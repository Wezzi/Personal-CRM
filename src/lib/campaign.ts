import { EventCategory } from "./crm";

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function getBaseUrl() {
  if (typeof window === "undefined") {
    return "";
  }

  return window.location.origin;
}

export function buildCampaignPath(input: { name: string; slug?: string | null }) {
  const slug = input.slug?.trim() || slugify(input.name);
  return `/e/${slug || "event"}`;
}

export function buildCampaignUrl(input: {
  name: string;
  category?: EventCategory | string | null;
  eventDate?: string | null;
  slug?: string | null;
}) {
  const path = buildCampaignPath({ name: input.name, slug: input.slug });
  const params = new URLSearchParams();

  if (input.name.trim()) {
    params.set("event_name", input.name.trim());
  }

  if (input.category) {
    params.set("event_category", input.category);
  }

  if (input.eventDate?.trim()) {
    params.set("event_date", input.eventDate.trim());
  }

  const query = params.toString();
  return `${getBaseUrl()}${path}${query ? `?${query}` : ""}`;
}
