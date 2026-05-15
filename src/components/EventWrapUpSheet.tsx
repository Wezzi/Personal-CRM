import { useEffect, useMemo, useState } from "react";

import { Alert, Modal, SafeAreaView, ScrollView, StyleSheet, View } from "react-native";

import * as Clipboard from "expo-clipboard";



import { CurrentEventValue } from "./CurrentEventSheet";

import { PersonQuickActionsButton } from "./PersonQuickActionsButton";

import { Button } from "./ui/Button";

import { Card } from "./ui/Card";

import { Typography } from "./ui/Typography";

import { ensureSessionUserId, listPeopleInsights, PersonInsight } from "../lib/crm";

import { buildPeopleCsv, exportCsvFile } from "../lib/csvExport";

import { emailEventSummary } from "../lib/emailSummary";

import { buildSlackCanvasSummary } from "../lib/slackCanvas";

import { layout, radius, useTheme, useThemedStyles } from "../theme/tokens";



type EventWrapUpSheetProps = {

  visible: boolean;

  event: CurrentEventValue | null;

  canExportCsv?: boolean;

  onClose: () => void;

  onExitEventMode: () => void;

};



function belongsToCurrentEvent(person: PersonInsight, event: CurrentEventValue) {

  return person.lastEventName?.trim().toLowerCase() === event.name.trim().toLowerCase();

}



