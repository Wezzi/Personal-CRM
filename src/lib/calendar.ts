import { Alert, Linking, Platform } from "react-native";
import * as Calendar from "expo-calendar";

export type CalendarFollowUpInput = {
  name: string;
  company?: string | null;
  nextFollowUpAt: string;
  whatMatters?: string | null;
  nextStep?: string | null;
  linkedinUrl?: string | null;
};

export type CalendarDestination = "device" | "google" | "outlook" | "yahoo" | "ics";

export function getAvailableCalendarDestinations(): Array<{
  value: CalendarDestination;
  label: string;
  description: string;
}> {
  const options: Array<{ value: CalendarDestination; label: string; description: string }> = [];

  if (Platform.OS !== "web") {
    options.push({
      value: "device",
      label: "Device calendar",
      description: "Adds the follow-up to the calendar app on this phone.",
    });
  }

  options.push(
    {
      value: "google",
      label: "Google Calendar",
      description: "Opens Google Calendar with the event prefilled.",
    },
    {
      value: "outlook",
      label: "Outlook Calendar",
      description: "Opens Outlook Calendar with the event prefilled.",
    },
    {
      value: "yahoo",
      label: "Yahoo Calendar",
      description: "Opens Yahoo Calendar with the event prefilled.",
    }
  );

  if (Platform.OS === "web") {
    options.push({
      value: "ics",
      label: "Download .ics",
      description: "Downloads a calendar file you can import anywhere.",
    });
  }

  return options;
}

function parseFollowUpDate(dateOnly: string): Date {
  const [year, month, day] = dateOnly.split("-").map((value) => Number(value));

  if (!year || !month || !day) {
    throw new Error("The saved follow-up date is invalid.");
  }

  return new Date(year, month - 1, day, 10, 0, 0, 0);
}

function toCompactUtcDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function toOutlookDate(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function buildTitle(input: CalendarFollowUpInput): string {
  const companySuffix =
    input.company && input.company.trim().length > 0
      ? ` (${input.company.trim()})`
      : "";

  return `Follow up with ${input.name}${companySuffix} - Blackbook`;
}

function buildNotes(input: CalendarFollowUpInput): string {
  const lines = [
    input.whatMatters?.trim() ? `Context: ${input.whatMatters.trim()}` : null,
    input.nextStep?.trim() ? `Next step: ${input.nextStep.trim()}` : null,
    input.linkedinUrl?.trim() ? `LinkedIn: ${input.linkedinUrl.trim()}` : null,
  ].filter(Boolean) as string[];

  return lines.join("\n\n");
}

function getEventWindow(input: CalendarFollowUpInput) {
  const start = parseFollowUpDate(input.nextFollowUpAt);
  const end = new Date(start.getTime() + 15 * 60 * 1000);
  return { start, end };
}

function buildGoogleCalendarUrl(input: CalendarFollowUpInput): string {
  const { start, end } = getEventWindow(input);
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: buildTitle(input),
    dates: `${toCompactUtcDate(start)}/${toCompactUtcDate(end)}`,
    details: buildNotes(input),
  });

  if (input.linkedinUrl?.trim()) {
    params.set("location", input.linkedinUrl.trim());
  }

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function buildOutlookCalendarUrl(input: CalendarFollowUpInput): string {
  const { start, end } = getEventWindow(input);
  const params = new URLSearchParams({
    path: "/calendar/action/compose",
    rru: "addevent",
    subject: buildTitle(input),
    startdt: toOutlookDate(start),
    enddt: toOutlookDate(end),
    body: buildNotes(input),
  });

  if (input.linkedinUrl?.trim()) {
    params.set("location", input.linkedinUrl.trim());
  }

  return `https://outlook.office.com/calendar/0/deeplink/compose?${params.toString()}`;
}

function buildYahooCalendarUrl(input: CalendarFollowUpInput): string {
  const { start } = getEventWindow(input);
  const params = new URLSearchParams({
    v: "60",
    view: "d",
    type: "20",
    title: buildTitle(input),
    st: toCompactUtcDate(start),
    dur: "0015",
    desc: buildNotes(input),
  });

  if (input.linkedinUrl?.trim()) {
    params.set("in_loc", input.linkedinUrl.trim());
  }

  return `https://calendar.yahoo.com/?${params.toString()}`;
}

function escapeIcsText(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function buildIcsContent(input: CalendarFollowUpInput): string {
  const { start, end } = getEventWindow(input);
  const title = escapeIcsText(buildTitle(input));
  const notes = escapeIcsText(buildNotes(input));
  const location = escapeIcsText(input.linkedinUrl?.trim() || "");
  const stamp = toCompactUtcDate(new Date());

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Blackbook Pulse//Follow Up//EN",
    "BEGIN:VEVENT",
    `UID:blackbook-${start.getTime()}-${input.name.replace(/\s+/g, "-").toLowerCase()}`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${toCompactUtcDate(start)}`,
    `DTEND:${toCompactUtcDate(end)}`,
    `SUMMARY:${title}`,
    notes ? `DESCRIPTION:${notes}` : "",
    location ? `LOCATION:${location}` : "",
    "END:VEVENT",
    "END:VCALENDAR",
  ]
    .filter(Boolean)
    .join("\r\n");
}

async function ensureCalendarPermission(): Promise<boolean> {
  const { status } = await Calendar.getCalendarPermissionsAsync();

  if (status === "granted") {
    return true;
  }

  const { status: nextStatus } = await Calendar.requestCalendarPermissionsAsync();

  if (nextStatus !== "granted") {
    Alert.alert(
      "Calendar access needed",
      "To add follow-ups to your calendar, enable calendar permissions in Settings."
    );
    return false;
  }

  return true;
}

async function openExternalCalendarUrl(url: string) {
  if (Platform.OS === "web") {
    if (typeof window !== "undefined") {
      window.open(url, "_blank", "noopener,noreferrer");
    }
    return;
  }

  await Linking.openURL(url);
}

async function downloadIcsFile(input: CalendarFollowUpInput) {
  if (Platform.OS !== "web") {
    throw new Error("ICS download is only available in the browser right now.");
  }

  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error("Could not prepare the calendar file in this browser.");
  }

  const blob = new Blob([buildIcsContent(input)], {
    type: "text/calendar;charset=utf-8",
  });
  const blobUrl = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  const safeName = input.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-") || "follow-up";

  anchor.href = blobUrl;
  anchor.download = `${safeName}-follow-up.ics`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.URL.revokeObjectURL(blobUrl);
}

export async function openFollowUpInCalendar(
  input: CalendarFollowUpInput,
  destination: CalendarDestination
): Promise<void> {
  if (!input.nextFollowUpAt?.trim()) {
    throw new Error("No follow-up date is set yet.");
  }

  if (destination === "google") {
    await openExternalCalendarUrl(buildGoogleCalendarUrl(input));
    return;
  }

  if (destination === "outlook") {
    await openExternalCalendarUrl(buildOutlookCalendarUrl(input));
    return;
  }

  if (destination === "yahoo") {
    await openExternalCalendarUrl(buildYahooCalendarUrl(input));
    return;
  }

  if (destination === "ics") {
    await downloadIcsFile(input);
    return;
  }

  const ok = await ensureCalendarPermission();
  if (!ok) {
    return;
  }

  const { start, end } = getEventWindow(input);

  await Calendar.createEventAsync((await Calendar.getDefaultCalendarAsync()).id, {
    title: buildTitle(input),
    startDate: start,
    endDate: end,
    notes: buildNotes(input),
    location: input.linkedinUrl?.trim() || undefined,
  });
}
