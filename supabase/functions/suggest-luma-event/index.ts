const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type CalendarEvent = {
  name: string;
  startsAt: string;
  endsAt: string | null;
  location: string | null;
  sourceUrl: string | null;
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

function normalizeFeedUrl(value: string) {
  const trimmed = value.trim();
  const candidate = trimmed.startsWith("webcal://") ? `https://${trimmed.slice("webcal://".length)}` : trimmed;
  const url = new URL(candidate);

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Paste a valid public Luma or calendar URL.");
  }

  return url.toString();
}

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function unfoldIcs(value: string) {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n[ \t]/g, "");
}

function unescapeIcsValue(value: string) {
  return value
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\")
    .trim();
}

function readIcsValue(block: string, key: string) {
  const pattern = new RegExp(`^${key}(?:;[^:]*)?:(.*)$`, "im");
  const match = block.match(pattern);
  return match ? unescapeIcsValue(match[1]) : "";
}

function parseIcsDate(value: string) {
  const raw = value.trim();
  if (!raw) {
    return null;
  }

  const dateOnly = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (dateOnly) {
    const [, year, month, day] = dateOnly;
    return new Date(Number(year), Number(month) - 1, Number(day), 12, 0, 0);
  }

  const dateTime = raw.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/);
  if (!dateTime) {
    return null;
  }

  const [, year, month, day, hour, minute, second = "00", utc] = dateTime;
  if (utc) {
    return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)));
  }

  return new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
}

function toDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseIcsEvents(icsText: string): CalendarEvent[] {
  const unfolded = unfoldIcs(icsText);
  const blocks = unfolded.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) || [];

  return blocks
    .map((block) => {
      const name = readIcsValue(block, "SUMMARY");
      const startsAt = parseIcsDate(readIcsValue(block, "DTSTART"));
      const explicitEnd = parseIcsDate(readIcsValue(block, "DTEND"));

      if (!name || !startsAt || Number.isNaN(startsAt.getTime())) {
        return null;
      }

      const fallbackEnd = new Date(startsAt.getTime() + 2 * 60 * 60 * 1000);
      const endsAt = explicitEnd && !Number.isNaN(explicitEnd.getTime()) ? explicitEnd : fallbackEnd;

      return {
        name,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        location: readIcsValue(block, "LOCATION") || null,
        sourceUrl: readIcsValue(block, "URL") || null,
      } satisfies CalendarEvent;
    })
    .filter((event): event is CalendarEvent => Boolean(event));
}

async function fetchText(url: string) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "BlackbookEventAssistant/1.0",
      Accept: "text/calendar,text/html,application/calendar+json,*/*",
    },
  });

  if (!response.ok) {
    throw new Error(`Could not read that Luma/calendar URL (${response.status}).`);
  }

  return response.text();
}

function findCalendarLinks(html: string, baseUrl: string) {
  const decoded = decodeHtml(html);
  const candidates = new Set<string>();
  const regexes = [
    /webcal:\/\/[^"' <>)]+/gi,
    /https?:\/\/[^"' <>)]+(?:\.ics|calendar|ical)[^"' <>)]+/gi,
    /href=["']([^"']*(?:\.ics|calendar|ical)[^"']*)["']/gi,
  ];

  for (const regex of regexes) {
    for (const match of decoded.matchAll(regex)) {
      const raw = match[1] || match[0];
      try {
        candidates.add(normalizeFeedUrl(new URL(raw, baseUrl).toString()));
      } catch {
        // Ignore malformed links.
      }
    }
  }

  return [...candidates].slice(0, 5);
}

async function resolveIcsText(url: string) {
  const normalizedUrl = normalizeFeedUrl(url);
  const firstText = await fetchText(normalizedUrl);

  if (/BEGIN:VCALENDAR/i.test(firstText)) {
    return { icsText: firstText, source: normalizedUrl, discovered: false };
  }

  const links = findCalendarLinks(firstText, normalizedUrl);
  for (const link of links) {
    const text = await fetchText(link);
    if (/BEGIN:VCALENDAR/i.test(text)) {
      return { icsText: text, source: link, discovered: true };
    }
  }

  throw new Error("Could not find a public calendar feed there. Paste your Luma iCal/subscription URL if the profile page does not work.");
}

function rankEvents(events: CalendarEvent[]) {
  const now = new Date();
  const today = toDateInputValue(now);
  const twoHoursFromNow = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  return events
    .filter((event) => {
      const start = new Date(event.startsAt);
      const end = event.endsAt ? new Date(event.endsAt) : new Date(start.getTime() + 2 * 60 * 60 * 1000);
      return end >= sevenDaysAgo && start <= new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
    })
    .map((event) => {
      const start = new Date(event.startsAt);
      const end = event.endsAt ? new Date(event.endsAt) : new Date(start.getTime() + 2 * 60 * 60 * 1000);
      const active = now >= start && now <= end;
      const startsSoon = start >= now && start <= twoHoursFromNow;
      const startsToday = toDateInputValue(start) === today;
      const upcomingDistance = Math.max(0, start.getTime() - now.getTime()) / (60 * 1000);
      const score =
        (active ? 100 : 0) +
        (startsSoon ? 80 : 0) +
        (startsToday ? 45 : 0) +
        (event.location ? 5 : 0) -
        upcomingDistance / 120;

      return { event, score, active, startsSoon };
    })
    .sort((a, b) => b.score - a.score);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const body = (await req.json()) as { url?: string };
    const url = clean(body.url);
    if (!url) {
      return json({ error: "Paste your public Luma calendar URL first." }, 400);
    }

    const resolved = await resolveIcsText(url);
    const events = parseIcsEvents(resolved.icsText);
    const ranked = rankEvents(events);

    if (!events.length) {
      return json({ error: "We found the calendar, but it did not contain any readable events." }, 404);
    }

    if (!ranked.length) {
      return json({ error: "We found events, but none look current or upcoming." }, 404);
    }

    const best = ranked[0];
    const start = new Date(best.event.startsAt);

    return json({
      event: {
        ...best.event,
        eventDate: toDateInputValue(start),
      },
      count: events.length,
      source: resolved.discovered ? "calendar-link-discovered" : "calendar-feed",
      isActiveNow: best.active,
      startsSoon: best.startsSoon,
    });
  } catch (error) {
    return json(
      {
        error: error instanceof Error ? error.message : "Could not check that Luma calendar.",
      },
      400
    );
  }
});
