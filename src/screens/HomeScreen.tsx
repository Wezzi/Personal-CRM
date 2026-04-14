import { useEffect, useMemo, useState } from "react";
import { Alert, Pressable, SafeAreaView, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";

import { CurrentEventValue } from "../components/CurrentEventSheet";
import { FloatingFab } from "../components/FloatingFab";
import { CaptureModal, ParsedPersonDraft } from "./CaptureModal";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Typography } from "../components/ui/Typography";
import {
  JUST_CONNECTED_THRESHOLD,
  buildInteractionRecord,
  createInteraction,
  createPerson,
  ensureSessionUserId,
  formatCategoryLabel,
  getOrCreateEvent,
  isContactStale,
  listEventInsights,
  listPeopleInsights,
} from "../lib/crm";
import { colors, layout } from "../theme/tokens";
import { PersonStatusMode } from "./PersonProfileScreen";

type HomeScreenProps = {
  currentEvent: CurrentEventValue | null;
  onOpenPeopleFilter?: (status: PersonStatusMode) => void;
};

type SignalFilter = "all" | "tracked" | "contactedToday" | "needNudge";

export function HomeScreen({ currentEvent, onOpenPeopleFilter }: HomeScreenProps) {
  const { width } = useWindowDimensions();
  const isCompactLayout = width < 720;
  const [isCaptureOpen, setCaptureOpen] = useState(false);
  const [isSaving, setSaving] = useState(false);
  const [people, setPeople] = useState<Awaited<ReturnType<typeof listPeopleInsights>>>([]);
  const [events, setEvents] = useState<Awaited<ReturnType<typeof listEventInsights>>>([]);
  const [isLoading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeSignal, setActiveSignal] = useState<SignalFilter>("all");

  const recentPeople = useMemo(() => people.slice(0, 4), [people]);
  const followUpPeople = useMemo(
    () => people.filter((person) => isContactStale(person.daysSinceLastContact, person.priority)).slice(0, 4),
    [people]
  );
  const contactedTodayPeople = useMemo(
    () => people.filter((person) => (person.daysSinceLastContact || 0) <= JUST_CONNECTED_THRESHOLD),
    [people]
  );
  const signalPeople = useMemo(() => {
    if (activeSignal === "tracked") {
      return people;
    }

    if (activeSignal === "contactedToday") {
      return contactedTodayPeople;
    }

    if (activeSignal === "needNudge") {
      return people.filter((person) => isContactStale(person.daysSinceLastContact, person.priority));
    }

    return recentPeople;
  }, [activeSignal, contactedTodayPeople, people, recentPeople]);
  const signalHeading =
    activeSignal === "tracked"
      ? "People tracked"
      : activeSignal === "contactedToday"
        ? "Contacted today"
        : activeSignal === "needNudge"
          ? "People who need a nudge"
          : "Recently connected";
  const eventPulse = useMemo(() => {
    const counts = new Map<string, number>();
    events.forEach((event) => {
      counts.set(event.category, (counts.get(event.category) || 0) + 1);
    });

    return Array.from(counts.entries())
      .map(([category, count]) => ({ category, count }))
      .sort((left, right) => right.count - left.count)
      .slice(0, 3);
  }, [events]);

  async function loadData() {
    try {
      setLoading(true);
      setErrorMessage(null);

      const userId = await ensureSessionUserId();
      const [peopleInsights, eventInsights] = await Promise.all([
        listPeopleInsights(userId),
        listEventInsights(userId),
      ]);

      setPeople(
        peopleInsights.sort((left, right) => {
          if (!left.lastInteractionAt && !right.lastInteractionAt) {
            return right.createdAt.localeCompare(left.createdAt);
          }

          if (!left.lastInteractionAt) {
            return 1;
          }

          if (!right.lastInteractionAt) {
            return -1;
          }

          return right.lastInteractionAt.localeCompare(left.lastInteractionAt);
        })
      );
      setEvents(eventInsights);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load data.";
      setErrorMessage(message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  async function handleSaveDraft(draft: ParsedPersonDraft) {
    if (isSaving) {
      return;
    }

    try {
      setSaving(true);
      const userId = await ensureSessionUserId();
      const person = await createPerson(
        userId,
        draft.name,
        draft.company,
        draft.linkedinUrl,
        draft.phoneNumber,
        draft.priority,
        draft.tags
      );

      let eventId: string | null = null;
      const eventName = currentEvent?.name || draft.event;
      const eventCategory = currentEvent?.category || draft.eventCategory || null;
      if (eventName && eventName !== "No event") {
        const event = await getOrCreateEvent(userId, eventName, eventCategory);
        eventId = event.id;
      }

      await createInteraction({
        userId,
        personId: person.id,
        eventId,
        rawNote: buildInteractionRecord(draft.notes, draft.followUp, draft.company),
      });

      setCaptureOpen(false);
      await loadData();
      Alert.alert("Saved", `${draft.name} saved to Supabase.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save interaction.";
      Alert.alert("Save failed", message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          <View style={[styles.heroRow, isCompactLayout ? styles.heroRowCompact : null]}>
            <View style={styles.heroCopy}>
              <Typography variant="caption">Black Book</Typography>
              <Typography variant="h1">Making follow-ups with connections easier than ever.</Typography>
            </View>
            <Button
              label="Add person"
              onPress={() => setCaptureOpen(true)}
              fullWidth={isCompactLayout}
              style={isCompactLayout ? styles.heroActionCompact : null}
            />
          </View>

          {errorMessage ? (
            <Card>
              <Typography variant="body">{errorMessage}</Typography>
            </Card>
          ) : null}

          <Card style={styles.heroCard}>
            <Typography variant="caption" style={styles.heroCaption}>Signals</Typography>
            <View style={styles.signalGrid}>
              <Pressable
                style={[styles.signalCell, activeSignal === "tracked" ? styles.signalCellActive : null]}
                onPress={() => {
                  setActiveSignal("tracked");
                  onOpenPeopleFilter?.("all");
                }}
              >
                <Typography variant="h2" style={styles.heroMetric}>{people.length}</Typography>
                <Typography variant="caption" style={styles.heroCaption}>People tracked</Typography>
              </Pressable>
              <Pressable
                style={[styles.signalCell, activeSignal === "contactedToday" ? styles.signalCellActive : null]}
                onPress={() => {
                  setActiveSignal("contactedToday");
                  onOpenPeopleFilter?.("today");
                }}
              >
                <Typography variant="h2" style={styles.heroMetric}>{contactedTodayPeople.length}</Typography>
                <Typography variant="caption" style={styles.heroCaption}>Contacted today</Typography>
              </Pressable>
              <Pressable
                style={[styles.signalCell, activeSignal === "needNudge" ? styles.signalCellActive : null]}
                onPress={() => {
                  setActiveSignal("needNudge");
                  onOpenPeopleFilter?.("stale");
                }}
              >
                <Typography variant="h2" style={styles.heroMetric}>{people.filter((person) => isContactStale(person.daysSinceLastContact, person.priority)).length}</Typography>
                <Typography variant="caption" style={styles.heroCaption}>Need a nudge</Typography>
              </Pressable>
            </View>
          </Card>

          {activeSignal !== "all" ? (
            <View style={styles.sectionHeaderRow}>
              <Typography variant="caption">{signalHeading}</Typography>
              <Button
                label="Clear"
                onPress={() => setActiveSignal("all")}
                variant="ghost"
                fullWidth={false}
                size="compact"
              />
            </View>
          ) : null}

          {activeSignal !== "all" ? (
            <View style={styles.section}>
              {signalPeople.map((person) => (
                <Card key={`signal-${person.id}`} style={styles.connectionCard}>
                  <View style={styles.connectionHeader}>
                    <View style={styles.connectionMain}>
                      <Typography variant="h2">{person.name}</Typography>
                      <Typography variant="caption">
                        {[person.company, person.lastEventName || "No event logged"].filter(Boolean).join(" · ")}
                      </Typography>
                    </View>
                    <Typography variant="caption">{person.statusLabel}</Typography>
                  </View>
                  <Typography variant="body" style={styles.cardBody} numberOfLines={2}>
                    {person.lastInteractionNote}
                  </Typography>
                  <Typography variant="caption">{person.bannerLabel}</Typography>
                </Card>
              ))}
              {!isLoading && signalPeople.length === 0 ? (
                <Typography variant="body">No contacts in this segment yet.</Typography>
              ) : null}
            </View>
          ) : null}

          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Typography variant="caption">Recently connected</Typography>
              <Typography variant="body" style={styles.sectionMeta}>
                Last touch, follow-up, and event memory in one glance.
              </Typography>
            </View>

            {recentPeople.map((person) => (
              <Card key={person.id} style={styles.connectionCard}>
                <View style={styles.connectionHeader}>
                  <View style={styles.connectionMain}>
                    <Typography variant="h2">{person.name}</Typography>
                    <Typography variant="caption">
                      {[person.company, person.lastEventName || "No event logged"].filter(Boolean).join(" · ")}
                    </Typography>
                  </View>
                  <Typography variant="caption">{person.statusLabel}</Typography>
                </View>
                <Typography variant="body" style={styles.cardBody} numberOfLines={2}>
                  {person.lastInteractionNote}
                </Typography>
                <Typography variant="caption">{person.bannerLabel}</Typography>
              </Card>
            ))}
            {!isLoading && recentPeople.length === 0 ? (
              <Typography variant="body">No people tracked yet.</Typography>
            ) : null}
          </View>

          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Typography variant="caption">Needs follow-up</Typography>
              <Typography variant="body" style={styles.sectionMeta}>
                Contacts drifting beyond two weeks.
              </Typography>
            </View>
            {followUpPeople.map((person) => (
              <Card key={person.id} style={styles.followCard}>
                <View style={styles.connectionHeader}>
                  <View style={styles.connectionMain}>
                    <Typography variant="h2">{person.name}</Typography>
                    {person.company ? <Typography variant="caption">{person.company}</Typography> : null}
                  </View>
                  <Typography variant="caption">{person.bannerLabel}</Typography>
                </View>
                <Typography variant="body" style={styles.cardBody}>
                  {person.followUp}
                </Typography>
              </Card>
            ))}
            {!isLoading && followUpPeople.length === 0 ? (
              <Typography variant="body">Everyone is still warm.</Typography>
            ) : null}
          </View>

          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Typography variant="caption">Event pulse</Typography>
              <Typography variant="body" style={styles.sectionMeta}>
                Dominant room types across your recent activity.
              </Typography>
            </View>
            <View style={styles.pulseRow}>
              {eventPulse.map((item) => (
                <Card key={item.category} style={styles.pulseCard}>
                  <Typography variant="h2">{item.count}</Typography>
                  <Typography variant="caption">{formatCategoryLabel(item.category as never)}</Typography>
                </Card>
              ))}
              {!isLoading && eventPulse.length === 0 ? (
                <Card style={styles.pulseCard}>
                  <Typography variant="body">No event categories yet.</Typography>
                </Card>
              ) : null}
            </View>
          </View>
        </ScrollView>

        <FloatingFab label="+" onPress={() => setCaptureOpen(true)} />

        <CaptureModal
          visible={isCaptureOpen}
          onClose={() => setCaptureOpen(false)}
          onSave={handleSaveDraft}
          isSaving={isSaving}
          lockedEvent={currentEvent}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingHorizontal: layout.screenPaddingHorizontal,
    paddingTop: layout.stackGap,
    paddingBottom: 120,
    gap: 18,
  },
  heroRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 12,
  },
  heroCopy: {
    flex: 1,
    gap: 8,
  },
  heroRowCompact: {
    alignItems: "stretch",
  },
  heroActionCompact: {
    width: "100%",
  },
  heroCard: {
    backgroundColor: colors.primaryAction,
  },
  signalGrid: {
    marginTop: 18,
    flexDirection: "row",
    gap: 10,
  },
  signalCell: {
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 18,
    padding: 14,
    gap: 6,
  },
  signalCellActive: {
    backgroundColor: "rgba(255,255,255,0.18)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.4)",
  },
  heroMetric: {
    color: colors.background,
  },
  heroCaption: {
    color: "rgba(246,243,238,0.76)",
  },
  section: {
    gap: 12,
  },
  sectionHeader: {
    gap: 4,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  sectionMeta: {
    color: colors.textSecondary,
  },
  connectionCard: {
    gap: 10,
  },
  followCard: {
    gap: 8,
    backgroundColor: colors.surfaceMuted,
  },
  connectionHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  connectionMain: {
    flex: 1,
    gap: 6,
  },
  cardBody: {
    color: colors.textSecondary,
  },
  pulseRow: {
    flexDirection: "row",
    gap: 10,
  },
  pulseCard: {
    flex: 1,
    gap: 8,
  },
});
