import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
  RecordingPresets,
} from "expo-audio";

import * as ImagePicker from "expo-image-picker";

import { QRScannerModal } from "../components/QRScannerModal";
import { scanContactCardImage } from "../lib/cardScan";
import { parseScannedInput } from "../lib/scan";
import { transcribeContactAudio } from "../lib/voice";

import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Typography } from "../components/ui/Typography";
import {
  EVENT_CATEGORY_OPTIONS,
  EventCategory,
  FollowUpPreset,
  formatCategoryLabel,
  formatFollowUpDate,
  getSuggestedFollowUpPreset,
  PersonPriority,
  PreferredChannel,
  toDateOnlyString,
} from "../lib/crm";
import { layout, radius, useTheme, useThemedStyles } from "../theme/tokens";

export type QuickCaptureMethod = "manual" | "paste" | "voice" | "scan";

export type ParsedPersonDraft = {
  name: string;
  priority: PersonPriority;
  tags: string[];
  company: string;
  linkedinUrl: string;
  email: string;
  phoneNumber: string;
  preferredChannel: PreferredChannel | "";
  preferredChannelOther: string;
  event: string;
  eventCategory: EventCategory | "";
  whatMatters: string;
  nextStep: string;
  nextFollowUpAt: string;
  followUpPreset: FollowUpPreset | "";
  rawInput: string;
};

const emptyDraft: ParsedPersonDraft = {
  name: "",
  priority: "medium",
  tags: [],
  company: "",
  linkedinUrl: "",
  email: "",
  phoneNumber: "",
  preferredChannel: "",
  preferredChannelOther: "",
  event: "",
  eventCategory: "",
  whatMatters: "",
  nextStep: "",
  nextFollowUpAt: "",
  followUpPreset: "",
  rawInput: "",
};

const preferredChannelOptions: Array<{ label: string; value: PreferredChannel }> = [
  { label: "LinkedIn", value: "linkedin" },
  { label: "WhatsApp", value: "whatsapp" },
  { label: "Email", value: "email" },
  { label: "Phone", value: "phone" },
  { label: "Other", value: "other" },
];

const goalTagOptions = [
  "Business Opportunity",
  "Potential Client",
  "New Hire",
  "Partner",
  "Interesting",
  "Other",
] as const;

export type LockedEventDraft = {
  name: string;
  category: EventCategory;
};

type CaptureModalProps = {
  visible: boolean;
  onClose: () => void;
  onSave: (draft: ParsedPersonDraft, options?: { addAnother?: boolean }) => void | Promise<void>;
  title?: string;
  saveLabel?: string;
  isSaving?: boolean;
  initialDraft?: Partial<ParsedPersonDraft> | null;
  lockedEvent?: LockedEventDraft | null;
  initialMethod?: QuickCaptureMethod;
  showQuickCapture?: boolean;
  showSaveAndAddAnother?: boolean;
  draftStorageKey?: string;
  autosaveWithInitialDraft?: boolean;
};

type SavedCaptureDraft = {
  draft: ParsedPersonDraft;
  activeMethod: QuickCaptureMethod;
  pasteInput: string;
  isFollowUpManuallySet: boolean;
};

function cleanValue(value: string) {
  return value.replace(/^[\s:,-]+|[\s:,-]+$/g, "").trim();
}

function titleCaseFromSlug(value: string) {
  return value
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function buildDraftSentence(draft: ParsedPersonDraft) {
  const name = cleanValue(draft.name) || "someone";
  const company = cleanValue(draft.company) || "their company";
  const event = cleanValue(draft.event) || "somewhere memorable";
  const context = cleanValue(draft.whatMatters) || "what clicked";
  const nextStep = cleanValue(draft.nextStep) || "a thoughtful follow-up";
  const followUpDate = draft.nextFollowUpAt ? ` Follow up on ${formatFollowUpDate(draft.nextFollowUpAt)}.` : "";

  return `I met ${name} from ${company} at ${event}. What matters: ${context}. Next step: ${nextStep}.${followUpDate}`;
}

function getSuggestedPresetLabel(category: EventCategory | "" | null | undefined) {
  const preset = getSuggestedFollowUpPreset(category || null);
  return formatFollowUpOptionLabel(getPresetDateTime(preset));
}

function getPresetDateTime(preset: FollowUpPreset, baseDate = new Date()) {
  const date = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), 10, 0, 0, 0);

  if (preset === "tomorrow") {
    date.setDate(date.getDate() + 1);
    date.setHours(10, 0, 0, 0);
  } else if (preset === "in3days") {
    date.setDate(date.getDate() + 3);
    date.setHours(14, 30, 0, 0);
  } else if (preset === "nextWeek") {
    date.setDate(date.getDate() + 7);
    date.setHours(10, 0, 0, 0);
  }

  return date.toISOString();
}

function formatFollowUpOptionLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Pick date + time";
  }

  const dayLabel = date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const timeLabel = date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

  return `${dayLabel} • ${timeLabel}`;
}

function toTimeInputValue(date: Date) {
  return `${date.getHours()}`.padStart(2, "0") + `:${date.getMinutes()}`.padStart(2, "0");
}

