import { PostgrestError } from "@supabase/supabase-js";

import { missingSupabaseEnvMessage, supabase } from "./supabase";

export type PersonRow = {
  company: string | null;
  id: string;
  is_vip: boolean;
  linkedin_url: string | null;
  email: string | null;
  name: string | null;
  next_follow_up_at: string | null;
  phone_number: string | null;
  priority: PersonPriority;
  preferred_channel: PreferredChannel | null;
  preferred_channel_other: string | null;
  tags: string[];
  created_at: string;
};

export type EventRow = {
  category: EventCategory | null;
  ended_at: string | null;
  event_date: string | null;
  id: string;
  name: string;
  created_at: string;
};

export type InteractionRow = {
  id: string;
  raw_note: string;
  created_at: string;
  person_id: string;
  event_id: string | null;
  persons?: { name: string | null; company?: string | null } | null;
  events?: { name: string; category?: EventCategory | null } | null;
};

export type EventCategory =
  | "networking"
  | "conference"
  | "coffee"
  | "zoom"
  | "investor"
  | "social"
  | "workshop"
  | "community"
  | "other";

export type PersonPriority = "high" | "medium" | "low";
export type FollowUpPreset = "tomorrow" | "in3days" | "nextWeek" | "custom";
export type PreferredChannel = "linkedin" | "whatsapp" | "email" | "phone" | "other";

export type PersonInsight = {
  id: string;
  name: string;
  priority: PersonPriority;
  company: string;
  linkedinUrl: string;
  email: string;
  phoneNumber: string;
  preferredChannel: PreferredChannel | "";
  preferredChannelOther: string;
  tags: string[];
  createdAt: string;
  interactionCount: number;
  lastInteractionId: string | null;
  lastInteractionAt: string | null;
  lastInteractionNote: string;
  whatMatters: string;
  nextStep: string;
  relationshipStatus: string;
  nextFollowUpAt: string | null;
  nextFollowUpLabel: string;
  followUpState: "none" | "upcoming" | "dueToday" | "overdue";
  lastEventName: string | null;
  lastEventCategory: EventCategory;
  followUp: string;
  daysSinceLastContact: number | null;
  statusLabel: string;
  bannerLabel: string;
};

export type EventInsight = {
  id: string;
  name: string;
  createdAt: string;
  eventDate: string | null;
  category: EventCategory;
  interactionCount: number;
  peopleCount: number;
  lastInteractionAt: string | null;
  lastConnectedLabel: string;
  featuredPeople: string[];
};

// Keep real day-based reminder timing in the app; demo timing causes status changes within seconds.
export const FAST_REMINDER_DEMO_MODE = false;
export const STALE_CONTACT_THRESHOLD = FAST_REMINDER_DEMO_MODE ? 45 : 14;
export const RECENT_CONTACT_THRESHOLD = FAST_REMINDER_DEMO_MODE ? 20 : 7;
export const JUST_CONNECTED_THRESHOLD = FAST_REMINDER_DEMO_MODE ? 10 : 0;

export const PERSON_TAG_SUGGESTIONS = [
  "investor",
  "founder",
  "corporate",
  "charity",
  "operator",
  "advisor",
  "creator",
  "community",
] as const;

export const EVENT_CATEGORY_OPTIONS: Array<{ label: string; value: EventCategory | "all" }> = [
  { label: "All", value: "all" },
  { label: "Networking", value: "networking" },
  { label: "Conference", value: "conference" },
  { label: "Coffee", value: "coffee" },
  { label: "Zoom", value: "zoom" },
  { label: "Drinks", value: "social" },
  { label: "Investor", value: "investor" },
  { label: "Workshop", value: "workshop" },
  { label: "Community", value: "community" },
  { label: "Other", value: "other" },
];

