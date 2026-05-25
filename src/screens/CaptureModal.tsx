import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  AppState,
  Linking,
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
import * as Clipboard from "expo-clipboard";

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
import { getDefaultCalendarDestination, openFollowUpInCalendar } from "../lib/calendar";
import { generateFollowUpDraft } from "../lib/followUpDraft";
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
type CaptureStage = "capture" | "review" | "contact";

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

type ExtractedFieldKey =
  | "name"
  | "company"
  | "whatMatters"
  | "nextStep"
  | "linkedinUrl"
  | "email"
  | "phoneNumber"
  | "preferredChannel"
  | "tags"
  | "nextFollowUpAt";

type ExtractionSource = "voice" | "scan" | "quick note";

type ExtractionNotice = {
  source: ExtractionSource;
  fields: ExtractedFieldKey[];
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
  "Meeting Booked",
  "Intro",
  "New Hire",
  "Partner",
  "Sponsor",
  "Interesting",
  "Other",
] as const;
const goalTagSet = new Set<string>(goalTagOptions);

const extractedFieldLabels: Record<ExtractedFieldKey, string> = {
  name: "Name",
  company: "Company",
  whatMatters: "Why",
  nextStep: "Next move",
  linkedinUrl: "LinkedIn",
  email: "Email",
  phoneNumber: "Phone",
  preferredChannel: "Best channel",
  tags: "Goal",
  nextFollowUpAt: "Reminder",
};

export type LockedEventDraft = {
  name: string;
  category: EventCategory;
};

type CaptureModalProps = {
  visible: boolean;
  onClose: () => void;
  onSave: (draft: ParsedPersonDraft, options?: { addAnother?: boolean; keepOpen?: boolean }) => void | Promise<void>;
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
  showPostSaveActions?: boolean;
};

type SavedCaptureDraft = {
  draft: ParsedPersonDraft;
  activeMethod: QuickCaptureMethod;
  pasteInput: string;
  isFollowUpManuallySet: boolean;
  savedDraftForNextAction?: ParsedPersonDraft | null;
  savedDraftMessage?: string;
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

function buildPostCaptureMessage(draft: ParsedPersonDraft) {
  const name = cleanValue(draft.name) || "there";
  const context = cleanValue(draft.whatMatters) || cleanValue(draft.nextStep) || "our conversation";
  const event = cleanValue(draft.event);
  const eventLine = event && event !== "No event" ? ` at ${event}` : "";

  return `Hey ${name}, great meeting you${eventLine}. Picking up from ${context}. Would be good to continue the conversation.`;
}

function collectExtractedFields(input: Partial<ParsedPersonDraft>) {
  const fields: ExtractedFieldKey[] = [];

  ([
    "name",
    "company",
    "whatMatters",
    "nextStep",
    "linkedinUrl",
    "email",
    "phoneNumber",
    "preferredChannel",
    "nextFollowUpAt",
  ] as const).forEach((field) => {
    if (typeof input[field] === "string" && input[field]?.trim()) {
      fields.push(field);
    }
  });

  if (input.tags?.length) {
    fields.push("tags");
  }

  return fields;
}

function normalizePhoneForUrl(value: string) {
  const digits = value.replace(/[^\d+]/g, "").replace(/^00/, "+");
  return digits.startsWith("+") ? digits.slice(1) : digits;
}

function getSuggestedPresetLabel(category: EventCategory | "" | null | undefined) {
  const preset = getSuggestedFollowUpPreset(category || null);
  return getPresetLabel(preset);
}

function getPresetDateTime(preset: FollowUpPreset, baseDate = new Date()) {
  const date = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), 10, 0, 0, 0);

  if (preset === "tomorrow") {
    date.setDate(date.getDate() + 1);
  } else if (preset === "in3days") {
    date.setDate(date.getDate() + 3);
  } else if (preset === "nextWeek") {
    date.setDate(date.getDate() + 7);
  }

  return toDateOnlyString(date);
}

function getPresetLabel(preset: FollowUpPreset) {
  if (preset === "tomorrow") {
    return "Tomorrow";
  }

  if (preset === "in3days") {
    return "In 3 days";
  }

  return "Next week";
}

function getCustomDateTimeParts(value?: string | null) {
  return {
    date: value?.trim() || getPresetDateTime("nextWeek"),
  };
}

