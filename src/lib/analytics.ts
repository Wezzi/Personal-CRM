import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

type AnalyticsProperties = Record<string, string | number | boolean | null | undefined>;

export type InviteAttribution = {
  eventSource?: string;
  eventName?: string;
  eventCategory?: string;
  eventDate?: string;
  userRole?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
};

const POSTHOG_KEY = process.env.EXPO_PUBLIC_POSTHOG_KEY;
const POSTHOG_HOST = process.env.EXPO_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com";
const ATTRIBUTION_STORAGE_KEY = "blackbook.analytics_attribution";

let posthogPromise: Promise<typeof import("posthog-js").default | null> | null = null;

function cleanProperties(properties: AnalyticsProperties = {}) {
  return Object.fromEntries(
    Object.entries(properties).filter(([, value]) => value !== undefined && value !== "")
  );
}

function normalizeAttribution(raw: InviteAttribution): InviteAttribution {
  return cleanProperties(raw) as InviteAttribution;
}

function getEventSlugFromPath() {
  if (Platform.OS !== "web" || typeof window === "undefined") {
    return undefined;
  }

  const match = window.location.pathname.match(/^\/e\/([^/?#]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

async function getPostHog() {
  if (Platform.OS !== "web" || !POSTHOG_KEY) {
    return null;
  }

  if (!posthogPromise) {
    posthogPromise = import("posthog-js")
      .then(({ default: posthog }) => {
        posthog.init(POSTHOG_KEY, {
          api_host: POSTHOG_HOST,
          defaults: "2026-01-30",
          autocapture: false,
          capture_pageview: false,
          disable_session_recording: false,
          session_recording: {
            maskAllInputs: true,
          },
        } as Parameters<typeof posthog.init>[1]);

        return posthog;
      })
      .catch(() => null);
  }

  return posthogPromise;
}

export async function initAnalytics() {
  await getPostHog();
}

export async function captureInviteAttributionFromUrl() {
  if (Platform.OS !== "web" || typeof window === "undefined") {
    return getStoredInviteAttribution();
  }

  const params = new URLSearchParams(window.location.search);
  const pathEventSlug = getEventSlugFromPath();
  const attribution = normalizeAttribution({
    eventSource:
      params.get("event_source") ||
      params.get("event") ||
      params.get("event_slug") ||
      params.get("source") ||
      pathEventSlug ||
      undefined,
    eventName: params.get("event_name") || params.get("eventName") || params.get("name") || undefined,
    eventCategory: params.get("event_category") || params.get("eventCategory") || undefined,
    eventDate: params.get("event_date") || params.get("eventDate") || undefined,
    userRole: params.get("user_role") || params.get("role") || undefined,
    utmSource: params.get("utm_source") || undefined,
    utmMedium: params.get("utm_medium") || undefined,
    utmCampaign: params.get("utm_campaign") || undefined,
  });

  if (Object.keys(attribution).length) {
    await AsyncStorage.setItem(ATTRIBUTION_STORAGE_KEY, JSON.stringify(attribution));
    return attribution;
  }

  return getStoredInviteAttribution();
}

export async function getStoredInviteAttribution(): Promise<InviteAttribution> {
  const raw = await AsyncStorage.getItem(ATTRIBUTION_STORAGE_KEY);
  if (!raw) {
    return {};
  }

  try {
    return normalizeAttribution(JSON.parse(raw) as InviteAttribution);
  } catch {
    await AsyncStorage.removeItem(ATTRIBUTION_STORAGE_KEY);
    return {};
  }
}

export async function identifyAnalyticsUser(userId: string, properties: AnalyticsProperties = {}) {
  const posthog = await getPostHog();
  if (!posthog) {
    return;
  }

  const attribution = await getStoredInviteAttribution();
  posthog.identify(userId, {
    ...cleanProperties({
      ...properties,
      event_source: attribution.eventSource,
      event_name: attribution.eventName,
      event_category: attribution.eventCategory,
      event_date: attribution.eventDate,
      user_role: attribution.userRole,
      utm_source: attribution.utmSource,
      utm_medium: attribution.utmMedium,
      utm_campaign: attribution.utmCampaign,
    }),
  });
}

export async function captureAnalyticsEvent(name: string, properties: AnalyticsProperties = {}) {
  const posthog = await getPostHog();
  if (!posthog) {
    return;
  }

  const attribution = await getStoredInviteAttribution();
  posthog.capture(name, {
    ...cleanProperties({
      ...properties,
      event_source: attribution.eventSource,
      event_name: attribution.eventName,
      event_category: attribution.eventCategory,
      event_date: attribution.eventDate,
      user_role: attribution.userRole,
      utm_source: attribution.utmSource,
      utm_medium: attribution.utmMedium,
      utm_campaign: attribution.utmCampaign,
    }),
  });
}

export async function resetAnalyticsUser() {
  const posthog = await getPostHog();
  posthog?.reset();
}