function startOfDay(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function toDateOnlyString(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseDateOnlyString(value?: string | null) {
  if (!value) {
    return null;
  }

  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) {
    return null;
  }

  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

export function getSuggestedFollowUpPreset(category?: EventCategory | "" | null): FollowUpPreset {
  if (category === "networking" || category === "conference" || category === "investor") {
    return "tomorrow";
  }

  if (category === "coffee") {
    return "in3days";
  }

  if (category === "workshop" || category === "community") {
    return "nextWeek";
  }

  return "in3days";
}

export function getPresetDate(preset: FollowUpPreset, baseDate = new Date()) {
  const seed = startOfDay(baseDate);
  const next = new Date(seed);

  if (preset === "tomorrow") {
    next.setDate(next.getDate() + 1);
    return toDateOnlyString(next);
  }

  if (preset === "in3days") {
    next.setDate(next.getDate() + 3);
    return toDateOnlyString(next);
  }

  if (preset === "nextWeek") {
    next.setDate(next.getDate() + 7);
    return toDateOnlyString(next);
  }

  return toDateOnlyString(next);
}

export function formatFollowUpDate(value?: string | null) {
  const hasTime = Boolean(value?.includes("T"));
  const parsed = hasTime ? new Date(value as string) : parseDateOnlyString(value);
  if (!parsed || Number.isNaN(parsed.getTime())) {
    return "No follow-up date";
  }

  const dayLabel = parsed.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    });

  if (!hasTime) {
    return dayLabel;
  }

  const timeLabel = parsed.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

  return `${dayLabel} • ${timeLabel}`;
}

export function normalizeEventDate(value?: string | null) {
  const trimmed = value?.trim() || "";
  if (!trimmed) {
    return null;
  }

  const parsed = parseDateOnlyString(trimmed);
  return parsed ? toDateOnlyString(parsed) : null;
}

export function formatEventDate(value?: string | null) {
  const parsed = parseDateOnlyString(value);
  if (!parsed) {
    return "No date set";
  }

  return parsed.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function getFollowUpState(nextFollowUpAt?: string | null): PersonInsight["followUpState"] {
  const parsed = parseDateOnlyString(nextFollowUpAt);
  if (!parsed) {
    return "none";
  }

  const target = startOfDay(parsed).getTime();
  const today = startOfDay().getTime();

  if (target < today) {
    return "overdue";
  }

  if (target === today) {
    return "dueToday";
  }

  return "upcoming";
}


const eventCategoryMatchers: Array<{ category: EventCategory; patterns: RegExp[] }> = [
  {
    category: "networking",
    patterns: [/network/i, /mixer/i, /meetup/i, /founder/i, /operator/i],
  },
  {
    category: "conference",
    patterns: [/conference/i, /summit/i, /expo/i, /forum/i, /congress/i],
  },
  {
    category: "coffee",
    patterns: [/coffee/i, /breakfast/i, /lunch/i, /brunch/i, /tea/i],
  },
  {
    category: "zoom",
    patterns: [/zoom/i, /meet/i, /virtual/i, /video call/i, /remote/i],
  },
  {
    category: "investor",
    patterns: [/investor/i, /fund/i, /vc/i, /pitch/i, /demo day/i],
  },
  {
    category: "workshop",
    patterns: [/workshop/i, /masterclass/i, /bootcamp/i, /training/i],
  },
  {
    category: "community",
    patterns: [/community/i, /alumni/i, /guild/i, /club/i],
  },
  {
    category: "social",
    patterns: [/dinner/i, /drinks/i, /party/i, /social/i, /hangout/i],
  },
];

function assertClient() {
  if (!supabase) {
    throw new Error(missingSupabaseEnvMessage);
  }

  return supabase;
}

function assertNoError(error: PostgrestError | null) {
  if (error) {
    throw new Error(error.message);
  }
}

export function normalizePriority(priority?: string | null, isVip?: boolean) {
  if (priority === "high" || priority === "medium" || priority === "low") {
    return priority;
  }

  return isVip ? "high" : "medium";
}

export function normalizeTags(tags?: string[] | null) {
  if (!tags?.length) {
    return [];
  }

  return Array.from(
    new Set(
      tags
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean)
    )
  );
}

