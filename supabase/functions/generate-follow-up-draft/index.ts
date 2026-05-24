const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type DraftChannel = "whatsapp" | "linkedin" | "email" | "phone" | "other" | "";

type DraftRequest = {
  name?: string;
  company?: string | null;
  eventName?: string | null;
  whatMatters?: string | null;
  nextStep?: string | null;
  relationshipGoal?: string | null;
  relationshipStatus?: string | null;
  preferredChannel?: DraftChannel;
  preferredChannelOther?: string | null;
  lastInteractionNote?: string | null;
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

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function getChannelInstruction(channel: DraftChannel, other?: string | null) {
  if (channel === "whatsapp" || channel === "phone") {
    return "Write a short, warm mobile message. 1-3 sentences. No subject line. No sign-off unless it sounds natural.";
  }

  if (channel === "linkedin") {
    return "Write a polished LinkedIn DM. 2-4 sentences. Warm, professional, and not salesy. No email formatting.";
  }

  if (channel === "email") {
    return "Write a concise email with a subject line and body. Keep it warm, structured, and easy to send.";
  }

  if (channel === "other" && clean(other)) {
    return `Write for ${clean(other)}. Keep it natural for that channel and concise.`;
  }

  return "Write a concise, warm follow-up message. Avoid sounding like a CRM template.";
}

async function generateDraft(openaiApiKey: string, input: DraftRequest) {
  const channel = input.preferredChannel || "";
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openaiApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text:
                "You write follow-up messages for Blackbook, an event memory assistant. " +
                "Use only the context provided. Do not invent facts, promises, companies, meetings, or personal details. " +
                "Sound human, specific, warm, and low-friction. Avoid corporate CRM language. " +
                "If context is thin, keep the message simple instead of overreaching. " +
                getChannelInstruction(channel, input.preferredChannelOther),
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: JSON.stringify(
                {
                  name: clean(input.name) || "there",
                  company: clean(input.company),
                  eventName: clean(input.eventName),
                  whatMatters: clean(input.whatMatters),
                  nextStep: clean(input.nextStep),
                  relationshipGoal: clean(input.relationshipGoal),
                  relationshipStatus: clean(input.relationshipStatus),
                  preferredChannel: channel,
                  lastInteractionNote: clean(input.lastInteractionNote),
                },
                null,
                2
              ),
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "follow_up_draft",
          strict: true,
          schema: {
            type: "object",
            properties: {
              message: {
                type: "string",
                description: "The ready-to-send follow-up message.",
              },
            },
            required: ["message"],
            additionalProperties: false,
          },
        },
      },
    }),
  });

  const raw = await response.text();

  if (!response.ok) {
    throw new Error(`OpenAI draft generation failed: ${raw}`);
  }

  const payload = JSON.parse(raw);
  const outputText =
    payload.output_text ||
    payload.output?.find?.((item: any) => item.type === "message")?.content?.find?.((c: any) => c.type === "output_text")?.text ||
    "";

  if (!outputText) {
    throw new Error("OpenAI draft generation returned no structured output.");
  }

  const parsed = JSON.parse(outputText);
  const message = clean(parsed.message);

  if (!message) {
    throw new Error("OpenAI draft generation returned an empty message.");
  }

  return message;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const openaiApiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openaiApiKey) {
    return json({ error: "Missing OPENAI_API_KEY secret" }, 500);
  }

  try {
    const body = (await req.json()) as DraftRequest;
    const message = await generateDraft(openaiApiKey, body);
    return json({ message });
  } catch (error) {
    return json(
      {
        error: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
});
