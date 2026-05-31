const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type SearchRequest = {
  name?: string;
  company?: string | null;
  eventName?: string | null;
};

type SerperResult = {
  title?: string;
  link?: string;
  snippet?: string;
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

function buildQuery(input: SearchRequest) {
  const name = clean(input.name);
  const company = clean(input.company);
  const eventName = clean(input.eventName);
  const quotedParts = [name, company, eventName].filter(Boolean).map((part) => `"${part.replace(/"/g, "")}"`);

  return ["site:linkedin.com/in", ...quotedParts].join(" ").trim();
}

function normalizeLinkedInUrl(value: string) {
  const url = value.trim();
  if (!url) {
    return "";
  }

  return url.startsWith("http") ? url : `https://${url.replace(/^\/+/, "")}`;
}

function isLikelyLinkedInProfile(url: string) {
  return /^https?:\/\/([a-z]{2,3}\.)?(www\.)?linkedin\.com\/in\//i.test(url);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const serperApiKey = Deno.env.get("SERPER_API_KEY");
  if (!serperApiKey) {
    return json({ error: "Missing SERPER_API_KEY secret" }, 500);
  }

  try {
    const body = (await req.json()) as SearchRequest;
    const query = buildQuery(body);

    if (!clean(body.name)) {
      return json({ error: "Name is required for LinkedIn search." }, 400);
    }

    const response = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "X-API-KEY": serperApiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        q: query,
        num: 5,
      }),
    });

    const raw = await response.text();

    if (!response.ok) {
      return json({ error: "Serper search failed", details: raw }, 502);
    }

    const payload = JSON.parse(raw);
    const organic = Array.isArray(payload.organic) ? payload.organic as SerperResult[] : [];
    const seen = new Set<string>();
    const matches = organic
      .map((result) => ({
        title: clean(result.title),
        url: normalizeLinkedInUrl(clean(result.link)),
        snippet: clean(result.snippet),
      }))
      .filter((result) => result.title && result.url && isLikelyLinkedInProfile(result.url))
      .filter((result) => {
        if (seen.has(result.url)) {
          return false;
        }

        seen.add(result.url);
        return true;
      })
      .slice(0, 3);

    return json({ query, matches });
  } catch (error) {
    return json(
      {
        error: error instanceof Error ? error.message : "Unknown search error",
      },
      500
    );
  }
});