function getCustomDateTimeParts(value?: string | null) {
  const parsed = value?.includes("T") ? new Date(value) : value ? new Date(`${value}T10:00:00`) : new Date(getPresetDateTime("nextWeek"));
  const safeDate = Number.isNaN(parsed.getTime()) ? new Date(getPresetDateTime("nextWeek")) : parsed;

  return {
    date: toDateOnlyString(safeDate),
    time: toTimeInputValue(safeDate),
  };
}

function combineCustomDateTime(dateValue: string, timeValue: string) {
  const dateMatch = dateValue.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const timeMatch = timeValue.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!dateMatch || !timeMatch) {
    return null;
  }

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);

  if (hour > 23 || minute > 59) {
    return null;
  }

  return new Date(year, month - 1, day, hour, minute, 0, 0).toISOString();
}

function parsePastedInput(rawValue: string, lockedEvent?: LockedEventDraft | null) {
  const raw = rawValue.trim();
  if (!raw) {
    return null;
  }

  const lines = raw
    .split(/\r?\n/)
    .map((line) => cleanValue(line))
    .filter(Boolean);

  const linkedinMatch = raw.match(/https?:\/\/(?:[\w-]+\.)?linkedin\.com\/[\S]+/i);
  const emailMatch = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  const phoneMatch = raw.match(/(?:\+?\d[\d\s().-]{7,}\d)/);
  const metFromMatch = raw.match(/met\s+([^,.\n]+?)\s+from\s+([^,.\n]+?)(?:\s+at\s+([^,.\n]+))?(?:[,.\n]|$)/i);
  const fromMatch = raw.match(/\bfrom\s+([^,.\n]+?)(?:\s+at\s+|[,.\n]|$)/i);
  const companyLabelMatch = raw.match(/(?:company|org|organisation|organization)\s*[:\-]\s*([^\n]+)/i);
  const eventMatch = raw.match(/(?:event|met at)\s*[:\-]?\s*([^\n]+)/i);

  let name = "";
  let company = "";
  let event = lockedEvent?.name || "";
  const linkedinUrl = linkedinMatch?.[0] || "";
  const rawLooksLikeLinkedInOnly = Boolean(linkedinUrl) && lines.length <= 2 && !metFromMatch && !companyLabelMatch && !eventMatch;

  const emailOnly =
    Boolean(emailMatch) &&
    raw.trim() === (emailMatch ? emailMatch[0] : "") &&
    !linkedinMatch &&
    !phoneMatch &&
    !metFromMatch &&
    !companyLabelMatch &&
    !eventMatch;

  if (metFromMatch) {
    name = cleanValue(metFromMatch[1]);
    company = cleanValue(metFromMatch[2]);
    event = cleanValue(metFromMatch[3] || event);
  }

  if (!company && companyLabelMatch) {
    company = cleanValue(companyLabelMatch[1]);
  }

  if (!company && fromMatch) {
    company = cleanValue(fromMatch[1]);
  }

  if (!event && eventMatch) {
    event = cleanValue(eventMatch[1]);
  }

  if (!name && linkedinUrl) {
    const slugMatch = linkedinUrl.match(/linkedin\.com\/in\/([^/?#]+)/i);
    if (slugMatch) {
      name = titleCaseFromSlug(slugMatch[1]);
    }
  }

  if (!name && emailMatch) {
    const localPart = emailMatch[0].split("@")[0] || "";
    const candidate = titleCaseFromSlug(localPart.replace(/\d+/g, ""));
    if (candidate.split(" ").length <= 3) {
      name = candidate;
    }
  }

  if (!name && lines.length) {
    const candidate = lines[0];
    if (!candidate.includes("@") && !candidate.includes("http") && candidate.split(" ").length <= 4) {
      name = candidate;
    }
  }

  if (!company && lines.length > 1 && !rawLooksLikeLinkedInOnly) {
    const candidate = lines[1];
    if (!candidate.includes("@") && !candidate.includes("http") && candidate.length <= 48) {
      company = candidate;
    }
  }

  const extractedContext = rawLooksLikeLinkedInOnly
    ? ""
    : lines.length > 2
      ? lines.slice(2).join(" ")
      : lines.join(" ");

  return {
    name,
    company,
    event,
    linkedinUrl,
    email: emailMatch?.[0] || "",
    phoneNumber: phoneMatch?.[0] || "",
    rawInput: raw,
    whatMatters: extractedContext,
  } satisfies Partial<ParsedPersonDraft>;
}

export function CaptureModal({
  visible,
  onClose,
  onSave,
  title = "Add Person",
  saveLabel = "Save Person",
  isSaving = false,
  initialDraft,
  lockedEvent,
  initialMethod = "manual",
  showQuickCapture = true,
  showSaveAndAddAnother = true,
  draftStorageKey,
  autosaveWithInitialDraft = false,
}: CaptureModalProps) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [draft, setDraft] = useState<ParsedPersonDraft>(emptyDraft);
  const [isFollowUpManuallySet, setFollowUpManuallySet] = useState(false);
  const [activeMethod, setActiveMethod] = useState<QuickCaptureMethod>(initialMethod);
  const [pasteInput, setPasteInput] = useState("");
  const [customFollowUpDate, setCustomFollowUpDate] = useState("");
  const [customFollowUpTime, setCustomFollowUpTime] = useState("10:00");
  const [hasHydratedSavedDraft, setHasHydratedSavedDraft] = useState(false);

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder);

  const [isTranscribing, setIsTranscribing] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [isCardScanProcessing, setIsCardScanProcessing] = useState(false);
  const [isScanChoiceVisible, setIsScanChoiceVisible] = useState(false);
  const [isQrScannerVisible, setIsQrScannerVisible] = useState(false);

  useEffect(() => {
    if (!visible) {
      return;
    }

    let isMounted = true;

    async function hydrateDraft() {
      setHasHydratedSavedDraft(false);

      const eventCategory: EventCategory | "" = lockedEvent?.category || initialDraft?.eventCategory || "";
      const followUpPreset = initialDraft?.followUpPreset || getSuggestedFollowUpPreset(eventCategory || null);
      const nextFollowUpAt = initialDraft?.nextFollowUpAt || getPresetDateTime(followUpPreset);
      const baseDraft: ParsedPersonDraft = {
        ...emptyDraft,
        ...initialDraft,
        event: lockedEvent?.name || initialDraft?.event || "",
        eventCategory,
        whatMatters: initialDraft?.whatMatters || "",
        nextStep: initialDraft?.nextStep || "",
        followUpPreset,
        nextFollowUpAt,
        rawInput: initialDraft?.rawInput || "",
      };

      let savedDraft: SavedCaptureDraft | null = null;
      if (draftStorageKey && (!initialDraft || autosaveWithInitialDraft)) {
        const rawSavedDraft = await AsyncStorage.getItem(draftStorageKey);
        if (rawSavedDraft) {
          try {
            savedDraft = JSON.parse(rawSavedDraft) as SavedCaptureDraft;
          } catch {
            await AsyncStorage.removeItem(draftStorageKey);
          }
        }
      }

      if (!isMounted) {
        return;
      }

      const nextDraft: ParsedPersonDraft = savedDraft?.draft
        ? {
            ...baseDraft,
            ...savedDraft.draft,
            event: lockedEvent?.name || savedDraft.draft.event || baseDraft.event,
            eventCategory: lockedEvent?.category || savedDraft.draft.eventCategory || baseDraft.eventCategory,
          }
        : baseDraft;

      setDraft(nextDraft);
      setFollowUpManuallySet(
        savedDraft?.isFollowUpManuallySet ?? Boolean(initialDraft?.nextFollowUpAt || initialDraft?.followUpPreset)
      );
      setActiveMethod(savedDraft?.activeMethod || initialMethod);
      setPasteInput(savedDraft?.pasteInput || initialDraft?.rawInput || "");
      const customParts = getCustomDateTimeParts(nextDraft.nextFollowUpAt);
      setCustomFollowUpDate(customParts.date);
      setCustomFollowUpTime(customParts.time);
      setScanError(null);
      setIsCardScanProcessing(false);
      setIsScanChoiceVisible(false);
      setIsQrScannerVisible(false);
      setHasHydratedSavedDraft(true);
    }

    void hydrateDraft();

    return () => {
      isMounted = false;
    };
  }, [initialDraft, initialMethod, lockedEvent, visible]);

  useEffect(() => {
    if (!visible || !draftStorageKey || !hasHydratedSavedDraft || (initialDraft && !autosaveWithInitialDraft)) {
      return;
    }

    async function persistDraft() {
      const payload: SavedCaptureDraft = {
        draft,
        activeMethod,
        pasteInput,
        isFollowUpManuallySet,
      };

      await AsyncStorage.setItem(draftStorageKey as string, JSON.stringify(payload));
    }

    void persistDraft();
  }, [activeMethod, autosaveWithInitialDraft, draft, draftStorageKey, hasHydratedSavedDraft, initialDraft, isFollowUpManuallySet, pasteInput, visible]);

  useEffect(() => {
    if (!visible || isFollowUpManuallySet) {
      return;
    }

    const preset = getSuggestedFollowUpPreset(draft.eventCategory || null);
    const nextFollowUpAt = getPresetDateTime(preset);
    const customParts = getCustomDateTimeParts(nextFollowUpAt);
    setCustomFollowUpDate(customParts.date);
    setCustomFollowUpTime(customParts.time);
    setDraft((current) => ({
      ...current,
      followUpPreset: preset,
      nextFollowUpAt,
    }));
  }, [draft.eventCategory, isFollowUpManuallySet, visible]);

  const sentencePreview = useMemo(() => buildDraftSentence(draft), [draft]);
  const canSave = cleanValue(draft.name).length > 0;
  const suggestedPresetLabel = getSuggestedPresetLabel(draft.eventCategory || lockedEvent?.category || null);
  const followUpPresetOptions = useMemo(
    () => (["tomorrow", "in3days", "nextWeek"] as const).map((preset) => {
      const value = getPresetDateTime(preset);
      return {
        preset,
        value,
        label: formatFollowUpOptionLabel(value),
      };
    }),
    []
  );

  function updateField(field: keyof ParsedPersonDraft, value: string) {
    setDraft((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function handleMethodPress(method: QuickCaptureMethod) {
    setActiveMethod(method);

    if (method === "scan") {
      setIsScanChoiceVisible(true);
    }
  }

  async function handleStartVoiceCapture() {
    try {
      setVoiceError(null);

      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        setVoiceError("Microphone permission was denied.");
        return;
      }

      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });

      await recorder.prepareToRecordAsync();
      recorder.record();
    } catch (error) {
      setVoiceError(
        error instanceof Error ? error.message : "Could not start recording."
      );
    }
  }

  async function handleStopVoiceCapture() {
    try {
      setVoiceError(null);
      setIsTranscribing(true);

      await recorder.stop();

      const uri = recorder.uri;
      if (!uri) {
        throw new Error("No recording file was created.");
      }

      const result = await transcribeContactAudio({
        uri,
        fileName: "contact-note.m4a",
        mimeType: "audio/m4a",
      });

      setDraft((current) => ({
        ...current,
        ...result.draft,
        whatMatters:
          result.draft.whatMatters?.trim() ||
          result.transcript?.trim() ||
          current.whatMatters,
      }));

      setActiveMethod("manual");
    } catch (error) {
      setVoiceError(
        error instanceof Error ? error.message : "Voice transcription failed."
      );
    } finally {
      setIsTranscribing(false);
    }
  }

  function handleChooseScanQr() {
    setIsScanChoiceVisible(false);
    setIsQrScannerVisible(true);
  }

  async function launchCardScan(source: "camera" | "library") {
    try {
      setScanError(null);
      setIsCardScanProcessing(true);

      if (source === "camera") {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          throw new Error("Camera permission was denied.");
        }
      } else {
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) {
          throw new Error("Media library permission was denied.");
        }
      }

      const result = source === "camera"
        ? await ImagePicker.launchCameraAsync({
            mediaTypes: ["images"] as any,
            allowsEditing: false,
            quality: 0.9,
          })
        : await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ["images"] as any,
            allowsEditing: false,
            quality: 0.9,
          });

      if (result.canceled || !result.assets?.length) {
        return;
      }

      const asset = result.assets[0];
      const scanResult = await scanContactCardImage({
        uri: asset.uri,
        mimeType: asset.mimeType || "image/jpeg",
        fileName: asset.fileName || "contact-card.jpg",
      });

      setDraft((current) => ({
        ...current,
        name: scanResult.draft.name || current.name,
        company: scanResult.draft.company || current.company,
        event: lockedEvent?.name || current.event,
        linkedinUrl: scanResult.draft.linkedinUrl || current.linkedinUrl,
        email: scanResult.draft.email || current.email,
        phoneNumber: scanResult.draft.phoneNumber || current.phoneNumber,
        whatMatters: scanResult.draft.whatMatters || current.whatMatters,
        rawInput: scanResult.rawText || current.rawInput,
      }));

      setActiveMethod("manual");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Business card scan failed.";
      setScanError(message);
      Alert.alert("Card scan error", message);
    } finally {
      setIsCardScanProcessing(false);
    }
  }

  function handleChooseScanOcr() {
    setIsScanChoiceVisible(false);

    if (Platform.OS === "web") {
      void launchCardScan("library");
      return;
    }

    Alert.alert("Scan business card / badge", "Choose how you want to import the image.", [
      {
        text: "Take photo",
        onPress: () => {
          void launchCardScan("camera");
        },
      },
      {
        text: "Choose photo",
        onPress: () => {
          void launchCardScan("library");
        },
      },
      {
        text: "Cancel",
        style: "cancel",
      },
    ]);
  }

  function handleScanResult(value: string) {
    const parsed = parseScannedInput(value, lockedEvent);

    setDraft((current) => ({
      ...current,
      name: parsed.name || current.name,
      company: parsed.company || current.company,
      event: lockedEvent?.name || parsed.event || current.event,
      linkedinUrl: parsed.linkedinUrl || current.linkedinUrl,
      email: parsed.email || current.email,
      phoneNumber: parsed.phoneNumber || current.phoneNumber,
      whatMatters: parsed.whatMatters ? parsed.whatMatters : current.whatMatters,
      rawInput: value,
    }));

    setActiveMethod("manual");
    setIsQrScannerVisible(false);
  }

  function handlePasteParse() {
    const parsed = parsePastedInput(pasteInput, lockedEvent);
    if (!parsed) {
      Alert.alert("Nothing to parse", "Paste a LinkedIn URL, email signature, or copied contact text first.");
      return;
    }

    setDraft((current) => ({
      ...current,
      name: parsed.name || current.name,
      company: parsed.company || current.company,
      event: lockedEvent?.name || parsed.event || current.event,
      linkedinUrl: parsed.linkedinUrl || current.linkedinUrl,
      email: parsed.email || current.email,
      phoneNumber: parsed.phoneNumber || current.phoneNumber,
      whatMatters: parsed.whatMatters ? parsed.whatMatters : current.whatMatters,
      rawInput: pasteInput,
    }));
    setActiveMethod("manual");
  }

  function handleEventCategoryChange(value: EventCategory) {
    setDraft((current) => ({
      ...current,
      eventCategory: value,
    }));
  }

  function handlePriorityChange(value: PersonPriority) {
    setDraft((current) => ({
      ...current,
      priority: value,
    }));
  }

  function handleFollowUpPresetSelect(preset: FollowUpPreset) {
    const nextFollowUpAt = getPresetDateTime(preset);
    const customParts = getCustomDateTimeParts(nextFollowUpAt);
    setFollowUpManuallySet(true);
    setCustomFollowUpDate(customParts.date);
    setCustomFollowUpTime(customParts.time);
    setDraft((current) => ({
      ...current,
      followUpPreset: preset,
      nextFollowUpAt,
    }));
  }

  function handleCustomFollowUp() {
    setFollowUpManuallySet(true);
    const fallback = getPresetDateTime("nextWeek");
    setDraft((current) => ({
      ...current,
      followUpPreset: "custom",
      nextFollowUpAt: current.nextFollowUpAt || fallback,
    }));

    const customParts = getCustomDateTimeParts(draft.nextFollowUpAt || fallback);
    setCustomFollowUpDate(customParts.date);
    setCustomFollowUpTime(customParts.time);
  }

  function updateCustomFollowUpDate(value: string) {
    setCustomFollowUpDate(value);
    const combinedValue = combineCustomDateTime(value, customFollowUpTime);
    setDraft((current) => ({
      ...current,
      followUpPreset: "custom",
      nextFollowUpAt: combinedValue || current.nextFollowUpAt,
    }));
  }

  function updateCustomFollowUpTime(value: string) {
    setCustomFollowUpTime(value);
    const combinedValue = combineCustomDateTime(customFollowUpDate, value);
    setDraft((current) => ({
      ...current,
      followUpPreset: "custom",
      nextFollowUpAt: combinedValue || current.nextFollowUpAt,
    }));
  }

  function toggleTag(tag: string) {
    setDraft((current) => {
      const hasTag = current.tags.includes(tag);
      return {
        ...current,
        tags: hasTag ? current.tags.filter((item) => item !== tag) : [...current.tags, tag],
      };
    });
  }

  function handlePreferredChannelSelect(channel: PreferredChannel) {
    setDraft((current) => ({
      ...current,
      preferredChannel: channel,
      preferredChannelOther: channel === "other" ? current.preferredChannelOther : "",
    }));
  }

  function buildCleanDraft() {
    return {
      ...draft,
      name: cleanValue(draft.name),
      priority: draft.priority,
      tags: draft.tags,
      company: cleanValue(draft.company),
      linkedinUrl: cleanValue(draft.linkedinUrl),
      email: cleanValue(draft.email),
      phoneNumber: cleanValue(draft.phoneNumber),
      preferredChannel: draft.preferredChannel,
      preferredChannelOther: cleanValue(draft.preferredChannelOther),
      event: cleanValue(draft.event) || "No event",
      eventCategory: draft.eventCategory,
      whatMatters: cleanValue(draft.whatMatters),
      nextStep: cleanValue(draft.nextStep),
      nextFollowUpAt: cleanValue(draft.nextFollowUpAt),
      followUpPreset: draft.followUpPreset,
      rawInput: cleanValue(draft.rawInput) || sentencePreview,
    };
  }

  function resetForAnotherCapture() {
    const eventCategory: EventCategory | "" = lockedEvent?.category || "";
    const followUpPreset = getSuggestedFollowUpPreset(eventCategory || null);
    const nextFollowUpAt = getPresetDateTime(followUpPreset);
    const customParts = getCustomDateTimeParts(nextFollowUpAt);
    setDraft({
      ...emptyDraft,
      event: lockedEvent?.name || "",
      eventCategory,
      followUpPreset,
      nextFollowUpAt,
    });
    setCustomFollowUpDate(customParts.date);
    setCustomFollowUpTime(customParts.time);
    setPasteInput("");
    setActiveMethod(initialMethod);
    setFollowUpManuallySet(false);
  }

  async function handleSave(addAnother = false) {
    if (isSaving || !canSave) {
      return;
    }

    if (draftStorageKey) {
      void AsyncStorage.removeItem(draftStorageKey);
    }

    await onSave(buildCleanDraft(), { addAnother });
    if (addAnother) {
      resetForAnotherCapture();
    }
  }

  function handleClose() {
    if (draftStorageKey) {
      void AsyncStorage.removeItem(draftStorageKey);
    }

    onClose();
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.shell}>
          <ScrollView
            style={styles.container}
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.headerRow}>
              <View style={styles.headerCopy}>
                <Typography variant="caption">Capture</Typography>
                <Typography variant="h1">{title}</Typography>
                <Typography variant="body" style={styles.helperText}>
                  Capture quickly now, tidy the details second.
                </Typography>
              </View>
              <Pressable onPress={handleClose} hitSlop={12} style={styles.closePill}>
                <Typography variant="caption" style={styles.closeText}>
                  Close
                </Typography>
              </Pressable>
            </View>

            {lockedEvent ? (
              <Card style={styles.lockedEventCard}>
                <Typography variant="caption">Current event active</Typography>
                <Typography variant="body" style={styles.previewText}>
                  This person will be tagged to {lockedEvent.name} · {formatCategoryLabel(lockedEvent.category)}.
                </Typography>
              </Card>
            ) : null}

            {showQuickCapture ? (
              <Card style={styles.sectionCard}>
                <View style={styles.sectionIntro}>
                  <Typography variant="caption">Quick capture</Typography>
                  <Typography variant="body" style={styles.helperText}>
                    Choose the fastest way to get this person into Pulse.
                  </Typography>
                </View>

                <View style={styles.chipRow}>
                  <Button
                    label="Paste"
                    onPress={() => handleMethodPress("paste")}
                    variant={activeMethod === "paste" ? "primary" : "ghost"}
                    fullWidth={false}
                    size="compact"
                  />
                  <Button
                    label={
                      isTranscribing
                        ? "Transcribing..."
                        : recorderState.isRecording
                        ? "Stop recording"
                        : "Voice"
                    }
                    onPress={
                      recorderState.isRecording
                        ? handleStopVoiceCapture
                        : async () => {
                            handleMethodPress("voice");
                            await handleStartVoiceCapture();
                          }
                    }
                    variant={
                      recorderState.isRecording || activeMethod === "voice"
                        ? "primary"
                        : "ghost"
                    }
                    fullWidth={false}
                    size="compact"
                    disabled={isTranscribing}
                  />
                  <Button
                    label="Scan"
                    onPress={() => handleMethodPress("scan")}
                    variant={activeMethod === "scan" ? "primary" : "ghost"}
                    fullWidth={false}
                    size="compact"
                  />
                  <Button
                    label="Manual"
                    onPress={() => handleMethodPress("manual")}
                    variant={activeMethod === "manual" ? "primary" : "ghost"}
                    fullWidth={false}
                    size="compact"
                  />
                </View>

                {activeMethod === "paste" ? (
                  <View style={styles.capturePanel}>
                    <Typography variant="caption">Paste LinkedIn or copied contact text</Typography>
                    <TextInput
                      placeholder="Paste a LinkedIn URL, email signature, or copied attendee text"
                      placeholderTextColor={colors.textTertiary}
                      style={[styles.fieldInput, styles.textAreaInput]}
                      value={pasteInput}
                      onChangeText={setPasteInput}
                      multiline
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                    <Typography variant="body" style={styles.helperText}>
                      We will pull through anything obvious now, then you can review and clean it up below.
                    </Typography>
                    <Button label="Parse pasted text" onPress={handlePasteParse} />
                  </View>
                ) : null}

                {activeMethod === "voice" ? (
                  <View style={styles.placeholderPanel}>
                    <Typography variant="h2">Voice capture placeholder</Typography>
                    <Typography variant="body" style={styles.helperText}>
                      Next up: tap record, transcribe the noisy event note, then review the extracted fields here.
                    </Typography>
                  </View>
                ) : null}

                {activeMethod === "scan" ? (
                  <View style={styles.placeholderPanel}>
                    <Typography variant="h2">Scan capture</Typography>
                    <Typography variant="body" style={styles.helperText}>
                      Scan a QR code now, or import a business card or badge photo for OCR. Everything still lands back in this same review form.
                    </Typography>
                    {scanError ? (
                      <Typography variant="caption" style={styles.errorText}>
                        {scanError}
                      </Typography>
                    ) : null}
                  </View>
                ) : null}
              </Card>
            ) : null}

            <Card style={styles.sectionCard}>
              <View style={styles.sectionIntro}>
                <Typography variant="caption">Who + why</Typography>
                <Typography variant="body" style={styles.helperText}>
                  Just enough context to remember why this person matters.
                </Typography>
              </View>

              <View style={styles.fieldBlock}>
                <Typography variant="caption">Name</Typography>
                <TextInput
                  autoFocus={activeMethod !== "paste"}
                  placeholder="Sarah"
                  placeholderTextColor={colors.textTertiary}
                  style={styles.fieldInput}
                  value={draft.name}
                  onChangeText={(value) => updateField("name", value)}
                />
              </View>

              <View style={styles.fieldBlock}>
                <Typography variant="caption">Company</Typography>
                <TextInput
                  placeholder="Stripe"
                  placeholderTextColor={colors.textTertiary}
                  style={styles.fieldInput}
                  value={draft.company}
                  onChangeText={(value) => updateField("company", value)}
                />
              </View>

              <View style={styles.fieldBlock}>
                <Typography variant="caption">Why they matter</Typography>
                <TextInput
                  placeholder="Investor in climate, hiring designers, runs the community..."
                  placeholderTextColor={colors.textTertiary}
                  style={[styles.fieldInput, styles.fastTextAreaInput]}
                  value={draft.whatMatters}
                  onChangeText={(value) => updateField("whatMatters", value)}
                  multiline
                />
              </View>

              <View style={styles.chipSection}>
                <Typography variant="caption">Goal</Typography>
                <View style={styles.chipRow}>
                  {goalTagOptions.map((tag) => (
                    <Button
                      key={tag}
                      label={tag}
                      onPress={() => toggleTag(tag)}
                      variant={draft.tags.includes(tag) ? "primary" : "ghost"}
                      fullWidth={false}
                      size="compact"
                    />
                  ))}
                </View>
                {draft.tags.length ? (
                  <Typography variant="caption" style={styles.tagSummary}>
                    Selected: {draft.tags.join(", ")}
                  </Typography>
                ) : null}
              </View>

              <View style={styles.chipSection}>
                <Typography variant="caption">Preferred contact method</Typography>
                <View style={styles.chipRow}>
                  {preferredChannelOptions.map((option) => (
                    <Button
                      key={option.value}
                      label={option.label}
                      onPress={() => handlePreferredChannelSelect(option.value)}
                      variant={draft.preferredChannel === option.value ? "primary" : "ghost"}
                      fullWidth={false}
                      size="compact"
                    />
                  ))}
                </View>
                {draft.preferredChannel === "other" ? (
                  <TextInput
                    placeholder="Instagram, Discord, Telegram..."
                    placeholderTextColor={colors.textTertiary}
                    style={[styles.fieldInput, styles.inlineInputTop]}
                    value={draft.preferredChannelOther}
                    onChangeText={(value) => updateField("preferredChannelOther", value)}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                ) : null}
              </View>
            </Card>

            <Card style={styles.sectionCard}>
              <View style={styles.sectionIntro}>
                <Typography variant="caption">Next step</Typography>
                <Typography variant="body" style={styles.helperText}>
                  The small action or messy thought you do not want to lose.
                </Typography>
              </View>

              <View style={styles.fieldBlock}>
                <Typography variant="caption">Next step / brain dump</Typography>
                <TextInput
                  placeholder="Send deck, make intro, ask about the role..."
                  placeholderTextColor={colors.textTertiary}
                  style={[styles.fieldInput, styles.fastTextAreaInput]}
                  value={draft.nextStep}
                  onChangeText={(value) => updateField("nextStep", value)}
                  multiline
                />
              </View>

              <View style={styles.twoColumnRow}>
                <View style={styles.metaInputBlock}>
                  <Typography variant="caption">LinkedIn</Typography>
                  <TextInput
                    placeholder="linkedin.com/in/sarah"
                    placeholderTextColor={colors.textTertiary}
                    style={styles.fieldInput}
                    value={draft.linkedinUrl}
                    onChangeText={(value) => updateField("linkedinUrl", value)}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </View>
                <View style={styles.metaInputBlock}>
                  <Typography variant="caption">Email</Typography>
                  <TextInput
                    placeholder="sarah@company.com"
                    placeholderTextColor={colors.textTertiary}
                    style={styles.fieldInput}
                    value={draft.email}
                    onChangeText={(value) => updateField("email", value)}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="email-address"
                  />
                </View>
                <View style={styles.metaInputBlock}>
                  <Typography variant="caption">WhatsApp</Typography>
                  <TextInput
                    placeholder="+44 7700 900123"
                    placeholderTextColor={colors.textTertiary}
                    style={styles.fieldInput}
                    value={draft.phoneNumber}
                    onChangeText={(value) => updateField("phoneNumber", value)}
                    keyboardType="phone-pad"
                  />
                </View>
              </View>
            </Card>

            <Card style={styles.sectionCard}>
              <View style={styles.sectionIntro}>
                <Typography variant="caption">Follow-up</Typography>
                <Typography variant="body" style={styles.helperText}>
                  Pick a sensible reminder. Add it to calendar from the person card after saving.
                </Typography>
              </View>

              <View style={styles.twoColumnRow}>
                <View style={styles.metaInputBlock}>
                  <Typography variant="caption">Event</Typography>
                  <TextInput
                    placeholder="React Native EU"
                    placeholderTextColor={colors.textTertiary}
                    style={styles.fieldInput}
                    value={draft.event}
                    onChangeText={(value) => updateField("event", value)}
                    editable={!lockedEvent}
                  />
                </View>
              </View>

              <View style={styles.chipSection}>
                <Typography variant="caption">Event type</Typography>
                <View style={styles.chipRow}>
                  {EVENT_CATEGORY_OPTIONS.filter(
                    (option): option is { label: string; value: EventCategory } => option.value !== "all"
                  ).map((option) => (
                    <Button
                      key={option.value}
                      label={option.label}
                      onPress={() => handleEventCategoryChange(option.value)}
                      variant={draft.eventCategory === option.value ? "primary" : "ghost"}
                      fullWidth={false}
                      size="compact"
                      disabled={Boolean(lockedEvent)}
                    />
                  ))}
                </View>
              </View>

              <View style={styles.chipSection}>
                <Typography variant="caption">Suggested follow-up</Typography>
                <Typography variant="body" style={styles.helperText}>
                  Suggested from event type: {suggestedPresetLabel}
                </Typography>
                <View style={styles.chipRow}>
                  {followUpPresetOptions.map((option) => (
                    <Button
                      key={option.preset}
                      label={option.label}
                      onPress={() => handleFollowUpPresetSelect(option.preset)}
                      variant={draft.followUpPreset === option.preset ? "primary" : "ghost"}
                      fullWidth={false}
                      size="compact"
                    />
                  ))}
                  <Button
                    label="Pick date + time"
                    onPress={handleCustomFollowUp}
                    variant={draft.followUpPreset === "custom" ? "primary" : "ghost"}
                    fullWidth={false}
                    size="compact"
                  />
                </View>
                {draft.nextFollowUpAt ? (
                  <Typography variant="caption" style={styles.tagSummary}>
                    Follow-up date: {formatFollowUpDate(draft.nextFollowUpAt)}
                  </Typography>
                ) : null}
                {draft.followUpPreset === "custom" ? (
                  <View style={styles.twoColumnRow}>
                    <View style={styles.metaInputBlock}>
                      <Typography variant="caption">Custom date</Typography>
                      <TextInput
                        placeholder="YYYY-MM-DD"
                        placeholderTextColor={colors.textTertiary}
                        style={styles.fieldInput}
                        value={customFollowUpDate}
                        onChangeText={updateCustomFollowUpDate}
                        autoCapitalize="none"
                        autoCorrect={false}
                      />
                    </View>
                    <View style={styles.metaInputBlock}>
                      <Typography variant="caption">Custom time</Typography>
                      <TextInput
                        placeholder="14:30"
                        placeholderTextColor={colors.textTertiary}
                        style={styles.fieldInput}
                        value={customFollowUpTime}
                        onChangeText={updateCustomFollowUpTime}
                        autoCapitalize="none"
                        autoCorrect={false}
                      />
                    </View>
                  </View>
                ) : null}
              </View>
            </Card>

            <Card style={styles.sectionCard}>
              <Typography variant="caption">Preview message</Typography>
              <Typography variant="body" style={styles.previewText}>
                {sentencePreview}
              </Typography>
            </Card>
          </ScrollView>

          <View style={styles.footerWrap}>
            <View style={styles.footerButtons}>
              <Button label={saveLabel} onPress={() => void handleSave(false)} loading={isSaving} disabled={!canSave} />
              {showSaveAndAddAnother ? (
                <Button label="Save & Add Another" onPress={() => void handleSave(true)} loading={isSaving} disabled={!canSave} variant="ghost" />
              ) : null}
              <Button label="Cancel" onPress={handleClose} variant="ghost" />
            </View>
          </View>
        </View>

        <Modal
          visible={isScanChoiceVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setIsScanChoiceVisible(false)}
        >
          <View style={styles.sheetBackdrop}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setIsScanChoiceVisible(false)} />
            <View style={styles.sheetCard}>
              <Typography variant="h2">Scan</Typography>
              <Typography variant="body" style={styles.helperText}>
                Choose what you want to capture.
              </Typography>
              <View style={styles.sheetButtonStack}>
                <Button label="Scan QR" onPress={handleChooseScanQr} />
                <Button
                  label={isCardScanProcessing ? "Scanning card..." : "Scan business card / badge"}
                  onPress={handleChooseScanOcr}
                  variant="ghost"
                  loading={isCardScanProcessing}
                />
                <Button label="Cancel" onPress={() => setIsScanChoiceVisible(false)} variant="ghost" />
              </View>
            </View>
          </View>
        </Modal>

        <QRScannerModal
          visible={isQrScannerVisible}
          onClose={() => setIsQrScannerVisible(false)}
          onScanned={handleScanResult}
        />
      </SafeAreaView>
    </Modal>
  );
}

