import { useEffect, useMemo, useState } from "react";
import { Alert, Pressable, SafeAreaView, ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { CurrentEventValue } from "../components/CurrentEventSheet";
import { FloatingFab } from "../components/FloatingFab";
import { PersonQuickActionsButton } from "../components/PersonQuickActionsButton";
import { CaptureModal, ParsedPersonDraft } from "./CaptureModal";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Typography } from "../components/ui/Typography";
import {
  JUST_CONNECTED_THRESHOLD,
  buildInteractionRecord,
  createInteraction,
  createPerson,
  ensureSessionUserId,
  formatCategoryLabel,
  getOrCreateEvent,
  isContactStale,
  listPeopleInsights,
  updatePersonDetails,
} from "../lib/crm";
import { layout, radius, useTheme, useThemedStyles } from "../theme/tokens";
import { PersonStatusMode } from "./PersonProfileScreen";
import { captureAnalyticsEvent } from "../lib/analytics";

type HomeScreenProps = {
  currentEvent: CurrentEventValue | null;
  onOpenPeopleFilter?: (status: PersonStatusMode) => void;
  onOpenEventWrapUp?: () => void;
  showCaptureCoach?: boolean;
  onCaptureCoachDone?: () => void;
};

type SignalFilter = "all" | "tracked" | "contactedToday" | "needNudge";

const HOME_CAPTURE_OPEN_STORAGE_KEY = "blackbook.home_capture_open";
const HOME_CAPTURE_DRAFT_STORAGE_KEY = "blackbook.home_capture_draft";
const ACTIVE_SCREEN_STORAGE_KEY = "blackbook.active_screen";

