import { useEffect, useMemo, useState } from "react";
import { Alert, AppState, Linking, Modal, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, TextInput, View, useWindowDimensions } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Clipboard from "expo-clipboard";

import { CurrentEventValue } from "../components/CurrentEventSheet";
import { FloatingActionBar } from "../components/FloatingActionBar";
import { PersonQuickActionsButton } from "../components/PersonQuickActionsButton";
import { CaptureModal, ParsedPersonDraft } from "./CaptureModal";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Typography } from "../components/ui/Typography";
import {
  EVENT_CATEGORY_OPTIONS,
  PERSON_TAG_SUGGESTIONS,
  buildReconnectDraft,
  JUST_CONNECTED_THRESHOLD,
  RECENT_CONTACT_THRESHOLD,
  buildInteractionRecord,
  createInteraction,
  createPerson,
  deletePerson,
  ensureSessionUserId,
  formatPreferredChannelLabel,
  formatFollowUpDate,
  getPresetDate,
  getOrCreateEvent,
  listPeopleInsights,
  markPersonContactedToday,
  parseDateOnlyString,
  updateInteraction,
  updatePersonDetails,
  isContactStale,
} from "../lib/crm";
import { layout, useTheme, useThemedStyles } from "../theme/tokens";
import { CalendarDestination, CalendarSuggestedSlot, getAvailableCalendarDestinations, getFollowUpSlotSuggestions, openFollowUpInCalendar } from "../lib/calendar";
import { clearPendingExternalAction, getPendingExternalAction, PendingExternalAction, setPendingExternalAction } from "../lib/externalActionFlow";
import { captureAnalyticsEvent } from "../lib/analytics";
import { generateFollowUpDraft } from "../lib/followUpDraft";

type SortMode = "recent" | "stale" | "name" | "frequency";
type CaptureMode = "createInteraction" | "createPerson" | "edit";
type DraftPreviewDestination = "whatsapp" | "linkedin";
type UpdateInteractionType = "met" | "called" | "emailed" | "messaged" | "followedUp" | "introduced";
type UpdateStatus = "warm" | "needsAction" | "waiting" | "doneForNow";
type PeopleView = "needsFollowUp" | "recentlyMet" | "allContacts";
type FollowUpOutcome =
  | "Sent"
  | "Replied"
  | "Meeting booked"
  | "Intro made"
  | "Opportunity created"
  | "Converted"
  | "No response"
  | "Not relevant";
type FollowUpChannelAction = "whatsapp" | "linkedin" | "email" | "copy";
export type PersonStatusMode = "all" | "today" | "recent" | "stale";

type UpdateDraftState = {
  interactionType: UpdateInteractionType;
  shortNote: string;
  nextStep: string;
  dueDate: string;
  status: UpdateStatus;
};

type SavedPeopleCaptureState = {
  isOpen: boolean;
  mode: CaptureMode;
  selectedPersonId: string | null;
  draft: Partial<ParsedPersonDraft> | null;
};

type SavedLogUpdateState = {
  isOpen: boolean;
  personId: string | null;
  draft: UpdateDraftState;
};

const PEOPLE_CAPTURE_STATE_STORAGE_KEY = "blackbook.people_capture_state";
const PEOPLE_CAPTURE_DRAFT_STORAGE_KEY = "blackbook.people_capture_draft";
const PEOPLE_LOG_UPDATE_STATE_STORAGE_KEY = "blackbook.people_log_update_state";

const interactionTypeOptions: Array<{ label: string; value: UpdateInteractionType }> = [
  { label: "Met", value: "met" },
  { label: "Called", value: "called" },
  { label: "Emailed", value: "emailed" },
  { label: "Messaged", value: "messaged" },
  { label: "Followed up", value: "followedUp" },
  { label: "Introduced", value: "introduced" },
];

const updateStatusOptions: Array<{ label: string; value: UpdateStatus }> = [
  { label: "Warm", value: "warm" },
  { label: "Needs action", value: "needsAction" },
  { label: "Waiting", value: "waiting" },
  { label: "Done for now", value: "doneForNow" },
];

type PersonProfileScreenProps = {
  currentEvent: CurrentEventValue | null;
  forcedStatusMode?: PersonStatusMode | null;
  forcedStatusNonce?: number;
};

