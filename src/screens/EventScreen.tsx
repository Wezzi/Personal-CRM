import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Modal,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Clipboard from "expo-clipboard";

import { CurrentEventValue } from "../components/CurrentEventSheet";
import { LiveEventBadge } from "../components/LiveEventBadge";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Typography } from "../components/ui/Typography";
import {
  EVENT_CATEGORY_OPTIONS,
  deleteEvent,
  ensureSessionUserId,
  formatCategoryLabel,
  formatEventDate,
  getOrCreateEvent,
  listAllInteractions,
  listEventInsights,
  listPeopleInsights,
  parseDateOnlyString,
  updateEventDetails,
} from "../lib/crm";
import { buildCampaignUrl } from "../lib/campaign";
import { buildPeopleCsv, exportCsvFile, getPeopleForEventExport } from "../lib/csvExport";
import { exportSlackCanvas } from "../lib/slackExport";
import { buildSlackCanvasSummary } from "../lib/slackCanvas";
import { layout, useTheme, useThemedStyles } from "../theme/tokens";

type SortMode = "recent" | "name" | "people" | "notes";

type EventEditorDraft = {
  name: string;
  category: (typeof EVENT_CATEGORY_OPTIONS)[number]["value"] | "";
  eventDate: string;
};

type EventScreenProps = {
  currentEvent: CurrentEventValue | null;
  onSetCurrentEvent?: (event: CurrentEventValue) => void;
  onEndCurrentEvent?: () => void;
  canExportCsv?: boolean;
  canManageCampaignLinks?: boolean;
  canDirectSlackCanvas?: boolean;
};

type SavedEventEditorState = {
  isOpen: boolean;
  mode: "create" | "edit";
  selectedEventId: string | null;
  draft: EventEditorDraft;
};

const EVENT_EDITOR_STATE_STORAGE_KEY = "blackbook.event_editor_state";

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

