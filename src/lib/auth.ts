import { Platform } from "react-native";

import AsyncStorage from "@react-native-async-storage/async-storage";
import { AuthError, User } from "@supabase/supabase-js";

import { Database } from "../types/database";
import { authRedirectUrl, missingSupabaseEnvMessage, supabase } from "./supabase";

type EventRow = Database["public"]["Tables"]["events"]["Row"];
type PersonRow = Database["public"]["Tables"]["persons"]["Row"];
type InteractionRow = Database["public"]["Tables"]["interactions"]["Row"];

type GuestSnapshot = {
  events: EventRow[];
  persons: PersonRow[];
  interactions: InteractionRow[];
};

type PendingUpgradePayload = {
  guestUserId: string;
  snapshot: GuestSnapshot;
};

const USERNAME_REGEX = /^[a-z0-9_]{3,24}$/;
const PENDING_UPGRADE_STORAGE_KEY = "blackbook.pending_guest_upgrade";

function assertClient() {
  if (!supabase) {
    throw new Error(missingSupabaseEnvMessage);
  }

  return supabase;
}

async function storageGetItem(key: string) {
  if (Platform.OS === "web") {
    return typeof window === "undefined" ? null : window.localStorage.getItem(key);
  }

  return AsyncStorage.getItem(key);
}

async function storageSetItem(key: string, value: string) {
  if (Platform.OS === "web") {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(key, value);
    }
    return;
  }

  await AsyncStorage.setItem(key, value);
}

async function storageRemoveItem(key: string) {
  if (Platform.OS === "web") {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(key);
    }
    return;
  }

  await AsyncStorage.removeItem(key);
}

function normalizeAuthError(error: AuthError | Error) {
  const message = error.message.toLowerCase();

  if (message.includes("invalid login")) {
    return "That sign-in link is invalid or expired. Please request a new one.";
  }

  if (message.includes("email not confirmed")) {
    return "Check your inbox and enter the sign-in code we sent.";
  }

  if (message.includes("redirect") || message.includes("callback")) {
    return "Auth redirect is not configured correctly. Check your allowed redirect URLs in Supabase.";
  }

  return error.message;
}

function slugifyUsernameCandidate(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  if (normalized.length >= 3) {
    return normalized.slice(0, 24);
  }

  return "member";
}

export function validateUsername(username: string) {
  const normalized = slugifyUsernameCandidate(username);

  if (!USERNAME_REGEX.test(normalized)) {
    throw new Error("Username must be 3-24 characters and use only lowercase letters, numbers, or _.");
  }

  return normalized;
}

async function readGuestSnapshot(userId: string): Promise<GuestSnapshot> {
  const client = assertClient();

  const [{ data: events, error: eventsError }, { data: persons, error: personsError }, { data: interactions, error: interactionsError }] =
    await Promise.all([
      client.from("events").select("*").eq("user_id", userId),
      client.from("persons").select("*").eq("user_id", userId),
      client.from("interactions").select("*").eq("user_id", userId),
    ]);

  if (eventsError || personsError || interactionsError) {
    throw new Error(eventsError?.message || personsError?.message || interactionsError?.message || "Failed to read guest data.");
  }

  return {
    events: events || [],
    persons: persons || [],
    interactions: interactions || [],
  };
}

async function importGuestSnapshot(targetUserId: string, snapshot: GuestSnapshot) {
  const client = assertClient();
  const eventIdMap = new Map<string, string>();
  const personIdMap = new Map<string, string>();

  for (const event of snapshot.events) {
    const { data, error } = await client
      .from("events")
      .insert({
        user_id: targetUserId,
        name: event.name,
        category: event.category,
      })
      .select("id")
      .single();

    if (error || !data?.id) {
      throw new Error(error?.message || "Failed to import events.");
    }

    eventIdMap.set(event.id, data.id);
  }

  for (const person of snapshot.persons) {
    const { data, error } = await client
      .from("persons")
      .insert({
        user_id: targetUserId,
        name: person.name,
        company: person.company,
        is_vip: person.is_vip,
        linkedin_url: person.linkedin_url,
        phone_number: person.phone_number,
        photo_url: person.photo_url,
        priority: person.priority,
        tags: person.tags,
      })
      .select("id")
      .single();

    if (error || !data?.id) {
      throw new Error(error?.message || "Failed to import contacts.");
    }

    personIdMap.set(person.id, data.id);
  }

  for (const interaction of snapshot.interactions) {
    const mappedPersonId = personIdMap.get(interaction.person_id);
    if (!mappedPersonId) {
      continue;
    }

    const mappedEventId = interaction.event_id ? eventIdMap.get(interaction.event_id) || null : null;
    const { error } = await client.from("interactions").insert({
      user_id: targetUserId,
      person_id: mappedPersonId,
      event_id: mappedEventId,
      raw_note: interaction.raw_note,
    });

    if (error) {
      throw new Error(error.message);
    }
  }
}

async function getPendingUpgradePayload() {
  const raw = await storageGetItem(PENDING_UPGRADE_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as PendingUpgradePayload;
  } catch {
    await storageRemoveItem(PENDING_UPGRADE_STORAGE_KEY);
    return null;
  }
}

async function stashPendingUpgrade(payload: PendingUpgradePayload) {
  await storageSetItem(PENDING_UPGRADE_STORAGE_KEY, JSON.stringify(payload));
}

async function clearPendingUpgrade() {
  await storageRemoveItem(PENDING_UPGRADE_STORAGE_KEY);
}