export function HomeScreen({
  currentEvent,
  onOpenPeopleFilter,
  onOpenEventWrapUp,
  showCaptureCoach = false,
  onCaptureCoachDone,
}: HomeScreenProps) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { width } = useWindowDimensions();
  const isMobileFieldMode = width < 720;
  const [isCaptureOpen, setCaptureOpen] = useState(false);
  const [editingPerson, setEditingPerson] = useState<Awaited<ReturnType<typeof listPeopleInsights>>[number] | null>(null);
  const [isSaving, setSaving] = useState(false);
  const [people, setPeople] = useState<Awaited<ReturnType<typeof listPeopleInsights>>>([]);
  const [isLoading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeSignal, setActiveSignal] = useState<SignalFilter>("all");
  const [hasHydratedCaptureState, setHasHydratedCaptureState] = useState(false);

  const recentPeople = useMemo(() => people.slice(0, 4), [people]);
  const dueTodayPeople = useMemo(
    () => people.filter((person) => person.followUpState === "dueToday").slice(0, 4),
    [people]
  );
  const overduePeople = useMemo(
    () => people.filter((person) => person.followUpState === "overdue").slice(0, 4),
    [people]
  );
  const followUpPeople = useMemo(
    () => people.filter((person) => isContactStale(person.daysSinceLastContact, person.priority)).slice(0, 4),
    [people]
  );
  const todayPeople = useMemo(() => {
    const seen = new Set<string>();
    return [...dueTodayPeople, ...overduePeople, ...followUpPeople]
      .filter((person) => {
        if (seen.has(person.id)) {
          return false;
        }
        seen.add(person.id);
        return true;
      })
      .slice(0, 5);
  }, [dueTodayPeople, followUpPeople, overduePeople]);
  const missedOpportunities = useMemo(
    () =>
      people
        .filter((person) => !person.nextStep.trim() || !person.nextFollowUpAt || !person.preferredChannel)
        .slice(0, 3),
    [people]
  );
  const waitingOnYouCount = dueTodayPeople.length + overduePeople.length;
  const contactedTodayPeople = useMemo(
    () => people.filter((person) => (person.daysSinceLastContact || 0) <= JUST_CONNECTED_THRESHOLD),
    [people]
  );
  const nudgeCount = useMemo(
    () => people.filter((person) => isContactStale(person.daysSinceLastContact, person.priority)).length,
    [people]
  );
  const currentEventSummary = useMemo(() => {
    if (!currentEvent) {
      return null;
    }

    const linkedPeople = people.filter((person) => person.lastEventName === currentEvent.name);
    return {
      total: linkedPeople.length,
      outstanding: linkedPeople.filter((person) => person.followUpState === "dueToday" || person.followUpState === "overdue").length,
      missingNextStep: linkedPeople.filter((person) => !person.nextStep.trim()).length,
      missingReminder: linkedPeople.filter((person) => !person.nextFollowUpAt).length,
      readyToFollowUp: linkedPeople.filter(
        (person) => person.nextStep.trim() && person.nextFollowUpAt && person.preferredChannel
      ).length,
    };
  }, [currentEvent, people]);

  async function loadData() {
    try {
      setLoading(true);
      setErrorMessage(null);

      const userId = await ensureSessionUserId();
      const peopleInsights = await listPeopleInsights(userId);

      setPeople(
        peopleInsights.sort((left, right) => {
          if (!left.lastInteractionAt && !right.lastInteractionAt) {
            return right.createdAt.localeCompare(left.createdAt);
          }

          if (!left.lastInteractionAt) {
            return 1;
          }

          if (!right.lastInteractionAt) {
            return -1;
          }

          return right.lastInteractionAt.localeCompare(left.lastInteractionAt);
        })
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load data.";
      setErrorMessage(message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function hydrateCaptureState() {
      const savedState = await AsyncStorage.getItem(HOME_CAPTURE_OPEN_STORAGE_KEY);
      if (isMounted && savedState === "true") {
        setCaptureOpen(true);
      }
      if (isMounted) {
        setHasHydratedCaptureState(true);
      }
    }

    void hydrateCaptureState();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    async function persistCaptureState() {
      if (!hasHydratedCaptureState) {
        return;
      }

      await AsyncStorage.setItem(HOME_CAPTURE_OPEN_STORAGE_KEY, isCaptureOpen ? "true" : "false");
    }

    void persistCaptureState();
  }, [hasHydratedCaptureState, isCaptureOpen]);

  async function handleSaveDraft(draft: ParsedPersonDraft, options?: { addAnother?: boolean; keepOpen?: boolean }) {
    if (isSaving) {
      return;
    }

    try {
      setSaving(true);
      const userId = await ensureSessionUserId();

      if (editingPerson) {
        await updatePersonDetails({
          userId,
          personId: editingPerson.id,
          name: draft.name,
          company: draft.company,
          linkedinUrl: draft.linkedinUrl,
          email: draft.email,
          phoneNumber: draft.phoneNumber,
          preferredChannel: draft.preferredChannel,
          preferredChannelOther: draft.preferredChannelOther,
          priority: draft.priority,
          tags: draft.tags,
        });

        setEditingPerson(null);
        setCaptureOpen(false);
        await AsyncStorage.setItem(HOME_CAPTURE_OPEN_STORAGE_KEY, "false");
        await loadData();
        Alert.alert("Contact updated", `${draft.name} is up to date.`);
        return;
      }

      const person = await createPerson(
        userId,
        draft.name,
        draft.company,
        draft.linkedinUrl,
        draft.email,
        draft.phoneNumber,
        draft.preferredChannel,
        draft.preferredChannelOther,
        draft.priority,
        draft.tags
      );

      let eventId: string | null = null;
      const eventName = currentEvent?.name || draft.event;
      const eventCategory = currentEvent?.category || draft.eventCategory || null;
      const eventDate = currentEvent?.eventDate || null;
      if (eventName && eventName !== "No event") {
        const event = await getOrCreateEvent(userId, eventName, eventCategory, eventDate);
        eventId = event.id;
      }

      await createInteraction({
        userId,
        personId: person.id,
        eventId,
        rawNote: buildInteractionRecord(draft.whatMatters, draft.nextStep, draft.company, draft.nextFollowUpAt),
      });

      void captureAnalyticsEvent("contact_captured", {
        surface: "home",
        add_another: Boolean(options?.addAnother),
        has_current_event: Boolean(currentEvent),
        event_category: eventCategory || undefined,
        follow_up_preset: draft.followUpPreset || undefined,
        preferred_channel: draft.preferredChannel || undefined,
        tags_count: draft.tags.length,
        has_company: Boolean(draft.company),
        has_linkedin: Boolean(draft.linkedinUrl),
        has_email: Boolean(draft.email),
        has_phone: Boolean(draft.phoneNumber),
      });

      if (!options?.addAnother && !options?.keepOpen) {
        setCaptureOpen(false);
        await AsyncStorage.setItem(HOME_CAPTURE_OPEN_STORAGE_KEY, "false");
      }
      await loadData();
      if (!options?.addAnother && !options?.keepOpen) {
        Alert.alert("Contact added", `${draft.name} saved${eventName && eventName !== "No event" ? ` to ${eventName}` : ""}.`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save interaction.";
      Alert.alert("Could not save contact", message);
    } finally {
      setSaving(false);
    }
  }

  function openCapture() {
    setEditingPerson(null);
    onCaptureCoachDone?.();
    void AsyncStorage.setItem(ACTIVE_SCREEN_STORAGE_KEY, "home");
    void AsyncStorage.setItem(HOME_CAPTURE_OPEN_STORAGE_KEY, "true");
    setCaptureOpen(true);
  }

  function closeCapture() {
    void AsyncStorage.setItem(HOME_CAPTURE_OPEN_STORAGE_KEY, "false");
    setEditingPerson(null);
    setCaptureOpen(false);
  }

  function openEditPerson(person: (typeof people)[number]) {
    setEditingPerson(person);
    void AsyncStorage.setItem(ACTIVE_SCREEN_STORAGE_KEY, "home");
    void AsyncStorage.setItem(HOME_CAPTURE_OPEN_STORAGE_KEY, "true");
    setCaptureOpen(true);
  }

  function renderPersonCard(person: (typeof people)[number], variant: "default" | "muted" = "default") {
    return (
      <Card key={person.id} style={[styles.connectionCard, variant === "muted" ? styles.mutedCard : null]}>
        <View style={styles.connectionHeader}>
          <View style={styles.connectionMain}>
            <Typography variant="h2">{person.name}</Typography>
            <Typography variant="caption">
              {[person.company, person.lastEventName || "No event logged"].filter(Boolean).join(" · ")}
            </Typography>
          </View>
          <View style={styles.cardActions}>
            <View style={styles.statusPill}>
              <Typography variant="caption" style={styles.statusPillText}>{person.statusLabel}</Typography>
            </View>
            <PersonQuickActionsButton person={person} onChanged={loadData} onEdit={() => openEditPerson(person)} />
          </View>
        </View>
        <Typography variant="body" style={styles.cardBody} numberOfLines={2}>
          {person.nextStep || person.whatMatters || person.lastInteractionNote}
        </Typography>
        {person.relationshipStatus ? (
          <Typography variant="caption">
            Status: {person.relationshipStatus}
          </Typography>
        ) : null}
        <Typography variant="caption">{person.bannerLabel}</Typography>
      </Card>
    );
  }

  function renderCaptureModal() {
    return (
      <CaptureModal
        visible={isCaptureOpen}
        onClose={closeCapture}
        onSave={handleSaveDraft}
        saveLabel={editingPerson ? "Save Changes" : "Save & Close"}
        isSaving={isSaving}
        lockedEvent={currentEvent}
        initialDraft={editingPerson ? {
          name: editingPerson.name,
          priority: editingPerson.priority,
          tags: editingPerson.tags,
          company: editingPerson.company,
          linkedinUrl: editingPerson.linkedinUrl,
          email: editingPerson.email,
          phoneNumber: editingPerson.phoneNumber,
          preferredChannel: editingPerson.preferredChannel,
          preferredChannelOther: editingPerson.preferredChannelOther,
          event: editingPerson.lastEventName || "",
          whatMatters: editingPerson.whatMatters || editingPerson.lastInteractionNote,
          nextStep: editingPerson.nextStep || "",
          nextFollowUpAt: editingPerson.nextFollowUpAt || "",
          followUpPreset: "",
        } : null}
        initialMethod="manual"
        showQuickCapture={!editingPerson}
        showSaveAndAddAnother={!editingPerson}
        draftStorageKey={HOME_CAPTURE_DRAFT_STORAGE_KEY}
        autosaveWithInitialDraft={Boolean(editingPerson)}
      />
    );
  }

  if (isMobileFieldMode) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.container}>
          <ScrollView contentContainerStyle={styles.mobileContent} showsVerticalScrollIndicator={false}>
            <View style={styles.headerRow}>
              <View style={styles.headerCopy}>
                <Typography variant="caption">Today</Typography>
                <Typography variant="h1">Who needs you now?</Typography>
                <Typography variant="body" style={styles.sectionMeta}>
                  Capture fast. Come back to the few conversations still open.
                </Typography>
              </View>
            </View>

            {currentEvent ? (
              <Card style={styles.currentEventCard}>
                <View style={styles.currentEventTopRow}>
                  <Typography variant="caption">Current event</Typography>
                  <Typography variant="caption">
                    {currentEvent.category === "other" && currentEvent.customCategoryLabel?.trim()
                      ? currentEvent.customCategoryLabel.trim()
                      : formatCategoryLabel(currentEvent.category)}
                  </Typography>
                </View>
                <Typography variant="h2">{currentEvent.name}</Typography>
                <Typography variant="body" style={styles.sectionMeta}>
                  {currentEventSummary
                    ? `${currentEventSummary.total} people captured · ${currentEventSummary.outstanding} conversations still open.`
                    : "New captures will attach to this event."}
                </Typography>
                <View style={styles.eventActionRow}>
                  <Button label="Wrap up" onPress={onOpenEventWrapUp || (() => undefined)} variant="ghost" fullWidth={false} size="compact" />
                </View>
              </Card>
            ) : null}

            {errorMessage ? (
              <Card>
                <Typography variant="body">{errorMessage}</Typography>
              </Card>
            ) : null}

            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Typography variant="caption">Who to contact today</Typography>
                <Typography variant="body" style={styles.sectionMeta}>
                  Max five people so this stays doable.
                </Typography>
              </View>
              {todayPeople.map((person) => renderPersonCard(person, "muted"))}
              {!isLoading && todayPeople.length === 0 ? (
                <Card style={styles.emptyTodayCard}>
                  <Typography variant="h2">No urgent conversations today</Typography>
                  <Typography variant="body" style={styles.sectionMeta}>
                    Capture someone new when the next useful conversation happens.
                  </Typography>
                </Card>
              ) : null}
            </View>

            {missedOpportunities.length ? (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Typography variant="caption">Missed opportunities</Typography>
                  <Typography variant="body" style={styles.sectionMeta}>
                    People with missing context, reminder, or contact preference.
                  </Typography>
                </View>
                {missedOpportunities.map((person) => renderPersonCard(person))}
              </View>
            ) : null}
          </ScrollView>

          {showCaptureCoach ? (
            <View pointerEvents="box-none" style={styles.captureCoachWrap}>
              <View style={styles.captureCoachCard}>
                <Typography variant="caption">Next</Typography>
                <Typography variant="h2">Tap + when you meet someone.</Typography>
                <Typography variant="body" style={styles.sectionMeta}>
                  Capture the person now. Tidy the details later.
                </Typography>
                <View style={styles.onboardingActions}>
                  <Button label="Got it" onPress={onCaptureCoachDone || (() => undefined)} variant="ghost" fullWidth={false} size="compact" />
                </View>
              </View>
            </View>
          ) : null}

          <FloatingFab label="+" onPress={openCapture} style={showCaptureCoach ? styles.fabCoachTarget : null} />
          {renderCaptureModal()}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.headerRow}>
            <View style={styles.headerCopy}>
              <Typography variant="caption">{currentEvent ? "Live event" : "Today"}</Typography>
              <Typography variant="h1">{currentEvent ? "Event assistant" : "Morning queue"}</Typography>
              <Typography variant="body" style={styles.sectionMeta}>
                {currentEvent
                  ? "Capture conversations now, then close the loop before context fades."
                  : "Open conversations before the day gets loud."}
              </Typography>
            </View>
          </View>



          {currentEvent ? (
            <Card style={styles.currentEventCard}>
              <View style={styles.currentEventTopRow}>
                <Typography variant="caption">{currentEvent.isCampaignMode ? "Campaign event" : "Current event"}</Typography>
                <Typography variant="caption">
                  {currentEvent.category === "other" && currentEvent.customCategoryLabel?.trim()
                    ? currentEvent.customCategoryLabel.trim()
                    : formatCategoryLabel(currentEvent.category)}
                </Typography>
              </View>
              <Typography variant="h2">{currentEvent.name}</Typography>
              <Typography variant="body" style={styles.sectionMeta}>
                {currentEvent.eventDate?.trim() ? `${currentEvent.eventDate.trim()} · ` : ""}
                {currentEventSummary
                  ? `${currentEventSummary.total} people captured · ${currentEventSummary.outstanding} conversations still open. New captures will keep tagging to this event until you end event mode.`
                  : "Any person saved now will be attached to this event until you end event mode."}
              </Typography>
              {currentEventSummary ? (
                <Typography variant="caption" style={styles.sectionMeta}>
                  Ready: {currentEventSummary.readyToFollowUp} - Cleanup: {currentEventSummary.missingNextStep + currentEventSummary.missingReminder}
                </Typography>
              ) : null}
              <View style={styles.eventActionRow}>
                <Button label="Capture conversation" onPress={openCapture} fullWidth={false} size="compact" />
                <Button
                  label="Wrap up event"
                  onPress={onOpenEventWrapUp || (() => undefined)}
                  variant="ghost"
                  fullWidth={false}
                  size="compact"
                />
              </View>
            </Card>
          ) : null}

          {errorMessage ? (
            <Card>
              <Typography variant="body">{errorMessage}</Typography>
            </Card>
          ) : null}

          <Card style={styles.heroCard}>
              <View style={styles.heroTopRow}>
                <View style={styles.heroCopy}>
                  <Typography variant="caption" style={styles.heroCaption}>{currentEvent ? "Outcome queue" : "Pulse"}</Typography>
                  <Typography variant="h2" style={styles.heroHeading}>Today’s relationship queue</Typography>
                  <Typography variant="body" style={styles.heroMeta}>
                    {currentEvent
                      ? "See who is ready, what needs cleanup, and which conversations are still open."
                      : "Today’s open conversations first, with shortcuts into the wider list."}
                  </Typography>
                </View>
              {waitingOnYouCount ? (
                <View style={styles.heroBadge}>
                  <Typography variant="caption" style={styles.heroBadgeText}>{waitingOnYouCount} waiting</Typography>
                </View>
              ) : null}
            </View>

            <View style={styles.signalGrid}>
              <Pressable
                style={[styles.signalCell, activeSignal === "tracked" ? styles.signalCellActive : null]}
                onPress={() => {
                  setActiveSignal("tracked");
                  onOpenPeopleFilter?.("all");
                }}
              >
                <Typography variant="h2" style={styles.heroMetric}>{people.length}</Typography>
                <Typography variant="caption" style={styles.heroCaption}>{currentEvent ? "People captured" : "Everyone"}</Typography>
                <Typography variant="caption" style={styles.tapCue}>Tap to view</Typography>
              </Pressable>
              <Pressable
                style={[styles.signalCell, activeSignal === "contactedToday" ? styles.signalCellActive : null]}
                onPress={() => {
                  setActiveSignal("contactedToday");
                  onOpenPeopleFilter?.("today");
                }}
              >
                <Typography variant="h2" style={styles.heroMetric}>{contactedTodayPeople.length}</Typography>
                <Typography variant="caption" style={styles.heroCaption}>{currentEvent ? "Captured today" : "Contacted today"}</Typography>
                <Typography variant="caption" style={styles.tapCue}>Tap to view</Typography>
              </Pressable>
              <Pressable
                style={[styles.signalCell, activeSignal === "needNudge" ? styles.signalCellActive : null]}
                onPress={() => {
                  setActiveSignal("needNudge");
                  onOpenPeopleFilter?.("stale");
                }}
              >
                <Typography variant="h2" style={styles.heroMetric}>{nudgeCount}</Typography>
                <Typography variant="caption" style={styles.heroCaption}>Still open</Typography>
                <Typography variant="caption" style={styles.tapCue}>Tap to view</Typography>
              </Pressable>
            </View>
          </Card>

          {dueTodayPeople.length ? (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Typography variant="caption">Today</Typography>
                <Typography variant="body" style={styles.sectionMeta}>
                  Conversations you planned to pick up today.
                </Typography>
              </View>
              {dueTodayPeople.map((person) => renderPersonCard(person, "muted"))}
            </View>
          ) : null}

          {overduePeople.length ? (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Typography variant="caption">Still open</Typography>
                <Typography variant="body" style={styles.sectionMeta}>
                  Conversations with dates before today.
                </Typography>
              </View>
              {overduePeople.map((person) => renderPersonCard(person, "muted"))}
            </View>
          ) : null}

          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Typography variant="caption">Recently connected</Typography>
              <Typography variant="body" style={styles.sectionMeta}>
                Latest people you captured or updated.
              </Typography>
            </View>

            {recentPeople.map((person) => renderPersonCard(person))}
            {!isLoading && recentPeople.length === 0 ? (
              <Typography variant="body">No people tracked yet.</Typography>
            ) : null}
          </View>

          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Typography variant="caption">Needs a nudge</Typography>
              <Typography variant="body" style={styles.sectionMeta}>
                Stale high-priority relationships that may need a nudge.
              </Typography>
            </View>
            {followUpPeople.map((person) => renderPersonCard(person, "muted"))}
            {!isLoading && followUpPeople.length === 0 ? (
              <Typography variant="body">Everyone is still warm.</Typography>
            ) : null}
          </View>
        </ScrollView>

        {showCaptureCoach ? (
          <View pointerEvents="box-none" style={styles.captureCoachWrap}>
            <View style={styles.captureCoachCard}>
              <Typography variant="caption">Next</Typography>
              <Typography variant="h2">Tap + when you meet someone.</Typography>
              <Typography variant="body" style={styles.sectionMeta}>
                Capture the person now. Tidy the details later.
              </Typography>
              <View style={styles.onboardingActions}>
                <Button label="Got it" onPress={onCaptureCoachDone || (() => undefined)} variant="ghost" fullWidth={false} size="compact" />
              </View>
            </View>
          </View>
        ) : null}

        <FloatingFab
          label="+"
          onPress={openCapture}
          style={showCaptureCoach ? styles.fabCoachTarget : null}
        />

        {renderCaptureModal()}
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
    paddingTop: layout.sectionGap,
    paddingBottom: 120,
    gap: layout.sectionGap,
  },
  mobileContent: {
    paddingHorizontal: layout.screenPaddingHorizontal,
    paddingTop: layout.sectionGap,
    paddingBottom: 128,
    gap: 20,
  },
  headerRow: {
    gap: 10,
  },
  headerCopy: {
    gap: 8,
  },
  quickCaptureCard: {
    gap: 14,
  },
  quickCaptureHeader: {
    gap: 8,
  },
  quickCaptureCopy: {
    gap: 6,
  },
  quickCaptureRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  currentEventCard: {
    backgroundColor: colors.surface,
    gap: 10,
  },
  onboardingActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  currentEventTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  eventActionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingTop: 4,
  },
  liveBadge: {
    alignSelf: "flex-start",
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: colors.successSoft,
    borderWidth: 1,
    borderColor: colors.border,
  },
  liveBadgeText: {
    color: "#17843A",
  },
  heroCard: {
    backgroundColor: colors.primaryAction,
    borderColor: colors.primaryAction,
    gap: 18,
  },
  heroTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
  },
  heroCopy: {
    flex: 1,
    gap: 6,
  },
  heroHeading: {
    color: colors.onPrimary,
  },
  heroBadge: {
    borderRadius: radius.pill,
    backgroundColor: "rgba(255,255,255,0.12)",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  heroBadgeText: {
    color: colors.onPrimary,
  },
  bannerCard: {
    gap: 10,
  },
  signalGrid: {
    flexDirection: "row",
    gap: 10,
  },
  signalCell: {
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    padding: 14,
    gap: 6,
  },
  signalCellActive: {
    backgroundColor: "rgba(255,255,255,0.18)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.35)",
  },
  heroMetric: {
    color: colors.onPrimary,
  },
  heroCaption: {
    color: "rgba(246,243,238,0.76)",
  },
  heroMeta: {
    color: "rgba(255,255,255,0.88)",
  },
  tapCue: {
    color: "rgba(255,255,255,0.9)",
    marginTop: 2,
  },
  section: {
    gap: 12,
  },
  sectionHeader: {
    gap: 4,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  sectionMeta: {
    color: colors.textSecondary,
  },
  connectionCard: {
    gap: 10,
  },
  mutedCard: {
    backgroundColor: colors.surfaceMuted,
  },
  emptyTodayCard: {
    gap: 8,
    backgroundColor: colors.surfaceMuted,
  },
  connectionHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  connectionMain: {
    flex: 1,
    gap: 6,
  },
  statusPill: {
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: colors.border,
  },
  statusPillText: {
    color: colors.textSecondary,
  },
  cardActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexShrink: 0,
  },
  cardBody: {
    color: colors.textSecondary,
  },
  captureCoachWrap: {
    position: "absolute",
    left: 20,
    right: 20,
    bottom: 100,
    zIndex: 90,
    alignItems: "flex-end",
  },
  captureCoachCard: {
    width: "100%",
    maxWidth: 360,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: 14,
    gap: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.14,
    shadowRadius: 18,
    elevation: 8,
  },
  fabCoachTarget: {
    borderColor: "#19A64A",
    shadowColor: "#19A64A",
    shadowOpacity: 0.45,
    shadowRadius: 22,
    elevation: 12,
  },
  pulseRow: {
    flexDirection: "row",
    gap: 10,
  },
  pulseCard: {
    flex: 1,
    gap: 8,
  },
});
