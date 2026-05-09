import { Platform, Share } from "react-native";

import { formatCategoryLabel, formatFollowUpDate, InteractionRow, PersonInsight } from "./crm";

type CsvPerson = PersonInsight & {
  exportEventName?: string | null;
  exportEventCategory?: string | null;
  exportEventDate?: string | null;
  exportCampaignSlug?: string | null;
  exportNote?: string | null;
};

const RELATIONSHIP_GOAL_TAGS = new Set([
  "business opportunity",
  "potential client",
  "new hire",
  "partner",
  "interesting",
  "other",
]);

const CSV_HEADERS = [
  "Name",
  "Company",
  "Role / Title",
  "Email",
  "Phone",
  "LinkedIn",
  "Preferred Contact Method",
  "Event Name",
  "Campaign / Event Slug",
  "Event Type",
  "Date Met",
  "Why They Matter",
  "Relationship Goal",
  "Latest Status",
  "Next Action",
  "Follow-up Due Date",
  "Last Contacted Date",
  "Outcome",
  "Notes",
  "Tags",
  "Created At",
  "Updated At",
];

function csvEscape(value: string | number | null | undefined) {
  const normalized = value === null || value === undefined ? "" : String(value);
  return `"${normalized.replace(/"/g, '""')}"`;
}

function formatIsoDate(value?: string | null) {
  if (!value) {
    return "";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function slugify(value?: string | null) {
  return (value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function extractRelationshipGoalFromNote(rawNote?: string | null) {
  const match = rawNote?.match(/^Relationship\s*goal:\s*(.+)$/im);
  return match?.[1]?.trim() || "";
}

function getRelationshipGoal(person: CsvPerson) {
  const explicitGoal = extractRelationshipGoalFromNote(person.exportNote || person.lastInteractionNote);
  if (explicitGoal) {
    return explicitGoal;
  }

  return person.tags.find((tag) => RELATIONSHIP_GOAL_TAGS.has(tag.toLowerCase())) || "";
}

function getPreferredChannelLabel(person: CsvPerson) {
  if (person.preferredChannel === "other") {
    return person.preferredChannelOther || "Other";
  }

  if (!person.preferredChannel) {
    return "";
  }

  return person.preferredChannel.charAt(0).toUpperCase() + person.preferredChannel.slice(1);
}

function buildRows(people: CsvPerson[]) {
  return people.map((person) => [
    person.name,
    person.company,
    "",
    person.email,
    person.phoneNumber,
    person.linkedinUrl,
    getPreferredChannelLabel(person),
    person.exportEventName || person.lastEventName || "",
    person.exportCampaignSlug || slugify(person.exportEventName || person.lastEventName),
    person.exportEventCategory
      ? formatCategoryLabel(person.exportEventCategory as never)
      : person.lastEventCategory
        ? formatCategoryLabel(person.lastEventCategory)
        : "",
    person.exportEventDate || "",
    person.whatMatters === "No interactions yet." ? "" : person.whatMatters,
    getRelationshipGoal(person),
    person.relationshipStatus,
    person.nextStep,
    person.nextFollowUpAt ? formatFollowUpDate(person.nextFollowUpAt) : "",
    formatIsoDate(person.lastInteractionAt),
    "",
    person.exportNote || person.lastInteractionNote,
    person.tags.join(", "),
    formatIsoDate(person.createdAt),
    formatIsoDate(person.lastInteractionAt || person.createdAt),
  ]);
}

export function buildPeopleCsv(people: CsvPerson[]) {
  const rows = [CSV_HEADERS, ...buildRows(people)];
  return rows.map((row) => row.map(csvEscape).join(",")).join("\n");
}

export function getPeopleForEventExport(input: {
  people: PersonInsight[];
  interactions: InteractionRow[];
  eventId: string;
  eventName: string;
  eventCategory?: string | null;
  eventDate?: string | null;
}) {
  const peopleById = new Map(input.people.map((person) => [person.id, person]));
  const eventPeople = new Map<string, CsvPerson>();

  input.interactions
    .filter((interaction) => interaction.event_id === input.eventId)
    .forEach((interaction) => {
      const person = peopleById.get(interaction.person_id);
      if (!person || eventPeople.has(person.id)) {
        return;
      }

      eventPeople.set(person.id, {
        ...person,
        exportEventName: input.eventName,
        exportEventCategory: input.eventCategory,
        exportEventDate: input.eventDate,
        exportCampaignSlug: slugify(input.eventName),
        exportNote: interaction.raw_note,
      });
    });

  return Array.from(eventPeople.values());
}

export async function exportCsvFile(input: { csv: string; fileName: string }) {
  const safeName = slugify(input.fileName) || "blackbook-export";

  if (Platform.OS === "web") {
    if (typeof window === "undefined" || typeof document === "undefined") {
      throw new Error("Could not prepare the CSV in this browser.");
    }

    const blob = new Blob([input.csv], { type: "text/csv;charset=utf-8" });
    const blobUrl = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = blobUrl;
    anchor.download = `${safeName}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    window.URL.revokeObjectURL(blobUrl);
    return;
  }

  await Share.share({
    title: `${safeName}.csv`,
    message: input.csv,
  });
}