function combineCustomDateTime(dateValue: string) {
  const dateMatch = dateValue.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!dateMatch) {
    return null;
  }

  return dateValue.trim();
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
  showPostSaveActions = true,
}: CaptureModalProps) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [draft, setDraft] = useState<ParsedPersonDraft>(emptyDraft);
  const [captureStage, setCaptureStage] = useState<CaptureStage>("capture");
  const [isFollowUpManuallySet, setFollowUpManuallySet] = useState(false);
  const [activeMethod, setActiveMethod] = useState<QuickCaptureMethod>(initialMethod);
  const [pasteInput, setPasteInput] = useState("");
  const [customFollowUpDate, setCustomFollowUpDate] = useState("");
  const [hasHydratedSavedDraft, setHasHydratedSavedDraft] = useState(false);
  const [savedDraftForNextAction, setSavedDraftForNextAction] = useState<ParsedPersonDraft | null>(null);
  const [savedDraftMessage, setSavedDraftMessage] = useState("");
  const [isGeneratingSavedDraftMessage, setGeneratingSavedDraftMessage] = useState(false);
  const [extractionNotice, setExtractionNotice] = useState<ExtractionNotice | null>(null);
  const [captureReadyMessage, setCaptureReadyMessage] = useState("");
  const [isVoicePaused, setVoicePaused] = useState(false);

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder);
  const isVoiceCaptureActive = recorderState.isRecording || isVoicePaused;

  const [isTranscribing, setIsTranscribing] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [isCardScanProcessing, setIsCardScanProcessing] = useState(false);
  const [isScanChoiceVisible, setIsScanChoiceVisible] = useState(false);
  const [isQrScannerVisible, setIsQrScannerVisible] = useState(false);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active" && recorderState.isRecording && !isVoicePaused) {
        try {
          recorder.pause();
          setVoicePaused(true);
        } catch {
          // Native interruption handling can vary; the visible pause state still keeps the user oriented.
        }
      }
    });

    return () => subscription.remove();
  }, [isVoicePaused, recorder, recorderState.isRecording]);

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
      setScanError(null);
      setIsCardScanProcessing(false);
      setIsScanChoiceVisible(false);
      setIsQrScannerVisible(false);
      setSavedDraftForNextAction(savedDraft?.savedDraftForNextAction || null);
      setSavedDraftMessage(savedDraft?.savedDraftMessage || "");
      setExtractionNotice(null);
      setCaptureReadyMessage("");
      setCaptureStage(showQuickCapture ? "capture" : "review");
      setHasHydratedSavedDraft(true);
    }

    void hydrateDraft();

    return () => {
      isMounted = false;
    };
  }, [initialDraft, initialMethod, lockedEvent, showQuickCapture, visible]);

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
        savedDraftForNextAction,
        savedDraftMessage,
      };

      await AsyncStorage.setItem(draftStorageKey as string, JSON.stringify(payload));
    }

    void persistDraft();
  }, [activeMethod, autosaveWithInitialDraft, draft, draftStorageKey, hasHydratedSavedDraft, initialDraft, isFollowUpManuallySet, pasteInput, savedDraftForNextAction, savedDraftMessage, visible]);

  useEffect(() => {
    if (!visible || isFollowUpManuallySet) {
      return;
    }

    const preset = getSuggestedFollowUpPreset(draft.eventCategory || null);
    const nextFollowUpAt = getPresetDateTime(preset);
    const customParts = getCustomDateTimeParts(nextFollowUpAt);
    setCustomFollowUpDate(customParts.date);
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
    () => (["tomorrow", "in3days", "nextWeek"] as const).map((preset) => ({
      preset,
      label: getPresetLabel(preset),
    })),
    []
  );
  const extractedFieldSet = useMemo(
    () => new Set(extractionNotice?.fields || []),
    [extractionNotice]
  );

  function getFieldInputStyle(field: ExtractedFieldKey) {
    return [styles.fieldInput, extractedFieldSet.has(field) ? styles.extractedFieldInput : null];
  }

  function renderExtractionNotice() {
    if (!extractionNotice || extractionNotice.fields.length === 0) {
      return null;
    }

    return (
      <Card style={styles.extractionCard}>
        <Typography variant="caption">Draft filled from {extractionNotice.source}</Typography>
        <Typography variant="body" style={styles.helperText}>
          Review the highlighted fields. Correct anything that feels off.
        </Typography>
        <View style={styles.chipRow}>
          {extractionNotice.fields.map((field) => (
            <View key={field} style={styles.extractionPill}>
              <Typography variant="caption" style={styles.extractionPillText}>{extractedFieldLabels[field]}</Typography>
            </View>
          ))}
        </View>
      </Card>
    );
  }

  function updateField(field: keyof ParsedPersonDraft, value: string) {
    setExtractionNotice((current) =>
      current
        ? {
            ...current,
            fields: current.fields.filter((item) => item !== field),
          }
        : null
    );
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
      setVoicePaused(false);
    } catch (error) {
      setVoiceError(
        error instanceof Error ? error.message : "Could not start recording."
      );
    }
  }

  function handleToggleVoicePause() {
    try {
      if (!isVoiceCaptureActive) {
        return;
      }

      if (isVoicePaused) {
        recorder.record();
        setVoicePaused(false);
        return;
      }

      recorder.pause();
      setVoicePaused(true);
    } catch (error) {
      setVoiceError(error instanceof Error ? error.message : "Could not pause or resume recording.");
    }
  }

  async function handleSubmitPausedVoiceCapture() {
    await handleStopVoiceCapture();
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

      const extractedFields = collectExtractedFields({
        ...result.draft,
        whatMatters: result.draft.whatMatters?.trim() || result.transcript?.trim(),
      });

      setDraft((current) => ({
        ...current,
        ...result.draft,
        whatMatters:
          result.draft.whatMatters?.trim() ||
          result.transcript?.trim() ||
          current.whatMatters,
      }));

      setExtractionNotice({
        source: "voice",
        fields: extractedFields.length ? extractedFields : ["whatMatters"],
      });

      setActiveMethod("manual");
      setCaptureStage("review");
    } catch (error) {
      setVoiceError(
        error instanceof Error ? error.message : "Voice transcription failed."
      );
    } finally {
      setIsTranscribing(false);
      setVoicePaused(false);
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

      const extractedFields = collectExtractedFields(scanResult.draft);

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

      setExtractionNotice({
        source: "scan",
        fields: extractedFields.length ? extractedFields : ["name", "company"],
      });

      setActiveMethod("manual");
      setCaptureStage("review");
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
    const extractedFields = collectExtractedFields(parsed);

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

    setExtractionNotice({
      source: "scan",
      fields: extractedFields.length ? extractedFields : ["linkedinUrl"],
    });
    setActiveMethod("manual");
    setCaptureStage("review");
    setIsQrScannerVisible(false);
  }

  function handlePasteParse() {
    const parsed = parsePastedInput(pasteInput, lockedEvent);
    if (!parsed) {
      Alert.alert("Nothing to parse", "Paste a LinkedIn URL, email signature, or copied contact text first.");
      return;
    }

    const extractedFields = collectExtractedFields(parsed);

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
    setExtractionNotice({
      source: "quick note",
      fields: extractedFields.length ? extractedFields : ["whatMatters"],
    });
    setActiveMethod("manual");
    setCaptureStage("review");
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
  }

  function updateCustomFollowUpDate(value: string) {
    setCustomFollowUpDate(value);
    const combinedValue = combineCustomDateTime(value);
    setDraft((current) => ({
      ...current,
      followUpPreset: "custom",
      nextFollowUpAt: combinedValue || current.nextFollowUpAt,
    }));
  }

  function toggleTag(tag: string) {
    setDraft((current) => {
      const hasTag = current.tags.includes(tag);
      const isGoalTag = goalTagSet.has(tag);
      const baseTags = isGoalTag ? current.tags.filter((item) => !goalTagSet.has(item)) : current.tags;

      return {
        ...current,
        tags: hasTag ? current.tags.filter((item) => item !== tag) : [...baseTags, tag],
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
    setPasteInput("");
    setActiveMethod(initialMethod);
    setFollowUpManuallySet(false);
    setSavedDraftForNextAction(null);
    setSavedDraftMessage("");
    setGeneratingSavedDraftMessage(false);
    setExtractionNotice(null);
    setVoicePaused(false);
    setCaptureStage("capture");
  }

  function returnToCaptureReady(savedName?: string) {
    resetForAnotherCapture();
    if (savedName?.trim()) {
      setCaptureReadyMessage(`${savedName.trim()} saved.`);
    }
  }

  async function handleSave(addAnother = false) {
    if (isSaving || !canSave) {
      return;
    }

    const cleanDraft = buildCleanDraft();
    const shouldShowNextActions = !addAnother && showPostSaveActions && showSaveAndAddAnother;

    if (draftStorageKey && !shouldShowNextActions) {
      void AsyncStorage.removeItem(draftStorageKey);
    }

    await onSave(cleanDraft, { addAnother, keepOpen: shouldShowNextActions });

    if (shouldShowNextActions) {
      setSavedDraftForNextAction(cleanDraft);
      const fallbackMessage = buildPostCaptureMessage(cleanDraft);
      setSavedDraftMessage(fallbackMessage);
      void improveSavedDraftMessage(cleanDraft, fallbackMessage);
      return;
    }

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

  async function handleCopySavedDraftMessage() {
    if (!savedDraftForNextAction) {
      return;
    }

    try {
      await Clipboard.setStringAsync(savedDraftMessage || buildPostCaptureMessage(savedDraftForNextAction));
      Alert.alert("Draft copied", "The message is ready to paste into their preferred channel.");
    } catch {
      Alert.alert("Copy failed", "Could not copy the draft message.");
    }
  }

  async function improveSavedDraftMessage(targetDraft: ParsedPersonDraft, fallbackMessage: string) {
    try {
      setGeneratingSavedDraftMessage(true);
      const message = await generateFollowUpDraft({
        name: targetDraft.name,
        company: targetDraft.company,
        eventName: targetDraft.event,
        whatMatters: targetDraft.whatMatters,
        nextStep: targetDraft.nextStep,
        relationshipGoal: targetDraft.tags[0] || null,
        preferredChannel: targetDraft.preferredChannel,
        preferredChannelOther: targetDraft.preferredChannelOther,
        lastInteractionNote: targetDraft.rawInput,
      });
      setSavedDraftMessage(message);
    } catch {
      setSavedDraftMessage(fallbackMessage);
    } finally {
      setGeneratingSavedDraftMessage(false);
    }
  }

  function getPostSavePrimaryAction(draft: ParsedPersonDraft) {
    if (draft.preferredChannel === "whatsapp" && draft.phoneNumber.trim()) {
      return "Open WhatsApp";
    }

    if (draft.preferredChannel === "email" && draft.email.trim()) {
      return "Open Email";
    }

    if (draft.preferredChannel === "linkedin" && draft.linkedinUrl.trim()) {
      return "Copy + Open LinkedIn";
    }

    if (draft.preferredChannel === "phone" && draft.phoneNumber.trim()) {
      return "Open Text";
    }

    return "Copy message";
  }

  async function handlePostSavePrimaryAction() {
    if (!savedDraftForNextAction) {
      return;
    }

    const message = savedDraftMessage || buildPostCaptureMessage(savedDraftForNextAction);
    const preferredChannel = savedDraftForNextAction.preferredChannel;

    try {
      if (preferredChannel === "whatsapp" && savedDraftForNextAction.phoneNumber.trim()) {
        const phone = normalizePhoneForUrl(savedDraftForNextAction.phoneNumber);
        await Linking.openURL(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`);
        returnToCaptureReady(savedDraftForNextAction.name);
        return;
      }

      if (preferredChannel === "email" && savedDraftForNextAction.email.trim()) {
        const subject = savedDraftForNextAction.event && savedDraftForNextAction.event !== "No event"
          ? `Following up from ${savedDraftForNextAction.event}`
          : `Following up with ${savedDraftForNextAction.name}`;
        await Linking.openURL(
          `mailto:${encodeURIComponent(savedDraftForNextAction.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`
        );
        returnToCaptureReady(savedDraftForNextAction.name);
        return;
      }

      if (preferredChannel === "linkedin" && savedDraftForNextAction.linkedinUrl.trim()) {
        await Clipboard.setStringAsync(message);
        await Linking.openURL(savedDraftForNextAction.linkedinUrl);
        Alert.alert("Message copied", "Paste the draft into LinkedIn when the profile opens.");
        returnToCaptureReady(savedDraftForNextAction.name);
        return;
      }

      if (preferredChannel === "phone" && savedDraftForNextAction.phoneNumber.trim()) {
        await Clipboard.setStringAsync(message);
        await Linking.openURL(`sms:${savedDraftForNextAction.phoneNumber}?body=${encodeURIComponent(message)}`);
        returnToCaptureReady(savedDraftForNextAction.name);
        return;
      }

      await handleCopySavedDraftMessage();
      returnToCaptureReady(savedDraftForNextAction.name);
    } catch {
      await Clipboard.setStringAsync(message);
      Alert.alert("Message copied", "Could not open the app, so the draft is copied instead.");
      returnToCaptureReady(savedDraftForNextAction.name);
    }
  }

  async function handlePostSaveCalendarAction() {
    if (!savedDraftForNextAction?.nextFollowUpAt) {
      Alert.alert("No reminder yet", "Open this person later to add a reminder.");
      return;
    }

    try {
      await openFollowUpInCalendar(
        {
          name: savedDraftForNextAction.name,
          company: savedDraftForNextAction.company,
          nextFollowUpAt: savedDraftForNextAction.nextFollowUpAt,
          whatMatters: savedDraftForNextAction.whatMatters,
          nextStep: savedDraftForNextAction.nextStep,
          linkedinUrl: savedDraftForNextAction.linkedinUrl,
        },
        await getDefaultCalendarDestination()
      );
      returnToCaptureReady(savedDraftForNextAction.name);
    } catch (error) {
      Alert.alert("Calendar failed", error instanceof Error ? error.message : "Could not add this reminder.");
    }
  }

  function handleSavedDraftAddAnother() {
    returnToCaptureReady(savedDraftForNextAction?.name);
  }

  function renderPostSaveActions() {
    if (!savedDraftForNextAction) {
      return null;
    }

    return (
      <Card style={styles.sectionCard}>
        <View style={styles.sectionIntro}>
          <Typography variant="caption">What next?</Typography>
          <Typography variant="h1">{savedDraftForNextAction.name} is saved.</Typography>
          <Typography variant="body" style={styles.helperText}>
            Close the loop now, add one more person, or leave it for wrap-up.
          </Typography>
        </View>

        <Card style={styles.nextActionPreviewCard}>
          <Typography variant="caption">Draft message</Typography>
          {isGeneratingSavedDraftMessage ? (
            <Typography variant="caption" style={styles.tagSummary}>Improving draft for {savedDraftForNextAction.preferredChannel || "this channel"}...</Typography>
          ) : null}
          <TextInput
            placeholder="Edit the message before sending..."
            placeholderTextColor={colors.textTertiary}
            style={[styles.fieldInput, styles.draftMessageInput]}
            value={savedDraftMessage || buildPostCaptureMessage(savedDraftForNextAction)}
            onChangeText={setSavedDraftMessage}
            multiline
          />
        </Card>

        <View style={styles.postSaveActionGrid}>
          <Button label="Review later" onPress={handleSavedDraftAddAnother} />
          <Button
            label={getPostSavePrimaryAction(savedDraftForNextAction) === "Copy message" ? "Send now: copy" : `Send now: ${getPostSavePrimaryAction(savedDraftForNextAction)}`}
            onPress={() => void handlePostSavePrimaryAction()}
            variant="ghost"
          />
          <Button
            label={savedDraftForNextAction.nextFollowUpAt ? `Add to calendar: ${formatFollowUpDate(savedDraftForNextAction.nextFollowUpAt)}` : "Add calendar reminder later"}
            onPress={() => void handlePostSaveCalendarAction()}
            variant="ghost"
          />
          <Button label="Save & add another" onPress={handleSavedDraftAddAnother} variant="ghost" />
          <Button label="Done" onPress={handleClose} variant="ghost" />
        </View>
      </Card>
    );
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
                <Typography variant="caption">Event capture</Typography>
                <Typography variant="h1">{title === "Add Person" ? "Capture conversation" : title}</Typography>
                <Typography variant="body" style={styles.helperText}>
                  {showQuickCapture
                    ? "Tell me what just happened. We will turn it into a draft you can confirm."
                    : "Correct the useful context and save the clean version."}
                </Typography>
              </View>
              <Pressable onPress={handleClose} hitSlop={12} style={styles.closePill}>
                <Typography variant="caption" style={styles.closeText}>
                  Close
                </Typography>
              </Pressable>
            </View>

            {lockedEvent && !savedDraftForNextAction ? (
              <Card style={styles.lockedEventCard}>
                <Typography variant="caption">Current event active</Typography>
                <Typography variant="body" style={styles.previewText}>
                  This person will be tagged to {lockedEvent.name} · {formatCategoryLabel(lockedEvent.category)}.
                </Typography>
              </Card>
            ) : null}

            {savedDraftForNextAction ? renderPostSaveActions() : (
              <>
            {showQuickCapture && captureStage === "capture" ? (
              <Card style={[styles.sectionCard, styles.voiceFirstCard]}>
                {captureReadyMessage ? (
                  <View style={styles.savedInlineBanner}>
                    <Typography variant="caption" style={styles.savedInlineText}>Saved</Typography>
                    <Typography variant="body" style={styles.savedInlineText}>{captureReadyMessage} Ready for the next person.</Typography>
                  </View>
                ) : null}
                <View style={styles.sectionIntro}>
                  <Typography variant="caption">{lockedEvent ? lockedEvent.name : "Capture"}</Typography>
                  <Typography variant="h1">Tell me what just happened.</Typography>
                  <Typography variant="body" style={styles.helperText}>
                    Say who you met, why they matter, and what should happen next.
                  </Typography>
                </View>

                {isVoicePaused ? (
                  <View style={styles.pausedVoiceCard}>
                    <Typography variant="caption">Recording paused</Typography>
                    <Typography variant="h2">Resume or submit?</Typography>
                    <Typography variant="body" style={styles.helperText}>
                      We paused the voice note and will not resume until you choose.
                    </Typography>
                    <View style={styles.secondaryCaptureRow}>
                      <Button label="Resume" onPress={handleToggleVoicePause} fullWidth={false} size="compact" />
                      <Button label="Submit voice note" onPress={() => void handleSubmitPausedVoiceCapture()} variant="ghost" fullWidth={false} size="compact" />
                    </View>
                  </View>
                ) : (
                  <Pressable
                    style={[styles.speakButton, recorderState.isRecording ? styles.speakButtonActive : null]}
                    onPress={
                      recorderState.isRecording
                        ? () => void handleStopVoiceCapture()
                        : () => {
                            handleMethodPress("voice");
                            void handleStartVoiceCapture();
                          }
                    }
                    disabled={isTranscribing}
                  >
                    <Typography variant="h1" style={styles.speakIcon}>
                      {isTranscribing ? "..." : recorderState.isRecording ? "Stop" : "Mic"}
                    </Typography>
                    <Typography variant="h2" style={styles.speakLabel}>
                      {isTranscribing ? "Transcribing..." : recorderState.isRecording ? "Tap to finish" : "Tap to speak"}
                    </Typography>
                    <Typography variant="body" style={styles.speakHelper}>
                      “Met Sarah from Acme, partnership lead, follow up next week.”
                    </Typography>
                  </Pressable>
                )}

                {recorderState.isRecording && !isVoicePaused ? (
                  <Button
                    label="Pause recording"
                    onPress={handleToggleVoicePause}
                    variant="ghost"
                    fullWidth={false}
                    size="compact"
                  />
                ) : null}

                {voiceError ? (
                  <Typography variant="caption" style={styles.errorText}>
                    {voiceError}
                  </Typography>
                ) : null}

                <View style={styles.secondaryCaptureRow}>
                  <Button
                    label="Scan card/badge"
                    onPress={() => handleMethodPress("scan")}
                    variant="ghost"
                    fullWidth={false}
                    size="compact"
                  />
                  <Button
                    label="Quick note"
                    onPress={() => {
                      handleMethodPress("paste");
                      setCaptureStage("review");
                    }}
                    variant="ghost"
                    fullWidth={false}
                    size="compact"
                  />
                </View>

                {activeMethod === "paste" ? (
                  <View style={styles.capturePanel}>
                    <Typography variant="caption">Quick note or copied profile</Typography>
                    <TextInput
                      placeholder="Met Sarah from Stripe. Partnership lead. Follow up next week on LinkedIn."
                      placeholderTextColor={colors.textTertiary}
                      style={[styles.fieldInput, styles.textAreaInput]}
                      value={pasteInput}
                      onChangeText={setPasteInput}
                      multiline
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                    <Typography variant="body" style={styles.helperText}>
                      We will pull through obvious names, links, emails, and context. You only correct what matters.
                    </Typography>
                    <Button label="Extract draft" onPress={handlePasteParse} />
                  </View>
                ) : null}
              </Card>
            ) : null}

            {captureStage !== "capture" ? renderExtractionNotice() : null}

            {(!showQuickCapture || captureStage === "review" || captureStage === "contact") ? (
            <Card style={styles.sectionCard}>
              <View style={styles.sectionIntro}>
                <Typography variant="caption">Who + why</Typography>
                <Typography variant="body" style={styles.helperText}>
                  Review the draft. Correct anything that feels off.
                </Typography>
              </View>

              <View style={styles.fieldBlock}>
                <Typography variant="caption">Name</Typography>
                <TextInput
                  autoFocus={activeMethod !== "paste"}
                  placeholder="Sarah"
                  placeholderTextColor={colors.textTertiary}
                  style={getFieldInputStyle("name")}
                  value={draft.name}
                  onChangeText={(value) => updateField("name", value)}
                />
              </View>

              <View style={styles.fieldBlock}>
                <Typography variant="caption">Company</Typography>
                <TextInput
                  placeholder="Stripe"
                  placeholderTextColor={colors.textTertiary}
                  style={getFieldInputStyle("company")}
                  value={draft.company}
                  onChangeText={(value) => updateField("company", value)}
                />
              </View>

              <View style={styles.fieldBlock}>
                <Typography variant="caption">Why they matter</Typography>
                <TextInput
                  placeholder="Investor in climate, hiring designers, runs the community..."
                  placeholderTextColor={colors.textTertiary}
                  style={[...getFieldInputStyle("whatMatters"), styles.fastTextAreaInput]}
                  value={draft.whatMatters}
                  onChangeText={(value) => updateField("whatMatters", value)}
                  multiline
                />
              </View>

                <View style={[styles.chipSection, extractedFieldSet.has("tags") ? styles.extractedSection : null]}>
                <Typography variant="caption">Outcome goal</Typography>
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

              {(!showQuickCapture || captureStage === "contact") ? (
              <View style={[styles.chipSection, extractedFieldSet.has("preferredChannel") ? styles.extractedSection : null]}>
                <>
                <Typography variant="caption">Best follow-up channel</Typography>
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
                    style={[...getFieldInputStyle("preferredChannel"), styles.inlineInputTop]}
                    value={draft.preferredChannelOther}
                    onChangeText={(value) => updateField("preferredChannelOther", value)}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                ) : null}
                </>
              </View>
              ) : null}
            </Card>
            ) : null}

            {(!showQuickCapture || captureStage === "review" || captureStage === "contact") ? (
            <Card style={styles.sectionCard}>
              <View style={styles.sectionIntro}>
                <Typography variant="caption">Next step</Typography>
                <Typography variant="body" style={styles.helperText}>
                  The promise, open loop, or messy thought you do not want to lose.
                </Typography>
              </View>

              {(!showQuickCapture || captureStage === "review") ? (
              <View style={styles.fieldBlock}>
                <Typography variant="caption">Next step / brain dump</Typography>
                <TextInput
                  placeholder="Send deck, make intro, ask about the role..."
                  placeholderTextColor={colors.textTertiary}
                  style={[...getFieldInputStyle("nextStep"), styles.fastTextAreaInput]}
                  value={draft.nextStep}
                  onChangeText={(value) => updateField("nextStep", value)}
                  multiline
                />
              </View>
              ) : null}

              {!showQuickCapture || captureStage === "contact" ? (
              <>
              <View style={styles.sectionIntro}>
                <Typography variant="caption">Contact details</Typography>
                <Typography variant="body" style={styles.helperText}>
                  How should you reach them?
                </Typography>
              </View>

              <View style={styles.secondaryCaptureRow}>
                <Button
                  label="Scan card/badge"
                  onPress={() => handleMethodPress("scan")}
                  fullWidth={false}
                  size="compact"
                />
                <Button
                  label="Paste LinkedIn"
                  onPress={() => handleMethodPress("paste")}
                  variant="ghost"
                  fullWidth={false}
                  size="compact"
                />
                <Button
                  label="Add manually"
                  onPress={() => handleMethodPress("manual")}
                  variant="ghost"
                  fullWidth={false}
                  size="compact"
                />
              </View>

              {activeMethod === "paste" ? (
                <View style={styles.capturePanel}>
                  <Typography variant="caption">Paste LinkedIn or copied contact text</Typography>
                  <TextInput
                    placeholder="linkedin.com/in/sarah or an email signature"
                    placeholderTextColor={colors.textTertiary}
                    style={[styles.fieldInput, styles.textAreaInput]}
                    value={pasteInput}
                    onChangeText={setPasteInput}
                    multiline
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  <Button label="Extract contact details" onPress={handlePasteParse} />
                </View>
              ) : null}

              <View style={styles.twoColumnRow}>
                <View style={styles.metaInputBlock}>
                  <Typography variant="caption">LinkedIn</Typography>
                  <TextInput
                    placeholder="linkedin.com/in/sarah"
                    placeholderTextColor={colors.textTertiary}
                    style={getFieldInputStyle("linkedinUrl")}
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
                    style={getFieldInputStyle("email")}
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
                    style={getFieldInputStyle("phoneNumber")}
                    value={draft.phoneNumber}
                    onChangeText={(value) => updateField("phoneNumber", value)}
                    keyboardType="phone-pad"
                  />
                </View>
              </View>
              </>
              ) : null}
            </Card>
            ) : null}

            {(!showQuickCapture || captureStage === "review" || captureStage === "contact") ? (
            <Card style={styles.sectionCard}>
              <View style={styles.sectionIntro}>
                <Typography variant="caption">Follow-up</Typography>
                <Typography variant="body" style={styles.helperText}>
                  Suggested, not required. Accept it now or change it later.
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
                    label="Custom"
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
                  <View style={styles.metaInputBlock}>
                    <Typography variant="caption">Custom date</Typography>
                    <TextInput
                      placeholder="YYYY-MM-DD"
                      placeholderTextColor={colors.textTertiary}
                      style={getFieldInputStyle("nextFollowUpAt")}
                      value={customFollowUpDate}
                      onChangeText={updateCustomFollowUpDate}
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                  </View>
                ) : null}
              </View>
            </Card>
            ) : null}
              </>
            )}
          </ScrollView>

          {!savedDraftForNextAction ? (
            <View style={styles.footerWrap}>
            <View style={styles.footerButtons}>
              {showQuickCapture && captureStage === "capture" ? (
                <Button label="Close" onPress={handleClose} variant="ghost" />
              ) : null}
              {showQuickCapture && captureStage === "review" ? (
                <>
                  <Button label={saveLabel} onPress={() => void handleSave(false)} loading={isSaving} disabled={!canSave} />
                  {showSaveAndAddAnother ? (
                    <Button label="Save & Add Another" onPress={() => void handleSave(true)} loading={isSaving} disabled={!canSave} variant="ghost" />
                  ) : null}
                  <Button label="Start over" onPress={resetForAnotherCapture} variant="ghost" />
                </>
              ) : null}
              {(!showQuickCapture || captureStage === "contact") ? (
                <>
              <Button label={saveLabel} onPress={() => void handleSave(false)} loading={isSaving} disabled={!canSave} />
              {showSaveAndAddAnother ? (
                <Button label="Save & Add Another" onPress={() => void handleSave(true)} loading={isSaving} disabled={!canSave} variant="ghost" />
              ) : null}
              <Button label="Cancel" onPress={handleClose} variant="ghost" />
                </>
              ) : null}
            </View>
          </View>
          ) : null}
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
  voiceFirstCard: {
    gap: 18,
  },
  sectionIntro: {
    gap: 6,
  },
  speakButton: {
    minHeight: 220,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: colors.primaryAction,
    backgroundColor: colors.primaryAction,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 10,
  },
  speakButtonActive: {
    backgroundColor: colors.primaryActionHover,
  },
  pausedVoiceCard: {
    minHeight: 220,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: colors.primaryAction,
    backgroundColor: colors.successSoft,
    justifyContent: "center",
    padding: 24,
    gap: 12,
  },
  speakIcon: {
    color: colors.onPrimary,
  },
  speakLabel: {
    color: colors.onPrimary,
  },
  speakHelper: {
    color: colors.onPrimary,
    textAlign: "center",
  },
  secondaryCaptureRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  savedInlineBanner: {
    borderRadius: 18,
    backgroundColor: colors.successSoft,
    borderWidth: 1,
    borderColor: colors.primaryAction,
    padding: 12,
    gap: 4,
  },
  savedInlineText: {
    color: colors.textPrimary,
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
  extractionCard: {
    gap: 10,
    borderColor: colors.primaryAction,
    backgroundColor: colors.successSoft,
  },
  extractionPill: {
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  extractionPillText: {
    color: colors.textPrimary,
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
  extractedFieldInput: {
    borderColor: colors.primaryAction,
    borderWidth: 2,
    backgroundColor: colors.successSoft,
  },
  extractedSection: {
    borderWidth: 1,
    borderColor: colors.primaryAction,
    borderRadius: 18,
    backgroundColor: colors.successSoft,
    padding: 12,
  },
  textAreaInput: {
    minHeight: 96,
    textAlignVertical: "top",
  },
  draftMessageInput: {
    minHeight: 150,
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
  previewCard: {
    marginBottom: 8,
    borderColor: colors.primaryAction,
  },
  nextActionPreviewCard: {
    gap: 8,
    backgroundColor: colors.surfaceMuted,
  },
  postSaveActionGrid: {
    gap: 10,
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