export function EventWrapUpSheet({ visible, event, canExportCsv = false, onClose, onExitEventMode }: EventWrapUpSheetProps) {

  const styles = useThemedStyles(createStyles);

  const [people, setPeople] = useState<PersonInsight[]>([]);

  const [isLoading, setLoading] = useState(false);

  const [isCopyingSummary, setCopyingSummary] = useState(false);

  const [isExportingCsv, setExportingCsv] = useState(false);

  const [isEmailingSummary, setEmailingSummary] = useState(false);

  const [errorMessage, setErrorMessage] = useState<string | null>(null);



  async function loadPeople(activeEvent: CurrentEventValue) {

    try {

      setLoading(true);

      setErrorMessage(null);

      const userId = await ensureSessionUserId();

      const insights = await listPeopleInsights(userId);

      setPeople(insights.filter((person) => belongsToCurrentEvent(person, activeEvent)));

    } catch (error) {

      setErrorMessage(error instanceof Error ? error.message : "Could not load event wrap-up.");

    } finally {

      setLoading(false);

    }

  }



  useEffect(() => {

    if (visible && event) {

      void loadPeople(event);

    }

  }, [visible, event?.name]);



  const summary = useMemo(() => {

    return {

      readyToFollowUp: people.filter(

        (person) => person.nextStep.trim() && person.nextFollowUpAt && person.preferredChannel

      ).length,

      missingNextStep: people.filter((person) => !person.nextStep.trim()).length,

      missingReminder: people.filter((person) => !person.nextFollowUpAt).length,

      missingChannel: people.filter((person) => !person.preferredChannel).length,

      dueOrOverdue: people.filter((person) => person.followUpState === "dueToday" || person.followUpState === "overdue").length,

    };

  }, [people]);



  if (!event) {

    return null;

  }



  const activeEvent = event;



  function buildSummaryText() {

    return buildSlackCanvasSummary({

      eventName: activeEvent.name,

      eventDate: activeEvent.eventDate,

      people,

    });

  }



  async function handleCopySummary() {

    if (isCopyingSummary) {

      return;

    }



    try {

      setCopyingSummary(true);

      await Clipboard.setStringAsync(buildSummaryText());

      Alert.alert("Summary copied", "Paste it into Slack, email, or notes when you are ready.");

    } catch {

      Alert.alert("Copy failed", "Could not copy this event summary.");

    } finally {

      setCopyingSummary(false);

    }

  }



  async function handleExportCsv() {

    if (isExportingCsv) {

      return;

    }



    if (!people.length) {

      Alert.alert("Nothing to export yet", "Capture at least one person for this event first.");

      return;

    }



    try {

      setExportingCsv(true);

      await exportCsvFile({

        csv: buildPeopleCsv(people),

        fileName: `${activeEvent.name} contacts`,

      });

    } catch (error) {

      Alert.alert("CSV export failed", error instanceof Error ? error.message : "Could not export this event.");

    } finally {

      setExportingCsv(false);

    }

  }



  async function handleEmailSummary() {

    if (isEmailingSummary) {

      return;

    }



    try {

      setEmailingSummary(true);

      await emailEventSummary({

        eventName: activeEvent.name,

        eventDate: activeEvent.eventDate,

      });

      Alert.alert("Email sent", "Your event summary has been sent to your signed-in email.");

    } catch (error) {

      Alert.alert("Email summary failed", error instanceof Error ? error.message : "Could not email this summary.");

    } finally {

      setEmailingSummary(false);

    }

  }



  return (

    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>

      <SafeAreaView style={styles.safeArea}>

        <View style={styles.container}>

          <View style={styles.headerRow}>

            <View style={styles.headerCopy}>

              <Typography variant="caption">Event wrap-up</Typography>

              <Typography variant="h1">{activeEvent.name}</Typography>

              <Typography variant="body" style={styles.metaText}>

                Your assistant checklist before this event turns into forgotten notes.

              </Typography>

            </View>

            <Button label="Close" onPress={onClose} variant="ghost" fullWidth={false} size="compact" />

          </View>



          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

            <View style={styles.summaryGrid}>

              <Card style={styles.summaryCard}>

                <Typography variant="h2">{people.length}</Typography>

                <Typography variant="caption">People captured</Typography>

              </Card>

              <Card style={styles.summaryCard}>

                <Typography variant="h2">{summary.readyToFollowUp}</Typography>

                <Typography variant="caption">Ready to follow up</Typography>

              </Card>

              <Card style={styles.summaryCard}>

                <Typography variant="h2">{summary.dueOrOverdue}</Typography>

                <Typography variant="caption">At risk now</Typography>

              </Card>

              <Card style={styles.summaryCard}>

                <Typography variant="h2">{summary.missingReminder}</Typography>

                <Typography variant="caption">Need reminder</Typography>

              </Card>

              <Card style={styles.summaryCard}>

                <Typography variant="h2">{summary.missingNextStep}</Typography>

                <Typography variant="caption">Need next step</Typography>

              </Card>

              <Card style={styles.summaryCard}>

                <Typography variant="h2">{summary.missingChannel}</Typography>

                <Typography variant="caption">Need channel</Typography>

              </Card>

            </View>



            {errorMessage ? (

              <Card>

                <Typography variant="body">{errorMessage}</Typography>

              </Card>

            ) : null}



            {isLoading ? <Typography variant="body">Loading event people...</Typography> : null}



            {!isLoading ? (

              <Card style={styles.assistantCard}>

                <Typography variant="caption">Close-loop order</Typography>

                <Typography variant="body" style={styles.metaText}>

                  Add missing next steps first, set reminders second, then send the follow-ups that are already due.

                </Typography>

                <View style={styles.actionRow}>

                  <Button

                    label="Copy summary"

                    onPress={() => void handleCopySummary()}

                    loading={isCopyingSummary}

                    fullWidth={false}

                    size="compact"

                  />

                  {canExportCsv ? (

                    <Button

                      label="Export CSV"

                      onPress={() => void handleExportCsv()}

                      loading={isExportingCsv}

                      variant="ghost"

                      fullWidth={false}

                      size="compact"

                    />

                  ) : null}

                  <Button

                    label="Email summary"

                    onPress={() => void handleEmailSummary()}

                    loading={isEmailingSummary}

                    variant="ghost"

                    fullWidth={false}

                    size="compact"

                  />

                </View>

              </Card>

            ) : null}



            {!isLoading && people.length === 0 ? (

              <Card style={styles.emptyCard}>

                <Typography variant="h2">No people tied to this event yet</Typography>

                <Typography variant="body" style={styles.metaText}>

                  Anyone captured while this event is live will appear here for follow-up.

                </Typography>

              </Card>

            ) : null}



            {people.map((person) => (

              <Card key={person.id} style={styles.personCard}>

                <View style={styles.personHeader}>

                  <View style={styles.personCopy}>

                    <Typography variant="h2">{person.name}</Typography>

                    <Typography variant="caption">

                      {[person.company, person.nextFollowUpLabel].filter(Boolean).join(" · ")}

                    </Typography>

                  </View>

                  <PersonQuickActionsButton person={person} onChanged={() => void loadPeople(activeEvent)} />

                </View>

                <Typography variant="body" numberOfLines={1} style={styles.metaText}>

                  {person.nextStep || person.whatMatters || "Add the next useful step."}

                </Typography>

                <View style={styles.nudgeRow}>

                  {person.nextStep.trim() && person.nextFollowUpAt && person.preferredChannel ? (

                    <View style={styles.readyPill}><Typography variant="caption" style={styles.readyPillText}>Ready</Typography></View>

                  ) : null}

                  {!person.nextFollowUpAt ? <View style={styles.nudgePill}><Typography variant="caption">Set reminder</Typography></View> : null}

                  {!person.nextStep.trim() ? <View style={styles.nudgePill}><Typography variant="caption">Add next step</Typography></View> : null}

                  {!person.preferredChannel ? <View style={styles.nudgePill}><Typography variant="caption">Add channel</Typography></View> : null}

                  {person.followUpState === "dueToday" || person.followUpState === "overdue" ? (

                    <View style={styles.hotPill}><Typography variant="caption" style={styles.hotPillText}>Needs action</Typography></View>

                  ) : null}

                </View>

              </Card>

            ))}

          </ScrollView>



          <View style={styles.footer}>

            <Button label="Finish event mode" onPress={onExitEventMode} />

          </View>

        </View>

      </SafeAreaView>

    </Modal>

  );

}



