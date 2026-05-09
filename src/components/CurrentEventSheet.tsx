
import { useEffect, useState } from "react";
import { Modal, SafeAreaView, ScrollView, StyleSheet, TextInput, View, useWindowDimensions } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { EVENT_CATEGORY_OPTIONS, EventCategory, formatCategoryLabel } from "../lib/crm";
import { layout, radius, useTheme, useThemedStyles } from "../theme/tokens";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { Typography } from "./ui/Typography";

export type CurrentEventValue = {
  name: string;
  category: EventCategory;
  eventDate?: string | null;
  customCategoryLabel?: string | null;
};

type CurrentEventSheetProps = {
  visible: boolean;
  value: CurrentEventValue | null;
  onClose: () => void;
  onSave: (value: CurrentEventValue) => void;
  onClear: () => void;
  draftStorageKey?: string;
};

function formatCurrentEventType(value: CurrentEventValue | { category: EventCategory; customCategoryLabel?: string | null }) {
  if (value.category === "other" && value.customCategoryLabel?.trim()) {
    return value.customCategoryLabel.trim();
  }

  return formatCategoryLabel(value.category);
}

function toDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getRelativeDateInputValue(offsetDays: number) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + offsetDays);
  return toDateInputValue(date);
}

type CurrentEventDraft = {
  name: string;
  category: EventCategory;
  eventDate: string;
  customCategoryLabel: string;
};

