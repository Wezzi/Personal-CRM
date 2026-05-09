import { FunctionsHttpError } from "@supabase/supabase-js";

import { missingSupabaseEnvMessage, supabase } from "./supabase";

export async function exportSlackCanvas(input: { title: string; markdown: string }) {
  if (!supabase) {
    throw new Error(missingSupabaseEnvMessage);
  }

  const { data: sessionResult, error: sessionError } = await supabase.auth.getSession();
  const token = sessionResult.session?.access_token;

  if (sessionError || !token) {
    throw new Error("Sign in again before exporting to Slack.");
  }

  const { data, error } = await supabase.functions.invoke("export-slack-canvas", {
    body: input,
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (error instanceof FunctionsHttpError) {
    let details = "Slack Canvas export failed.";
    try {
      const body = await error.context.json();
      details = body?.error || body?.details || JSON.stringify(body);
    } catch {
      try {
        details = await error.context.text();
      } catch {
        details = error.message;
      }
    }
    throw new Error(details);
  }

  if (error) {
    throw new Error(error.message);
  }

  return data as { ok: boolean; canvasId?: string; alreadyExists?: boolean; updated?: boolean; warning?: string };
}
