import { formatFollowUpDate, PersonInsight } from "./crm";

type SlackCanvasPerson = PersonInsight & {
  exportEventName?: string | null;
};

const RELATIONSHIP_GOAL_TAGS = new Set([
  "business opportunity",
  "potential client",
  "new hire",
  "partner",
  "interesting",
  "other",
]);

function getRelationshipGoal(person: SlackCanvasPerson) {
  return person.tags.find((tag) => RELATIONSHIP_GOAL_TAGS.has(tag.toLowerCase())) || "No goal set";
}

function formatPersonLine(person: SlackCanvasPerson) {
  const company = person.company ? `, ${person.company}` : "";
  const goal = getRelationshipGoal(person);
  const status = person.relationshipStatus || "No status yet";
  const nextAction = person.nextStep || "No next action set";
  const due = person.nextFollowUpAt ? formatFollowUpDate(person.nextFollowUpAt) : "No follow-up date";

  return `- ${person.name}${company}\n  Goal: ${goal}\n  Status: ${status}\n  Next: ${nextAction}\n  Due: ${due}`;
}

export function buildSlackCanvasSummary(input: {
  eventName: string;
  eventDate?: string | null;
  campaignLink?: string | null;
  people: SlackCanvasPerson[];
}) {
  const overdue = input.people.filter((person) => person.followUpState === "overdue");
  const dueToday = input.people.filter((person) => person.followUpState === "dueToday");
  const upcoming = input.people.filter((person) => person.followUpState === "upcoming");
  const noNextAction = input.people.filter((person) => !person.nextStep);
  const eventDate = input.eventDate ? `\nDate: ${input.eventDate}` : "";

  const sections = [
    `# ${input.eventName} follow-up summary${eventDate}`,
    input.campaignLink ? `Campaign link: ${input.campaignLink}` : "",
    `People captured: ${input.people.length}`,
    `Follow-ups due: ${overdue.length + dueToday.length}`,
    "",
    "## Due now",
    [...overdue, ...dueToday].length ? [...overdue, ...dueToday].map(formatPersonLine).join("\n") : "- Nothing due right now.",
    "",
    "## Upcoming",
    upcoming.length ? upcoming.slice(0, 12).map(formatPersonLine).join("\n") : "- No upcoming follow-ups set.",
    "",
    "## Needs next action",
    noNextAction.length ? noNextAction.slice(0, 12).map(formatPersonLine).join("\n") : "- Everyone has a next action.",
  ];

  return sections.join("\n");
}