export function EventScreen({
  currentEvent,
  onSetCurrentEvent,
  onEndCurrentEvent,
  canExportCsv = false,
  canManageCampaignLinks = false,
  canDirectSlackCanvas = false,
}: EventScreenProps) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { width } = useWindowDimensions();
  const isCompactLayout = width < 720;
  const [isEventEditorOpen, setEventEditorOpen] = useState(false);
  const [isSavingEvent, setSavingEvent] = useState(false);
  const [isDeletingEvent, setDeletingEvent] = useState(false);
  const [isExportingCsv, setExportingCsv] = useState(false);
  const [isExportingSlackCanvas, setExportingSlackCanvas] = useState(false);
  const [isCopyingCampaignLink, setCopyingCampaignLink] = useState(false);
  const [isCopyingSlackCanvas, setCopyingSlackCanvas] = useState(false);
  const [deleteArmedEventId, setDeleteArmedEventId] = useState<string | null>(null);
  const [eventEditorMode, setEventEditorMode] = useState<"create" | "edit">("create");
  const [eventDraft, setEventDraft] = useState<EventEditorDraft>({ name: "", category: "", eventDate: getRelativeDateInputValue(0) });
  const [hasHydratedEventEditorState, setHasHydratedEventEditorState] = useState(false);
  const quickDateChoices = useMemo(
    () => [
      { label: "Yesterday", value: getRelativeDateInputValue(-1) },
      { label: "Today", value: getRelativeDateInputValue(0) },
      { label: "Tomorrow", value: getRelativeDateInputValue(1) },
    ],
    []
  );
  const [selectedCategory, setSelectedCategory] = useState<(typeof EVENT_CATEGORY_OPTIONS)[number]["value"]>("all");
  const [sortMode, setSortMode] = useState<SortMode>("recent");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [people, setPeople] = useState<Awaited<ReturnType<typeof listPeopleInsights>>>([]);
  const [interactions, setInteractions] = useState<Awaited<ReturnType<typeof listAllInteractions>>>([]);
  const [events, setEvents] = useState<Awaited<ReturnType<typeof listEventInsights>>>([]);
  const [isLoading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const filteredEvents = useMemo(() => {
    const categoryFiltered = events.filter(
      (event) => selectedCategory === "all" || event.category === selectedCategory
    );
    const query = searchQuery.trim().toLowerCase();
    const searchedEvents = !query
      ? categoryFiltered
      : categoryFiltered.filter((event) => event.name.toLowerCase().includes(query));

    return searchedEvents.sort((left, right) => {
      if (sortMode === "name") {
        return left.name.localeCompare(right.name);
      }

      if (sortMode === "people") {
        return right.peopleCount - left.peopleCount;
      }

      if (sortMode === "notes") {
        return right.interactionCount - left.interactionCount;
      }

      const leftValue = left.lastInteractionAt || left.createdAt;
      const rightValue = right.lastInteractionAt || right.createdAt;
      return rightValue.localeCompare(leftValue);
    });
  }, [events, searchQuery, selectedCategory, sortMode]);

  const selectedEvent = useMemo(() => {
    return filteredEvents.find((event) => event.id === selectedEventId) || filteredEvents[0] || null;
  }, [filteredEvents, selectedEventId]);

  const eventSummaryById = useMemo(() => {
    const personById = new Map(people.map((person) => [person.id, person]));
    const peopleByEventId = new Map<string, Set<string>>();

    interactions.forEach((interaction) => {
      if (!interaction.event_id || !interaction.person_id) {
        return;
      }

      const current = peopleByEventId.get(interaction.event_id) || new Set<string>();
      current.add(interaction.person_id);
      peopleByEventId.set(interaction.event_id, current);
    });

    const summaries = new Map<
      string,
      { peopleCount: number; dueToday: number; overdue: number; upcoming: number; followUpsDue: number }
    >();

    events.forEach((event) => {
      const personIds = peopleByEventId.get(event.id) || new Set<string>();
      let dueToday = 0;
      let overdue = 0;
      let upcoming = 0;

      personIds.forEach((personId) => {
        const person = personById.get(personId);
        if (person?.followUpState === "dueToday") {
          dueToday += 1;
        }
        if (person?.followUpState === "overdue") {
          overdue += 1;
        }
        if (person?.followUpState === "upcoming") {
          upcoming += 1;
        }
      });

      summaries.set(event.id, {
        peopleCount: personIds.size || event.peopleCount,
        dueToday,
        overdue,
        upcoming,
        followUpsDue: dueToday + overdue,
      });
    });

    return summaries;
  }, [events, interactions, people]);

  const selectedEventFollowUpSummary = selectedEvent
    ? eventSummaryById.get(selectedEvent.id) || {
        peopleCount: selectedEvent.peopleCount,
        dueToday: 0,
        overdue: 0,
        upcoming: 0,
        followUpsDue: 0,
      }
    : null;

  const currentEventInsight = useMemo(() => {
    if (!currentEvent) {
      return null;
    }

    const currentName = currentEvent.name.trim().toLowerCase();
    return events.find((event) => event.name.trim().toLowerCase() === currentName) || null;
  }, [currentEvent, events]);

  const currentEventSummary = useMemo(() => {
    if (!currentEvent) {
      return { peopleCount: 0, followUpsDue: 0 };
    }

    if (currentEventInsight) {
      const summary = eventSummaryById.get(currentEventInsight.id);
      return {
        peopleCount: summary?.peopleCount || currentEventInsight.peopleCount,
        followUpsDue: summary?.followUpsDue || 0,
      };
    }

    const currentName = currentEvent.name.trim().toLowerCase();
    const matchingPeople = people.filter((person) => person.lastEventName?.trim().toLowerCase() === currentName);

    return {
      peopleCount: matchingPeople.length,
      followUpsDue: matchingPeople.filter(
        (person) => person.followUpState === "dueToday" || person.followUpState === "overdue"
      ).length,
    };
  }, [currentEvent, currentEventInsight, eventSummaryById, people]);

  const groupedEvents = useMemo(() => {
    const groups = new Map<string, typeof filteredEvents>();

    filteredEvents.forEach((event) => {
      const key = event.category;
      const current = groups.get(key) || [];
      current.push(event);
      groups.set(key, current);
    });

    return Array.from(groups.entries()).map(([category, items]) => ({
      category,
      items,
    }));
  }, [filteredEvents]);

  async function loadEventData() {
    try {
      setLoading(true);
      setErrorMessage(null);

      const userId = await ensureSessionUserId();
      const [peopleInsights, eventInsights, allInteractions] = await Promise.all([
        listPeopleInsights(userId),
        listEventInsights(userId),
        listAllInteractions(userId),
      ]);
      setPeople(peopleInsights);
      setEvents(eventInsights);
      setInteractions(allInteractions);
      setDeleteArmedEventId(null);
      setSelectedEventId((current) => {
        if (current && eventInsights.some((event) => event.id === current)) {
          return current;
        }

        return eventInsights[0]?.id || null;
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load event data.";
      setErrorMessage(message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadEventData();
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function hydrateEventEditorState() {
      const rawState = await AsyncStorage.getItem(EVENT_EDITOR_STATE_STORAGE_KEY);
      if (!rawState) {
        if (isMounted) {
          setHasHydratedEventEditorState(true);
        }
        return;
      }

      try {
        const savedState = JSON.parse(rawState) as SavedEventEditorState;
        if (isMounted && savedState.isOpen) {
          setEventEditorMode(savedState.mode);
          setSelectedEventId(savedState.selectedEventId);
          setEventDraft(savedState.draft);
          setEventEditorOpen(true);
        }
      } catch {
        await AsyncStorage.removeItem(EVENT_EDITOR_STATE_STORAGE_KEY);
      } finally {
        if (isMounted) {
          setHasHydratedEventEditorState(true);
        }
      }
    }

    void hydrateEventEditorState();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!hasHydratedEventEditorState) {
      return;
    }

    async function persistEventEditorState() {
      const payload: SavedEventEditorState = {
        isOpen: isEventEditorOpen,
        mode: eventEditorMode,
        selectedEventId,
        draft: eventDraft,
      };
      await AsyncStorage.setItem(EVENT_EDITOR_STATE_STORAGE_KEY, JSON.stringify(payload));
    }

    void persistEventEditorState();
  }, [eventDraft, eventEditorMode, hasHydratedEventEditorState, isEventEditorOpen, selectedEventId]);

  async function clearEventEditorState() {
    await AsyncStorage.removeItem(EVENT_EDITOR_STATE_STORAGE_KEY);
  }

  function openCreateEvent() {
    setEventEditorMode("create");
    setEventDraft({
      name: currentEvent?.name || "",
      category: currentEvent?.category || "",
      eventDate: getRelativeDateInputValue(0),
    });
    void AsyncStorage.setItem(
      EVENT_EDITOR_STATE_STORAGE_KEY,
      JSON.stringify({
        isOpen: true,
        mode: "create",
        selectedEventId,
        draft: {
          name: currentEvent?.name || "",
          category: currentEvent?.category || "",
          eventDate: getRelativeDateInputValue(0),
        },
      } satisfies SavedEventEditorState)
    );
    setEventEditorOpen(true);
  }

  function openCreateEventWithName(name: string) {
    setEventEditorMode("create");
    setEventDraft({
      name,
      category: currentEvent?.category || "",
      eventDate: getRelativeDateInputValue(0),
    });
    void AsyncStorage.setItem(
      EVENT_EDITOR_STATE_STORAGE_KEY,
      JSON.stringify({
        isOpen: true,
        mode: "create",
        selectedEventId,
        draft: { name, category: currentEvent?.category || "", eventDate: getRelativeDateInputValue(0) },
      } satisfies SavedEventEditorState)
    );
    setEventEditorOpen(true);
  }

  function openEditEvent(targetEvent = selectedEvent) {
    if (!targetEvent) {
      return;
    }

    setEventEditorMode("edit");
    setSelectedEventId(targetEvent.id);
    setEventDraft({
      name: targetEvent.name,
      category: targetEvent.category,
      eventDate: targetEvent.eventDate || "",
    });
    void AsyncStorage.setItem(
      EVENT_EDITOR_STATE_STORAGE_KEY,
      JSON.stringify({
        isOpen: true,
        mode: "edit",
        selectedEventId: targetEvent.id,
        draft: {
          name: targetEvent.name,
          category: targetEvent.category,
          eventDate: targetEvent.eventDate || "",
        },
      } satisfies SavedEventEditorState)
    );
    setEventEditorOpen(true);
  }

  async function handleSaveEvent() {
    const name = eventDraft.name.trim();
    if (!name || isSavingEvent) {
      return;
    }

    if (eventDraft.eventDate && !parseDateOnlyString(eventDraft.eventDate)) {
      Alert.alert("Invalid date", "Use YYYY-MM-DD for the event date.");
      return;
    }

    try {
      setSavingEvent(true);
      const userId = await ensureSessionUserId();
      const category = eventDraft.category && eventDraft.category !== "all" ? eventDraft.category : null;
      const eventDate = eventDraft.eventDate.trim() || null;

      if (eventEditorMode === "edit" && selectedEvent) {
        await updateEventDetails({
          userId,
          eventId: selectedEvent.id,
          name,
          category,
          eventDate,
        });
      } else {
        const event = await getOrCreateEvent(userId, name, category, eventDate);
        setSelectedEventId(event.id);
      }

      setEventEditorOpen(false);
      await clearEventEditorState();
      await loadEventData();
      Alert.alert(
        eventEditorMode === "edit" ? "Event updated" : "Event added",
        eventEditorMode === "edit" ? `${name} is up to date.` : `${name} is ready for capture.`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save event.";
      Alert.alert("Could not save event", message);
    } finally {
      setSavingEvent(false);
    }
  }

  function closeEventEditor() {
    void clearEventEditorState();
    setEventEditorOpen(false);
  }

  function isCurrentEvent(event: (typeof events)[number]) {
    return currentEvent?.name.trim().toLowerCase() === event.name.trim().toLowerCase();
  }

  function handleSetCurrentEvent(event: (typeof events)[number]) {
    onSetCurrentEvent?.({
      name: event.name,
      category: event.category,
      eventDate: event.eventDate,
    });
  }

  function handleCurrentEventToggle(event: (typeof events)[number]) {
    if (isCurrentEvent(event)) {
      confirmEndCurrentEvent(event.name);
      return;
    }

    handleSetCurrentEvent(event);
  }

  function confirmEndCurrentEvent(eventName?: string) {
    Alert.alert(
      "End current event?",
      eventName
        ? `New captures will stop being added to ${eventName}. Existing people and notes stay saved.`
        : "New captures will stop being added to this event. Existing people and notes stay saved.",
      [
        { text: "Keep event live", style: "cancel" },
        { text: "End event", style: "destructive", onPress: () => onEndCurrentEvent?.() },
      ]
    );
  }

  async function handleDeleteEvent(targetEvent = selectedEvent) {
    if (!targetEvent) {
      return;
    }

    if (deleteArmedEventId !== targetEvent.id) {
      setDeleteArmedEventId(targetEvent.id);
      return;
    }

    try {
      setDeletingEvent(true);
      const userId = await ensureSessionUserId();
      await deleteEvent(userId, targetEvent.id);
      if (isCurrentEvent(targetEvent)) {
        onEndCurrentEvent?.();
      }
      await loadEventData();
      Alert.alert("Event removed", `${targetEvent.name} is gone. Existing contact notes are still safe.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to delete event.";
      Alert.alert("Could not delete event", message);
    } finally {
      setDeletingEvent(false);
      setDeleteArmedEventId(null);
    }
  }

  async function handleQuickCreateEvent() {
    const trimmedQuery = searchQuery.trim();
    if (!trimmedQuery || isSavingEvent) {
      return;
    }

    try {
      setSavingEvent(true);
      const userId = await ensureSessionUserId();
      const event = await getOrCreateEvent(userId, trimmedQuery, null, null);
      setSelectedEventId(event.id);
      setSearchQuery("");
      await loadEventData();
      Alert.alert("Event added", `${event.name} is now in your event list.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create event.";
      Alert.alert("Could not add event", message);
    } finally {
      setSavingEvent(false);
    }
  }

  async function handleExportCsv(targetEvent = selectedEvent) {
    if (!targetEvent || isExportingCsv) {
      return;
    }

    const exportPeople = getPeopleForEventExport({
      people,
      interactions,
      eventId: targetEvent.id,
      eventName: targetEvent.name,
      eventCategory: targetEvent.category,
      eventDate: targetEvent.eventDate,
    });

    if (!exportPeople.length) {
      Alert.alert("Nothing to export yet", "Capture at least one person for this event first.");
      return;
    }

    try {
      setExportingCsv(true);
      await exportCsvFile({
        csv: buildPeopleCsv(exportPeople),
        fileName: `${targetEvent.name} contacts`,
      });
    } catch (error) {
      Alert.alert("CSV export failed", error instanceof Error ? error.message : "Could not export this event.");
    } finally {
      setExportingCsv(false);
    }
  }

  async function handleCopyCampaignLink(targetEvent = selectedEvent) {
    if (!targetEvent || isCopyingCampaignLink) {
      return;
    }

    try {
      setCopyingCampaignLink(true);
      const url = buildCampaignUrl({
        name: targetEvent.name,
        category: targetEvent.category,
        eventDate: targetEvent.eventDate,
      });
      await Clipboard.setStringAsync(url);
      Alert.alert("Campaign link copied", "Send this link to testers so captures open inside this event.");
    } catch {
      Alert.alert("Could not copy campaign link", "Try again in a moment.");
    } finally {
      setCopyingCampaignLink(false);
    }
  }

  async function handleCopySlackCanvas(targetEvent = selectedEvent) {
    if (!targetEvent || isCopyingSlackCanvas) {
      return;
    }

    const exportPeople = getPeopleForEventExport({
      people,
      interactions,
      eventId: targetEvent.id,
      eventName: targetEvent.name,
      eventCategory: targetEvent.category,
      eventDate: targetEvent.eventDate,
    });

    if (!exportPeople.length) {
      Alert.alert("Nothing to summarise yet", "Capture at least one person for this event first.");
      return;
    }

    try {
      setCopyingSlackCanvas(true);
      await Clipboard.setStringAsync(
        buildSlackCanvasSummary({
          eventName: targetEvent.name,
          eventDate: targetEvent.eventDate,
          campaignLink: buildCampaignUrl({
            name: targetEvent.name,
            category: targetEvent.category,
            eventDate: targetEvent.eventDate,
          }),
          people: exportPeople,
        })
      );
      Alert.alert("Slack Canvas summary copied", "Paste it into a Slack Canvas or channel when you are ready.");
    } catch {
      Alert.alert("Could not copy summary", "Try again in a moment.");
    } finally {
      setCopyingSlackCanvas(false);
    }
  }

  function getSlackCanvasPayload(targetEvent: NonNullable<typeof selectedEvent>) {
    const exportPeople = getPeopleForEventExport({
      people,
      interactions,
      eventId: targetEvent.id,
      eventName: targetEvent.name,
      eventCategory: targetEvent.category,
      eventDate: targetEvent.eventDate,
    });

    if (!exportPeople.length) {
      return null;
    }

    return {
      title: `${targetEvent.name} follow-up summary`,
      markdown: buildSlackCanvasSummary({
        eventName: targetEvent.name,
        eventDate: targetEvent.eventDate,
        campaignLink: buildCampaignUrl({
          name: targetEvent.name,
          category: targetEvent.category,
          eventDate: targetEvent.eventDate,
        }),
        people: exportPeople,
      }),
    };
  }

  async function handleExportSlackCanvas(targetEvent = selectedEvent) {
    if (!targetEvent || isExportingSlackCanvas) {
      return;
    }

    const payload = getSlackCanvasPayload(targetEvent);
    if (!payload) {
      Alert.alert("Nothing to export yet", "Capture at least one person for this event first.");
      return;
    }

    try {
      setExportingSlackCanvas(true);
      const result = await exportSlackCanvas(payload);
      Alert.alert(
        "Slack Canvas created",
        result.canvasId ? `Canvas ID: ${result.canvasId}` : "Your event summary was sent to Slack."
      );
    } catch (error) {
      Alert.alert("Slack export failed", error instanceof Error ? error.message : "Could not create the Slack Canvas.");
    } finally {
      setExportingSlackCanvas(false);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={[styles.headerRow, isCompactLayout ? styles.headerRowCompact : null]}>
            <View style={styles.headerCopy}>
              <Typography variant="h1">Event workspace</Typography>
            </View>
            <Button
              label="Add event"
              onPress={openCreateEvent}
              fullWidth={false}
              variant="primary"
              style={styles.addEventButton}
            />
          </View>

          {currentEvent ? (
            <Card style={styles.currentEventCard}>
              <View style={styles.eventHeader}>
                <LiveEventBadge eventDate={currentEvent.eventDate} />
                <Typography variant="caption">
                  {currentEvent.eventDate ? formatEventDate(currentEvent.eventDate) : "No date set"}
                </Typography>
              </View>
              <Typography variant="h2">Current event: {currentEvent.name}</Typography>
              <Typography variant="body" style={styles.secondaryText}>
                {currentEventSummary.peopleCount} people added · {currentEventSummary.followUpsDue} follow-ups due
              </Typography>
              {canManageCampaignLinks && currentEvent.isCampaignMode && currentEvent.campaignSlug ? (
                <Typography variant="caption" style={styles.secondaryText}>
                  Campaign mode · /e/{currentEvent.campaignSlug}
                </Typography>
              ) : null}
              <View style={styles.featureActions}>
                <Button
                  label="View event"
                  onPress={() => {
                    if (currentEventInsight) {
                      setSelectedEventId(currentEventInsight.id);
                      return;
                    }
                    openCreateEventWithName(currentEvent.name);
                  }}
                  fullWidth={false}
                  size="compact"
                />
                <Button label="End event" onPress={() => confirmEndCurrentEvent(currentEvent.name)} variant="ghost" fullWidth={false} size="compact" />
              </View>
            </Card>
          ) : null}

          <Card>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
              {EVENT_CATEGORY_OPTIONS.map((option) => (
                <Button
                  key={option.value}
                  label={option.label}
                  onPress={() => setSelectedCategory(option.value)}
                  variant={selectedCategory === option.value ? "primary" : "ghost"}
                  fullWidth={false}
                  size="compact"
                />
              ))}
            </ScrollView>

            <View style={styles.sortRow}>
              <Button
                label="Recent"
                onPress={() => setSortMode("recent")}
                variant={sortMode === "recent" ? "primary" : "ghost"}
                fullWidth={false}
                size="compact"
              />
              <Button
                label="Name"
                onPress={() => setSortMode("name")}
                variant={sortMode === "name" ? "primary" : "ghost"}
                fullWidth={false}
                size="compact"
              />
              <Button
                label="Most people"
                onPress={() => setSortMode("people")}
                variant={sortMode === "people" ? "primary" : "ghost"}
                fullWidth={false}
                size="compact"
              />
              <Button
                label="Most notes"
                onPress={() => setSortMode("notes")}
                variant={sortMode === "notes" ? "primary" : "ghost"}
                fullWidth={false}
                size="compact"
              />
            </View>

            <TextInput
              placeholder="Search event name"
              placeholderTextColor={colors.textTertiary}
              value={searchQuery}
              onChangeText={setSearchQuery}
              style={styles.searchInput}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </Card>

          {errorMessage ? (
            <Card>
              <Typography variant="body">{errorMessage}</Typography>
            </Card>
          ) : null}

          {selectedEvent ? (
            <Card style={styles.featureCard}>
              <View style={styles.eventHeader}>
                <LiveEventBadge eventDate={selectedEvent.eventDate} />
                <Button label="Edit" onPress={() => openEditEvent()} variant="ghost" fullWidth={false} size="compact" />
              </View>
              <View style={styles.eventCopy}>
                <Typography variant="h2">{selectedEvent.name}</Typography>
                <Typography variant="caption" style={styles.secondaryText}>
                  {formatCategoryLabel(selectedEvent.category)}
                  {selectedEvent.eventDate ? ` · ${formatEventDate(selectedEvent.eventDate)}` : ""}
                  {` · ${selectedEvent.interactionCount} notes · ${selectedEvent.peopleCount} people`}
                </Typography>
              </View>
              {selectedEventFollowUpSummary ? (
                <Typography variant="caption">
                  Due today {selectedEventFollowUpSummary.dueToday} · Overdue {selectedEventFollowUpSummary.overdue} · Upcoming {selectedEventFollowUpSummary.upcoming}
                </Typography>
              ) : null}
              <View style={styles.featureActions}>
                <Button
                  label={isCurrentEvent(selectedEvent) ? "End event" : "Set current"}
                  onPress={() => handleCurrentEventToggle(selectedEvent)}
                  fullWidth={false}
                  size="compact"
                />
                <Button
                  label="Copy event recap"
                  onPress={() => void handleCopySlackCanvas(selectedEvent)}
                  variant="ghost"
                  fullWidth={false}
                  size="compact"
                  loading={isCopyingSlackCanvas}
                />
                {canDirectSlackCanvas ? (
                  <Button
                    label="Send to Slack"
                    onPress={() => void handleExportSlackCanvas(selectedEvent)}
                    variant="ghost"
                    fullWidth={false}
                    size="compact"
                    loading={isExportingSlackCanvas}
                  />
                ) : null}
                {canExportCsv ? (
                  <Button
                    label="Export event CSV"
                    onPress={() => void handleExportCsv(selectedEvent)}
                    variant="ghost"
                    fullWidth={false}
                    size="compact"
                    loading={isExportingCsv}
                  />
                ) : null}
                {canManageCampaignLinks ? (
                  <Button
                    label="Copy pilot link"
                    onPress={() => void handleCopyCampaignLink(selectedEvent)}
                    variant="ghost"
                    fullWidth={false}
                    size="compact"
                    loading={isCopyingCampaignLink}
                  />
                ) : null}
                <Button
                  label={deleteArmedEventId === selectedEvent.id ? "Delete now" : "Delete"}
                  onPress={() => void handleDeleteEvent(selectedEvent)}
                  variant="ghost"
                  fullWidth={false}
                  size="compact"
                  disabled={isDeletingEvent}
                />
              </View>
            </Card>
          ) : null}

          <View style={styles.sectionHeader}>
            <Typography variant="caption">All events</Typography>
          </View>

          <View style={styles.peopleStack}>
            {groupedEvents.map((group) => (
              <View key={group.category} style={styles.groupSection}>
                {group.items.map((event) => {
                  const summary = eventSummaryById.get(event.id) || {
                    peopleCount: event.peopleCount,
                    dueToday: 0,
                    overdue: 0,
                    upcoming: 0,
                    followUpsDue: 0,
                  };

                  return (
                    <Card
                      key={event.id}
                      style={[
                        styles.eventCard,
                        selectedEvent?.id === event.id ? styles.eventCardSelected : null,
                      ]}
                    >
                      <View style={styles.eventHeader}>
                        <LiveEventBadge eventDate={event.eventDate} />
                        <Typography variant="caption">{event.eventDate ? formatEventDate(event.eventDate) : "No date set"}</Typography>
                      </View>
                      <Typography variant="h2">{event.name}</Typography>
                      <Typography variant="caption">
                        {formatCategoryLabel(event.category as never)} · {summary.peopleCount} people · {event.interactionCount} notes
                      </Typography>
                      <Typography variant="caption">
                        Due today {summary.dueToday} · Overdue {summary.overdue} · Upcoming {summary.upcoming}
                      </Typography>
                      <View style={styles.eventActions}>
                        <Button label="View" onPress={() => setSelectedEventId(event.id)} variant="ghost" fullWidth={false} size="compact" />
                        <Button label="Edit" onPress={() => openEditEvent(event)} variant="ghost" fullWidth={false} size="compact" />
                        <Button
                          label={isCurrentEvent(event) ? "End event" : "Set current"}
                          onPress={() => handleCurrentEventToggle(event)}
                          variant="ghost"
                          fullWidth={false}
                          size="compact"
                        />
                        <Button
                          label={deleteArmedEventId === event.id ? "Delete now" : "Delete"}
                          onPress={() => void handleDeleteEvent(event)}
                          variant="ghost"
                          fullWidth={false}
                          size="compact"
                          disabled={isDeletingEvent}
                        />
                      </View>
                    </Card>
                  );
                })}
              </View>
            ))}
            {!isLoading && groupedEvents.length === 0 ? (
              searchQuery.trim() ? (
                <Card style={styles.emptyStateCard}>
                  <Typography variant="h2">No event found for "{searchQuery.trim()}"</Typography>
                  <Typography variant="body" style={styles.secondaryText}>
                    Add it now and keep the search term as the event name.
                  </Typography>
                  <View style={styles.emptyStateActions}>
                    <Button label={`Add ${searchQuery.trim()}`} onPress={handleQuickCreateEvent} fullWidth={false} size="compact" loading={isSavingEvent} />
                    <Button label="Edit before saving" onPress={() => openCreateEventWithName(searchQuery.trim())} variant="ghost" fullWidth={false} size="compact" />
                  </View>
                </Card>
              ) : (
                <Typography variant="body">No event categories match this filter yet.</Typography>
              )
            ) : null}
          </View>
        </ScrollView>

        {isCompactLayout ? (
          <View style={styles.mobileAddEventBar}>
            <Button label="Add event" onPress={openCreateEvent} />
          </View>
        ) : null}

        <Modal visible={isEventEditorOpen} animationType="slide" presentationStyle="pageSheet">
          <SafeAreaView style={styles.safeArea}>
            <View style={styles.modalContainer}>
              <View style={styles.headerRow}>
                <View style={styles.headerCopy}>
                  <Typography variant="caption">Event</Typography>
                  <Typography variant="h1">{eventEditorMode === "edit" ? "Edit event" : "Log event"}</Typography>
                </View>
                <Button
                  label="Close"
                  onPress={closeEventEditor}
                  variant="ghost"
                  fullWidth={false}
                  size="compact"
                />
              </View>

              <Card style={styles.modalCard}>
                <Typography variant="caption">Event name</Typography>
                <TextInput
                  placeholder="London Founders Dinner"
                  placeholderTextColor={colors.textTertiary}
                  style={styles.searchInput}
                  value={eventDraft.name}
                  onChangeText={(value) => setEventDraft((current) => ({ ...current, name: value }))}
                />

                <Typography variant="caption" style={styles.subSectionLabel}>
                  Event date
                </Typography>
                <Typography variant="body" style={styles.dateHelperText}>
                  Defaults to today. Use a quick pick or type a different date if needed.
                </Typography>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.datePillRow}>
                  {quickDateChoices.map((option) => (
                    <Button
                      key={option.value}
                      label={option.label}
                      onPress={() => setEventDraft((current) => ({ ...current, eventDate: option.value }))}
                      variant={eventDraft.eventDate === option.value ? "primary" : "ghost"}
                      fullWidth={false}
                      size="compact"
                    />
                  ))}
                </ScrollView>
                <TextInput
                  placeholder="2026-04-28"
                  placeholderTextColor={colors.textTertiary}
                  style={[styles.searchInput, styles.dateInput]}
                  value={eventDraft.eventDate}
                  onChangeText={(value) => setEventDraft((current) => ({ ...current, eventDate: value }))}
                  autoCapitalize="none"
                  autoCorrect={false}
                />

                <Typography variant="caption" style={styles.subSectionLabel}>
                  Event type
                </Typography>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
                  {EVENT_CATEGORY_OPTIONS.filter((option) => option.value !== "all").map((option) => (
                    <Button
                      key={option.value}
                      label={option.label}
                      onPress={() => setEventDraft((current) => ({ ...current, category: option.value }))}
                      variant={eventDraft.category === option.value ? "primary" : "ghost"}
                      fullWidth={false}
                      size="compact"
                    />
                  ))}
                </ScrollView>
              </Card>

              <View style={styles.footerButtons}>
                <Button
                  label={eventEditorMode === "edit" ? "Save event" : "Log event"}
                  onPress={handleSaveEvent}
                  loading={isSavingEvent}
                  disabled={!eventDraft.name.trim()}
                />
                <Button label="Cancel" onPress={closeEventEditor} variant="ghost" />
              </View>
            </View>
          </SafeAreaView>
        </Modal>
      </View>
    </SafeAreaView>
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
    paddingBottom: 132,
    gap: 18,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 12,
  },
  headerActions: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },
  headerRowCompact: {
    alignItems: "stretch",
  },
  headerCopy: {
    flex: 1,
    gap: 8,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: layout.screenPaddingHorizontal,
    paddingTop: layout.stackGap,
    paddingBottom: 24,
    gap: 18,
  },
  modalCard: {
    gap: 12,
  },
  chipRow: {
    gap: 8,
    paddingTop: 10,
    paddingBottom: 8,
  },
  secondaryText: {
    color: colors.textSecondary,
  },
  sortRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 8,
    flexWrap: "wrap",
  },
  subSectionLabel: {
    marginTop: 12,
  },
  searchInput: {
    minHeight: 48,
    marginTop: 8,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    backgroundColor: colors.surfaceMuted,
    color: colors.textPrimary,
    fontSize: 15,
  },
  sectionHeader: {
    gap: 4,
  },
  featureCard: {
    gap: 10,
  },
  currentEventCard: {
    gap: 10,
  },
  featureActions: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },
  emptyStateCard: {
    gap: 10,
  },
  emptyStateActions: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },
  groupSection: {
    gap: 10,
  },
  eventCard: {
    gap: 8,
  },
  eventCardSelected: {
    borderColor: colors.primaryAction,
  },
  eventActions: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
    paddingTop: 4,
  },
  eventHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
  },
  eventCopy: {
    flex: 1,
    gap: 6,
  },
  peopleStack: {
    gap: 12,
  },
  mobileAddEventBar: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 18,
    zIndex: 40,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 18,
    backgroundColor: colors.surface,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 18,
    elevation: 6,
  },
  footerButtons: {
    gap: 10,
    marginTop: "auto",
  },
  addEventButton: {
    marginLeft: 8,
    minWidth: 110,
  },
  dateHelperText: {
    marginTop: 4,
    marginBottom: 8,
    color: colors.textSecondary,
  },
  datePillRow: {
    flexDirection: "row",
    gap: 8,
    paddingBottom: 12,
  },
  dateInput: {
    marginTop: 0,
  },
});
