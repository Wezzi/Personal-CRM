import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type PersonRow = {
  id: string;
  user_id: string;
  name: string | null;
  company: string | null;
  next_follow_up_at: string | null;
};

type InteractionRow = {
  person_id: string;
  raw_note: string;
  created_at: string;
  events?: { name: string } | Array<{ name: string }> | null;
};

type DueFollowUp = {
  personName: string;
  company: string | null;
  eventName: string | null;
  nextStep: string;
  followUpDate: string;
  state: "dueToday" | "overdue";
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function toDateOnlyString(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function extractFollowUpDate(rawNote: string) {
  const explicitMatch = rawNote.match(/^Follow\s*up\s*date:\s*(\d{4}-\d{2}-\d{2})$/im);
  return explicitMatch?.[1] || null;
}

function extractNextStep(rawNote: string) {
  const match = rawNote.match(/^Next\s*step:\s*(.+)$/im);
  return match?.[1]?.trim() || "Follow up";
}

function latestDueItems(people: PersonRow[], interactions: InteractionRow[], today: string) {
  const latestByPerson = new Map<string, InteractionRow>();

  interactions.forEach((interaction) => {
    const current = latestByPerson.get(interaction.person_id);
    if (!current || interaction.created_at > current.created_at) {
      latestByPerson.set(interaction.person_id, interaction);
    }
  });

  return people.flatMap((person): DueFollowUp[] => {
    const latest = latestByPerson.get(person.id);
    if (!latest) {
      return [];
    }

    const followUpDate = person.next_follow_up_at || extractFollowUpDate(latest.raw_note);
    if (!followUpDate || followUpDate > today) {
      return [];
    }

    return [
      {
        personName: person.name || "Unknown contact",
        company: person.company,
        eventName: Array.isArray(latest.events)
          ? latest.events[0]?.name || null
          : latest.events?.name || null,
        nextStep: extractNextStep(latest.raw_note),
        followUpDate,
        state: followUpDate === today ? "dueToday" : "overdue",
      },
    ];
  });
}

function buildEmailHtml(items: DueFollowUp[], appUrl: string) {
  const rows = items
    .slice(0, 12)
    .map((item) => {
      const meta = [item.company, item.eventName].filter(Boolean).join(" · ");
      const label = item.state === "overdue" ? `Overdue since ${item.followUpDate}` : "Due today";
      return `
        <li style="margin-bottom:16px;">
          <strong>${escapeHtml(item.personName)}</strong>
          ${meta ? `<br><span style="color:#64748B;">${escapeHtml(meta)}</span>` : ""}
          <br><span>${escapeHtml(item.nextStep)}</span>
          <br><span style="color:${item.state === "overdue" ? "#DC2626" : "#059669"};">${label}</span>
        </li>
      `;
    })
    .join("");

  return `
    <div style="font-family:Inter,Arial,sans-serif;line-height:1.5;color:#0F172A;">
      <h2>Your Blackbook follow-ups</h2>
      <p>You have ${items.length} ${items.length === 1 ? "person" : "people"} needing attention today.</p>
      <ul style="padding-left:20px;">${rows}</ul>
      <p><a href="${appUrl}" style="background:#10B981;color:white;padding:10px 14px;border-radius:8px;text-decoration:none;">Open Blackbook</a></p>
    </div>
  `;
}

function buildEmailText(items: DueFollowUp[], appUrl: string) {
  const lines = items.slice(0, 12).map((item) => {
    const meta = [item.company, item.eventName].filter(Boolean).join(" · ");
    const label = item.state === "overdue" ? `Overdue since ${item.followUpDate}` : "Due today";
    return `- ${item.personName}${meta ? ` (${meta})` : ""}: ${item.nextStep} — ${label}`;
  });

  return [`Your Blackbook follow-ups`, "", `You have ${items.length} people needing attention today.`, "", ...lines, "", appUrl].join("\n");
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function sendEmail(input: { to: string; from: string; subject: string; html: string; text: string }) {
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  if (!resendApiKey) {
    throw new Error("Missing RESEND_API_KEY.");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const cronSecret = Deno.env.get("REMINDER_DIGEST_SECRET");
  if (cronSecret && req.headers.get("x-cron-secret") !== cronSecret) {
    return json({ error: "Unauthorized" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const appUrl = Deno.env.get("APP_PUBLIC_URL") || "https://personal-crm-ruddy.vercel.app";
  const from = Deno.env.get("REMINDER_EMAIL_FROM") || "Blackbook <hello@blackbookpulse.com>";
  const today = toDateOnlyString(new Date());

  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: "Missing Supabase service env vars." }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const { data: preferences, error: preferencesError } = await supabase
    .from("reminder_preferences")
    .select("user_id,last_digest_sent_on")
    .eq("email_digest_enabled", true);

  if (preferencesError) {
    return json({ error: preferencesError.message }, 500);
  }

  const results: Array<{ userId: string; sent: boolean; count?: number; error?: string }> = [];

  for (const preference of preferences || []) {
    if (preference.last_digest_sent_on === today) {
      results.push({ userId: preference.user_id, sent: false, error: "Already sent today" });
      continue;
    }

    const [{ data: userResult }, { data: people }, { data: interactions, error: interactionsError }] = await Promise.all([
      supabase.auth.admin.getUserById(preference.user_id),
      supabase.from("persons").select("id,user_id,name,company,next_follow_up_at").eq("user_id", preference.user_id),
      supabase
        .from("interactions")
        .select("person_id,raw_note,created_at,events(name)")
        .eq("user_id", preference.user_id)
        .order("created_at", { ascending: false }),
    ]);

    const email = userResult?.user?.email;
    if (!email) {
      results.push({ userId: preference.user_id, sent: false, error: "No email" });
      continue;
    }

    if (interactionsError) {
      results.push({ userId: preference.user_id, sent: false, error: interactionsError.message });
      continue;
    }

    const items = latestDueItems((people || []) as PersonRow[], (interactions || []) as unknown as InteractionRow[], today);
    if (!items.length) {
      results.push({ userId: preference.user_id, sent: false, count: 0 });
      continue;
    }

    try {
      await sendEmail({
        to: email,
        from,
        subject: `Blackbook: ${items.length} follow-up${items.length === 1 ? "" : "s"} need attention`,
        html: buildEmailHtml(items, appUrl),
        text: buildEmailText(items, appUrl),
      });

      await supabase
        .from("reminder_preferences")
        .update({ last_digest_sent_on: today })
        .eq("user_id", preference.user_id);

      results.push({ userId: preference.user_id, sent: true, count: items.length });
    } catch (error) {
      results.push({
        userId: preference.user_id,
        sent: false,
        error: error instanceof Error ? error.message : "Email failed",
      });
    }
  }

  return json({
    date: today,
    checked: preferences?.length || 0,
    sent: results.filter((result) => result.sent).length,
    results,
  });
});
