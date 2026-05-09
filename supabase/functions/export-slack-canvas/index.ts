import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type RequestBody = {
  title?: string;
  markdown?: string;
  channelId?: string;
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

function cleanString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const slackBotToken = Deno.env.get("SLACK_BOT_TOKEN");
  const defaultChannelId = Deno.env.get("SLACK_CHANNEL_ID");

  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: "Missing Supabase service env vars." }, 500);
  }

  if (!slackBotToken) {
    return json({ error: "Missing SLACK_BOT_TOKEN." }, 500);
  }

  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();

  if (!token) {
    return json({ error: "Missing auth token." }, 401);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const { data: userResult, error: userError } = await supabase.auth.getUser(token);
  const userId = userResult?.user?.id;

  if (userError || !userId) {
    return json({ error: "Unauthorized." }, 401);
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("access_role,feature_flags")
    .eq("user_id", userId)
    .maybeSingle();

  if (profileError) {
    return json({ error: profileError.message }, 500);
  }

  const featureFlags = (profile?.feature_flags || {}) as Record<string, unknown>;
  const canExport = profile?.access_role === "admin" || featureFlags.directSlackCanvas === true;

  if (!canExport) {
    return json({ error: "Slack Canvas export is not enabled for this account." }, 403);
  }

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  const title = cleanString(body.title) || "Blackbook event summary";
  const markdown = cleanString(body.markdown);
  const channelId = cleanString(body.channelId) || defaultChannelId || "";

  if (!markdown) {
    return json({ error: "Missing markdown." }, 400);
  }

  if (!channelId) {
    return json({ error: "Missing SLACK_CHANNEL_ID." }, 500);
  }

  const response = await fetch("https://slack.com/api/conversations.canvases.create", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${slackBotToken}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      title,
      channel_id: channelId,
      document_content: {
        type: "markdown",
        markdown,
      },
    }),
  });

  const slackResult = await response.json().catch(() => null);

  if (!response.ok || !slackResult?.ok) {
    if (
      slackResult?.error === "channel_canvas_already_exists" ||
      slackResult?.error === "free_team_canvas_tab_already_exists"
    ) {
      return json({
        ok: true,
        alreadyExists: true,
        warning: slackResult.error,
      });
    }

    return json(
      {
        error: slackResult?.error || "slack_request_failed",
        details: slackResult,
      },
      502
    );
  }

  return json({
    ok: true,
    canvasId: slackResult.canvas_id,
  });
});