const createStyles = (colors: ReturnType<typeof useTheme>["colors"]) => StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  shell: {
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
    paddingBottom: layout.stickyBottomInset + 48,
    gap: layout.sectionGap,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  headerCopy: {
    flex: 1,
    gap: 8,
  },
  closePill: {
    alignSelf: "flex-start",
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  closeText: {
    color: colors.textSecondary,
  },
  helperText: {
    color: colors.textSecondary,
  },
  errorText: {
    color: colors.destructive,
  },
  sectionCard: {
    gap: 16,
  },
  sectionIntro: {
    gap: 6,
  },
  lockedEventCard: {
    backgroundColor: colors.surfaceMuted,
    gap: 6,
  },
  capturePanel: {
    gap: 12,
  },
  placeholderPanel: {
    gap: 8,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    padding: 14,
  },
  fieldBlock: {
    gap: 8,
  },
  twoColumnRow: {
    flexDirection: "row",
    gap: 12,
    flexWrap: "wrap",
  },
  metaInputBlock: {
    flex: 1,
    minWidth: 180,
    gap: 8,
  },
  inlineInputTop: {
    marginTop: 10,
  },
  fieldInput: {
    minHeight: layout.minTouchTarget,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    color: colors.textPrimary,
    fontSize: 16,
    lineHeight: 22,
  },
  textAreaInput: {
    minHeight: 96,
    textAlignVertical: "top",
  },
  fastTextAreaInput: {
    minHeight: 72,
    textAlignVertical: "top",
  },
  chipSection: {
    gap: 10,
  },
  calendarSlotStack: {
    gap: 8,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  tagSummary: {
    color: colors.textSecondary,
  },
  previewText: {
    color: colors.textSecondary,
  },
  footerWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: layout.screenPaddingHorizontal,
    paddingTop: 12,
    paddingBottom: 18,
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  footerButtons: {
    gap: 10,
  },
  sheetBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.4)",
    justifyContent: "flex-end",
    padding: layout.screenPaddingHorizontal,
    paddingBottom: layout.stickyBottomInset + 24,
  },
  sheetCard: {
    backgroundColor: colors.background,
    borderRadius: 24,
    padding: 24,
    gap: 8,
  },
  sheetButtonStack: {
    gap: 10,
    marginTop: 12,
  },
});
