import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { Alert, Linking, Modal, SafeAreaView, Share, StyleSheet, View, useWindowDimensions } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { Typography } from "./src/components/ui/Typography";
import { CurrentEventSheet, CurrentEventValue } from "./src/components/CurrentEventSheet";
import { EventWrapUpSheet } from "./src/components/EventWrapUpSheet";
import { LiveEventBadge } from "./src/components/LiveEventBadge";
import { formatCategoryLabel } from "./src/lib/crm";
import { ensureProfileForUser, getCurrentUsername, signOutCurrentUser } from "./src/lib/auth";
import { supabaseConfigMessage } from "./src/lib/supabase";
import { Button } from "./src/components/ui/Button";
import { AuthScreen } from "./src/screens/AuthScreen";
import { EventScreen } from "./src/screens/EventScreen";
import { HomeScreen } from "./src/screens/HomeScreen";
import { PersonProfileScreen, PersonStatusMode } from "./src/screens/PersonProfileScreen";
import { useAuth } from "./src/hooks/useAuth";
import { ThemePreference, ThemeProvider, useTheme, useThemedStyles } from "./src/theme/tokens";

type ScreenKey = "home" | "event" | "person";
type TutorialStep = "setEvent" | "capture";

const CURRENT_EVENT_STORAGE_KEY = "blackbook.current_event";
const ACTIVE_SCREEN_STORAGE_KEY = "blackbook.active_screen";
const TUTORIAL_STORAGE_KEY = "blackbook.tutorial.core_flow";

function formatCurrentEventChipLabel(event: CurrentEventValue | null) {
  if (!event) {
    return "Set Current Event";
  }

  const typeLabel = event.category === "other" && event.customCategoryLabel?.trim()
    ? event.customCategoryLabel.trim()
    : formatCategoryLabel(event.category);

  return event.eventDate?.trim()
    ? `Current: ${event.name} · ${typeLabel} · ${event.eventDate.trim()}`
    : `Current: ${event.name} · ${typeLabel}`;
}

function getWelcomeName(user: NonNullable<ReturnType<typeof useAuth>["user"]> | null, username: string | null) {
  const metadata = user?.user_metadata || {};
  const candidate =
    metadata.name ||
    metadata.full_name ||
    metadata.preferred_username ||
    metadata.user_name ||
    username ||
    (typeof user?.email === "string" ? user.email.split("@")[0] : null);

  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : "there";
}

function isScreenKey(value: string | null): value is ScreenKey {
  return value === "home" || value === "event" || value === "person";
}

function AppShell() {
  const { width } = useWindowDimensions();
  const { colors, preference, resolvedScheme, setPreference } = useTheme();
  const styles = useThemedStyles(createStyles);
  const isCompactLayout = width < 880;
  const isVeryCompactLayout = width < 520;
  const { user, isLoading, authError, clearAuthError } = useAuth();
  const activeUser = user && !user.is_anonymous ? user : null;
  const [currentUsername, setCurrentUsername] = useState<string | null>(null);
  const [isPreparingAccount, setPreparingAccount] = useState(false);
  const [isAuthModalOpen, setAuthModalOpen] = useState(false);
  const [isAccountMenuOpen, setAccountMenuOpen] = useState(false);
  const [isNavMenuOpen, setNavMenuOpen] = useState(false);
  const [isSettingsOpen, setSettingsOpen] = useState(false);
  const [screen, setScreen] = useState<ScreenKey>("home");
  const [hasHydratedActiveScreen, setHasHydratedActiveScreen] = useState(false);
  const [personStatusMode, setPersonStatusMode] = useState<PersonStatusMode>("all");
  const [personStatusNonce, setPersonStatusNonce] = useState(0);
  const [isCurrentEventOpen, setCurrentEventOpen] = useState(false);
  const [isEventWrapUpOpen, setEventWrapUpOpen] = useState(false);
  const [currentEvent, setCurrentEvent] = useState<CurrentEventValue | null>(null);
  const [tutorialStep, setTutorialStep] = useState<TutorialStep | null>(null);
  const welcomeName = getWelcomeName(activeUser, currentUsername);

  if (supabaseConfigMessage) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.loadingWrap}>
          <View style={styles.configCard}>
            <Typography variant="h2">Supabase configuration error</Typography>
            <Typography variant="body" style={styles.configText}>
              {supabaseConfigMessage}
            </Typography>
            <Typography variant="body" style={styles.configText}>
              Add EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY or EXPO_PUBLIC_SUPABASE_ANON_KEY, and EXPO_PUBLIC_AUTH_REDIRECT_URL to your local .env and Vercel Project Settings, then redeploy.
            </Typography>
          </View>
        </View>
      </SafeAreaView>
    );
  }