export function normalizePreferredChannel(channel?: string | null): PreferredChannel | null {
  if (
    channel === "linkedin" ||
    channel === "whatsapp" ||
    channel === "email" ||
    channel === "phone" ||
    channel === "other"
  ) {
    return channel;
  }

  return null;
}

export function normalizePreferredChannelOther(value?: string | null) {
  const trimmed = value?.trim() || "";
  return trimmed || null;
}

export function formatPreferredChannelLabel(
  channel?: PreferredChannel | "" | null,
  otherValue?: string | null
) {
  if (channel === "linkedin") return "LinkedIn";
  if (channel === "whatsapp") return "WhatsApp";
  if (channel === "email") return "Email";
  if (channel === "phone") return "Phone";
  if (channel === "other") return otherValue?.trim() || "Other";
  return "No preference";
}

export async function ensureSessionUserId() {
  const client = assertClient();

  const { data: sessionData } = await client.auth.getSession();
  if (sessionData.session?.user?.id) {
    return sessionData.session.user.id;
  }

  const { data, error } = await client.auth.signInAnonymously();
  if (error || !data.user?.id) {
    throw new Error(error?.message || "Unable to authenticate with Supabase.");
  }

  return data.user.id;
}

export async function getOrCreateEvent(
  userId: string,
  name: string,
  category?: EventCategory | null,
  eventDate?: string | null
) {
  const client = assertClient();
  const normalizedName = name.trim();
  const normalizedCategory = category || inferEventCategory(normalizedName, "");
  const normalizedEventDate = normalizeEventDate(eventDate);

  const { data: existing, error: findError } = await client
    .from("events")
    .select("id,name,category,event_date,ended_at,created_at")
    .eq("user_id", userId)
    .ilike("name", normalizedName)
    .maybeSingle();

  assertNoError(findError);
  if (existing) {
    const needsCategoryUpdate = normalizedCategory && existing.category !== normalizedCategory;
    const needsDateUpdate = normalizedEventDate !== null && (existing.event_date || null) !== normalizedEventDate;

    if (needsCategoryUpdate || needsDateUpdate) {
      const updatePayload: Pick<EventRow, "category"> & Partial<Pick<EventRow, "event_date">> = {
        category: normalizedCategory,
      };

      if (needsDateUpdate) {
        updatePayload.event_date = normalizedEventDate;
      }

      const { data: updated, error: updateError } = await client
        .from("events")
        .update(updatePayload)
        .eq("user_id", userId)
        .eq("id", existing.id)
        .select("id,name,category,event_date,ended_at,created_at")
        .single();

      assertNoError(updateError);
      return updated as EventRow;
    }

    return existing as EventRow;
  }

  const { data: inserted, error: insertError } = await client
    .from("events")
    .insert({
      user_id: userId,
      name: normalizedName,
      category: normalizedCategory,
      event_date: normalizedEventDate,
    })
    .select("id,name,category,event_date,ended_at,created_at")
    .single();

  assertNoError(insertError);
  return inserted as EventRow;
}

export async function createPerson(
  userId: string,
  name: string,
  company?: string,
  linkedinUrl?: string,
  email?: string,
  phoneNumber?: string,
  preferredChannel?: PreferredChannel | "",
  preferredChannelOther?: string,
  priority: PersonPriority = "medium",
  tags: string[] = [],
  nextFollowUpAt?: string | null
) {
  const client = assertClient();
  const normalizedTags = normalizeTags(tags);

  const { data, error } = await client
    .from("persons")
    .insert({
      user_id: userId,
      name: name.trim() || null,
      company: company?.trim() || null,
      is_vip: priority === "high",
      linkedin_url: normalizeLinkedInUrl(linkedinUrl),
      email: normalizeEmail(email),
      phone_number: normalizePhoneNumber(phoneNumber),
      preferred_channel: normalizePreferredChannel(preferredChannel),
      preferred_channel_other: normalizePreferredChannelOther(preferredChannelOther),
      priority,
      tags: normalizedTags,
      next_follow_up_at: normalizeEventDate(nextFollowUpAt),
    })
    .select("id,name,company,is_vip,linkedin_url,email,phone_number,preferred_channel,preferred_channel_other,priority,tags,next_follow_up_at,created_at")
    .single();

  assertNoError(error);
  return data as PersonRow;
}