export function CurrentEventSheet({ visible, value, onClose, onSave, onClear, draftStorageKey }: CurrentEventSheetProps) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { width } = useWindowDimensions();
  const isCompactLayout = width < 720;
  const [name, setName] = useState("");
  const [category, setCategory] = useState<EventCategory>("networking");
  const [eventDate, setEventDate] = useState("");
  const [customCategoryLabel, setCustomCategoryLabel] = useState("");
  const [hasHydratedDraft, setHasHydratedDraft] = useState(false);

  useEffect(() => {
    if (!visible) {
      return;
    }

    let isMounted = true;

    async function hydrateDraft() {
      setHasHydratedDraft(false);
      let savedDraft: CurrentEventDraft | null = null;
      if (draftStorageKey) {
        const rawDraft = await AsyncStorage.getItem(draftStorageKey);
        if (rawDraft) {
          try {
            savedDraft = JSON.parse(rawDraft) as CurrentEventDraft;
          } catch {
            await AsyncStorage.removeItem(draftStorageKey);
          }
        }
      }

      if (!isMounted) {
        return;
      }

      const draft = value ? null : savedDraft;
      setName(value?.name ?? draft?.name ?? "");
      setCategory(value?.category ?? draft?.category ?? "networking");
      setEventDate(value?.eventDate ?? draft?.eventDate ?? "");
      setCustomCategoryLabel(value?.customCategoryLabel ?? draft?.customCategoryLabel ?? "");
      setHasHydratedDraft(true);
    }

    void hydrateDraft();

    return () => {
      isMounted = false;
    };
  }, [draftStorageKey, value, visible]);

  useEffect(() => {
    if (!visible || !draftStorageKey || !hasHydratedDraft) {
      return;
    }

    async function persistDraft() {
      await AsyncStorage.setItem(
        draftStorageKey as string,
        JSON.stringify({ name, category, eventDate, customCategoryLabel } satisfies CurrentEventDraft)
      );
    }

    void persistDraft();
  }, [category, customCategoryLabel, draftStorageKey, eventDate, hasHydratedDraft, name, visible]);

  function handleSave() {
    if (!name.trim()) {
      return;
    }

    if (draftStorageKey) {
      void AsyncStorage.removeItem(draftStorageKey);
    }

    onSave({
      name: name.trim(),
      category,
      eventDate: eventDate.trim() || null,
      customCategoryLabel: category === "other" ? customCategoryLabel.trim() || null : null,
    });
  }

  const quickDateChoices = [
    { label: "Yesterday", value: getRelativeDateInputValue(-1) },
    { label: "Today", value: getRelativeDateInputValue(0) },
    { label: "Tomorrow", value: getRelativeDateInputValue(1) },
  ];

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <SafeAreaView style={styles.safeArea}>
        <ScrollView
          style={styles.container}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.headerRow}>
            <Typography variant="h1">Set Current Event</Typography>
            <Button label="Close" onPress={onClose} variant="ghost" fullWidth={false} size="compact" />
          </View>

          <Card style={styles.heroCard}>
            <Typography variant="caption">Current mode</Typography>
            <Typography variant="body" style={styles.heroText}>
              Set this once and every new person or interaction will automatically inherit the same event context until you end the event.
            </Typography>
          </Card>

          <Card>
            <Typography variant="caption">Event name</Typography>
            <TextInput
              placeholder="Sifted Summit"
              placeholderTextColor={colors.textTertiary}
              value={name}
              onChangeText={setName}
              style={styles.input}
              autoFocus
            />

            <Typography variant="caption" style={styles.labelSpacing}>Event date</Typography>
            <View style={styles.datePillRow}>
              {quickDateChoices.map((option) => (
                <Button
                  key={option.value}
                  label={option.label}
                  onPress={() => setEventDate(option.value)}
                  variant={eventDate === option.value ? "primary" : "ghost"}
                  fullWidth={false}
                  size="compact"
                />
              ))}
            </View>
            <TextInput
              placeholder="2026-04-28"
              placeholderTextColor={colors.textTertiary}
              value={eventDate}
              onChangeText={setEventDate}
              style={styles.input}
              autoCapitalize="none"
              autoCorrect={false}
            />

            <Typography variant="caption" style={styles.labelSpacing}>Event type</Typography>
            <View style={styles.chipRow}>
              {EVENT_CATEGORY_OPTIONS.filter((option) => option.value !== "all").map((option) => (
                <Button
                  key={option.value}
                  label={option.label}
                  onPress={() => setCategory(option.value as EventCategory)}
                  variant={category === option.value ? "primary" : "ghost"}
                  fullWidth={false}
                  size="compact"
                />
              ))}
            </View>

            {category === "other" ? (
              <View style={styles.inlineInputTop}>
                <Typography variant="caption">Custom event type</Typography>
                <TextInput
                  placeholder="Private dinner, accelerator demo day..."
                  placeholderTextColor={colors.textTertiary}
                  value={customCategoryLabel}
                  onChangeText={setCustomCategoryLabel}
                  style={styles.input}
                />
              </View>
            ) : null}
          </Card>

          <Card>
            <Typography variant="caption">Preview</Typography>
            <Typography variant="body" style={styles.heroText}>
              New saves will tag to {name.trim() || "your event"} · {formatCurrentEventType({ category, customCategoryLabel })}.
              {eventDate.trim() ? ` Date: ${eventDate.trim()}.` : " Add a date now so next-day wrap-up can sync later."}
            </Typography>
          </Card>

          <View style={styles.footerButtons}>
            <Button label={isCompactLayout ? "Save event" : "Save Current Event"} onPress={handleSave} disabled={!name.trim()} />
            <Button label="Exit event mode" onPress={onClear} variant="ghost" />
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const createStyles = (colors: ReturnType<typeof useTheme>["colors"]) => StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingHorizontal: layout.screenPaddingHorizontal,
    paddingTop: layout.stackGap,
    paddingBottom: layout.stackGap * 2,
    gap: 18,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 12,
  },
  heroCard: {
    backgroundColor: colors.surfaceMuted,
  },
  heroText: {
    marginTop: 10,
    color: colors.textSecondary,
  },
  input: {
    marginTop: 10,
    minHeight: 52,
    borderRadius: radius.button,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    color: colors.textPrimary,
    paddingHorizontal: 16,
    fontSize: 16,
  },
  labelSpacing: {
    marginTop: 16,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 10,
  },
  datePillRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 10,
  },
  inlineInputTop: {
    marginTop: 16,
  },
  footerButtons: {
    gap: 12,
  },
});
