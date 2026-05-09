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

async function callSlack(slackBotToken: string, method: string, body: Record<string, unknown>) {
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${slackBotToken}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });

  const result = await response.json().catch(() => null);
  return { response, result };
}

async function getChannelCanvasId(slackBotToken: string, channelId: string) {
  const { result } = await callSlack(slackBotToken, "conversations.info", {
    channel: channelId,
    include_num_members: false,
  });

  return result?.channel?.properties?.canvas?.file_id || result?.channel?.properties?.canvas?.id || null;
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

  const { response, result: slackResult } = await callSlack(slackBotToken, "conversations.canvases.create", {
    title,
    channel_id: channelId,
    document_content: {
      type: "markdown",
      markdown,
    },
  });

  if (!response.ok || !slackResult?.ok) {
    if (
      slackResult?.error === "channel_canvas_already_exists" ||
      slackResult?.error === "free_team_canvas_tab_already_exists"
    ) {
      const canvasId = await getChannelCanvasId(slackBotToken, channelId);

      if (canvasId) {
        const { response: editResponse, result: editResult } = await callSlack(slackBotToken, "canvases.edit", {
          canvas_id: canvasId,
          changes: [
            {
              operation: "replace",
              document_content: {
                type: "markdown",
                markdown,
              },
            },
          ],
        });

        if (editResponse.ok && editResult?.ok) {
          return json({
            ok: true,
            updated: true,
            canvasId,
          });
        }

        return json(
          {
            error: editResult?.error || "slack_canvas_update_failed",
            details: editResult,
          },
          502
        );
      }

      return json({
        ok: false,
        alreadyExists: true,
        warning: slackResult.error,
        error: "channel_canvas_already_exists",
        details: "Slack says this channel already has a canvas, but the function could not read its ID. Add channels:read to the Slack bot scopes, reinstall the app, then try again.",
      }, 409);
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
