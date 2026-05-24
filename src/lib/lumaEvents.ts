import {
  FunctionsFetchError,
  FunctionsHttpError,
  FunctionsRelayError,
} from "@supabase/supabase-js";

import { missingSupabaseEnvMessage, supabase } from "./supabase";

export type LumaSuggestedEvent = {
  name: string;
  eventDate: string;
  startsAt: string;
  endsAt: string | null;
  location: string | null;
  sourceUrl: string | null;
};

export type LumaEventSuggestion = {
  event: LumaSuggestedEvent;
  count: number;
  source: "calendar-feed" | "calendar-link-discovered";
  isActiveNow: boolean;
  startsSoon: boolean;
};

export async function suggestLumaEvent(url: string): Promise<LumaEventSuggestion> {
  if (!supabase) {
    throw new Error(missingSupabaseEnvMessage);
  }

  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();

  if (sessionError) {
    throw new Error(sessionError.message || "Could not read auth session.");
  }

  if (!session?.access_token) {
    throw new Error("No active session found. Please sign in again, then retry Luma detection.");
  }

  const { data, error } = await supabase.functions.invoke("suggest-luma-event", {
    body: { url },
    headers: {
      Authorization: `Bearer ${session.access_token}`,
    },
  });

  if (error instanceof FunctionsHttpError) {
    let details = "Function returned an HTTP error.";
    try {
      const body = await error.context.json();
      details = body?.details || body?.error || JSON.stringify(body);
    } catch {
      try {
        details = await error.context.text();
      } catch {
        details = error.message;
      }
    }
    throw new Error(details);
  }

  if (error instanceof FunctionsRelayError) {
    throw new Error(`Relay error: ${error.message}`);
  }

  if (error instanceof FunctionsFetchError) {
    throw new Error(`Fetch error: ${error.message}`);
  }

  if (error) {
    throw new Error(error.message || "Luma event detection failed.");
  }

  if (!data?.event?.name || !data?.event?.eventDate) {
    throw new Error("Luma event detection did not return an event.");
  }

  return data as LumaEventSuggestion;
}
