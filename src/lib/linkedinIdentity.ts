import {
  FunctionsFetchError,
  FunctionsHttpError,
  FunctionsRelayError,
} from "@supabase/supabase-js";

import { missingSupabaseEnvMessage, supabase } from "./supabase";

export type LinkedInIdentityMatch = {
  title: string;
  url: string;
  snippet: string;
};

export type LinkedInIdentitySearchInput = {
  name: string;
  company?: string | null;
  eventName?: string | null;
};

export async function searchLinkedInProfiles(input: LinkedInIdentitySearchInput) {
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
    throw new Error("No active session found. Please sign in again, then retry LinkedIn search.");
  }

  const { data, error } = await supabase.functions.invoke("search-linkedin-profile", {
    body: input,
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
    throw new Error(error.message || "LinkedIn search failed.");
  }

  return {
    query: typeof data?.query === "string" ? data.query : "",
    matches: Array.isArray(data?.matches) ? data.matches as LinkedInIdentityMatch[] : [],
  };
}