export function PersonProfileScreen({
  currentEvent,
  forcedStatusMode = null,
  forcedStatusNonce = 0,
}: PersonProfileScreenProps) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { width } = useWindowDimensions();
  const isCompactLayout = width < 720;
  const [isCaptureOpen, setCaptureOpen] = useState(false);
  const [isSaving, setSaving] = useState(false);
  const [isDeleting, setDeleting] = useState(false);
  const [editorMode, setEditorMode] = useState<CaptureMode>("createInteraction");
  const [editorDraft, setEditorDraft] = useState<Partial<ParsedPersonDraft> | null>(null);
  const [isUpdateModalOpen, setUpdateModalOpen] = useState(false);
  const [updatePerson, setUpdatePerson] = useState<(typeof people)[number] | null>(null);
  const [updateDraft, setUpdateDraft] = useState<UpdateDraftState>({
    interactionType: "met" as UpdateInteractionType,
    shortNote: "",
    nextStep: "",
    dueDate: "",
    status: "warm" as UpdateStatus,
  });
  const [hasHydratedPeopleCaptureState, setHasHydratedPeopleCaptureState] = useState(false);
  const [hasHydratedLogUpdateState, setHasHydratedLogUpdateState] = useState(false);
  const [pendingUpdatePersonId, setPendingUpdatePersonId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>("name");
  const [statusMode, setStatusMode] = useState<PersonStatusMode>("all");
  const [peopleView, setPeopleView] = useState<PeopleView>("needsFollowUp");
  const [categoryMode, setCategoryMode] = useState<(typeof EVENT_CATEGORY_OPTIONS)[number]["value"]>("all");
  const [selectedTag, setSelectedTag] = useState<string>("all");
  const [people, setPeople] = useState<Awaited<ReturnType<typeof listPeopleInsights>>>([]);
  const [isLoading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [draftPreviewPerson, setDraftPreviewPerson] = useState<(typeof people)[number] | null>(null);
  const [draftPreviewText, setDraftPreviewText] = useState("");
  const [draftPreviewDestination, setDraftPreviewDestination] = useState<DraftPreviewDestination>("whatsapp");
  const [personActionMenu, setPersonActionMenu] = useState<(typeof people)[number] | null>(null);
  const [isInteractionPickerOpen, setInteractionPickerOpen] = useState(false);
  const [pendingExternalAction, setPendingExternalActionState] = useState<PendingExternalAction | null>(null);
  const [showPendingExternalReturn, setShowPendingExternalReturn] = useState(false);
  const [calendarPickerPerson, setCalendarPickerPerson] = useState<(typeof people)[number] | null>(null);
  const [followUpPerson, setFollowUpPerson] = useState<(typeof people)[number] | null>(null);
  const [followUpMessage, setFollowUpMessage] = useState("");
  const [isGeneratingFollowUpMessage, setGeneratingFollowUpMessage] = useState(false);
  const [updateCalendarSlots, setUpdateCalendarSlots] = useState<CalendarSuggestedSlot[]>([]);
  const [isCheckingUpdateCalendar, setCheckingUpdateCalendar] = useState(false);

  const availableTags = useMemo(() => {
    return Array.from(new Set([...PERSON_TAG_SUGGESTIONS, ...people.flatMap((person) => person.tags)])).sort();
  }, [people]);
  const calendarDestinationOptions = useMemo(() => getAvailableCalendarDestinations(), []);

  const sortLabel =
    sortMode === "name"
      ? "A-Z"
      : sortMode === "recent"
        ? "Recent"
        : sortMode === "stale"
          ? "Need nudge first"
          : "Most logged";

  function isRecentlyMet(person: (typeof people)[number]) {
    const createdAt = new Date(person.createdAt).getTime();
    if (Number.isNaN(createdAt)) {
      return false;
    }

    return Date.now() - createdAt <= 7 * 24 * 60 * 60 * 1000;
  }

  function needsFollowUp(person: (typeof people)[number]) {
    return (
      person.followUpState === "overdue" ||
      person.followUpState === "dueToday" ||
      (person.priority === "high" && isContactStale(person.daysSinceLastContact, person.priority)) ||
      (isRecentlyMet(person) && !person.nextStep.trim())
    );
  }

  const filteredPeople = useMemo(() => {
    const categoryFiltered = people.filter(
      (person) => categoryMode === "all" || person.lastEventCategory === categoryMode
    );

    const tagFiltered = categoryFiltered.filter(
      (person) => selectedTag === "all" || person.tags.includes(selectedTag)
    );

    const statusFiltered = tagFiltered.filter((person) => {
      if (statusMode === "today") {
        return (person.daysSinceLastContact || 0) <= JUST_CONNECTED_THRESHOLD;
      }

      if (statusMode === "recent") {
        return (person.daysSinceLastContact || 0) <= RECENT_CONTACT_THRESHOLD;
      }

      if (statusMode === "stale") {
        return isContactStale(person.daysSinceLastContact, person.priority);
      }

      return true;
    });

    const query = searchQuery.trim().toLowerCase();
    const searchedPeople = !query
      ? statusFiltered
      : statusFiltered.filter((person) =>
          [person.name, person.company, person.lastInteractionNote, person.followUp, person.lastEventName || "", person.tags.join(" ")]
            .join(" ")
            .toLowerCase()
            .includes(query)
        );

    return searchedPeople.sort((left, right) => {
      if (sortMode === "name") {
        return left.name.localeCompare(right.name);
      }

      if (sortMode === "stale") {
        return (right.daysSinceLastContact || 0) - (left.daysSinceLastContact || 0);
      }

      if (sortMode === "frequency") {
        return right.interactionCount - left.interactionCount;
      }

      const leftValue = left.lastInteractionAt || left.createdAt;
      const rightValue = right.lastInteractionAt || right.createdAt;
      return rightValue.localeCompare(leftValue);
    });
  }, [categoryMode, people, searchQuery, selectedTag, sortMode, statusMode]);

  const visiblePeople = useMemo(() => {
    if (peopleView === "needsFollowUp") {
      return filteredPeople.filter(needsFollowUp);
    }

    if (peopleView === "recentlyMet") {
      return filteredPeople.filter(isRecentlyMet);
    }

    return filteredPeople;
  }, [filteredPeople, peopleView]);

  const attentionCounts = useMemo(() => {
    return {
      needsFollowUp: filteredPeople.filter(needsFollowUp).length,
      recentlyMet: filteredPeople.filter(isRecentlyMet).length,
      allContacts: filteredPeople.length,
    };
  }, [filteredPeople]);

  const selectedPerson = useMemo(() => {
    if (selectedPersonId) {
      return visiblePeople.find((person) => person.id === selectedPersonId) || null;
    }
    // Only show a selected contact if the user has manually selected one
    return null;
  }, [isCompactLayout, selectedPersonId, visiblePeople]);

  async function loadProfileData() {
    try {
      setLoading(true);
      setErrorMessage(null);

      const userId = await ensureSessionUserId();
      const insights = await listPeopleInsights(userId);
      setPeople(insights);
      setSelectedPersonId((current) => {
        if (current && insights.some((person) => person.id === current)) {
          return current;
        }

        return isCompactLayout ? null : insights[0]?.id || null;
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load profile.";
      setErrorMessage(message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadProfileData();
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function hydratePeopleCaptureState() {
      const rawState = await AsyncStorage.getItem(PEOPLE_CAPTURE_STATE_STORAGE_KEY);
      if (!rawState) {
        if (isMounted) {
          setHasHydratedPeopleCaptureState(true);
        }
        return;
      }

      try {
        const savedState = JSON.parse(rawState) as SavedPeopleCaptureState;
        if (isMounted && savedState.isOpen) {
          setEditorMode(savedState.mode);
          setEditorDraft(savedState.draft);
          setSelectedPersonId(savedState.selectedPersonId);
          setCaptureOpen(true);
        }
      } catch {
        await AsyncStorage.removeItem(PEOPLE_CAPTURE_STATE_STORAGE_KEY);
        await AsyncStorage.removeItem(PEOPLE_CAPTURE_DRAFT_STORAGE_KEY);
      } finally {
        if (isMounted) {
          setHasHydratedPeopleCaptureState(true);
        }
      }
    }

    void hydratePeopleCaptureState();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!hasHydratedPeopleCaptureState) {
      return;
    }

    async function persistPeopleCaptureState() {
      const payload: SavedPeopleCaptureState = {
        isOpen: isCaptureOpen,
        mode: editorMode,
        selectedPersonId,
        draft: editorDraft,
      };
      await AsyncStorage.setItem(PEOPLE_CAPTURE_STATE_STORAGE_KEY, JSON.stringify(payload));
    }

    void persistPeopleCaptureState();
  }, [editorDraft, editorMode, hasHydratedPeopleCaptureState, isCaptureOpen, selectedPersonId]);

  useEffect(() => {
    let isMounted = true;

    async function hydrateLogUpdateState() {
      const rawState = await AsyncStorage.getItem(PEOPLE_LOG_UPDATE_STATE_STORAGE_KEY);
      if (!rawState) {
        if (isMounted) {
          setHasHydratedLogUpdateState(true);
        }
        return;
      }

      try {
        const savedState = JSON.parse(rawState) as SavedLogUpdateState;
        if (isMounted && savedState.isOpen) {
          setUpdateDraft(savedState.draft);
          setPendingUpdatePersonId(savedState.personId);
          setUpdateModalOpen(true);
        }
      } catch {
        await AsyncStorage.removeItem(PEOPLE_LOG_UPDATE_STATE_STORAGE_KEY);
      } finally {
        if (isMounted) {
          setHasHydratedLogUpdateState(true);
        }
      }
    }

    void hydrateLogUpdateState();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!pendingUpdatePersonId || !people.length) {
      return;
    }

    const restoredPerson = people.find((person) => person.id === pendingUpdatePersonId);
    if (restoredPerson) {
      setUpdatePerson(restoredPerson);
      setPendingUpdatePersonId(null);
    }
  }, [pendingUpdatePersonId, people]);

  useEffect(() => {
    if (!hasHydratedLogUpdateState) {
      return;
    }

    async function persistLogUpdateState() {
      const payload: SavedLogUpdateState = {
        isOpen: isUpdateModalOpen,
        personId: updatePerson?.id || pendingUpdatePersonId,
        draft: updateDraft,
      };
      await AsyncStorage.setItem(PEOPLE_LOG_UPDATE_STATE_STORAGE_KEY, JSON.stringify(payload));
    }

    void persistLogUpdateState();
  }, [hasHydratedLogUpdateState, isUpdateModalOpen, pendingUpdatePersonId, updateDraft, updatePerson?.id]);

  useEffect(() => {
    if (!forcedStatusMode) {
      return;
    }

    setStatusMode(forcedStatusMode);
    if (forcedStatusMode === "today") {
      setPeopleView("allContacts");
    }
    if (forcedStatusMode === "stale") {
      setPeopleView("needsFollowUp");
    }
    if (forcedStatusMode === "recent") {
      setPeopleView("recentlyMet");
    }
    if (forcedStatusMode === "all") {
      setPeopleView("allContacts");
    }
  }, [forcedStatusMode, forcedStatusNonce]);

  useEffect(() => {
    let isMounted = true;

    async function hydratePendingExternalAction() {
      const pending = await getPendingExternalAction();
      if (isMounted) {
        setPendingExternalActionState(pending);
      }
    }

    void hydratePendingExternalAction();

    const appStateSubscription = AppState.addEventListener("change", async (state) => {
      if (state !== "active") {
        return;
      }

      const pending = await getPendingExternalAction();
      if (pending) {
        setPendingExternalActionState(pending);
        setShowPendingExternalReturn(true);
      }
    });

    const handleWindowFocus = async () => {
      const pending = await getPendingExternalAction();
      if (pending) {
        setPendingExternalActionState(pending);
        setShowPendingExternalReturn(true);
      }
    };

    if (typeof window !== "undefined") {
      window.addEventListener("focus", handleWindowFocus);
      document.addEventListener("visibilitychange", handleWindowFocus);
    }

    return () => {
      isMounted = false;
      appStateSubscription.remove();
      if (typeof window !== "undefined") {
        window.removeEventListener("focus", handleWindowFocus);
        document.removeEventListener("visibilitychange", handleWindowFocus);
      }
    };
  }, []);

  async function markExternalActionStarted(destinationLabel: string, message?: string) {
    const pending = await setPendingExternalAction({ destinationLabel, message });
    setPendingExternalActionState(pending);
  }

  async function completeExternalActionFlow() {
    await clearPendingExternalAction();
    setPendingExternalActionState(null);
    setShowPendingExternalReturn(false);
  }

  function keepWaitingOnExternalAction() {
    setShowPendingExternalReturn(false);
  }

  async function clearPeopleCaptureState() {
    await AsyncStorage.removeItem(PEOPLE_CAPTURE_STATE_STORAGE_KEY);
    await AsyncStorage.removeItem(PEOPLE_CAPTURE_DRAFT_STORAGE_KEY);
  }

  async function clearLogUpdateState() {
    await AsyncStorage.removeItem(PEOPLE_LOG_UPDATE_STATE_STORAGE_KEY);
  }

  function closePeopleCapture() {
    void clearPeopleCaptureState();
    setCaptureOpen(false);
  }

  function closeLogUpdate() {
    void clearLogUpdateState();
    setUpdateModalOpen(false);
    setUpdatePerson(null);
    setPendingUpdatePersonId(null);
    setUpdateCalendarSlots([]);
  }

  function getDefaultUpdateStatus(person: (typeof people)[number]): UpdateStatus {
    if (person.followUpState === "dueToday" || person.followUpState === "overdue") {
      return "needsAction";
    }

    if (person.followUpState === "upcoming") {
      return "waiting";
    }

    return "warm";
  }

  function openLogUpdateForPerson(person: (typeof people)[number]) {
    const nextDraft: UpdateDraftState = {
      interactionType: currentEvent ? "met" : "called",
      shortNote: "",
      nextStep: person.nextStep || "",
      dueDate: person.nextFollowUpAt || "",
      status: getDefaultUpdateStatus(person),
    };
    setSelectedPersonId(person.id);
    setUpdatePerson(person);
    setUpdateDraft(nextDraft);
    setUpdateCalendarSlots([]);
    void AsyncStorage.setItem(
      PEOPLE_LOG_UPDATE_STATE_STORAGE_KEY,
      JSON.stringify({ isOpen: true, personId: person.id, draft: nextDraft } satisfies SavedLogUpdateState)
    );
    setUpdateModalOpen(true);
  }

  function openLogUpdate() {
    if (selectedPerson) {
      openLogUpdateForPerson(selectedPerson);
      return;
    }

    if (!visiblePeople.length) {
      openCreatePerson("");
      return;
    }

    setInteractionPickerOpen(true);
  }

  function openCreatePerson(initialName = searchQuery.trim()) {
    const nextDraft: Partial<ParsedPersonDraft> = {
      name: initialName,
      priority: "medium",
      tags: [],
      company: "",
      linkedinUrl: "",
      email: "",
      phoneNumber: "",
      event: currentEvent?.name || "",
      eventCategory: currentEvent?.category || "",
      whatMatters: "",
      nextStep: "",
      nextFollowUpAt: "",
      followUpPreset: "",
    };
    setEditorMode("createPerson");
    setEditorDraft(nextDraft);
    void AsyncStorage.setItem(
      PEOPLE_CAPTURE_STATE_STORAGE_KEY,
      JSON.stringify({ isOpen: true, mode: "createPerson", selectedPersonId: null, draft: nextDraft } satisfies SavedPeopleCaptureState)
    );
    setCaptureOpen(true);
  }

  function openCreatePersonFromSearch() {
    const nameFromSearch = searchQuery.trim();
    if (!nameFromSearch) {
      return;
    }

    setSelectedPersonId(null);
    openCreatePerson(nameFromSearch);
  }

  function openEditPerson(person = selectedPerson) {
    if (!person) {
      return;
    }

    const nextDraft: Partial<ParsedPersonDraft> = {
      name: person.name,
      priority: person.priority,
      tags: person.tags,
      company: person.company,
      linkedinUrl: person.linkedinUrl,
      email: person.email,
      phoneNumber: person.phoneNumber,
      preferredChannel: person.preferredChannel,
      preferredChannelOther: person.preferredChannelOther,
      event: person.lastEventName || "",
      whatMatters: person.whatMatters || person.lastInteractionNote,
      nextStep: person.nextStep || "",
      nextFollowUpAt: person.nextFollowUpAt || "",
      followUpPreset: "",
    };
    setSelectedPersonId(person.id);
    setEditorMode("edit");
    setEditorDraft(nextDraft);
    void AsyncStorage.setItem(
      PEOPLE_CAPTURE_STATE_STORAGE_KEY,
      JSON.stringify({ isOpen: true, mode: "edit", selectedPersonId: person.id, draft: nextDraft } satisfies SavedPeopleCaptureState)
    );
    setCaptureOpen(true);
  }

  function getInteractionTypeLabel(value: UpdateInteractionType) {
    return interactionTypeOptions.find((option) => option.value === value)?.label || "Update";
  }

  function getStatusLabel(value: UpdateStatus) {
    return updateStatusOptions.find((option) => option.value === value)?.label || "Warm";
  }

  function buildUpdateRecord() {
    const lines = [
      `Update type: ${getInteractionTypeLabel(updateDraft.interactionType)}`,
      updateDraft.shortNote.trim(),
      `Status: ${getStatusLabel(updateDraft.status)}`,
    ];

    if (updateDraft.nextStep.trim()) {
      lines.push(`Next step: ${updateDraft.nextStep.trim()}`);
    }

    if (updateDraft.dueDate.trim()) {
      lines.push(`Follow up date: ${updateDraft.dueDate.trim()}`);
    }

    return lines.filter(Boolean).join("\n");
  }

  async function handleCheckUpdateCalendarSlots() {
    try {
      setCheckingUpdateCalendar(true);
      const slots = await getFollowUpSlotSuggestions();
      setUpdateCalendarSlots(slots);
    } catch (error) {
      Alert.alert("Calendar check failed", error instanceof Error ? error.message : "Use a preset or custom date instead.");
    } finally {
      setCheckingUpdateCalendar(false);
    }
  }

  function handleUpdateCalendarSlotSelect(slot: CalendarSuggestedSlot) {
    setUpdateDraft((current) => ({
      ...current,
      dueDate: slot.dateOnly,
    }));
  }

  async function handleSaveUpdate() {
    if (!updatePerson || isSaving) {
      return;
    }

    if (!updateDraft.shortNote.trim()) {
      Alert.alert("Short note required", "Add a 1-2 line note so this update is useful later.");
      return;
    }

    if (updateDraft.dueDate.trim() && !parseDateOnlyString(updateDraft.dueDate.trim())) {
      Alert.alert("Invalid date", "Use YYYY-MM-DD for the due date.");
      return;
    }

    try {
      setSaving(true);
      const userId = await ensureSessionUserId();
      let eventId: string | null = null;

      if (currentEvent?.name) {
        const event = await getOrCreateEvent(userId, currentEvent.name, currentEvent.category, currentEvent.eventDate || null);
        eventId = event.id;
      }

      await createInteraction({
        userId,
        personId: updatePerson.id,
        eventId,
        rawNote: buildUpdateRecord(),
      });

      void captureAnalyticsEvent("interaction_logged", {
        surface: "people_log_update",
        interaction_type: updateDraft.interactionType,
        status: updateDraft.status,
        has_due_date: Boolean(updateDraft.dueDate),
        has_next_step: Boolean(updateDraft.nextStep),
      });

      setUpdateModalOpen(false);
      setUpdatePerson(null);
      setPendingUpdatePersonId(null);
      await clearLogUpdateState();
      await loadProfileData();
      Alert.alert("Update logged", `${updatePerson.name}'s timeline is up to date.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to log update.";
      Alert.alert("Could not log update", message);
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveInteraction(draft: ParsedPersonDraft, options?: { addAnother?: boolean; keepOpen?: boolean }) {
    if (isSaving) {
      return;
    }

    if (editorMode === "createInteraction" && !draft.whatMatters.trim() && !draft.nextStep.trim()) {
      Alert.alert("Context required", "Add what matters or the next step before saving.");
      return;
    }

    try {
      setSaving(true);
      const userId = await ensureSessionUserId();

      if (editorMode === "edit" && selectedPerson) {
        await updatePersonDetails({
          userId,
          personId: selectedPerson.id,
          name: draft.name,
          priority: draft.priority,
          tags: draft.tags,
          company: draft.company,
          linkedinUrl: draft.linkedinUrl,
          email: draft.email,
          phoneNumber: draft.phoneNumber,
          preferredChannel: draft.preferredChannel,
          preferredChannelOther: draft.preferredChannelOther,
        });

        let eventId: string | null = null;
        const editEventName = draft.event;
        if (editEventName && editEventName !== "No event") {
          const editEventDate =
            currentEvent?.name.trim().toLowerCase() === editEventName.trim().toLowerCase()
              ? currentEvent.eventDate || null
              : null;
          eventId = (await getOrCreateEvent(userId, editEventName, draft.eventCategory || null, editEventDate)).id;
        }

        const rawNote = buildInteractionRecord(draft.whatMatters, draft.nextStep, draft.company, draft.nextFollowUpAt);

        if (selectedPerson.lastInteractionId) {
          await updateInteraction({
            userId,
            interactionId: selectedPerson.lastInteractionId,
            eventId,
            rawNote,
          });
        } else {
          await createInteraction({
            userId,
            personId: selectedPerson.id,
            eventId,
            rawNote,
          });
        }

        if (!options?.addAnother) {
          setCaptureOpen(false);
          await clearPeopleCaptureState();
        }
        await loadProfileData();
        void captureAnalyticsEvent("contact_updated", {
          surface: "people_edit",
          preferred_channel: draft.preferredChannel || undefined,
          tags_count: draft.tags.length,
          has_company: Boolean(draft.company),
          has_linkedin: Boolean(draft.linkedinUrl),
          has_email: Boolean(draft.email),
          has_phone: Boolean(draft.phoneNumber),
        });
        if (!options?.addAnother) {
          Alert.alert("Contact updated", `${draft.name} is ready for follow-up.`);
        }
        return;
      }

      let activePersonId = selectedPerson?.id || null;
      if (editorMode === "createPerson" || !selectedPerson) {
        activePersonId = (
          await createPerson(
            userId,
            draft.name === "Unknown contact" ? "New Person" : draft.name,
            draft.company,
            draft.linkedinUrl,
            draft.email,
            draft.phoneNumber,
            draft.preferredChannel,
            draft.preferredChannelOther,
            draft.priority,
            draft.tags
          )
        ).id;
      } else {
        await updatePersonDetails({
          userId,
          personId: selectedPerson.id,
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
      }

      let eventId: string | null = null;
      const eventName = currentEvent?.name || draft.event;
      const eventCategory = currentEvent?.category || draft.eventCategory || null;
      const eventDate = currentEvent?.eventDate || null;
      if (eventName && eventName !== "No event") {
        eventId = (await getOrCreateEvent(userId, eventName, eventCategory, eventDate)).id;
      }

      if (!activePersonId) {
        throw new Error("Unable to determine which contact to save this interaction for.");
      }

      await createInteraction({
        userId,
        personId: activePersonId,
        eventId,
        rawNote: buildInteractionRecord(draft.whatMatters, draft.nextStep, draft.company, draft.nextFollowUpAt),
      });

      void captureAnalyticsEvent(editorMode === "createPerson" || !selectedPerson ? "contact_captured" : "interaction_logged", {
        surface: "people",
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
        await clearPeopleCaptureState();
      }
      await loadProfileData();
      if (!options?.addAnother && !options?.keepOpen) {
        Alert.alert("Timeline updated", selectedPerson ? `${selectedPerson.name}'s next step is saved.` : "New contact added with context.");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save interaction.";
      Alert.alert("Could not save update", message);
    } finally {
      setSaving(false);
    }
  }

  function handleToggleExpandedPerson(personId: string) {
    setSelectedPersonId((current) => (current === personId ? null : personId));
  }

  async function handleMarkContactedToday(person = selectedPerson) {
    if (!person) {
      return;
    }

    try {
      const userId = await ensureSessionUserId();
      await markPersonContactedToday(userId, person.id);
      await loadProfileData();
      void captureAnalyticsEvent("marked_contacted", {
        surface: "people",
        follow_up_state: person.followUpState,
        preferred_channel: person.preferredChannel || undefined,
      });
      Alert.alert("Marked contacted", `${person.name} is up to date for today.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to mark contact.";
      Alert.alert("Could not mark contacted", message);
    }
  }

  async function performDeletePerson(person = selectedPerson) {
    if (!person) {
      return;
    }

    try {
      setDeleting(true);
      const userId = await ensureSessionUserId();
      await deletePerson(userId, person.id);
      setPeople((current) => current.filter((entry) => entry.id !== person.id));
      setSelectedPersonId((current) => (current === person.id ? null : current));
      setPersonActionMenu((current) => (current?.id === person.id ? null : current));
      await loadProfileData();
      Alert.alert("Deleted", `${person.name} removed.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to delete contact.";
      Alert.alert("Delete failed", message);
    } finally {
      setDeleting(false);
    }
  }

  function handleDeletePerson(person = selectedPerson) {
    if (!person) {
      return;
    }

    const confirmDelete = () => {
      void performDeletePerson(person);
    };

    if (Platform.OS === "web" && typeof window !== "undefined" && typeof window.confirm === "function") {
      const confirmed = window.confirm(`${person.name} will be removed permanently.`);
      if (confirmed) {
        confirmDelete();
      }
      return;
    }

    Alert.alert(
      "Delete contact?",
      `${person.name} will be removed permanently.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: confirmDelete,
        },
      ]
    );
  }

  async function handleOpenExternal(url: string, destinationLabel = "external app") {
    try {
      await markExternalActionStarted(destinationLabel);
      await Linking.openURL(url);
    } catch {
      await clearPendingExternalAction();
      setPendingExternalActionState(null);
      Alert.alert("Open failed", "Could not open that link on this device.");
    }
  }


  function getMomentLabel(count: number) {
    return `${count} logged ${count === 1 ? "moment" : "moments"}`;
  }

  function renderPreferredChannelPill(person: (typeof people)[number], compact = false) {
    if (!person.preferredChannel) {
      return null;
    }

    return (
      <View style={[styles.preferredChannelPill, compact ? styles.preferredChannelPillCompact : null]}>
        <Typography variant="caption" style={styles.preferredChannelText}>
          Prefers {formatPreferredChannelLabel(person.preferredChannel, person.preferredChannelOther)}
        </Typography>
      </View>
    );
  }

  async function handleAddToCalendar(person = selectedPerson) {
    if (!person) {
      return;
    }

    if (!person.nextFollowUpAt) {
      Alert.alert("No follow-up date", `Set a follow-up date for ${person.name} first.`);
      return;
    }

    setCalendarPickerPerson(person);
  }

  async function handleCalendarDestinationSelect(destination: CalendarDestination) {
    const person = calendarPickerPerson;
    if (!person?.nextFollowUpAt) {
      setCalendarPickerPerson(null);
      return;
    }

    const destinationLabel =
      destination === "device"
        ? "device calendar"
        : destination === "google"
          ? "Google Calendar"
          : destination === "outlook"
            ? "Outlook Calendar"
            : destination === "yahoo"
              ? "Yahoo Calendar"
              : ".ics download";

    try {
      setCalendarPickerPerson(null);
      await markExternalActionStarted(destinationLabel, `Follow-up for ${person.name}`);
      await openFollowUpInCalendar(
        {
          name: person.name,
          company: person.company,
          nextFollowUpAt: person.nextFollowUpAt,
          whatMatters: person.whatMatters,
          nextStep: person.nextStep,
          linkedinUrl: person.linkedinUrl,
        },
        destination
      );
      void captureAnalyticsEvent("calendar_added", {
        destination,
        surface: "people_card",
        follow_up_state: person.followUpState,
        preferred_channel: person.preferredChannel || undefined,
      });
    } catch (error) {
      await clearPendingExternalAction();
      setPendingExternalActionState(null);
      const message = error instanceof Error ? error.message : "Could not open the calendar handoff.";
      Alert.alert("Calendar handoff failed", message);
    }
  }

  function buildMessageForPerson(person = selectedPerson) {
    if (!person) {
      return "";
    }

    return buildReconnectDraft({
      name: person.name,
      eventName: person.lastEventName,
      lastInteractionNote: person.lastInteractionNote,
      followUp: person.followUp,
    });
  }

  async function improveFollowUpMessage(person: (typeof people)[number], fallbackMessage: string) {
    try {
      setGeneratingFollowUpMessage(true);
      const message = await generateFollowUpDraft({
        name: person.name,
        company: person.company,
        eventName: person.lastEventName,
        whatMatters: person.whatMatters,
        nextStep: person.nextStep,
        relationshipGoal: person.tags[0] || null,
        relationshipStatus: person.relationshipStatus,
        preferredChannel: person.preferredChannel,
        preferredChannelOther: person.preferredChannelOther,
        lastInteractionNote: person.lastInteractionNote,
      });
      setFollowUpMessage(message);
    } catch {
      setFollowUpMessage(fallbackMessage);
    } finally {
      setGeneratingFollowUpMessage(false);
    }
  }

  function openFollowUpExecution(person = selectedPerson) {
    if (!person) {
      return;
    }

    const fallbackMessage = buildMessageForPerson(person);
    setSelectedPersonId(person.id);
    setFollowUpPerson(person);
    setFollowUpMessage(fallbackMessage);
    void improveFollowUpMessage(person, fallbackMessage);
    void captureAnalyticsEvent("followup_drafted", {
      surface: "people",
      follow_up_state: person.followUpState,
      preferred_channel: person.preferredChannel || undefined,
      has_whatsapp: Boolean(person.phoneNumber),
      has_linkedin: Boolean(person.linkedinUrl),
      has_email: Boolean(person.email),
    });
  }

  function getPrimaryFollowUpAction(person: (typeof people)[number]): { label: string; action: FollowUpChannelAction; disabled?: boolean } {
    if (person.preferredChannel === "whatsapp") {
      return { label: "Open WhatsApp", action: "whatsapp", disabled: !person.phoneNumber };
    }

    if (person.preferredChannel === "linkedin") {
      return { label: "Copy + Open LinkedIn", action: "linkedin", disabled: !person.linkedinUrl };
    }

    if (person.preferredChannel === "email") {
      return { label: "Open Email", action: "email", disabled: !person.email };
    }

    return { label: "Copy message", action: "copy" };
  }

  function runPrimaryFollowUpAction(person: (typeof people)[number], action: FollowUpChannelAction) {
    if (action === "whatsapp") {
      void openDraftMessage(person, followUpMessage);
      return;
    }

    if (action === "linkedin") {
      void copyLinkedInDraftAndOpen(person, followUpMessage);
      return;
    }

    if (action === "email") {
      void openEmailFollowUp(person);
      return;
    }

    void copyFollowUpMessage();
  }

  async function copyFollowUpMessage() {
    if (!followUpMessage.trim()) {
      return;
    }

    try {
      await Clipboard.setStringAsync(followUpMessage.trim());
      void captureAnalyticsEvent("followup_message_copied", {
        surface: "followup_execution",
      });
      Alert.alert("Message copied", "Your follow-up draft is ready to paste.");
    } catch {
      Alert.alert("Copy failed", "Could not copy the follow-up message.");
    }
  }

  async function logFollowUpOutcome(outcome: FollowUpOutcome, person = followUpPerson) {
    if (!person) {
      return;
    }

    try {
      const userId = await ensureSessionUserId();
      await createInteraction({
        userId,
        personId: person.id,
      rawNote: `Follow-up outcome: ${outcome}.\nNext step: ${outcome === "No response" ? "Try again later" : "Review relationship status"}`,
      });

    if (
      outcome === "Sent" ||
      outcome === "Replied" ||
      outcome === "Meeting booked" ||
      outcome === "Intro made" ||
      outcome === "Opportunity created" ||
      outcome === "Converted" ||
      outcome === "Not relevant"
    ) {
        await markPersonContactedToday(userId, person.id);
      }

      void captureAnalyticsEvent(outcome === "Sent" ? "followup_marked_sent" : "followup_outcome_recorded", {
        outcome,
        surface: "followup_execution",
        preferred_channel: person.preferredChannel || undefined,
      });

      setFollowUpPerson(null);
      setFollowUpMessage("");
      await loadProfileData();
      Alert.alert("Outcome saved", `${person.name}: ${outcome}.`);
    } catch (error) {
      Alert.alert("Could not save outcome", error instanceof Error ? error.message : "Try again in a moment.");
    }
  }

  async function snoozeFollowUp(person = followUpPerson) {
    if (!person) {
      return;
    }

    try {
      const date = getPresetDate("in3days");
      const userId = await ensureSessionUserId();
      await createInteraction({
        userId,
        personId: person.id,
        rawNote: `Reminder set.\nNext step: Follow up\nFollow up date: ${date}`,
      });
      setFollowUpPerson(null);
      setFollowUpMessage("");
      await loadProfileData();
      void captureAnalyticsEvent("followup_snoozed", {
        surface: "followup_execution",
        snooze_days: 3,
      });
      Alert.alert("Snoozed", `${person.name} will come back on ${formatFollowUpDate(date)}.`);
    } catch (error) {
      Alert.alert("Could not snooze", error instanceof Error ? error.message : "Try again in a moment.");
    }
  }

  async function openEmailDraft(person = selectedPerson) {
    if (!person) {
      return;
    }

    if (!person.email) {
      Alert.alert("No email address", `Add an email address for ${person.name} before opening an email draft.`);
      return;
    }

    const message = buildMessageForPerson(person);
    const subject = person.lastEventName
      ? `Following up from ${person.lastEventName}`
      : `Following up with ${person.name}`;
    const url = `mailto:${encodeURIComponent(person.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`;

    try {
      await markExternalActionStarted(`Email for ${person.name}`, message);
      await Linking.openURL(url);
    } catch {
      await clearPendingExternalAction();
      setPendingExternalActionState(null);
      Alert.alert("Email draft failed", "Could not open your email app for this contact.");
    }
  }

  async function openEmailFollowUp(person = followUpPerson) {
    if (!person) {
      return;
    }

    if (!person.email) {
      Alert.alert("No email address", `Add an email address for ${person.name} before opening an email draft.`);
      return;
    }

    const message = followUpMessage.trim() || buildMessageForPerson(person);
    const subject = person.lastEventName
      ? `Following up from ${person.lastEventName}`
      : `Following up with ${person.name}`;
    const url = `mailto:${encodeURIComponent(person.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`;

    try {
      await markExternalActionStarted(`Email for ${person.name}`, message);
      await Linking.openURL(url);
    } catch {
      await clearPendingExternalAction();
      setPendingExternalActionState(null);
      Alert.alert("Email draft failed", "Could not open your email app for this contact.");
    }
  }

  async function openPhoneCall(person = selectedPerson) {
    if (!person) {
      return;
    }

    if (!person.phoneNumber) {
      Alert.alert("No phone number", `Add a phone number for ${person.name} before calling.`);
      return;
    }

    try {
      await markExternalActionStarted(`Phone for ${person.name}`);
      await Linking.openURL(`tel:${person.phoneNumber}`);
    } catch {
      await clearPendingExternalAction();
      setPendingExternalActionState(null);
      Alert.alert("Call failed", "Could not open your phone app for this contact.");
    }
  }

  function renderContactActionButtons(person: (typeof people)[number], compact = false) {
    const actions = [
      person.phoneNumber
        ? {
            channel: "whatsapp",
            label: "WhatsApp Draft",
            onPress: () => handleDraftMessage(person),
          }
        : null,
      person.email
        ? {
            channel: "email",
            label: "Email Draft",
            onPress: () => {
              void openEmailDraft(person);
            },
          }
        : null,
      person.phoneNumber
        ? {
            channel: "phone",
            label: "Call",
            onPress: () => {
              void openPhoneCall(person);
            },
          }
        : null,
      person.linkedinUrl
        ? {
            channel: "linkedin",
            label: "LinkedIn Draft",
            onPress: () => handleLinkedInDraft(person),
          }
        : null,
    ].filter(Boolean) as Array<{
      channel: "whatsapp" | "email" | "phone" | "linkedin";
      label: string;
      onPress: () => void;
    }>;

    if (!actions.length) {
      return null;
    }

    const preferredChannel = person.preferredChannel;
    const action = preferredChannel
      ? actions.find((item) => item.channel === preferredChannel)
      : actions[0];

    if (!action) {
      return null;
    }

    return (
      <View style={compact ? styles.compactExpandedActions : styles.primaryActionRow}>
        <Button
          label={action.label}
          onPress={action.onPress}
          variant="primary"
          fullWidth={false}
          size="compact"
        />
      </View>
    );
  }

  function renderCompactPrimaryContactAction(person: (typeof people)[number]) {
    const actions = [
      person.phoneNumber
        ? {
            channel: "whatsapp",
            label: "WA",
            onPress: () => handleDraftMessage(person),
          }
        : null,
      person.email
        ? {
            channel: "email",
            label: "Email",
            onPress: () => {
              void openEmailDraft(person);
            },
          }
        : null,
      person.phoneNumber
        ? {
            channel: "phone",
            label: "Call",
            onPress: () => {
              void openPhoneCall(person);
            },
          }
        : null,
      person.linkedinUrl
        ? {
            channel: "linkedin",
            label: "in",
            onPress: () => handleLinkedInDraft(person),
          }
        : null,
    ].filter(Boolean) as Array<{
      channel: "whatsapp" | "email" | "phone" | "linkedin";
      label: string;
      onPress: () => void;
    }>;

    if (!actions.length) {
      return null;
    }

    const preferredChannel = person.preferredChannel;
    const action = preferredChannel
      ? actions.find((item) => item.channel === preferredChannel)
      : actions[0];

    if (!action) {
      return null;
    }

    return (
      <Pressable style={[styles.iconButton, styles.iconButtonPreferred]} onPress={action.onPress}>
        <Typography variant="body" style={[styles.iconButtonText, styles.iconButtonTextPreferred]}>
          {action.label}
        </Typography>
      </Pressable>
    );
  }

  async function openWhatsAppOnWeb(browserUrl: string, personName: string) {
    if (typeof window === "undefined") {
      return;
    }

    try {
      const openedWindow = window.open(browserUrl, "_blank", "noopener,noreferrer");
      if (!openedWindow) {
        Alert.alert("Open failed", `Your browser blocked opening WhatsApp Web for ${personName}. Please check your popup blocker settings.`);
      }
    } catch {
      // fall through to same-tab navigation
      Alert.alert("Open failed", `Your browser blocked opening WhatsApp Web for ${personName}. Please check your popup blocker settings.`);
    }
  }


  async function openDraftMessage(person = selectedPerson, messageOverride?: string) {
    if (!person) {
      return;
    }

    const message = messageOverride?.trim() || buildMessageForPerson(person);
    const digits = person.phoneNumber
      ? person.phoneNumber.replace(/[^\d+]/g, "").replace(/^00/, "+")
      : "";
    const normalizedPhone = digits.startsWith("+") ? digits.slice(1) : digits;
    const encodedMessage = encodeURIComponent(message);
    const destinationLabel = person.name ? `WhatsApp for ${person.name}` : "WhatsApp";
    const whatsappAppUrl = normalizedPhone ? `whatsapp://send?phone=${normalizedPhone}&text=${encodedMessage}` : null;
    const whatsappApiUrl = normalizedPhone
      ? `https://api.whatsapp.com/send/?phone=${normalizedPhone}&text=${encodedMessage}&type=phone_number&app_absent=0`
      : null;
    const whatsappWebUrl = normalizedPhone ? `https://wa.me/${normalizedPhone}?text=${encodedMessage}` : null;

    try {
      await markExternalActionStarted(destinationLabel, message);

      if (Platform.OS === "web") {
        const browserUrl = whatsappWebUrl || whatsappApiUrl;
        if (!browserUrl) {
          Alert.alert("No WhatsApp number", `Add a phone number for ${person.name} before opening WhatsApp.`);
          return;
        }

        await openWhatsAppOnWeb(browserUrl, person.name);
        return;
      }

      if (whatsappAppUrl) {
        const canOpenWhatsApp = await Linking.canOpenURL(whatsappAppUrl);
        if (canOpenWhatsApp) {
          await Linking.openURL(whatsappAppUrl);
          return;
        }
      }

      if (whatsappApiUrl) {
        await Linking.openURL(whatsappApiUrl);
        return;
      }

      if (whatsappWebUrl) {
        await Linking.openURL(whatsappWebUrl);
        return;
      }

      if (person.phoneNumber) {
        const smsUrl = `sms:${person.phoneNumber}?body=${encodedMessage}`;
        const canOpenSms = await Linking.canOpenURL(smsUrl);
        if (canOpenSms) {
          await Linking.openURL(smsUrl);
          return;
        }
      }

      Alert.alert("No supported message app", "Use Copy message and paste it into any app.");
    } catch {
      await clearPendingExternalAction();
      setPendingExternalActionState(null);
      Alert.alert("Draft failed", "Use Copy message and paste it into any app.");
    }
  }

  function handleDraftMessage(person = selectedPerson) {
    if (!person) {
      return;
    }

    if (!person.phoneNumber) {
      Alert.alert("No WhatsApp number", `Add a phone number for ${person.name} before opening a WhatsApp draft.`);
      return;
    }

    setDraftPreviewDestination("whatsapp");
    setDraftPreviewText(buildMessageForPerson(person));
    setDraftPreviewPerson(person);
  }

  function handleLinkedInDraft(person = selectedPerson) {
    if (!person) {
      return;
    }

    if (!person.linkedinUrl) {
      Alert.alert("No LinkedIn profile", `Add a LinkedIn URL for ${person.name} before opening a LinkedIn draft.`);
      return;
    }

    setDraftPreviewDestination("linkedin");
    setDraftPreviewText(buildMessageForPerson(person));
    setDraftPreviewPerson(person);
  }

  async function copyLinkedInDraftAndOpen(person: (typeof people)[number], message: string) {
    if (!person.linkedinUrl) {
      Alert.alert("No LinkedIn profile", `Add a LinkedIn URL for ${person.name} before opening LinkedIn.`);
      return;
    }

    try {
      await Clipboard.setStringAsync(message);
      Alert.alert("Message copied", "Your LinkedIn draft is copied to clipboard and ready to paste.");
      await handleOpenExternal(person.linkedinUrl, `LinkedIn for ${person.name}`);
    } catch {
      Alert.alert("Copy failed", "Could not copy the draft message. Please try again.");
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={[styles.headerRow, isCompactLayout ? styles.headerRowCompact : null]}>
            <View style={styles.headerCopy}>
              <Typography variant="caption">People</Typography>
              <Typography variant="h1">People you should not forget.</Typography>
            </View>
            {!isCompactLayout ? (
              <View style={styles.headerActions}>
                <Button label="Add person" onPress={() => openCreatePerson("")} variant="ghost" fullWidth={false} />
                <Button label="Log update" onPress={openLogUpdate} fullWidth={false} />
              </View>
            ) : null}
          </View>


{pendingExternalAction ? (
  <Card style={styles.pendingExternalCard}>
    <Typography variant="caption">Return and continue</Typography>
    <Typography variant="body" style={styles.confirmMeta}>
      You still have an external action open for {pendingExternalAction.destinationLabel}. Finish there, then come back here to continue.
    </Typography>
    <View style={styles.confirmActions}>
      <Button
        label="I have finished"
        fullWidth={false}
        size="compact"
        onPress={() => {
          void completeExternalActionFlow();
        }}
      />
      <Button
        label="Dismiss"
        variant="ghost"
        fullWidth={false}
        size="compact"
        onPress={keepWaitingOnExternalAction}
      />
    </View>
  </Card>
) : null}

          <Card style={styles.attentionCard}>
            <Typography variant="caption">Today</Typography>
            <View style={styles.controlRow}>
              <Button
                label={`Still open ${attentionCounts.needsFollowUp}`}
                onPress={() => {
                  setStatusMode("all");
                  setPeopleView("needsFollowUp");
                }}
                variant={peopleView === "needsFollowUp" ? "primary" : "ghost"}
                fullWidth={false}
                size="compact"
              />
              <Button
                label={`Recently met ${attentionCounts.recentlyMet}`}
                onPress={() => {
                  setStatusMode("all");
                  setPeopleView("recentlyMet");
                }}
                variant={peopleView === "recentlyMet" ? "primary" : "ghost"}
                fullWidth={false}
                size="compact"
              />
              <Button
                label={`Everyone ${attentionCounts.allContacts}`}
                onPress={() => {
                  setStatusMode("all");
                  setPeopleView("allContacts");
                }}
                variant={peopleView === "allContacts" ? "primary" : "ghost"}
                fullWidth={false}
                size="compact"
              />
            </View>
            <Typography variant="body" style={styles.confirmMeta}>
              {peopleView === "needsFollowUp"
                ? "Conversations due today, still open, high-priority stale, or missing a clear next move."
                : peopleView === "recentlyMet"
                  ? "People captured in the last 7 days with event context ready to review."
                  : "Everyone you have met, searchable when you need the full memory."}
            </Typography>
          </Card>

          <Card>
            <Typography variant="caption">Find someone</Typography>

            {!isCompactLayout ? (
              <>
                <Typography variant="caption" style={styles.subSectionLabel}>
                  Event type
                </Typography>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
                  {EVENT_CATEGORY_OPTIONS.map((option) => (
                    <Button
                      key={option.value}
                      label={option.label}
                      onPress={() => setCategoryMode(option.value)}
                      variant={categoryMode === option.value ? "primary" : "ghost"}
                      fullWidth={false}
                      size="compact"
                    />
                  ))}
                </ScrollView>

                <Typography variant="caption" style={styles.subSectionLabel}>
                  Sort order
                </Typography>
                <View style={styles.controlRow}>
                  <Button
                    label="Recent"
                    onPress={() => setSortMode("recent")}
                    variant={sortMode === "recent" ? "primary" : "ghost"}
                    fullWidth={false}
                    size="compact"
                  />
                  <Button
                    label="Stale"
                    onPress={() => setSortMode("stale")}
                    variant={sortMode === "stale" ? "primary" : "ghost"}
                    fullWidth={false}
                    size="compact"
                  />
                  <Button
                    label="A-Z"
                    onPress={() => setSortMode("name")}
                    variant={sortMode === "name" ? "primary" : "ghost"}
                    fullWidth={false}
                    size="compact"
                  />
                  <Button
                    label="Most logged"
                    onPress={() => setSortMode("frequency")}
                    variant={sortMode === "frequency" ? "primary" : "ghost"}
                    fullWidth={false}
                    size="compact"
                  />
                </View>
              </>
            ) : null}

            <Typography variant="caption" style={styles.subSectionLabel}>
              Search
            </Typography>
            <TextInput
              placeholder="Search name, company, notes, tags"
              placeholderTextColor={colors.textTertiary}
              value={searchQuery}
              onChangeText={setSearchQuery}
              style={styles.searchInput}
              autoCapitalize="none"
              autoCorrect={false}
            />

            {!isCompactLayout ? (
              <>
                <Typography variant="caption" style={styles.subSectionLabel}>
                  Tags
                </Typography>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
                  <Button
                    label="All tags"
                    onPress={() => setSelectedTag("all")}
                    variant={selectedTag === "all" ? "primary" : "ghost"}
                    fullWidth={false}
                    size="compact"
                  />
                  {availableTags.map((tag) => (
                    <Button
                      key={tag}
                      label={tag}
                      onPress={() => setSelectedTag(tag)}
                      variant={selectedTag === tag ? "primary" : "ghost"}
                      fullWidth={false}
                      size="compact"
                    />
                  ))}
                </ScrollView>
              </>
            ) : null}
          </Card>

          {!isCompactLayout && selectedPerson ? (
            <Card style={styles.featureCard}>
              <View style={styles.selectedContactHeader}>
                <View style={styles.selectedContactTitle}>
              <Typography variant="caption">Person memory</Typography>
                  <Typography variant="h1">{selectedPerson.name}</Typography>
                </View>
                <PersonQuickActionsButton person={selectedPerson} onChanged={loadProfileData} onEdit={() => openEditPerson(selectedPerson)} />
              </View>
              <View style={styles.featureMetaRow}>
                <Typography variant="body" style={styles.featureBody}>
                  {selectedPerson.bannerLabel}
                </Typography>
                <Typography variant="body" style={styles.metaDivider}>·</Typography>
                <Typography variant="body" style={styles.featureBody}>
                  {getMomentLabel(selectedPerson.interactionCount)}
                </Typography>
              </View>
              {selectedPerson.company ? (
                <Typography variant="caption">{selectedPerson.company}</Typography>
              ) : null}
              {selectedPerson.relationshipStatus ? (
                <Typography variant="caption">Status: {selectedPerson.relationshipStatus}</Typography>
              ) : null}
              {renderPreferredChannelPill(selectedPerson)}
              {selectedPerson.tags.length ? (
                <View style={styles.tagPillRow}>
                  {selectedPerson.tags.map((tag) => (
                    <View key={tag} style={styles.tagPill}>
                      <Typography variant="caption">{tag}</Typography>
                    </View>
                  ))}
                </View>
              ) : null}
              {searchQuery ? <Typography variant="caption">Search: {searchQuery}</Typography> : null}

              {renderContactActionButtons(selectedPerson)}

              <View style={styles.secondaryActionRow}>
                <Button
                  label="Draft message"
                  onPress={() => openFollowUpExecution(selectedPerson)}
                  fullWidth={false}
                  size="compact"
                />
                {selectedPerson.nextFollowUpAt ? (
                  <Button
                    label="Add to calendar"
                    onPress={() => void handleAddToCalendar(selectedPerson)}
                    variant="ghost"
                    fullWidth={false}
                    size="compact"
                  />
                ) : null}
                <Button
                  label="✓ Reached out"
                  onPress={() => handleMarkContactedToday(selectedPerson)}
                  variant="ghost"
                  fullWidth={false}
                  size="compact"
                />
                <Button
                  label="Edit"
                  onPress={() => setPersonActionMenu(selectedPerson)}
                  variant="ghost"
                  fullWidth={false}
                  size="compact"
                />
              </View>

              <Typography variant="body" style={styles.featureNote}>
                {selectedPerson.lastInteractionNote}
              </Typography>
            </Card>
          ) : null}

          <View style={styles.timelineHeader}>
            <Typography variant="caption">All connections</Typography>
            <Typography variant="body" style={styles.timelineCount}>
              {visiblePeople.length} people in view ({sortLabel}{selectedTag !== "all" ? ` · ${selectedTag}` : ""})
            </Typography>
          </View>

          {errorMessage ? (
            <Card>
              <Typography variant="body">{errorMessage}</Typography>
            </Card>
          ) : null}

          <View style={styles.timelineStack}>
            {visiblePeople.map((person) => (
              <Card key={person.id} style={person.id === selectedPerson?.id ? styles.selectedCard : null}>
                {isCompactLayout ? (
                  <>
                    <View style={styles.compactPersonRow}>
                      <View style={styles.compactPersonMain}>
                        <Typography variant="h2" numberOfLines={1}>{person.name}</Typography>
                        <Typography variant="body" style={styles.compactCompany} numberOfLines={1}>
                          {person.company || "No company"}
                        </Typography>
                        {renderPreferredChannelPill(person, true)}
                        {person.relationshipStatus ? (
                          <Typography variant="caption">Status: {person.relationshipStatus}</Typography>
                        ) : null}
                      </View>
                      <View style={styles.compactActions}>
                        {renderCompactPrimaryContactAction(person)}
                        <PersonQuickActionsButton person={person} onChanged={loadProfileData} onEdit={() => openEditPerson(person)} />
                        <Pressable style={styles.expandButton} onPress={() => handleToggleExpandedPerson(person.id)}>
                          <Typography variant="body" style={styles.iconButtonText}>
                            {selectedPersonId === person.id ? "v" : ">"}
                          </Typography>
                        </Pressable>
                      </View>
                    </View>

                    {selectedPersonId === person.id ? (
                      <View style={styles.expandedPersonContent}>
                        <Typography variant="body" style={styles.noteText}>
                          {person.lastInteractionNote}
                        </Typography>
                        <View style={styles.metaRow}>
                          <Typography variant="caption">{person.bannerLabel}</Typography>
                          {isContactStale(person.daysSinceLastContact, person.priority) ? <Typography variant="caption">Need a nudge</Typography> : null}
                          <Typography variant="caption">{getMomentLabel(person.interactionCount)}</Typography>
                        </View>
                        {renderPreferredChannelPill(person)}
                        {person.relationshipStatus ? <Typography variant="caption">Status: {person.relationshipStatus}</Typography> : null}
                        {person.tags.length ? <Typography variant="caption">Tags: {person.tags.join(", ")}</Typography> : null}
                        {renderContactActionButtons(person, true)}
                        <View style={styles.secondaryActionRow}>
                          <Button label="Draft message" onPress={() => openFollowUpExecution(person)} fullWidth={false} size="compact" />
                          {person.nextFollowUpAt ? (
                            <Button
                              label="Add to calendar"
                              onPress={() => void handleAddToCalendar(person)}
                              variant="ghost"
                              fullWidth={false}
                              size="compact"
                            />
                          ) : null}
                          <Button label="✓ Reached out" onPress={() => handleMarkContactedToday(person)} variant="ghost" fullWidth={false} size="compact" />
                          <Button label="Edit" onPress={() => setPersonActionMenu(person)} variant="ghost" fullWidth={false} size="compact" />
                        </View>
                      </View>
                    ) : null}
                  </>
                ) : (
                  <Pressable onPress={() => openFollowUpExecution(person)}>
                    <View style={styles.rowTop}>
                      <View style={styles.personCopy}>
                        <Typography variant="h2">{person.name}</Typography>
                        <Typography variant="caption">
                          {[person.company, person.lastEventName || "No event yet"].filter(Boolean).join(" · ")}
                        </Typography>
                        {renderPreferredChannelPill(person)}
                        {person.relationshipStatus ? <Typography variant="caption">Status: {person.relationshipStatus}</Typography> : null}
                        {person.tags.length ? <Typography variant="caption">Tags: {person.tags.join(", ")}</Typography> : null}
                      </View>
                      <View style={styles.cardActionRow}>
                        <Button
                          label="Draft message"
                          onPress={() => openFollowUpExecution(person)}
                          variant="primary"
                          fullWidth={false}
                          size="compact"
                        />
                        {person.nextFollowUpAt ? (
                          <Button
                            label="Calendar"
                            onPress={() => void handleAddToCalendar(person)}
                            variant="ghost"
                            fullWidth={false}
                            size="compact"
                          />
                        ) : null}
                        <Button
                          label="Edit"
                          onPress={() => setPersonActionMenu(person)}
                          variant={person.id === selectedPerson?.id ? "primary" : "ghost"}
                          fullWidth={false}
                          size="compact"
                        />
                        <PersonQuickActionsButton person={person} onChanged={loadProfileData} onEdit={() => openEditPerson(person)} />
                      </View>
                    </View>
                    <Typography variant="body" style={styles.noteText} numberOfLines={2}>
                      {person.lastInteractionNote}
                    </Typography>

                    <View style={styles.metaRow}>
                      
                      <Typography variant="caption">{person.bannerLabel}</Typography>
                      {isContactStale(person.daysSinceLastContact, person.priority) ? <Typography variant="caption">Need a nudge</Typography> : null}
                      <Typography variant="caption">{person.interactionCount} notes</Typography>
                    </View>
                    </Pressable>
                )}
              </Card>
            ))}
            {!isLoading && visiblePeople.length === 0 ? (
              searchQuery.trim() ? (
                <Card style={styles.emptyStateCard}>
                  <Typography variant="h2">No contact found for "{searchQuery.trim()}"</Typography>
                  <Typography variant="body" style={styles.timelineCount}>
                    Create a new contact with that name and fill in the rest from there.
                  </Typography>
                  <View style={styles.emptyStateActions}>
                    <Button label={`Create ${searchQuery.trim()}`} onPress={openCreatePersonFromSearch} fullWidth={false} size="compact" />
                  </View>
                </Card>
              ) : (
                <Typography variant="body">No contacts match this filter yet.</Typography>
              )
            ) : null}
          </View>
        </ScrollView>

        <CaptureModal
          visible={isCaptureOpen}
          onClose={closePeopleCapture}
          onSave={handleSaveInteraction}
          isSaving={isSaving}
          initialDraft={editorDraft}
          lockedEvent={editorMode === "edit" ? null : currentEvent}
          title={editorMode === "edit" ? "Edit Contact" : editorMode === "createPerson" ? "Add Person" : "Add Interaction"}
          saveLabel={editorMode === "edit" ? "Save Changes" : editorMode === "createPerson" ? "Save & Close" : "Save Interaction"}
          showQuickCapture={editorMode === "createPerson"}
          showSaveAndAddAnother={editorMode !== "edit"}
          draftStorageKey={PEOPLE_CAPTURE_DRAFT_STORAGE_KEY}
          autosaveWithInitialDraft
        />

        <Modal visible={isUpdateModalOpen} animationType="slide" presentationStyle="pageSheet">
          <SafeAreaView style={styles.safeArea}>
            <View style={styles.updateModalContainer}>
              <View style={styles.headerRow}>
                <View style={styles.headerCopy}>
                  <Typography variant="caption">Log update</Typography>
                  <Typography variant="h1">{updatePerson?.name || "Select contact"}</Typography>
                  <Typography variant="body" style={styles.confirmMeta}>
                    Capture what happened, what changed, and what needs doing next.
                  </Typography>
                </View>
                <Button
                  label="Close"
                  onPress={closeLogUpdate}
                  variant="ghost"
                  fullWidth={false}
                  size="compact"
                />
              </View>

              <ScrollView
                style={styles.updateModalScroll}
                contentContainerStyle={styles.updateModalContent}
                showsVerticalScrollIndicator={false}
              >
                <Card style={styles.updateCard}>
                  <Typography variant="caption">Interaction type</Typography>
                  <View style={styles.controlRow}>
                    {interactionTypeOptions.map((option) => (
                      <Button
                        key={option.value}
                        label={option.label}
                        onPress={() => setUpdateDraft((current) => ({ ...current, interactionType: option.value }))}
                        variant={updateDraft.interactionType === option.value ? "primary" : "ghost"}
                        fullWidth={false}
                        size="compact"
                      />
                    ))}
                  </View>
                </Card>

                <Card style={styles.updateCard}>
                  <Typography variant="caption">Short note</Typography>
                  <TextInput
                    value={updateDraft.shortNote}
                    onChangeText={(value) => setUpdateDraft((current) => ({ ...current, shortNote: value }))}
                    placeholder="1-2 lines: what happened?"
                    placeholderTextColor={colors.textTertiary}
                    style={[styles.updateInput, styles.updateTextArea]}
                    multiline
                    autoFocus
                  />

                  <Typography variant="caption" style={styles.subSectionLabel}>Next steps</Typography>
                  <TextInput
                    value={updateDraft.nextStep}
                    onChangeText={(value) => setUpdateDraft((current) => ({ ...current, nextStep: value }))}
                    placeholder="What do you need to do next?"
                    placeholderTextColor={colors.textTertiary}
                    style={[styles.updateInput, styles.updateTextArea]}
                    multiline
                  />
                </Card>

                <Card style={styles.updateCard}>
                  <Typography variant="caption">Due date</Typography>
                  <View style={styles.controlRow}>
                    <Button
                      label="Tomorrow"
                      onPress={() => setUpdateDraft((current) => ({ ...current, dueDate: getPresetDate("tomorrow") }))}
                      variant={updateDraft.dueDate === getPresetDate("tomorrow") ? "primary" : "ghost"}
                      fullWidth={false}
                      size="compact"
                    />
                    <Button
                      label="In 3 days"
                      onPress={() => setUpdateDraft((current) => ({ ...current, dueDate: getPresetDate("in3days") }))}
                      variant={updateDraft.dueDate === getPresetDate("in3days") ? "primary" : "ghost"}
                      fullWidth={false}
                      size="compact"
                    />
                    <Button
                      label="Next week"
                      onPress={() => setUpdateDraft((current) => ({ ...current, dueDate: getPresetDate("nextWeek") }))}
                      variant={updateDraft.dueDate === getPresetDate("nextWeek") ? "primary" : "ghost"}
                      fullWidth={false}
                      size="compact"
                    />
                    <Button
                      label={isCheckingUpdateCalendar ? "Checking..." : "Check calendar"}
                      onPress={() => void handleCheckUpdateCalendarSlots()}
                      variant="ghost"
                      fullWidth={false}
                      size="compact"
                      disabled={isCheckingUpdateCalendar}
                    />
                  </View>
                  {updateCalendarSlots.length ? (
                    <View style={styles.calendarOptionStack}>
                      <Typography variant="caption">
                        {updateCalendarSlots[0]?.source === "google"
                          ? "Free slots from Google Calendar"
                          : updateCalendarSlots[0]?.source === "device"
                            ? "Free slots from device calendar"
                            : "Suggested slots"}
                      </Typography>
                      <View style={styles.controlRow}>
                        {updateCalendarSlots.map((slot) => (
                          <Button
                            key={`${slot.dateOnly}-${slot.label}`}
                            label={slot.label}
                            onPress={() => handleUpdateCalendarSlotSelect(slot)}
                            variant={updateDraft.dueDate === slot.dateOnly ? "primary" : "ghost"}
                            fullWidth={false}
                            size="compact"
                          />
                        ))}
                      </View>
                    </View>
                  ) : null}
                  <TextInput
                    value={updateDraft.dueDate}
                    onChangeText={(value) => setUpdateDraft((current) => ({ ...current, dueDate: value }))}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor={colors.textTertiary}
                    style={styles.updateInput}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  {updateDraft.dueDate.trim() && parseDateOnlyString(updateDraft.dueDate.trim()) ? (
                    <Typography variant="caption" style={styles.confirmMeta}>
                      Due {formatFollowUpDate(updateDraft.dueDate.trim())}
                    </Typography>
                  ) : null}
                </Card>

                <Card style={styles.updateCard}>
                  <Typography variant="caption">Latest status</Typography>
                  <View style={styles.controlRow}>
                    {updateStatusOptions.map((option) => (
                      <Button
                        key={option.value}
                        label={option.label}
                        onPress={() => setUpdateDraft((current) => ({ ...current, status: option.value }))}
                        variant={updateDraft.status === option.value ? "primary" : "ghost"}
                        fullWidth={false}
                        size="compact"
                      />
                    ))}
                  </View>
                </Card>
              </ScrollView>

              <View style={styles.updateFooter}>
                <Button
                  label="Save update"
                  onPress={() => void handleSaveUpdate()}
                  loading={isSaving}
                  disabled={!updatePerson || !updateDraft.shortNote.trim()}
                />
              </View>
            </View>
          </SafeAreaView>
        </Modal>

        {isInteractionPickerOpen ? (
          <View style={styles.confirmOverlay}>
            <Pressable style={styles.confirmBackdrop} onPress={() => setInteractionPickerOpen(false)} />
            <View style={styles.confirmCardWrap}>
              <Card style={styles.confirmCard}>
                <Typography variant="h2">Log update</Typography>
                <Typography variant="body" style={styles.confirmMeta}>
                  Choose who this update belongs to.
                </Typography>
                <ScrollView style={styles.pickerList} contentContainerStyle={styles.pickerListContent}>
                  {visiblePeople.map((person) => (
                    <Button
                      key={person.id}
                      label={person.name}
                      variant="ghost"
                      fullWidth={false}
                      size="compact"
                      onPress={() => {
                        setSelectedPersonId(person.id);
                        setInteractionPickerOpen(false);
                        openLogUpdateForPerson(person);
                      }}
                    />
                  ))}
                </ScrollView>
                <View style={styles.confirmActions}>
                  <Button
                    label="Add person instead"
                    variant="ghost"
                    fullWidth={false}
                    size="compact"
                    onPress={() => {
                      setInteractionPickerOpen(false);
                      openCreatePerson("");
                    }}
                  />
                  <Button
                    label="Cancel"
                    variant="ghost"
                    fullWidth={false}
                    size="compact"
                    onPress={() => setInteractionPickerOpen(false)}
                  />
                </View>
              </Card>
            </View>
          </View>
        ) : null}

        {followUpPerson ? (
          <View style={styles.confirmOverlay}>
            <Pressable style={styles.confirmBackdrop} onPress={() => setFollowUpPerson(null)} />
            <View style={styles.confirmCardWrap}>
              <Card style={styles.followUpCard}>
                <ScrollView contentContainerStyle={styles.followUpContent} showsVerticalScrollIndicator={false}>
                  {(() => {
                    const primaryFollowUpAction = getPrimaryFollowUpAction(followUpPerson);

                    return (
                      <>
                  <View style={styles.selectedContactHeader}>
                    <View style={styles.selectedContactTitle}>
                      <Typography variant="caption">Execute follow-up</Typography>
                      <Typography variant="h1">{followUpPerson.name}</Typography>
                      {followUpPerson.company ? <Typography variant="caption">{followUpPerson.company}</Typography> : null}
                    </View>
                    <Button label="Close" onPress={() => setFollowUpPerson(null)} variant="ghost" fullWidth={false} size="compact" />
                  </View>

                  <View style={styles.followUpContextCard}>
                    <View style={styles.followUpInfoGrid}>
                      <View style={styles.followUpInfoBlock}>
                        <Typography variant="caption">Met at</Typography>
                        <Typography variant="body" style={styles.confirmMeta}>{followUpPerson.lastEventName || "No event logged"}</Typography>
                      </View>
                      <View style={styles.followUpInfoBlock}>
                        <Typography variant="caption">Preferred channel</Typography>
                        <Typography variant="body" style={styles.confirmMeta}>
                          {formatPreferredChannelLabel(followUpPerson.preferredChannel, followUpPerson.preferredChannelOther)}
                        </Typography>
                      </View>
                    </View>

                    <View style={styles.followUpInfoGrid}>
                      <View style={styles.followUpInfoBlock}>
                        <Typography variant="caption">Why</Typography>
                        <Typography variant="body" style={styles.confirmPreview} numberOfLines={2}>{followUpPerson.whatMatters}</Typography>
                      </View>
                      <View style={styles.followUpInfoBlock}>
                        <Typography variant="caption">Next</Typography>
                        <Typography variant="body" style={styles.confirmPreview} numberOfLines={2}>{followUpPerson.nextStep || "No next step yet"}</Typography>
                      </View>
                    </View>

                    {followUpPerson.relationshipStatus ? (
                      <Typography variant="caption" style={styles.confirmMeta}>Status: {followUpPerson.relationshipStatus}</Typography>
                    ) : null}
                  </View>

                  <View style={styles.followUpDraftBlock}>
                    <Typography variant="caption">Suggested message</Typography>
                    {isGeneratingFollowUpMessage ? (
                      <Typography variant="caption" style={styles.confirmMeta}>
                        Improving draft for {formatPreferredChannelLabel(followUpPerson.preferredChannel, followUpPerson.preferredChannelOther)}...
                      </Typography>
                    ) : null}
                    <TextInput
                      value={followUpMessage}
                      onChangeText={setFollowUpMessage}
                      multiline
                      placeholder="Write the follow-up message"
                      placeholderTextColor={colors.textTertiary}
                      style={styles.draftEditorInput}
                    />
                  </View>

                  <View style={styles.followUpPrimaryActions}>
                    <Button
                      label={primaryFollowUpAction.label}
                      onPress={() => runPrimaryFollowUpAction(followUpPerson, primaryFollowUpAction.action)}
                      fullWidth={false}
                      disabled={primaryFollowUpAction.disabled}
                    />
                    {primaryFollowUpAction.action !== "copy" ? (
                      <Button label="Copy message" onPress={() => void copyFollowUpMessage()} variant="ghost" fullWidth={false} />
                    ) : null}
                  </View>

                  <View style={styles.followUpOutcomeBlock}>
                    <View style={styles.followUpOutcomeHeader}>
                      <Typography variant="caption">After sending</Typography>
                      <Button label="Snooze" onPress={() => void snoozeFollowUp(followUpPerson)} variant="ghost" fullWidth={false} size="compact" />
                    </View>
                    <View style={styles.confirmActions}>
                      <Button label="Mark sent" onPress={() => void logFollowUpOutcome("Sent", followUpPerson)} fullWidth={false} size="compact" />
                      {(["Sent", "Replied", "Meeting booked", "Intro made", "Opportunity created", "No response", "Converted", "Not relevant"] as FollowUpOutcome[]).map((outcome) => (
                        outcome === "Sent" ? null : (
                        <Button
                          key={outcome}
                          label={outcome}
                          onPress={() => void logFollowUpOutcome(outcome, followUpPerson)}
                          variant={outcome === "Converted" || outcome === "Meeting booked" || outcome === "Opportunity created" ? "primary" : "ghost"}
                          fullWidth={false}
                          size="compact"
                        />
                        )
                      ))}
                    </View>
                  </View>
                      </>
                    );
                  })()}
                </ScrollView>
              </Card>
            </View>
          </View>
        ) : null}


{showPendingExternalReturn && pendingExternalAction ? (
  <View style={styles.confirmOverlay}>
    <Pressable style={styles.confirmBackdrop} onPress={keepWaitingOnExternalAction} />
    <View style={styles.confirmCardWrap}>
      <Card style={styles.confirmCard}>
        <Typography variant="h2">Did you finish in {pendingExternalAction.destinationLabel}?</Typography>
        <Typography variant="body" style={styles.confirmMeta}>
          We paused your flow here so you can confirm before carrying on inside Blackbook.
        </Typography>
        <View style={styles.confirmActions}>
          <Button
            label="Not yet"
            variant="ghost"
            fullWidth={false}
            size="compact"
            onPress={keepWaitingOnExternalAction}
          />
          <Button
            label="Yes, continue"
            fullWidth={false}
            size="compact"
            onPress={() => {
              void completeExternalActionFlow();
            }}
          />
        </View>
      </Card>
    </View>
  </View>
) : null}

        {calendarPickerPerson ? (
          <View style={styles.confirmOverlay}>
            <Pressable style={styles.confirmBackdrop} onPress={() => setCalendarPickerPerson(null)} />
            <View style={styles.confirmCardWrap}>
              <Card style={styles.confirmCard}>
                <Typography variant="h2">Add to calendar</Typography>
                <Typography variant="body" style={styles.confirmMeta}>
                  Pick where to save the follow-up for {calendarPickerPerson.name}.
                </Typography>
                <View style={styles.calendarOptionStack}>
                  {calendarDestinationOptions.map((option) => (
                    <Button
                      key={option.value}
                      label={option.label}
                      variant="ghost"
                      fullWidth={false}
                      size="compact"
                      onPress={() => {
                        void handleCalendarDestinationSelect(option.value);
                      }}
                    />
                  ))}
                </View>
                <Typography variant="caption" style={styles.confirmMeta}>
                  Google, Outlook, and Yahoo open prefilled calendar pages. Download `.ics` is the browser fallback.
                </Typography>
                <View style={styles.confirmActions}>
                  <Button
                    label="Cancel"
                    variant="ghost"
                    fullWidth={false}
                    size="compact"
                    onPress={() => setCalendarPickerPerson(null)}
                  />
                </View>
              </Card>
            </View>
          </View>
        ) : null}

        {draftPreviewPerson ? (
          <View style={styles.confirmOverlay}>
            <Pressable style={styles.confirmBackdrop} onPress={() => setDraftPreviewPerson(null)} />
            <View style={styles.confirmCardWrap}>
              <Card style={styles.confirmCard}>
                <Typography variant="h2">
                  {draftPreviewDestination === "linkedin" ? "LinkedIn draft" : "Open WhatsApp draft?"}
                </Typography>
                <Typography variant="body" style={styles.confirmMeta}>
                  {draftPreviewPerson.name} · {draftPreviewDestination === "linkedin" ? "LinkedIn" : draftPreviewPerson.phoneNumber}
                </Typography>
                <TextInput
                  value={draftPreviewText}
                  onChangeText={setDraftPreviewText}
                  multiline
                  placeholder={
                    draftPreviewDestination === "linkedin"
                      ? "Edit your LinkedIn message before copying it"
                      : "Edit your WhatsApp message before opening it"
                  }
                  placeholderTextColor={colors.textTertiary}
                  style={styles.draftEditorInput}
                />
                <View style={styles.confirmActions}>
                  <Button
                    label="Edit contact"
                    variant="ghost"
                    fullWidth={false}
                    size="compact"
                    onPress={() => {
                      const person = draftPreviewPerson;
                      setDraftPreviewPerson(null);
                      openEditPerson(person);
                    }}
                  />
                  <Button
                    label="Cancel"
                    variant="ghost"
                    fullWidth={false}
                    size="compact"
                    onPress={() => setDraftPreviewPerson(null)}
                  />
                  <Button
                    label={draftPreviewDestination === "linkedin" ? "Copy and open LinkedIn" : "Open WhatsApp"}
                    fullWidth={false}
                    size="compact"
                    onPress={() => {
                      const person = draftPreviewPerson;
                      const message = draftPreviewText;
                      const destination = draftPreviewDestination;
                      setDraftPreviewPerson(null);
                      setDraftPreviewText("");
                      if (destination === "linkedin") {
                        void copyLinkedInDraftAndOpen(person, message);
                        return;
                      }

                      void openDraftMessage(person, message);
                    }}
                  />
                </View>
              </Card>
            </View>
          </View>
        ) : null}

        {personActionMenu ? (
          <View style={styles.confirmOverlay}>
            <Pressable style={styles.confirmBackdrop} onPress={() => setPersonActionMenu(null)} />
            <View style={styles.confirmCardWrap}>
              <Card style={styles.confirmCard}>
                <Typography variant="h2">Edit contact</Typography>
                <Typography variant="body" style={styles.confirmMeta}>
                  {personActionMenu.name}
                </Typography>
                <View style={styles.confirmActions}>
                  <Button
                    label="Edit details"
                    variant="ghost"
                    fullWidth={false}
                    size="compact"
                    onPress={() => {
                      const person = personActionMenu;
                      setPersonActionMenu(null);
                      openEditPerson(person);
                    }}
                  />
                  <Button
                    label="Delete contact"
                    variant="ghost"
                    fullWidth={false}
                    size="compact"
                    loading={isDeleting}
                    onPress={() => {
                      const person = personActionMenu;
                      setPersonActionMenu(null);
                      handleDeletePerson(person);
                    }}
                  />
                  <Button
                    label="Cancel"
                    variant="ghost"
                    fullWidth={false}
                    size="compact"
                    onPress={() => setPersonActionMenu(null)}
                  />
                </View>
              </Card>
            </View>
          </View>
        ) : null}

        {isCompactLayout ? (
          <FloatingActionBar
            actions={[
              { label: "+", onPress: () => openCreatePerson(""), variant: "ghost" },
              { label: "Log update", onPress: openLogUpdate },
            ]}
          />
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const createStyles = (colors: ReturnType<typeof useTheme>["colors"]) => StyleSheet.create({
  pendingExternalCard: {
    gap: 12,
    borderColor: colors.primaryAction,
  },
  attentionCard: {
    gap: 12,
  },
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
  headerCopy: {
    flex: 1,
    gap: 8,
  },
  headerActions: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },
  headerRowCompact: {
    alignItems: "stretch",
  },
  headerActionButtonCompact: {
    width: "100%",
  },
  controlRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 10,
  },
  chipRow: {
    gap: 8,
    paddingTop: 10,
  },
  searchInput: {
    marginTop: 10,
    minHeight: 48,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    color: colors.textPrimary,
    paddingHorizontal: 16,
    fontSize: 15,
  },
  subSectionLabel: {
    marginTop: 14,
  },
  featureCard: {
    gap: 10,
    backgroundColor: colors.surfaceMuted,
  },
  selectedContactHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  selectedContactTitle: {
    flex: 1,
    gap: 4,
  },
  featureBody: {
    color: colors.textSecondary,
  },
  featureMetaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
  },
  metaDivider: {
    color: colors.textTertiary,
  },
  inlineMetaAction: {
    borderRadius: 999,
  },
  inlineMetaActionText: {
    color: colors.primaryAction,
    fontWeight: "600",
  },
  inlineMetaActionCaption: {
    color: colors.primaryAction,
  },
  confirmOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 120,
  },
  confirmBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0, 0, 0, 0.28)",
  },
  confirmCardWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  confirmCard: {
    width: "100%",
    maxWidth: 520,
    gap: 12,
  },
  followUpCard: {
    width: "100%",
    maxWidth: 620,
    maxHeight: "88%",
  },
  followUpContent: {
    gap: 14,
  },
  confirmMeta: {
    color: colors.textSecondary,
  },
  confirmPreview: {
    color: colors.textPrimary,
  },
  followUpInfoGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  followUpInfoBlock: {
    gap: 6,
    flex: 1,
    minWidth: 180,
  },
  followUpContextCard: {
    gap: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    backgroundColor: colors.surfaceMuted,
    padding: 14,
  },
  followUpDraftBlock: {
    gap: 8,
  },
  followUpPrimaryActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    alignItems: "center",
  },
  followUpOutcomeBlock: {
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 12,
  },
  followUpOutcomeHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  },
  updateModalContainer: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: layout.screenPaddingHorizontal,
    paddingTop: layout.stackGap,
  },
  updateModalScroll: {
    flex: 1,
  },
  updateModalContent: {
    paddingTop: 18,
    paddingBottom: 18,
    gap: 14,
  },
  updateCard: {
    gap: 12,
  },
  updateInput: {
    minHeight: 48,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    color: colors.textPrimary,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    lineHeight: 22,
  },
  updateTextArea: {
    minHeight: 86,
    textAlignVertical: "top",
  },
  updateFooter: {
    paddingTop: 12,
    paddingBottom: 18,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  draftEditorInput: {
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
  confirmActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  calendarOptionStack: {
    gap: 8,
  },
  pickerList: {
    maxHeight: 260,
  },
  pickerListContent: {
    gap: 8,
  },
  compactPersonRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  compactPersonMain: {
    flex: 1,
    gap: 4,
    minWidth: 0,
  },
  compactCompany: {
    color: colors.textSecondary,
  },
  compactActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  iconButton: {
    minWidth: 36,
    minHeight: 36,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  iconButtonPreferred: {
    borderColor: colors.primaryAction,
    backgroundColor: colors.primaryAction,
  },
  expandButton: {
    minWidth: 36,
    minHeight: 36,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.primaryAction,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  iconButtonText: {
    fontWeight: "700",
  },
  iconButtonTextPreferred: {
    color: colors.onPrimary,
  },
  expandedPersonContent: {
    marginTop: 14,
    gap: 10,
  },
  compactExpandedActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  primaryActionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  secondaryActionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  tagPillRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  tagPill: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  preferredChannelPill: {
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.primaryAction,
    backgroundColor: colors.successSoft,
  },
  preferredChannelPillCompact: {
    marginTop: 2,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  preferredChannelText: {
    color: colors.primaryAction,
  },
  featureNote: {
    color: colors.textSecondary,
  },
  timelineHeader: {
    marginTop: 6,
    gap: 4,
  },
  timelineCount: {
    color: colors.textSecondary,
  },
  timelineStack: {
    gap: 14,
  },
  emptyStateCard: {
    gap: 10,
  },
  emptyStateActions: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },
  selectedCard: {
    borderColor: colors.primaryAction,
  },
  rowTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 8,
  },
  cardActionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexShrink: 0,
  },
  personCopy: {
    flex: 1,
    gap: 6,
  },
  noteText: {
    marginTop: 10,
    marginBottom: 12,
    color: colors.textSecondary,
  },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 12,
  },
});
