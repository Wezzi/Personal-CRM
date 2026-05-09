import { useEffect, useMemo, useState } from "react";
import { Alert, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
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
import { captureAnalyticsEvent } from "../lib/analytics";
import { radius, useTheme, useThemedStyles } from "../theme/tokens";

type ContactMethod = "whatsapp" | "sms" | "email" | "linkedin";

type TimelineItem = {
  id: string;
  createdAt: string;
  label: string;
};

type PersonQuickActionsButtonProps = {
  person: PersonInsight;
  onChanged?: () => void | Promise<void>;
  onEdit?: () => void;
};

type SavedQuickActionState = {
  personId: string;
  modal: "draft" | "reminder" | "status";
  draftText: string;
  selectedMethod: ContactMethod | null;
  customReminderDate: string;
  selectedStatus: string;
  statusNextAction: string;
  statusFollowUpDate: string;
};

const QUICK_ACTION_STATE_STORAGE_KEY = "blackbook.quick_action_state";

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
    person.phoneNumber ? { method: "whatsapp" as const, label: "WhatsApp message" } : null,
    person.phoneNumber ? { method: "sms" as const, label: "Text message" } : null,
    person.email ? { method: "email" as const, label: "Email Draft" } : null,
    person.linkedinUrl ? { method: "linkedin" as const, label: "LinkedIn Draft" } : null,
  ].filter(Boolean) as Array<{ method: ContactMethod; label: string }>;
}

function getPrimaryGoal(person: PersonInsight) {
  return person.tags.find((tag) =>
    /business|client|hire|hiring|partner|interesting|other/i.test(tag)
  ) || person.tags[0] || "Relationship";
}

function getStatusOptionsForGoal(goal: string) {
  const normalized = goal.toLowerCase();

  if (/hire|hiring|new hire/.test(normalized)) {
    return ["Intro chat", "Role fit", "CV / portfolio check", "Interview", "Pass to hiring manager", "Final stage", "Done", "Not a fit"];
  }

  if (/business|client|sales|opportunity/.test(normalized)) {
    return ["New lead", "Qualified", "Needs follow-up", "Meeting booked", "Proposal sent", "Negotiating", "Converted", "Not relevant"];
  }

  if (/partner/.test(normalized)) {
    return ["Intro chat", "Shared context", "Opportunity mapped", "Intro made", "Collab in progress", "Done", "Not relevant"];
  }

  if (/interesting/.test(normalized)) {
    return ["Captured", "Worth revisiting", "Intro opportunity", "Keep warm", "Done"];
  }

  return ["Captured", "Needs follow-up", "Meeting booked", "Intro made", "Keep warm", "Done", "Not relevant"];
}

