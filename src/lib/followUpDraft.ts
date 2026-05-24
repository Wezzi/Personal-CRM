import {
  FunctionsFetchError,
  FunctionsHttpError,
  FunctionsRelayError,
} from "@supabase/supabase-js";

import { missingSupabaseEnvMessage, supabase } from "./supabase";
import { PreferredChannel } from "./crm";

export type GenerateFollowUpDraftInput = {
  name: string;
  company?: string | null;
  eventName?: string | null;
  whatMatters?: string | null;
  nextStep?: string | null;
  relationshipGoal?: string | null;
  relationshipStatus?: string | null;
  preferredChannel?: PreferredChannel | "";
  preferredChannelOther?: string | null;
  lastInteractionNote?: string | null;
};

export async function generateFollowUpDraft(input: GenerateFollowUpDraftInput) {
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
    throw new Error("No active session found. Please sign in again, then retry draft generation.");
  }

  const { data, error } = await supabase.functions.invoke("generate-follow-up-draft", {
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
    throw new Error(error.message || "Draft generation failed.");
  }

  const message = typeof data?.message === "string" ? data.message.trim() : "";
  if (!message) {
    throw new Error("Draft generation returned an empty message.");
  }

  return message;
}
