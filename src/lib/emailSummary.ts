 import { supabase } from "./supabase";

type EmailEventSummaryInput = {
  eventName: string;
  eventDate?: string | null;
};

export async function emailEventSummary(input: EmailEventSummaryInput) {
  if (!supabase) {
    throw new Error("Supabase is not configured.");
  }

  const { data, error } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (error || !token) {
    throw new Error(error?.message || "Sign in before emailing an event summary.");
  }

  const response = await fetch("/api/email-summary", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      eventName: input.eventName,
      eventDate: input.eventDate || null,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "Could not email this event summary.");
  }

  return payload as { ok: true; emailId?: string };
}