useEffect(() => {
  let isMounted = true;

  async function syncUsername() {
      if (!activeUser) {
      if (isMounted) {
        setPreparingAccount(false);
        setCurrentUsername(null);
      }
      return;
    }

    if (isMounted) {
      setPreparingAccount(true);
    }

    try {
      await ensureProfileForUser(activeUser);
        const username = await getCurrentUsername(activeUser.id);
      if (isMounted) {
        setCurrentUsername(username);
      }
    } catch {
      if (isMounted) {
        setCurrentUsername(null);
      }
    } finally {
      if (isMounted) {
        setPreparingAccount(false);
      }
    }
  }

  void syncUsername();

  return () => {
    isMounted = false;
  };
}, [activeUser]);

useEffect(() => {
  let isMounted = true;

  async function hydrateActiveScreen() {
    const savedScreen = await AsyncStorage.getItem(ACTIVE_SCREEN_STORAGE_KEY);
    if (isMounted && isScreenKey(savedScreen)) {
      setScreen(savedScreen);
    }
    if (isMounted) {
      setHasHydratedActiveScreen(true);
    }
  }

  void hydrateActiveScreen();

  return () => {
    isMounted = false;
  };
}, []);

useEffect(() => {
  async function persistActiveScreen() {
    if (!hasHydratedActiveScreen) {
      return;
    }

    await AsyncStorage.setItem(ACTIVE_SCREEN_STORAGE_KEY, screen);
  }

  void persistActiveScreen();
}, [hasHydratedActiveScreen, screen]);

useEffect(() => {
  let isMounted = true;

  async function hydrateCurrentEvent() {
    const raw = await AsyncStorage.getItem(CURRENT_EVENT_STORAGE_KEY);
    if (!raw || !isMounted) {
      return;
    }

    try {
      setCurrentEvent(JSON.parse(raw));
    } catch {
      await AsyncStorage.removeItem(CURRENT_EVENT_STORAGE_KEY);
    }
  }

  void hydrateCurrentEvent();

  return () => {
    isMounted = false;
  };
}, []);

useEffect(() => {
  async function persistCurrentEvent() {
    if (currentEvent) {
      await AsyncStorage.setItem(CURRENT_EVENT_STORAGE_KEY, JSON.stringify(currentEvent));
      return;
    }

    await AsyncStorage.removeItem(CURRENT_EVENT_STORAGE_KEY);
  }

  void persistCurrentEvent();
}, [currentEvent]);

