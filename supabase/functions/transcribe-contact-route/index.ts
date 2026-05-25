const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
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

type ExtractedDraft = {
  name?: string;
  company?: string;
  event?: string;
  whatMatters?: string;
  nextStep?: string;
  tags?: string[];
};

function cleanOptional(value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function cleanTags(value: unknown) {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const allowed = new Set([
    "Business Opportunity",
    "Potential Client",
    "Meeting Booked",
    "Intro",
    "New Hire",
    "Partner",
    "Sponsor",
    "Interesting",
    "Other",
  ]);

  const tags = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => allowed.has(item));

  return tags.length ? Array.from(new Set(tags)).slice(0, 2) : undefined;
}

async function extractDraftFromTranscript(openaiApiKey: string, transcript: string): Promise<ExtractedDraft> {
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
                "You extract structured contact-capture fields from a short voice note made after meeting someone. " +
                "Only use information explicitly present in the transcript. " +
                "Do not guess LinkedIn URLs, phone numbers, or tags. " +
                "Keep 'whatMatters' concise and useful, like a one- or two-sentence memory aid. " +
                "Keep 'nextStep' to the specific promised action or follow-up, if any. " +
                "For 'tags', choose at most two outcome goals only when clearly implied. Use only: Business Opportunity, Potential Client, Meeting Booked, Intro, New Hire, Partner, Sponsor, Interesting, Other. " +
                "If a field is missing, return null.",
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `Transcript:\n${transcript}`,
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "contact_draft",
          strict: true,
          schema: {
            type: "object",
            properties: {
              name: {
                type: ["string", "null"],
                description: "The person's first name or full name if clearly stated.",
              },
              company: {
                type: ["string", "null"],
                description: "The company or organization if clearly stated.",
              },
              event: {
                type: ["string", "null"],
                description: "The event, conference, coffee chat, or meeting context if stated.",
              },
              whatMatters: {
                type: ["string", "null"],
                description: "A concise memory aid about what mattered in the conversation.",
              },
              nextStep: {
                type: ["string", "null"],
                description: "The specific promised next step or follow-up, if any.",
              },
              tags: {
                type: ["array", "null"],
                items: {
                  type: "string",
                  enum: ["Business Opportunity", "Potential Client", "Meeting Booked", "Intro", "New Hire", "Partner", "Sponsor", "Interesting", "Other"],
                },
                description: "Outcome goal labels clearly implied by the transcript.",
              },
            },
            required: ["name", "company", "event", "whatMatters", "nextStep", "tags"],
            additionalProperties: false,
          },
        },
      },
    }),
  });

  const raw = await response.text();

  if (!response.ok) {
    throw new Error(`OpenAI extraction failed: ${raw}`);
  }

  const payload = JSON.parse(raw);
  const outputText =
    payload.output_text ||
    payload.output?.find?.((item: any) => item.type === "message")?.content?.find?.((c: any) => c.type === "output_text")?.text ||
    "";

  if (!outputText) {
    throw new Error("OpenAI extraction returned no structured output.");
  }

  const parsed = JSON.parse(outputText);

  return {
    name: cleanOptional(parsed.name),
    company: cleanOptional(parsed.company),
    event: cleanOptional(parsed.event),
    whatMatters: cleanOptional(parsed.whatMatters),
    nextStep: cleanOptional(parsed.nextStep),
    tags: cleanTags(parsed.tags),
  };
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
    const formData = await req.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return json({ error: "Expected a File under form key 'file'" }, 400);
    }

    const transcriptionPrompt =
      "This is a short voice note captured after meeting someone at an event. " +
      "Transcribe clearly, preserving names, company names, event names, and promises or next steps if spoken.";

    const openAiForm = new FormData();
    openAiForm.append("file", file, file.name || "audio.webm");
    openAiForm.append("model", "gpt-4o-mini-transcribe");
    openAiForm.append("response_format", "json");
    openAiForm.append("prompt", transcriptionPrompt);

    const transcriptionRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiApiKey}`,
      },
      body: openAiForm,
    });

    const transcriptionRaw = await transcriptionRes.text();

    if (!transcriptionRes.ok) {
      return json(
        {
          error: "OpenAI transcription failed",
          details: transcriptionRaw,
        },
        500
      );
    }

    const transcriptionJson = JSON.parse(transcriptionRaw);
    const transcript = transcriptionJson.text || transcriptionJson.transcript || "";

    if (!transcript.trim()) {
      return json(
        {
          error: "Transcription returned empty text.",
        },
        500
      );
    }

    const draft = await extractDraftFromTranscript(openaiApiKey, transcript);

    return json({
      transcript,
      draft: {
        ...draft,
        whatMatters: draft.whatMatters || transcript,
      },
    });
  } catch (error) {
    return json(
      {
        error: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
});