export async function createInteraction(input: {
  userId: string;
  personId: string;
  eventId?: string | null;
  rawNote: string;
}) {
  const client = assertClient();

  const { error } = await client.from("interactions").insert({
    user_id: input.userId,
    person_id: input.personId,
    event_id: input.eventId ?? null,
    raw_note: input.rawNote,
  });

  assertNoError(error);
}

export async function updatePersonDetails(input: {
  userId: string;
  personId: string;
  name: string;
  company?: string;
  linkedinUrl?: string;
  email?: string;
  phoneNumber?: string;
  preferredChannel?: PreferredChannel | "";
  preferredChannelOther?: string;
  priority?: PersonPriority;
  tags?: string[];
  nextFollowUpAt?: string | null;
}) {
  const client = assertClient();
  const normalizedPriority = input.priority || "medium";
  const normalizedTags = normalizeTags(input.tags);

  const { error } = await client
    .from("persons")
    .update({
      name: input.name.trim() || null,
      company: input.company?.trim() || null,
      is_vip: normalizedPriority === "high",
      linkedin_url: normalizeLinkedInUrl(input.linkedinUrl),
      email: normalizeEmail(input.email),
      phone_number: normalizePhoneNumber(input.phoneNumber),
      preferred_channel: normalizePreferredChannel(input.preferredChannel),
      preferred_channel_other: normalizePreferredChannelOther(input.preferredChannelOther),
      priority: normalizedPriority,
      tags: normalizedTags,
      ...(input.nextFollowUpAt !== undefined ? { next_follow_up_at: normalizeEventDate(input.nextFollowUpAt) } : {}),
    })
    .eq("user_id", input.userId)
    .eq("id", input.personId);

  assertNoError(error);
}

export async function updatePersonNextFollowUpAt(input: {
  userId: string;
  personId: string;
  nextFollowUpAt?: string | null;
}) {
  const client = assertClient();

  const { error } = await client
    .from("persons")
    .update({
      next_follow_up_at: normalizeEventDate(input.nextFollowUpAt),
    })
    .eq("user_id", input.userId)
    .eq("id", input.personId);

  assertNoError(error);
}

export async function updatePersonLinkedInUrl(input: {
  userId: string;
  personId: string;
  linkedinUrl: string;
}) {
  const client = assertClient();

  const { error } = await client
    .from("persons")
    .update({
      linkedin_url: normalizeLinkedInUrl(input.linkedinUrl),
    })
    .eq("user_id", input.userId)
    .eq("id", input.personId);

  assertNoError(error);
}

export async function updateInteraction(input: {
  userId: string;
  interactionId: string;
  eventId?: string | null;
  rawNote: string;
}) {
  const client = assertClient();

  const { error } = await client
    .from("interactions")
    .update({
      event_id: input.eventId ?? null,
      raw_note: input.rawNote,
    })
    .eq("user_id", input.userId)
    .eq("id", input.interactionId);

  assertNoError(error);
}

export async function updateEventDetails(input: {
  userId: string;
  eventId: string;
  name: string;
  category?: EventCategory | null;
  eventDate?: string | null;
}) {
  const client = assertClient();
  const normalizedName = input.name.trim();

  if (!normalizedName) {
    throw new Error("Event name is required.");
  }

  const { error } = await client
    .from("events")
    .update({
      name: normalizedName,
      category: input.category || inferEventCategory(normalizedName, ""),
      event_date: normalizeEventDate(input.eventDate),
    })
    .eq("user_id", input.userId)
    .eq("id", input.eventId);

  assertNoError(error);
}