useEffect(() => {
  let isMounted = true;

  async function hydrateTutorial() {
    if (!activeUser) {
      return;
    }

    const seen = await AsyncStorage.getItem(TUTORIAL_STORAGE_KEY);
    if (!isMounted || seen === "true") {
      return;
    }

    setTutorialStep(currentEvent ? "capture" : "setEvent");
  }

  void hydrateTutorial();

  return () => {
    isMounted = false;
  };
}, [activeUser, currentEvent]);

  if (isLoading || isPreparingAccount) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.loadingWrap}>
          <Button label="Loading..." onPress={() => undefined} disabled />
        </View>
      </SafeAreaView>
    );
  }

  if (!activeUser) {
    return <AuthScreen authError={authError} onAuthenticated={() => clearAuthError()} />;
  }

  async function handleReportBug() {
    const subject = "Bug Report - Personal CRM MVP";
    const body = [
      "What happened?",
      "",
      "What did you expect to happen?",
      "",
      "Steps to reproduce:",
      "1. ",
      "2. ",
      "3. ",
      "",
      `Signed in as: @${currentUsername || "member"}`,
    ].join("\n");
    const url = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

    try {
      await Linking.openURL(url);
      setSettingsOpen(false);
    } catch {
      try {
        await Share.share({
          title: subject,
          message: `${subject}\n\n${body}`,
        });
        setSettingsOpen(false);
      } catch {
        Alert.alert("Could not open bug report", "Please try again in a moment.");
      }
    }
  }

  async function handleSuggestFeature() {
    const subject = "Feature Request - Personal CRM MVP";
    const body = [
      "What would you like the app to do?",
      "",
      "Why would it help?",
      "",
      "When would you use it?",
      "",
      `Signed in as: @${currentUsername || "member"}`,
    ].join("\n");
    const url = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

    try {
      await Linking.openURL(url);
      setSettingsOpen(false);
    } catch {
      try {
        await Share.share({
          title: subject,
          message: `${subject}\n\n${body}`,
        });
        setSettingsOpen(false);
      } catch {
        Alert.alert("Could not open feature request", "Please try again in a moment.");
      }
    }
  }


  function handleOpenPeopleFilter(status: PersonStatusMode) {
    setPersonStatusMode(status || "all");
    setPersonStatusNonce((value) => value + 1);
    setScreen("person");
  }

  async function handleLogout() {
    try {
      await signOutCurrentUser();
      setCurrentEvent(null);
      setScreen("home");
    } finally {
      setAccountMenuOpen(false);
      setNavMenuOpen(false);
    }
  }

  function exitCurrentEventMode() {
    setCurrentEvent(null);
    setEventWrapUpOpen(false);
  }

  async function finishTutorial() {
    setTutorialStep(null);
    await AsyncStorage.setItem(TUTORIAL_STORAGE_KEY, "true");
  }

  function handleOpenTutorialEvent() {
    setCurrentEventOpen(true);
  }

  function handleSaveCurrentEvent(value: CurrentEventValue) {
    setCurrentEvent(value);
    setCurrentEventOpen(false);
    if (tutorialStep === "setEvent") {
      setTutorialStep("capture");
    }
  }

  function handleClearCurrentEvent() {
    setCurrentEvent(null);
    setCurrentEventOpen(false);
  }

  function openAccountArea() {
    setNavMenuOpen(false);
    setAccountMenuOpen(true);
  }

  function handleThemeChange(nextPreference: ThemePreference) {
    void setPreference(nextPreference);
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      {isCompactLayout ? (
        <View style={[styles.topBar, styles.topBarCompact]}
        >
          <View style={styles.compactTopRow}>
            <View style={styles.compactBrandWrap}>
              <Typography variant="caption">Welcome, {welcomeName}</Typography>
              <Typography variant="h2">{screen === "home" ? "Home" : screen === "event" ? "Events" : "People"}</Typography>
            </View>
            <View style={styles.compactTopActions}>
              <Button
                label={currentEvent ? (isVeryCompactLayout ? "Event" : "Current event") : "Set event"}
                onPress={() => setCurrentEventOpen(true)}
                variant="ghost"
                fullWidth={false}
                size="compact"
                style={[styles.compactHeaderButton, tutorialStep === "setEvent" ? styles.tutorialTarget : null]}
              />
              <Button
                label="Menu"
                onPress={() => setNavMenuOpen(true)}
                variant="ghost"
                fullWidth={false}
                size="compact"
                style={styles.compactHeaderButton}
              />
            </View>
          </View>
        </View>
      ) : (
        <View style={styles.topBar}>
          <View style={styles.brandCluster}>
            <Typography variant="caption">Welcome, {welcomeName}</Typography>
            <Button
              label="Home"
              onPress={() => setScreen("home")}
              variant={screen === "home" ? "primary" : "ghost"}
              fullWidth={false}
              size="compact"
              style={styles.switchButton}
            />
          </View>
          <View style={styles.switcher}>
            <Button
              label={`@${currentUsername || "member"}`}
              onPress={openAccountArea}
              variant="ghost"
              fullWidth={false}
              size="compact"
              style={styles.switchButton}
            />
            <Button
              label={formatCurrentEventChipLabel(currentEvent)}
              onPress={() => setCurrentEventOpen(true)}
              variant="ghost"
              fullWidth={false}
              size="compact"
              style={[styles.currentEventButton, tutorialStep === "setEvent" ? styles.tutorialTarget : null]}
            />
            <Button
              label="Events"
              onPress={() => setScreen("event")}
              variant={screen === "event" ? "primary" : "ghost"}
              fullWidth={false}
              size="compact"
              style={styles.switchButton}
            />
            <Button
              label="People"
              onPress={() => setScreen("person")}
              variant={screen === "person" ? "primary" : "ghost"}
              fullWidth={false}
              size="compact"
              style={styles.switchButton}
            />
            <Button
              label="Settings"
              onPress={() => setSettingsOpen(true)}
              variant="ghost"
              fullWidth={false}
              size="compact"
              style={styles.switchButton}
            />
          </View>
        </View>
      )}

      {currentEvent ? (
        <View style={styles.currentEventBar}>
          <LiveEventBadge eventDate={currentEvent.eventDate} />
          <Button
            label={formatCurrentEventChipLabel(currentEvent)}
            onPress={() => setCurrentEventOpen(true)}
            variant="ghost"
            fullWidth={false}
            size="compact"
          />
          <Button
            label="Wrap up"
            onPress={() => setEventWrapUpOpen(true)}
            variant="primary"
            fullWidth={false}
            size="compact"
          />
          <Button
            label="End event mode"
            onPress={exitCurrentEventMode}
            variant="ghost"
            fullWidth={false}
            size="compact"
          />
        </View>
      ) : null}

      <View style={styles.content}>
        {screen === "home" ? (
          <HomeScreen
            currentEvent={currentEvent}
            onOpenPeopleFilter={handleOpenPeopleFilter}
            showCaptureCoach={tutorialStep === "capture"}
            onCaptureCoachDone={() => void finishTutorial()}
          />
        ) : null}
        {screen === "event" ? (
          <EventScreen
            currentEvent={currentEvent}
            onSetCurrentEvent={setCurrentEvent}
            onEndCurrentEvent={exitCurrentEventMode}
          />
        ) : null}
        {screen === "person" ? (
          <PersonProfileScreen
            currentEvent={currentEvent}
            forcedStatusMode={personStatusMode}
            forcedStatusNonce={personStatusNonce}
          />
        ) : null}
      </View>

      <CurrentEventSheet
        visible={isCurrentEventOpen}
        value={currentEvent}
        onClose={() => setCurrentEventOpen(false)}
        onSave={handleSaveCurrentEvent}
        onClear={handleClearCurrentEvent}
      />

      <EventWrapUpSheet
        visible={isEventWrapUpOpen}
        event={currentEvent}
        onClose={() => setEventWrapUpOpen(false)}
        onExitEventMode={exitCurrentEventMode}
      />

      {tutorialStep === "setEvent" ? (
        <View pointerEvents="box-none" style={styles.tutorialOverlay}>
          <View pointerEvents="none" style={styles.tutorialDim} />
          <View style={styles.tutorialCard}>
            <Typography variant="caption">First move</Typography>
            <Typography variant="h2">Set the event you are at.</Typography>
            <Typography variant="body" style={styles.tutorialText}>
              New people you capture will carry this context automatically.
            </Typography>
            <View style={styles.tutorialActions}>
              <Button label="Set current event" onPress={handleOpenTutorialEvent} fullWidth={false} size="compact" />
              <Button label="Skip" onPress={() => void finishTutorial()} variant="ghost" fullWidth={false} size="compact" />
            </View>
          </View>
        </View>
      ) : null}

      <Modal visible={isAuthModalOpen} animationType="slide" presentationStyle="pageSheet">
        <AuthScreen
          onAuthenticated={() => {
            setAuthModalOpen(false);
          }}
          onCancel={() => setAuthModalOpen(false)}
        />
      </Modal>

      <Modal visible={isAccountMenuOpen} transparent animationType="fade" onRequestClose={() => setAccountMenuOpen(false)}>
        <View style={styles.accountMenuOverlay}>
          <View style={styles.accountMenuCard}>
            <Typography variant="caption">Signed in</Typography>
            <Typography variant="h2">@{currentUsername || "member"}</Typography>
            <Button label="Log out" onPress={handleLogout} />
            <Button
              label="Close"
              onPress={() => setAccountMenuOpen(false)}
              variant="ghost"
            />
          </View>
        </View>
      </Modal>

      <Modal visible={isNavMenuOpen} transparent animationType="fade" onRequestClose={() => setNavMenuOpen(false)}>
        <View style={styles.accountMenuOverlay}>
          <View style={styles.accountMenuCard}>
            <Typography variant="caption">Navigate</Typography>
            <Button
              label="Home"
              onPress={() => {
                setScreen("home");
                setNavMenuOpen(false);
              }}
              variant={screen === "home" ? "primary" : "ghost"}
            />
            <Button
              label="Events"
              onPress={() => {
                setScreen("event");
                setNavMenuOpen(false);
              }}
              variant={screen === "event" ? "primary" : "ghost"}
            />
            <Button
              label="People"
              onPress={() => {
                setScreen("person");
                setNavMenuOpen(false);
              }}
              variant={screen === "person" ? "primary" : "ghost"}
            />
            <Button
              label={`Account @${currentUsername || "member"}`}
              onPress={openAccountArea}
              variant="ghost"
            />
            <Button
              label="Settings"
              onPress={() => {
                setNavMenuOpen(false);
                setSettingsOpen(true);
              }}
              variant="ghost"
            />
            <Button label="Close" onPress={() => setNavMenuOpen(false)} variant="ghost" />
          </View>
        </View>
      </Modal>

      <Modal visible={isSettingsOpen} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={styles.safeArea}>
          <View style={styles.settingsContainer}>
            <View style={styles.settingsHeader}>
              <View style={styles.settingsCopy}>
                <Button label="Settings" onPress={() => undefined} disabled fullWidth={false} size="compact" />
              </View>
              <Button label="Close" onPress={() => setSettingsOpen(false)} variant="ghost" fullWidth={false} size="compact" />
            </View>

            <View style={styles.settingsActions}>
              <View style={styles.themeSection}>
                <Typography variant="caption">Theme</Typography>
                <View style={styles.themeButtons}>
                  <Button
                    label="System"
                    onPress={() => handleThemeChange("system")}
                    variant={preference === "system" ? "primary" : "ghost"}
                    fullWidth={false}
                    size="compact"
                  />
                  <Button
                    label="Light"
                    onPress={() => handleThemeChange("light")}
                    variant={preference === "light" ? "primary" : "ghost"}
                    fullWidth={false}
                    size="compact"
                  />
                  <Button
                    label="Dark"
                    onPress={() => handleThemeChange("dark")}
                    variant={preference === "dark" ? "primary" : "ghost"}
                    fullWidth={false}
                    size="compact"
                  />
                </View>
                <Typography variant="body" style={styles.themeMeta}>
                  Current theme: {resolvedScheme}
                </Typography>
              </View>
              <Button label="Report a bug" onPress={handleReportBug} />
              <Button label="Suggest a feature" onPress={handleSuggestFeature} variant="ghost" />
            </View>
          </View>
        </SafeAreaView>
      </Modal>

      <StatusBar style={resolvedScheme === "dark" ? "light" : "dark"} />
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AppShell />
    </ThemeProvider>
  );
}