const createStyles = (colors: ReturnType<typeof useTheme>["colors"]) => StyleSheet.create({

  safeArea: {

    flex: 1,

    backgroundColor: colors.background,

  },

  container: {

    flex: 1,

    backgroundColor: colors.background,

    paddingHorizontal: layout.screenPaddingHorizontal,

    paddingTop: layout.stackGap,

  },

  headerRow: {

    flexDirection: "row",

    alignItems: "flex-start",

    justifyContent: "space-between",

    gap: 12,

  },

  headerCopy: {

    flex: 1,

    gap: 6,

  },

  content: {

    paddingTop: 18,

    paddingBottom: 120,

    gap: 14,

  },

  summaryGrid: {

    flexDirection: "row",

    flexWrap: "wrap",

    gap: 10,

  },

  summaryCard: {

    flex: 1,

    minWidth: 135,

    gap: 6,

  },

  emptyCard: {

    gap: 8,

  },

  assistantCard: {

    gap: 8,

    backgroundColor: colors.surfaceMuted,

  },

  actionRow: {

    flexDirection: "row",

    flexWrap: "wrap",

    gap: 8,

    paddingTop: 4,

  },

  personCard: {

    gap: 10,

  },

  personHeader: {

    flexDirection: "row",

    alignItems: "flex-start",

    justifyContent: "space-between",

    gap: 12,

  },

  personCopy: {

    flex: 1,

    gap: 6,

  },

  metaText: {

    color: colors.textSecondary,

  },

  nudgeRow: {

    flexDirection: "row",

    flexWrap: "wrap",

    gap: 8,

  },

  nudgePill: {

    borderRadius: radius.pill,

    borderWidth: 1,

    borderColor: colors.border,

    backgroundColor: colors.surfaceMuted,

    paddingHorizontal: 10,

    paddingVertical: 7,

  },

  hotPill: {

    borderRadius: radius.pill,

    backgroundColor: colors.successSoft,

    borderWidth: 1,

    borderColor: colors.border,

    paddingHorizontal: 10,

    paddingVertical: 7,

  },

  hotPillText: {

    color: "#17843A",

  },

  readyPill: {

    borderRadius: radius.pill,

    backgroundColor: colors.successSoft,

    borderWidth: 1,

    borderColor: colors.border,

    paddingHorizontal: 10,

    paddingVertical: 7,

  },

  readyPillText: {

    color: "#17843A",

  },

  footer: {

    position: "absolute",

    left: layout.screenPaddingHorizontal,

    right: layout.screenPaddingHorizontal,

    bottom: 18,

    gap: 10,

  },

});