function toTimelineLabel(rawNote: string, eventName?: string | null) {
  const firstLine = rawNote.split(/\r?\n/).find((line) => line.trim())?.trim() || "Note added";
  const followUpDate = extractFollowUpDate(rawNote);
  const updateTypeMatch = rawNote.match(/^Update type:\s*(.+)$/im);
  const relationshipStatusMatch = rawNote.match(/^Relationship status:\s*(.+)$/im);
  const updateNote = rawNote
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) =>
      line &&
      !/^Update type:/i.test(line) &&
      !/^Status:/i.test(line) &&
      !/^Relationship goal:/i.test(line) &&
      !/^Relationship status:/i.test(line) &&
      !/^Next step:/i.test(line) &&
      !/^Follow up date:/i.test(line)
    );

  if (/^Contacted today\.?$/i.test(firstLine)) {
    return "Marked contacted";
  }

  if (updateTypeMatch?.[1]) {
    return `${updateTypeMatch[1].trim()}: ${updateNote || "Update logged"}`.slice(0, 120);
  }

  if (relationshipStatusMatch?.[1]) {
    return `Status updated: ${relationshipStatusMatch[1].trim()}`.slice(0, 120);
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

export function PersonQuickActionsButton({ person, onChanged, onEdit }: PersonQuickActionsButtonProps) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [isMenuOpen, setMenuOpen] = useState(false);
  const [isDraftOpen, setDraftOpen] = useState(false);
  const [isReminderOpen, setReminderOpen] = useState(false);
  const [isStatusOpen, setStatusOpen] = useState(false);
  const [isTimelineOpen, setTimelineOpen] = useState(false);
  const [draftText, setDraftText] = useState("");
  const [selectedMethod, setSelectedMethod] = useState<ContactMethod | null>(null);
  const [customReminderDate, setCustomReminderDate] = useState("");
  const [selectedStatus, setSelectedStatus] = useState("");
  const [statusNextAction, setStatusNextAction] = useState("");
  const [statusFollowUpDate, setStatusFollowUpDate] = useState("");
  const [timelineItems, setTimelineItems] = useState<TimelineItem[]>([]);
  const [isTimelineLoading, setTimelineLoading] = useState(false);

  const contactMethods = useMemo(() => getContactMethods(person), [person]);
  const primaryGoal = useMemo(() => getPrimaryGoal(person), [person]);
  const statusOptions = useMemo(() => getStatusOptionsForGoal(primaryGoal), [primaryGoal]);
  const groupedTimeline = useMemo(() => groupTimeline(timelineItems), [timelineItems]);

  useEffect(() => {
    let isMounted = true;

    async function hydrateQuickActionState() {
      const rawState = await AsyncStorage.getItem(QUICK_ACTION_STATE_STORAGE_KEY);
      if (!rawState) {
        return;
      }

      try {
        const savedState = JSON.parse(rawState) as SavedQuickActionState;
        if (!isMounted || savedState.personId !== person.id) {
          return;
        }

        setDraftText(savedState.draftText);
        setSelectedMethod(savedState.selectedMethod);
        setCustomReminderDate(savedState.customReminderDate);
        setSelectedStatus(savedState.selectedStatus || "");
        setStatusNextAction(savedState.statusNextAction || "");
        setStatusFollowUpDate(savedState.statusFollowUpDate || "");
        setDraftOpen(savedState.modal === "draft");
        setReminderOpen(savedState.modal === "reminder");
        setStatusOpen(savedState.modal === "status");
      } catch {
        await AsyncStorage.removeItem(QUICK_ACTION_STATE_STORAGE_KEY);
      }
    }

    void hydrateQuickActionState();

    return () => {
      isMounted = false;
    };
  }, [person.id]);

  useEffect(() => {
    async function persistQuickActionState() {
      if (!isDraftOpen && !isReminderOpen && !isStatusOpen) {
        return;
      }

      const payload: SavedQuickActionState = {
        personId: person.id,
        modal: isDraftOpen ? "draft" : isReminderOpen ? "reminder" : "status",
        draftText,
        selectedMethod,
        customReminderDate,
        selectedStatus,
        statusNextAction,
        statusFollowUpDate,
      };
      await AsyncStorage.setItem(QUICK_ACTION_STATE_STORAGE_KEY, JSON.stringify(payload));
    }

    void persistQuickActionState();
  }, [customReminderDate, draftText, isDraftOpen, isReminderOpen, isStatusOpen, person.id, selectedMethod, selectedStatus, statusFollowUpDate, statusNextAction]);

  async function clearQuickActionState() {
    await AsyncStorage.removeItem(QUICK_ACTION_STATE_STORAGE_KEY);
  }

  function closeMenu() {
    setMenuOpen(false);
  }

  function closeDraft() {
    void clearQuickActionState();
    setDraftOpen(false);
  }

  function closeReminder() {
    void clearQuickActionState();
    setReminderOpen(false);
  }

  function closeStatus() {
    void clearQuickActionState();
    setStatusOpen(false);
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
    const label = method === "whatsapp" ? "WhatsApp" : method === "sms" ? "Text message" : method === "email" ? "Email" : "LinkedIn";
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
        await Clipboard.setStringAsync(message);
        const digits = person.phoneNumber.replace(/[^\d+]/g, "").replace(/^00/, "+");
        const normalizedPhone = digits.startsWith("+") ? digits.slice(1) : digits;
        const url = Platform.OS === "web"
          ? `https://wa.me/${normalizedPhone}?text=${encodedMessage}`
          : `whatsapp://send?phone=${normalizedPhone}&text=${encodedMessage}`;
        Alert.alert("Draft ready", "Your WhatsApp message has been copied and opened.");
        await Linking.openURL(url);
      }

      if (selectedMethod === "sms") {
        if (!person.phoneNumber) throw new Error("No phone number is saved for this person.");
        await Clipboard.setStringAsync(message);
        const separator = Platform.OS === "ios" ? "&" : "?";
        const url = `sms:${encodeURIComponent(person.phoneNumber)}${separator}body=${encodedMessage}`;
        Alert.alert("Draft ready", "Your text message has been copied and opened.");
        await Linking.openURL(url);
      }

      if (selectedMethod === "linkedin") {
        if (!person.linkedinUrl) throw new Error("No LinkedIn profile is saved for this person.");
        await Clipboard.setStringAsync(message);
        Alert.alert("Message copied", "Your LinkedIn draft is copied to clipboard and ready to paste.");
        await Linking.openURL(person.linkedinUrl);
      }

      await logDraft(selectedMethod);
      setDraftOpen(false);
      await clearQuickActionState();
      await refreshParent();
    } catch (error) {
      Alert.alert("Follow-up failed", error instanceof Error ? error.message : "Could not open that follow-up method.");
    }
  }

  function openReminder() {
    setCustomReminderDate(person.nextFollowUpAt || getPresetDate("tomorrow"));
    closeMenu();
    setReminderOpen(true);
  }

  function openStatus() {
    setSelectedStatus(person.relationshipStatus || statusOptions[0] || "Needs follow-up");
    setStatusNextAction(person.nextStep || "");
    setStatusFollowUpDate(person.nextFollowUpAt || getPresetDate("tomorrow"));
    closeMenu();
    setStatusOpen(true);
  }

  async function saveStatus() {
    const status = selectedStatus.trim();
    const nextAction = statusNextAction.trim();
    const followUpDate = statusFollowUpDate.trim();

    if (!status) {
      Alert.alert("Choose a status", "Pick where this relationship is now.");
      return;
    }

    if (followUpDate && !parseDateOnlyString(followUpDate)) {
      Alert.alert("Invalid date", "Use YYYY-MM-DD for the follow-up date.");
      return;
    }

    try {
      const userId = await ensureSessionUserId();
      await createInteraction({
        userId,
        personId: person.id,
        rawNote: [
          `Relationship goal: ${primaryGoal}`,
          `Relationship status: ${status}`,
          nextAction ? `Next step: ${nextAction}` : null,
          followUpDate ? `Follow up date: ${followUpDate}` : null,
        ].filter(Boolean).join("\n"),
      });
      setStatusOpen(false);
      await clearQuickActionState();
      await refreshParent();
      void captureAnalyticsEvent("relationship_status_updated", {
        goal: primaryGoal,
        status,
        has_next_action: Boolean(nextAction),
        has_follow_up_date: Boolean(followUpDate),
      });
      Alert.alert("Status updated", `${person.name} is now at ${status}.`);
    } catch (error) {
      Alert.alert("Status failed", error instanceof Error ? error.message : "Could not update this status.");
    }
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
      await clearQuickActionState();
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
            <Button label="Mark contacted" onPress={() => void handleMarkContacted()} variant="ghost" />
            <Button label="Draft follow-up" onPress={openDraft} variant="ghost" disabled={!contactMethods.length} />
            <Button label="Update status" onPress={openStatus} variant="ghost" />
            <Button label="Set follow-up date" onPress={openReminder} variant="ghost" />
            {onEdit ? <Button label="Edit contact" onPress={onEdit} variant="ghost" /> : null}
            <Button label="Timeline" onPress={() => void openTimeline()} variant="ghost" />
            <Button label="Close" onPress={closeMenu} variant="ghost" />
          </Card>
        </View>
      </Modal>

      <Modal visible={isStatusOpen} transparent animationType="fade" onRequestClose={closeStatus}>
        <View style={styles.overlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={closeStatus} />
          <Card style={styles.modalCard}>
            <Typography variant="caption">Relationship status</Typography>
            <Typography variant="h2">{person.name}</Typography>
            <Typography variant="body" style={styles.helperText}>Goal: {primaryGoal}</Typography>
            <View style={styles.methodRow}>
              {statusOptions.map((status) => (
                <Button
                  key={status}
                  label={status}
                  onPress={() => setSelectedStatus(status)}
                  variant={selectedStatus === status ? "primary" : "ghost"}
                  fullWidth={false}
                  size="compact"
                />
              ))}
            </View>
            <Typography variant="caption">Next action</Typography>
            <TextInput
              value={statusNextAction}
              onChangeText={setStatusNextAction}
              multiline
              style={styles.textAreaCompact}
              placeholder="Ask for CV, book intro call, send proposal..."
              placeholderTextColor={colors.textTertiary}
            />
            <Typography variant="caption">Follow-up</Typography>
            <View style={styles.methodRow}>
              <Button
                label="Tomorrow"
                onPress={() => setStatusFollowUpDate(getPresetDate("tomorrow"))}
                variant={statusFollowUpDate === getPresetDate("tomorrow") ? "primary" : "ghost"}
                fullWidth={false}
                size="compact"
              />
              <Button
                label="In 3 days"
                onPress={() => setStatusFollowUpDate(getPresetDate("in3days"))}
                variant={statusFollowUpDate === getPresetDate("in3days") ? "primary" : "ghost"}
                fullWidth={false}
                size="compact"
              />
              <Button
                label="Next week"
                onPress={() => setStatusFollowUpDate(getPresetDate("nextWeek"))}
                variant={statusFollowUpDate === getPresetDate("nextWeek") ? "primary" : "ghost"}
                fullWidth={false}
                size="compact"
              />
            </View>
            <TextInput
              value={statusFollowUpDate}
              onChangeText={setStatusFollowUpDate}
              style={styles.input}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <View style={styles.actionRow}>
              <Button label="Cancel" onPress={closeStatus} variant="ghost" fullWidth={false} size="compact" />
              <Button label="Save status" onPress={() => void saveStatus()} fullWidth={false} size="compact" />
            </View>
          </Card>
        </View>
      </Modal>

      <Modal visible={isDraftOpen} transparent animationType="fade" onRequestClose={closeDraft}>
        <View style={styles.overlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={closeDraft} />
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
              <Button label="Cancel" onPress={closeDraft} variant="ghost" fullWidth={false} size="compact" />
              <Button label="Continue" onPress={() => void handleSendDraft()} fullWidth={false} size="compact" />
            </View>
          </Card>
        </View>
      </Modal>

      <Modal visible={isReminderOpen} transparent animationType="fade" onRequestClose={closeReminder}>
        <View style={styles.overlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={closeReminder} />
          <Card style={styles.modalCard}>
            <Typography variant="h2">Set follow-up date</Typography>
            <View style={styles.methodRow}>
              <Button
                label="Tomorrow"
                onPress={() => setCustomReminderDate(getPresetDate("tomorrow"))}
                variant={customReminderDate === getPresetDate("tomorrow") ? "primary" : "ghost"}
                fullWidth={false}
                size="compact"
              />
              <Button
                label="In 3 days"
                onPress={() => setCustomReminderDate(getPresetDate("in3days"))}
                variant={customReminderDate === getPresetDate("in3days") ? "primary" : "ghost"}
                fullWidth={false}
                size="compact"
              />
              <Button
                label="Next week"
                onPress={() => setCustomReminderDate(getPresetDate("nextWeek"))}
                variant={customReminderDate === getPresetDate("nextWeek") ? "primary" : "ghost"}
                fullWidth={false}
                size="compact"
              />
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
              <Button label="Cancel" onPress={closeReminder} variant="ghost" fullWidth={false} size="compact" />
              <Button label="Save follow-up date" onPress={() => void setReminder(customReminderDate.trim())} fullWidth={false} size="compact" />
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
                    <Pressable
                      key={item.id}
                      style={styles.timelineItem}
                      onPress={() => Alert.alert("Timeline detail", `${item.label}\n\n${formatDateTime(item.createdAt)}`)}
                    >
                      <Typography variant="body" numberOfLines={1} style={styles.timelineItemText}>{item.label}</Typography>
                      <Typography variant="caption">{formatDateTime(item.createdAt)}</Typography>
                    </Pressable>
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

const createStyles = (colors: ReturnType<typeof useTheme>["colors"]) => StyleSheet.create({
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
  helperText: {
    color: colors.textSecondary,
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
  textAreaCompact: {
    minHeight: 88,
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