async function prepareGuestUpgrade(guestUserId?: string | null) {
  if (!guestUserId) {
    return;
  }

  const snapshot = await readGuestSnapshot(guestUserId);
  await stashPendingUpgrade({ guestUserId, snapshot });
}

function readAuthRedirectParams() {
  if (typeof window === "undefined") {
    return null;
  }

  const url = new URL(window.location.href);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  const code = url.searchParams.get("code");
  const errorDescription = url.searchParams.get("error_description") || url.searchParams.get("error");

  return { url, tokenHash, type, code, errorDescription };
}

function clearAuthRedirectParams() {
  if (typeof window === "undefined") {
    return;
  }

  const url = new URL(window.location.href);
  ["code", "token_hash", "type", "error", "error_description"].forEach((key) => {
    url.searchParams.delete(key);
  });
  window.history.replaceState({}, document.title, url.toString());
}

export async function signInAsGuest() {
  const client = assertClient();
  const { error } = await client.auth.signInAnonymously();

  if (error) {
    throw new Error(normalizeAuthError(error));
  }
}

export async function sendEmailCode(email: string) {
  const client = assertClient();
  const normalizedEmail = email.trim().toLowerCase();

  if (!normalizedEmail || !normalizedEmail.includes("@")) {
    throw new Error("Enter a valid email address.");
  }

  const { error } = await client.auth.signInWithOtp({
    email: normalizedEmail,
    options: {
      shouldCreateUser: true,
    },
  });

  if (error) {
    throw new Error(normalizeAuthError(error));
  }
}

export async function verifyEmailCode(email: string, code: string) {
  const client = assertClient();
  const normalizedEmail = email.trim().toLowerCase();
  const normalizedCode = code.replace(/\s+/g, "");

  if (!normalizedEmail || !normalizedEmail.includes("@")) {
    throw new Error("Enter a valid email address.");
  }

  if (!normalizedCode) {
    throw new Error("Enter the code from your email.");
  }

  const { error } = await client.auth.verifyOtp({
    email: normalizedEmail,
    token: normalizedCode,
    type: "email",
  });

  if (error) {
    throw new Error(normalizeAuthError(error));
  }
}

export async function signInWithGoogle() {
  const client = assertClient();

  if (!authRedirectUrl) {
    throw new Error("Missing EXPO_PUBLIC_AUTH_REDIRECT_URL. Set it to your app URL before using Google sign-in.");
  }

  const { error } = await client.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: authRedirectUrl,
      scopes: "openid email profile",
    },
  });

  if (error) {
    throw new Error(normalizeAuthError(error));
  }
}

export async function completeAuthRedirect() {
  const client = assertClient();

  if (Platform.OS !== "web") {
    return { handled: false, error: null as string | null };
  }

  const params = readAuthRedirectParams();
  if (!params) {
    return { handled: false, error: null as string | null };
  }

  const { tokenHash, type, code, errorDescription } = params;

  if (errorDescription) {
    clearAuthRedirectParams();
    return { handled: true, error: errorDescription };
  }

  try {
    if (tokenHash && type === "email") {
      const { error } = await client.auth.verifyOtp({
        token_hash: tokenHash,
        type: "email",
      });

      if (error) {
        throw error;
      }

      clearAuthRedirectParams();
      return { handled: true, error: null as string | null };
    }

    if (code) {
      const { error } = await client.auth.exchangeCodeForSession(code);
      if (error) {
        throw error;
      }

      clearAuthRedirectParams();
      return { handled: true, error: null as string | null };
    }

    return { handled: false, error: null as string | null };
  } catch (error) {
    clearAuthRedirectParams();
    return {
      handled: true,
      error: error instanceof Error ? normalizeAuthError(error) : "Could not complete the sign-in flow.",
    };
  }
}

export async function getCurrentUsername(userId: string) {
  const client = assertClient();
  const { data, error } = await client.from("profiles").select("username").eq("user_id", userId).maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data?.username || null;
}

export async function ensureProfileForUser(user: User) {
  const client = assertClient();
  const existingUsername = await getCurrentUsername(user.id);
  if (existingUsername) {
    return existingUsername;
  }

  const candidateSources = [
    user.user_metadata?.preferred_username,
    user.user_metadata?.user_name,
    user.user_metadata?.name,
    user.user_metadata?.full_name,
    typeof user.email === "string" ? user.email.split("@")[0] : null,
  ];

  const base = validateUsername(candidateSources.find((value) => typeof value === "string" && value.trim().length > 0) || "member");

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const suffix = attempt === 0 ? "" : `_${Math.floor(Math.random() * 900 + 100)}`;
    const username = validateUsername(`${base}${suffix}`.slice(0, 24));
    const { error } = await client.from("profiles").insert({ user_id: user.id, username, email: user.email || null });

    if (!error) {
      return username;
    }

    if (!error.message.toLowerCase().includes("duplicate") && !error.message.toLowerCase().includes("unique")) {
      throw new Error(error.message);
    }
  }

  throw new Error("Could not generate a username for this account. Please try again.");
}

export async function finalizeGuestUpgrade(user: User) {
  if (user.is_anonymous) {
    return false;
  }

  const pending = await getPendingUpgradePayload();
  if (!pending) {
    return false;
  }

  if (pending.guestUserId === user.id) {
    await clearPendingUpgrade();
    return false;
  }

  await importGuestSnapshot(user.id, pending.snapshot);
  await clearPendingUpgrade();
  return true;
}

export async function signOutCurrentUser() {
  const client = assertClient();
  const { error } = await client.auth.signOut();
  if (error) {
    throw new Error(error.message);
  }
}