export async function updateEventEndedAt(input: {
  userId: string;
  eventId: string;
  endedAt?: string | null;
}) {
  const client = assertClient();

  const { error } = await client
    .from("events")
    .update({
      ended_at: input.endedAt || new Date().toISOString(),
    })
    .eq("user_id", input.userId)
    .eq("id", input.eventId);

  assertNoError(error);
}

export async function deleteEvent(userId: string, eventId: string) {
  const client = assertClient();

  const { error } = await client
    .from("events")
    .delete()
    .eq("user_id", userId)
    .eq("id", eventId);

  assertNoError(error);
}

export async function deletePerson(userId: string, personId: string) {
  const client = assertClient();

  const { error: interactionError } = await client
    .from("interactions")
    .delete()
    .eq("user_id", userId)
    .eq("person_id", personId);

  assertNoError(interactionError);

  const { error } = await client
    .from("persons")
    .delete()
    .eq("user_id", userId)
    .eq("id", personId);

  assertNoError(error);
}

export async function markPersonContactedToday(userId: string, personId: string) {
  await createInteraction({
    userId,
    personId,
    rawNote: "Contacted today.",
  });
}

export async function listRecentPeople(userId: string, limit = 8) {
  const client = assertClient();

  const { data, error } = await client
    .from("persons")
    .select("id,name,company,is_vip,linkedin_url,email,phone_number,preferred_channel,preferred_channel_other,priority,tags,next_follow_up_at,created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  assertNoError(error);
  return (data || []) as PersonRow[];
}

export async function listRecentEvents(userId: string, limit = 5) {
  const client = assertClient();

  const { data, error } = await client
    .from("events")
    .select("id,name,category,event_date,ended_at,created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  assertNoError(error);
  return (data || []) as EventRow[];
}

export async function listRecentInteractions(userId: string, limit = 24) {
  const client = assertClient();

  const { data, error } = await client
    .from("interactions")
    .select(
      "id,raw_note,created_at,person_id,event_id,persons(name,company),events(name,category)"
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  assertNoError(error);
  return (data || []) as InteractionRow[];
}

export async function listAllInteractions(userId: string, limit = 500) {
  return listRecentInteractions(userId, limit);
}

export async function listEventInteractions(userId: string, eventId: string) {
  const client = assertClient();

  const { data, error } = await client
    .from("interactions")
    .select("id,raw_note,created_at,person_id,event_id,persons(name,company),events(name,category)")
    .eq("user_id", userId)
    .eq("event_id", eventId)
    .order("created_at", { ascending: false });

  assertNoError(error);
  return (data || []) as InteractionRow[];
}

export async function listPersonInteractions(userId: string, personId: string) {
  const client = assertClient();

  const { data, error } = await client
    .from("interactions")
    .select("id,raw_note,created_at,person_id,event_id,events(name,category)")
    .eq("user_id", userId)
    .eq("person_id", personId)
    .order("created_at", { ascending: false });

  assertNoError(error);
  return (data || []) as InteractionRow[];
}

export async function getFirstPerson(userId: string) {
  const client = assertClient();

  const { data, error } = await client
    .from("persons")
    .select("id,name,company,is_vip,linkedin_url,email,phone_number,preferred_channel,preferred_channel_other,priority,tags,next_follow_up_at,created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  assertNoError(error);
  return (data as PersonRow | null) || null;
}

export async function listPeopleInsights(userId: string) {
  const [people, interactions] = await Promise.all([
    listRecentPeople(userId, 200),
    listAllInteractions(userId, 500),
  ]);

  const interactionsByPerson = new Map<string, InteractionRow[]>();
  interactions.forEach((interaction) => {
    const current = interactionsByPerson.get(interaction.person_id) || [];
    current.push(interaction);
    interactionsByPerson.set(interaction.person_id, current);
  });

  return people.map((person) => {
    const personInteractions = interactionsByPerson.get(person.id) || [];
    const lastInteraction = personInteractions[0] || null;
    const daysSinceLastContact = lastInteraction
      ? getDaysSince(lastInteraction.created_at)
      : null;
    const priority = normalizePriority(person.priority, person.is_vip);
    const tags = normalizeTags(person.tags);
    const rawNote = lastInteraction?.raw_note || "";
    const whatMatters = extractPrimaryNote(rawNote) || "No interactions yet.";
    const nextStep = extractNextStep(rawNote);
    const relationshipStatus = extractRelationshipStatus(rawNote);
    const nextFollowUpAt = person.next_follow_up_at || extractFollowUpDate(rawNote);

    return {
      id: person.id,
      name: person.name || "Unknown contact",
      priority,
      company: person.company || extractCompany(rawNote),
      linkedinUrl: person.linkedin_url || "",
      email: person.email || "",
      phoneNumber: person.phone_number || "",
      preferredChannel: normalizePreferredChannel(person.preferred_channel) || "",
      preferredChannelOther: person.preferred_channel_other || "",
      tags,
      createdAt: person.created_at,
      interactionCount: personInteractions.length,
      lastInteractionId: lastInteraction?.id || null,
      lastInteractionAt: lastInteraction?.created_at || null,
      lastInteractionNote: whatMatters,
      whatMatters,
      nextStep,
      relationshipStatus,
      nextFollowUpAt,
      nextFollowUpLabel: nextFollowUpAt ? formatFollowUpDate(nextFollowUpAt) : "No follow-up date",
      followUpState: getFollowUpState(nextFollowUpAt),
      lastEventName: lastInteraction?.events?.name || null,
      lastEventCategory: inferEventCategory(
        lastInteraction?.events?.name,
        rawNote,
        lastInteraction?.events?.category || null
      ),
      followUp: nextStep || "No next step yet",
      daysSinceLastContact,
      statusLabel: buildContactStatus(daysSinceLastContact, priority, nextFollowUpAt),
      bannerLabel: buildContactBanner(daysSinceLastContact, priority, nextFollowUpAt),
    } as PersonInsight;
  });
}

export async function listEventInsights(userId: string) {
  const [events, interactions] = await Promise.all([
    listRecentEvents(userId, 100),
    listAllInteractions(userId, 500),
  ]);

  const interactionsByEvent = new Map<string, InteractionRow[]>();
  interactions.forEach((interaction) => {
    if (!interaction.event_id) {
      return;
    }

    const current = interactionsByEvent.get(interaction.event_id) || [];
    current.push(interaction);
    interactionsByEvent.set(interaction.event_id, current);
  });

  return events.map((event) => {
    const eventInteractions = interactionsByEvent.get(event.id) || [];
    const lastInteraction = eventInteractions[0] || null;
    const peopleNames = Array.from(
      new Set(
        eventInteractions
          .map((interaction) => interaction.persons?.name || "Unknown contact")
          .filter(Boolean)
      )
    );

    return {
      id: event.id,
      name: event.name,
      createdAt: event.created_at,
      eventDate: event.event_date || null,
      category: inferEventCategory(event.name, lastInteraction?.raw_note, event.category),
      interactionCount: eventInteractions.length,
      peopleCount: peopleNames.length,
      lastInteractionAt: lastInteraction?.created_at || null,
      lastConnectedLabel: buildContactBanner(
        lastInteraction ? getDaysSince(lastInteraction.created_at) : null
      ),
      featuredPeople: peopleNames.slice(0, 3),
    } as EventInsight;
  });
}

export async function countInteractionsByEvent(userId: string, eventId: string) {
  const client = assertClient();

  const { count, error } = await client
    .from("interactions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("event_id", eventId);

  assertNoError(error);
  return count || 0;
}

export function buildInteractionNote(whatMatters: string, nextStep: string, nextFollowUpAt?: string) {
  return buildInteractionRecord(whatMatters, nextStep, undefined, nextFollowUpAt);
}

export function normalizeLinkedInUrl(value?: string | null) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  if (trimmed.includes("linkedin.com")) {
    return `https://${trimmed.replace(/^\/+/, "")}`;
  }

  return `https://www.linkedin.com/in/${trimmed.replace(/^@/, "")}`;
}

export function normalizeEmail(value?: string | null) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.toLowerCase();
}

export function normalizePhoneNumber(value?: string | null) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed;
}

export function toWhatsAppUrl(phoneNumber: string) {
  const digits = phoneNumber.replace(/[^\d+]/g, "").replace(/^00/, "+");
  const normalized = digits.startsWith("+") ? digits.slice(1) : digits;
  return normalized ? `https://wa.me/${normalized}` : null;
}

export function buildInteractionRecord(whatMatters: string, nextStep: string, company?: string, nextFollowUpAt?: string) {
  const lines: string[] = [];

  if (whatMatters.trim()) {
    lines.push(whatMatters.trim());
  }

  if (nextStep.trim() && nextStep.trim().toLowerCase() !== "none yet") {
    lines.push(`Next step: ${nextStep.trim()}`);
  }

  if (nextFollowUpAt?.trim()) {
    lines.push(`Follow up date: ${nextFollowUpAt.trim()}`);
  }

  return lines.join("\n");
}

export function extractCompany(rawNote: string) {
  const match = rawNote.match(/^Company:\s*(.+)$/im);
  return match?.[1]?.trim() || "";
}

function stripInteractionMetadata(rawNote: string) {
  return rawNote
    .replace(/^Company:\s*.+$/gim, "")
    .replace(/^Update\s*type:\s*.+$/gim, "")
    .replace(/^Status:\s*.+$/gim, "")
    .replace(/^Relationship\s*goal:\s*.+$/gim, "")
    .replace(/^Relationship\s*status:\s*.+$/gim, "")
    .replace(/^Next\s*step:\s*.+$/gim, "")
    .replace(/^Follow\s*up\s*date:\s*.+$/gim, "")
    .replace(/^Follow\s*up:\s*.+$/gim, "")
    .trim();
}

export function extractPrimaryNote(rawNote: string) {
  return stripInteractionMetadata(rawNote);
}

export function extractNextStep(rawNote: string) {
  const nextStepMatch = rawNote.match(/^Next\s*step:\s*(.+)$/im);
  if (nextStepMatch?.[1]) {
    return nextStepMatch[1].trim();
  }

  const legacyMatch = rawNote.match(/follow\s*up\s*[:.-]\s*(.+)$/im);
  if (legacyMatch?.[1]) {
    return legacyMatch[1].trim();
  }

  return "";
}

export function extractRelationshipStatus(rawNote: string) {
  const explicitMatch = rawNote.match(/^Relationship\s*status:\s*(.+)$/im);
  return explicitMatch?.[1]?.trim() || "";
}

export function extractFollowUp(rawNote: string) {
  return extractNextStep(rawNote) || "None yet";
}

export function extractFollowUpDate(rawNote: string) {
  const match = rawNote.match(/^Follow\s*up\s*date:\s*(\d{4}-\d{2}-\d{2})$/im);
  return match?.[1] || null;
}

export function inferEventCategory(
  eventName?: string | null,
  rawNote?: string | null,
  explicitCategory?: EventCategory | string | null
) {
  if (explicitCategory && explicitCategory !== "all") {
    return explicitCategory as EventCategory;
  }

  const haystack = `${eventName || ""} ${rawNote || ""}`.trim();

  for (const matcher of eventCategoryMatchers) {
    if (matcher.patterns.some((pattern) => pattern.test(haystack))) {
      return matcher.category;
    }
  }

  return "other";
}

export function formatCategoryLabel(category: EventCategory) {
  if (category === "social") {
    return "Drinks";
  }

  if (category === "zoom") {
    return "Zoom";
  }

  if (category === "other") {
    return "Other";
  }

  return category.charAt(0).toUpperCase() + category.slice(1);
}

export function getDaysSince(value: string) {
  const diff = Date.now() - new Date(value).getTime();
  if (FAST_REMINDER_DEMO_MODE) {
    return Math.max(0, Math.floor(diff / 1000));
  }

  return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
}

export function buildContactStatus(
  daysSinceLastContact: number | null,
  priority: PersonPriority = "medium",
  nextFollowUpAt?: string | null
) {
  const followUpState = getFollowUpState(nextFollowUpAt);
  if (followUpState === "overdue") {
    return "Overdue";
  }

  if (followUpState === "dueToday") {
    return "Due today";
  }

  if (daysSinceLastContact === null) {
    return "No contact yet";
  }

  if (daysSinceLastContact <= JUST_CONNECTED_THRESHOLD) {
    return FAST_REMINDER_DEMO_MODE ? "Connected just now" : "Connected today";
  }

  if (daysSinceLastContact <= RECENT_CONTACT_THRESHOLD) {
    return "Recently connected";
  }

  if (!isContactStale(daysSinceLastContact, priority)) {
    return "Cooling";
  }

  return "Needs follow-up";
}

export function buildContactBanner(
  daysSinceLastContact: number | null,
  priority: PersonPriority = "medium",
  nextFollowUpAt?: string | null
) {
  const followUpState = getFollowUpState(nextFollowUpAt);
  if (followUpState === "overdue") {
    return `Follow-up overdue since ${formatFollowUpDate(nextFollowUpAt)}`;
  }

  if (followUpState === "dueToday") {
    return `Follow up today · ${formatFollowUpDate(nextFollowUpAt)}`;
  }

  if (followUpState === "upcoming") {
    return `Follow up on ${formatFollowUpDate(nextFollowUpAt)}`;
  }

  if (daysSinceLastContact === null) {
    return "No contact on record yet";
  }

  if (daysSinceLastContact <= JUST_CONNECTED_THRESHOLD) {
    return FAST_REMINDER_DEMO_MODE ? "Last connected just now" : "Last connected today";
  }

  if (FAST_REMINDER_DEMO_MODE) {
    if (daysSinceLastContact === 1) {
      return "Last connected 1 second ago";
    }

    if (isContactStale(daysSinceLastContact, priority)) {
      return `Needs a nudge: ${daysSinceLastContact}s since contact`;
    }

    return `Haven't connected in ${daysSinceLastContact} seconds`;
  }

  if (daysSinceLastContact === 1) {
    return "Last connected 1 day ago";
  }

  if (isContactStale(daysSinceLastContact, priority)) {
    return `Needs a nudge: ${daysSinceLastContact} days since contact`;
  }

  return `Haven't connected in ${daysSinceLastContact} days`;
}

export function getStaleThreshold(priority: PersonPriority) {
  return STALE_CONTACT_THRESHOLD;
}

export function isContactStale(daysSinceLastContact: number | null, priority: PersonPriority) {
  if (daysSinceLastContact === null) {
    return false;
  }

  const threshold = getStaleThreshold(priority);
  if (threshold === null) {
    return false;
  }

  return daysSinceLastContact >= threshold;
}

export function formatPriorityLabel(priority: PersonPriority) {
  return "Tracked contact";
}

export function buildReconnectDraft(input: {
  name: string;
  eventName?: string | null;
  lastInteractionNote?: string;
  followUp?: string;
}) {
  const event = input.eventName || "the event";
  const note = input.lastInteractionNote?.trim() || "";
  const followUp = input.followUp?.trim() && input.followUp.trim().toLowerCase() !== "none yet"
    ? input.followUp.trim()
    : "";

  const contextLine = note
    ? `I was thinking about what you mentioned: ${note}.`
    : "I enjoyed the conversation and wanted to keep the thread warm.";
  const nextMoveLine = followUp
    ? `Picking up on ${followUp}, would it make sense to continue from there?`
    : "Would be good to continue the conversation when you have a moment.";

  return `Hey ${input.name}, great meeting you at ${event}. ${contextLine} ${nextMoveLine}`;
}

export function formatDateTime(value: string) {
  const date = new Date(value);
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
