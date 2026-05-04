import { useMemo, useState } from "react";
import { Alert, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import * as Clipboard from "expo-clipboard";

import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { Typography } from "./ui/Typography";
import {
  buildReconnectDraft,
  createInteraction,
  ensureSessionUserId,
  extractFollowUpDate,
  extractPrimaryNote,
  formatDateTime,
  formatFollowUpDate,
  getPresetDate,
  listPersonInteractions,
  markPersonContactedToday,
  parseDateOnlyString,
  PersonInsight,
} from "../lib/crm";
import { colors, radius } from "../theme/tokens";

type ContactMethod = "whatsapp" | "email" | "linkedin" | "phone";

type TimelineItem = {
  id: string;
  createdAt: string;
  label: string;
};

type PersonQuickActionsButtonProps = {
  person: PersonInsight;
  onChanged?: () => void | Promise<void>;
};

function buildMessageForPerson(person: PersonInsight) {
  return buildReconnectDraft({
    name: person.name,
    eventName: person.lastEventName,
    lastInteractionNote: person.lastInteractionNote,
    followUp: person.followUp,
  });
}

function getContactMethods(person: PersonInsight) {
  return [
    person.phoneNumber ? { method: "whatsapp" as const, label: "WhatsApp Draft" } : null,
    person.email ? { method: "email" as const, label: "Email Draft" } : null,
    person.linkedinUrl ? { method: "linkedin" as const, label: "LinkedIn Draft" } : null,
    person.phoneNumber ? { method: "phone" as const, label: "Call" } : null,
  ].filter(Boolean) as Array<{ method: ContactMethod; label: string }>;
}

function toTimelineLabel(rawNote: string, eventName?: string | null) {
  const firstLine = rawNote.split(/\r?\n/).find((line) => line.trim())?.trim() || "Note added";
  const followUpDate = extractFollowUpDate(rawNote);
  const updateTypeMatch = rawNote.match(/^Update type:\s*(.+)$/im);
  const updateNote = rawNote
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) =>
      line &&
      !/^Update type:/i.test(line) &&
      !/^Status:/i.test(line) &&
      !/^Next step:/i.test(line) &&
      !/^Follow up date:/i.test(line)
    );

  if (/^Contacted today\.?$/i.test(firstLine)) {
    return "Marked contacted";
  }

  if (updateTypeMatch?.[1]) {
    return `${updateTypeMatch[1].trim()}: ${updateNote || "Update logged"}`.slice(0, 120);
  }

  if (/^Reminder set\.?$/i.test(firstLine) || followUpDate) {
    return followUpDate ? `Reminder set: ${formatFollowUpDate(followUpDate)}` : "Reminder set";
  }

  if (/^Follow-up drafted via/i.test(firstLine)) {
    return firstLine;
  }

  const primaryNote = extractPrimaryNote(rawNote) || firstLine;
  const prefix = eventName ? `Met at ${eventName}` : "Note added";
  return `${prefix}: ${primaryNote}`.slice(0, 120);
}

function groupTimeline(items: TimelineItem[]) {
  const groups = new Map<string, TimelineItem[]>();
  items.forEach((item) => {
    const label = new Date(item.createdAt).toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
    const current = groups.get(label) || [];
    current.push(item);
    groups.set(label, current);
  });

  return Array.from(groups.entries()).map(([dateLabel, groupItems]) => ({
    dateLabel,
    items: groupItems,
  }));
}