const createStyles = (colors: ReturnType<typeof useTheme>["colors"]) => StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  switcher: {
    flexDirection: "row",
    gap: 8,
  },
  brandCluster: {
    gap: 6,
  },
  switcherCompact: {
    flexWrap: "wrap",
  },
  compactTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  compactBrandWrap: {
    flex: 1,
    gap: 4,
  },
  compactTopActions: {
    flexDirection: "row",
    gap: 8,
    flexShrink: 0,
  },
  compactHeaderButton: {
    minHeight: 38,
  },
  topBar: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  topBarCompact: {
    alignItems: "stretch",
    flexDirection: "column",
    gap: 0,
  },
  currentEventButton: {
    maxWidth: 170,
  },
  tutorialOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 150,
    justifyContent: "flex-start",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 86,
  },
  tutorialDim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.24)",
  },
  tutorialCard: {
    width: "100%",
    maxWidth: 420,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: 16,
    gap: 10,
  },
  tutorialText: {
    color: colors.textSecondary,
  },
  tutorialActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  tutorialTarget: {
    borderColor: "#19A64A",
    shadowColor: "#19A64A",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 8,
  },
  currentEventBar: {
    paddingHorizontal: 16,
    paddingBottom: 8,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  switchButton: {
    minHeight: 40,
  },
  switchButtonCompact: {
    maxWidth: "100%",
  },
  content: {
    flex: 1,
  },
  loadingWrap: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
  },
  configCard: {
    width: "100%",
    maxWidth: 560,
    padding: 20,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    gap: 12,
  },
  configText: {
    color: colors.textSecondary,
  },
  settingsContainer: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 24,
    gap: 16,
  },
  settingsHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  settingsCopy: {
    flex: 1,
  },
  settingsActions: {
    gap: 12,
    marginTop: 12,
  },
  themeSection: {
    gap: 10,
  },
  themeButtons: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  themeMeta: {
    color: colors.textSecondary,
  },
  accountMenuOverlay: {
    flex: 1,
    justifyContent: "flex-start",
    alignItems: "flex-end",
    backgroundColor: "rgba(0,0,0,0.18)",
    paddingTop: 64,
    paddingHorizontal: 16,
  },
  accountMenuCard: {
    width: 260,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: 14,
    gap: 10,
  },
});