export function PersonQuickActionsButton({ person, onChanged }: PersonQuickActionsButtonProps) {
  const [isMenuOpen, setMenuOpen] = useState(false);
  const [isDraftOpen, setDraftOpen] = useState(false);
  const [isReminderOpen, setReminderOpen] = useState(false);
  const [isTimelineOpen, setTimelineOpen] = useState(false);
  const [draftText, setDraftText] = useState("");
  const [selectedMethod, setSelectedMethod] = useState<ContactMethod | null>(null);
  const [customReminderDate, setCustomReminderDate] = useState("");
  const [timelineItems, setTimelineItems] = useState<TimelineItem[]>([]);
  const [isTimelineLoading, setTimelineLoading] = useState(false);

  const contactMethods = useMemo(() => getContactMethods(person), [person]);
  const groupedTimeline = useMemo(() => groupTimeline(timelineItems), [timelineItems]);

  function closeMenu() {
    setMenuOpen(false);
  }

  async function refreshParent() {
    await onChanged?.();
  }

  async function handleMarkContacted() {
    try {
      const userId = await ensureSessionUserId();
      await markPersonContactedToday(userId, person.id);
      closeMenu();
      await refreshParent();
      Alert.alert("Marked contacted", `${person.name} is up to date for today.`);
    } catch (error) {
      Alert.alert("Could not mark contacted", error instanceof Error ? error.message : "Could not mark this contact.");
    }
  }

  function openDraft() {
    const preferred = person.preferredChannel
      ? contactMethods.find((item) => item.method === person.preferredChannel)
      : null;
    setSelectedMethod(preferred?.method || contactMethods[0]?.method || null);
    setDraftText(buildMessageForPerson(person));
    closeMenu();
    setDraftOpen(true);
  }

  async function logDraft(method: ContactMethod) {
    const userId = await ensureSessionUserId();
    const label = method === "whatsapp" ? "WhatsApp" : method === "email" ? "Email" : method === "linkedin" ? "LinkedIn" : "Phone";
    await createInteraction({
      userId,
      personId: person.id,
      rawNote: `Follow-up drafted via ${label}.`,
    });
  }

  async function handleSendDraft() {
    if (!selectedMethod) {
      Alert.alert("Choose a method", "Pick how you want to follow up first.");
      return;
    }

    const message = draftText.trim() || buildMessageForPerson(person);
    const encodedMessage = encodeURIComponent(message);

    try {
      if (selectedMethod === "email") {
        if (!person.email) throw new Error("No email address is saved for this person.");
        const subject = person.lastEventName ? `Following up from ${person.lastEventName}` : `Following up with ${person.name}`;
        await Linking.openURL(`mailto:${encodeURIComponent(person.email)}?subject=${encodeURIComponent(subject)}&body=${encodedMessage}`);
      }

      if (selectedMethod === "whatsapp") {
        if (!person.phoneNumber) throw new Error("No WhatsApp number is saved for this person.");
        const digits = person.phoneNumber.replace(/[^\d+]/g, "").replace(/^00/, "+");
        const normalizedPhone = digits.startsWith("+") ? digits.slice(1) : digits;
        const url = Platform.OS === "web"
          ? `https://wa.me/${normalizedPhone}?text=${encodedMessage}`
          : `whatsapp://send?phone=${normalizedPhone}&text=${encodedMessage}`;
        await Linking.openURL(url);
      }

      if (selectedMethod === "linkedin") {
        if (!person.linkedinUrl) throw new Error("No LinkedIn profile is saved for this person.");
        await Clipboard.setStringAsync(message);
        Alert.alert("Message copied", "Your LinkedIn draft is copied to clipboard and ready to paste.");
        await Linking.openURL(person.linkedinUrl);
      }

      if (selectedMethod === "phone") {
        if (!person.phoneNumber) throw new Error("No phone number is saved for this person.");
        await Linking.openURL(`tel:${person.phoneNumber}`);
      }

      await logDraft(selectedMethod);
      setDraftOpen(false);
      await refreshParent();
    } catch (error) {
      Alert.alert("Follow-up failed", error instanceof Error ? error.message : "Could not open that follow-up method.");
    }
  }

  function openReminder() {
    setCustomReminderDate("");
    closeMenu();
    setReminderOpen(true);
  }

  async function setReminder(date: string) {
    if (!parseDateOnlyString(date)) {
      Alert.alert("Invalid date", "Use YYYY-MM-DD for a custom reminder.");
      return;
    }

    try {
      const userId = await ensureSessionUserId();
      await createInteraction({
        userId,
        personId: person.id,
        rawNote: `Reminder set.\nNext step: Follow up\nFollow up date: ${date}`,
      });
      setReminderOpen(false);
      await refreshParent();
      Alert.alert("Reminder set", `${person.name} will surface on ${formatFollowUpDate(date)}.`);
    } catch (error) {
      Alert.alert("Reminder failed", error instanceof Error ? error.message : "Could not set this reminder.");
    }
  }

  async function openTimeline() {
    closeMenu();
    setTimelineOpen(true);
    setTimelineLoading(true);

    try {
      const userId = await ensureSessionUserId();
      const interactions = await listPersonInteractions(userId, person.id);
      const items: TimelineItem[] = [
        {
          id: `created-${person.id}`,
          createdAt: person.createdAt,
          label: "Contact created",
        },
        ...interactions.map((interaction) => ({
          id: interaction.id,
          createdAt: interaction.created_at,
          label: toTimelineLabel(interaction.raw_note, interaction.events?.name),
        })),
      ].sort((left, right) => right.createdAt.localeCompare(left.createdAt));

      setTimelineItems(items);
    } catch (error) {
      Alert.alert("Timeline failed", error instanceof Error ? error.message : "Could not load this timeline.");
      setTimelineOpen(false);
    } finally {
      setTimelineLoading(false);
    }
  }

  return (
    <>
      <Pressable
        onPress={() => setMenuOpen(true)}
        hitSlop={10}
        style={styles.trigger}
        accessibilityRole="button"
        accessibilityLabel={`Quick actions for ${person.name}`}
      >
        <Typography variant="body" style={styles.triggerText}>...</Typography>
      </Pressable>

      <Modal visible={isMenuOpen} transparent animationType="fade" onRequestClose={closeMenu}>
        <View style={styles.overlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={closeMenu} />
          <Card style={styles.menuCard}>
            <Typography variant="caption">Quick actions</Typography>
            <Typography variant="h2">{person.name}</Typography>
            <Button label="Mark contacted" onPress={() => void handleMarkContacted()} />
            <Button label="Draft follow-up" onPress={openDraft} variant="ghost" disabled={!contactMethods.length} />
            <Button label="Remind me" onPress={openReminder} variant="ghost" />
            <Button label="Timeline" onPress={() => void openTimeline()} variant="ghost" />
            <Button label="Close" onPress={closeMenu} variant="ghost" />
          </Card>
        </View>
      </Modal>

      <Modal visible={isDraftOpen} transparent animationType="fade" onRequestClose={() => setDraftOpen(false)}>
        <View style={styles.overlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setDraftOpen(false)} />
          <Card style={styles.modalCard}>
            <Typography variant="h2">Draft follow-up</Typography>
            <View style={styles.methodRow}>
              {contactMethods.map((item) => (
                <Button
                  key={item.method}
                  label={item.label}
                  onPress={() => setSelectedMethod(item.method)}
                  variant={selectedMethod === item.method ? "primary" : "ghost"}
                  fullWidth={false}
                  size="compact"
                />
              ))}
            </View>
            <TextInput
              value={draftText}
              onChangeText={setDraftText}
              multiline
              style={styles.textArea}
              placeholder="Write your follow-up"
              placeholderTextColor={colors.textTertiary}
            />
            <View style={styles.actionRow}>
              <Button label="Cancel" onPress={() => setDraftOpen(false)} variant="ghost" fullWidth={false} size="compact" />
              <Button label="Continue" onPress={() => void handleSendDraft()} fullWidth={false} size="compact" />
            </View>
          </Card>
        </View>
      </Modal>

      <Modal visible={isReminderOpen} transparent animationType="fade" onRequestClose={() => setReminderOpen(false)}>
        <View style={styles.overlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setReminderOpen(false)} />
          <Card style={styles.modalCard}>
            <Typography variant="h2">Set reminder</Typography>
            <View style={styles.methodRow}>
              <Button label="Tomorrow" onPress={() => void setReminder(getPresetDate("tomorrow"))} fullWidth={false} size="compact" />
              <Button label="In 3 days" onPress={() => void setReminder(getPresetDate("in3days"))} variant="ghost" fullWidth={false} size="compact" />
              <Button label="Next week" onPress={() => void setReminder(getPresetDate("nextWeek"))} variant="ghost" fullWidth={false} size="compact" />
            </View>
            <TextInput
              value={customReminderDate}
              onChangeText={setCustomReminderDate}
              style={styles.input}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <View style={styles.actionRow}>
              <Button label="Cancel" onPress={() => setReminderOpen(false)} variant="ghost" fullWidth={false} size="compact" />
              <Button label="Set custom" onPress={() => void setReminder(customReminderDate.trim())} fullWidth={false} size="compact" />
            </View>
          </Card>
        </View>
      </Modal>

      <Modal visible={isTimelineOpen} transparent animationType="fade" onRequestClose={() => setTimelineOpen(false)}>
        <View style={styles.overlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setTimelineOpen(false)} />
          <Card style={styles.timelineCard}>
            <View style={styles.timelineHeader}>
              <View style={styles.timelineTitle}>
                <Typography variant="caption">Timeline</Typography>
                <Typography variant="h2">{person.name}</Typography>
              </View>
              <Button label="Close" onPress={() => setTimelineOpen(false)} variant="ghost" fullWidth={false} size="compact" />
            </View>
            <ScrollView style={styles.timelineList} contentContainerStyle={styles.timelineContent}>
              {isTimelineLoading ? <Typography variant="body">Loading timeline...</Typography> : null}
              {!isTimelineLoading && groupedTimeline.map((group) => (
                <View key={group.dateLabel} style={styles.timelineGroup}>
                  <Typography variant="caption">{group.dateLabel}</Typography>
                  {group.items.map((item) => (
                    <View key={item.id} style={styles.timelineItem}>
                      <Typography variant="body" numberOfLines={1} style={styles.timelineItemText}>{item.label}</Typography>
                      <Typography variant="caption">{formatDateTime(item.createdAt)}</Typography>
                    </View>
                  ))}
                </View>
              ))}
            </ScrollView>
          </Card>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    minWidth: 38,
    minHeight: 38,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  triggerText: {
    color: colors.primaryAction,
    fontWeight: "700",
  },
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.28)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  menuCard: {
    width: "100%",
    maxWidth: 420,
    gap: 10,
  },
  modalCard: {
    width: "100%",
    maxWidth: 560,
    gap: 12,
  },
  methodRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  actionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    gap: 8,
  },
  input: {
    minHeight: 48,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    color: colors.textPrimary,
    paddingHorizontal: 14,
    fontSize: 15,
  },
  textArea: {
    minHeight: 120,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    color: colors.textPrimary,
    paddingHorizontal: 14,
    paddingVertical: 12,
    textAlignVertical: "top",
    fontSize: 15,
    lineHeight: 22,
  },
  timelineCard: {
    width: "100%",
    maxWidth: 640,
    maxHeight: "82%",
    gap: 12,
  },
  timelineHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
  },
  timelineTitle: {
    flex: 1,
    gap: 4,
  },
  timelineList: {
    maxHeight: 520,
  },
  timelineContent: {
    gap: 16,
  },
  timelineGroup: {
    gap: 8,
  },
  timelineItem: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 4,
  },
  timelineItemText: {
    color: colors.textPrimary,
  },
});
