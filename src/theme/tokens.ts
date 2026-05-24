import { createContext, createElement, ReactNode, useContext, useEffect, useMemo, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Appearance, Platform, StyleSheet, useColorScheme } from "react-native";

export type ThemePreference = "system" | "light" | "dark";

const THEME_PREFERENCE_STORAGE_KEY = "blackbook.theme_preference";

const lightColors = {
  primaryAction: "#10B981",
  primaryActionHover: "#059669",
  background: "#F8FAFC",
  surface: "#FFFFFF",
  surfaceMuted: "#F1F5F9",
  surfaceStrong: "#E2E8F0",
  border: "#CBD5E1",
  textPrimary: "#0F172A",
  textSecondary: "#475569",
  textTertiary: "#64748B",
  onPrimary: "#F8FAFC",
  destructive: "#DC2626",
  success: "#10B981",
  successSoft: "rgba(16, 185, 129, 0.12)",
  accentSoft: "#FEE2E2",
} as const;

const darkColors = {
  primaryAction: "#22C55E",
  primaryActionHover: "#4ADE80",
  background: "#0B1220",
  surface: "#172033",
  surfaceMuted: "#111827",
  surfaceStrong: "#263349",
  border: "#475569",
  textPrimary: "#F8FAFC",
  textSecondary: "#CBD5E1",
  textTertiary: "#94A3B8",
  onPrimary: "#F8FAFC",
  destructive: "#EF4444",
  success: "#34D399",
  successSoft: "rgba(16, 185, 129, 0.18)",
  accentSoft: "rgba(220, 38, 38, 0.15)",
} as const;

export type AppColors = {
  primaryAction: string;
  primaryActionHover: string;
  background: string;
  surface: string;
  surfaceMuted: string;
  surfaceStrong: string;
  border: string;
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  onPrimary: string;
  destructive: string;
  success: string;
  successSoft: string;
  accentSoft: string;
};

export const colors: AppColors =
  Appearance.getColorScheme() === "dark" ? darkColors : lightColors;

type ThemeContextValue = {
  colors: AppColors;
  preference: ThemePreference;
  resolvedScheme: "light" | "dark";
  setPreference: (preference: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue>({
  colors,
  preference: "system",
  resolvedScheme: Appearance.getColorScheme() === "dark" ? "dark" : "light",
  setPreference: () => undefined,
});

async function storageGetItem(key: string) {
  try {
    if (Platform.OS === "web") {
      return typeof window === "undefined" ? null : window.localStorage.getItem(key);
    }

    return AsyncStorage.getItem(key);
  } catch {
    return null;
  }
}

async function storageSetItem(key: string, value: string) {
  try {
    if (Platform.OS === "web") {
      if (typeof window !== "undefined") {
        window.localStorage.setItem(key, value);
      }
      return;
    }

    await AsyncStorage.setItem(key, value);
  } catch {
    // Theme choice is nice-to-have; rendering the app matters more.
  }
}

function resolveScheme(preference: ThemePreference, systemScheme?: string | null): "light" | "dark" {
  if (preference === "light" || preference === "dark") {
    return preference;
  }

  return systemScheme === "dark" ? "dark" : "light";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>("system");

  useEffect(() => {
    let isMounted = true;

    async function hydrateThemePreference() {
      const storedPreference = await storageGetItem(THEME_PREFERENCE_STORAGE_KEY);
      if (!isMounted) {
        return;
      }

      if (
        storedPreference === "system" ||
        storedPreference === "light" ||
        storedPreference === "dark"
      ) {
        setPreferenceState(storedPreference);
      }
    }

    void hydrateThemePreference();

    return () => {
      isMounted = false;
    };
  }, []);

  const resolvedScheme = resolveScheme(preference, systemScheme);
  const palette = resolvedScheme === "dark" ? darkColors : lightColors;

  useEffect(() => {
    const setColorScheme = (
      Appearance as typeof Appearance & {
        setColorScheme?: (scheme: "light" | "dark" | null | undefined) => void;
      }
    ).setColorScheme;

    if (typeof setColorScheme === "function") {
      setColorScheme(preference === "system" ? null : preference);
    }
  }, [preference]);

  async function setPreference(nextPreference: ThemePreference) {
    setPreferenceState(nextPreference);
    await storageSetItem(THEME_PREFERENCE_STORAGE_KEY, nextPreference);
  }

  const value = useMemo(
    () => ({
      colors: palette,
      preference,
      resolvedScheme,
      setPreference,
    }),
    [palette, preference, resolvedScheme]
  );

  return createElement(ThemeContext.Provider, { value }, children);
}

export function useTheme() {
  return useContext(ThemeContext);
}

export function useThemedStyles<T>(factory: (colors: AppColors) => T): T {
  const { colors: palette } = useTheme();
  return useMemo(() => factory(palette), [palette, factory]);
}

export const spacing = {
  xs: 8,
  sm: 12,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

export const radius = {
  card: 22,
  cardLg: 28,
  button: 18,
  pill: 999,
} as const;

const displayFont = Platform.select({ ios: "Georgia", android: "serif", default: "Georgia" });

export const typography = {
  display: {
    fontSize: 34,
    lineHeight: 40,
    fontWeight: "500" as const,
    fontFamily: displayFont,
  },
  h1: {
    fontSize: 30,
    lineHeight: 36,
    fontWeight: "700" as const,
    fontFamily: displayFont,
  },
  h2: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "600" as const,
  },
  body: {
    fontSize: 16,
    lineHeight: 23,
    fontWeight: "400" as const,
  },
  caption: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "600" as const,
    letterSpacing: 1.1,
  },
} as const;

export const layout = {
  screenPaddingHorizontal: spacing.lg,
  stackGap: spacing.md,
  sectionGap: spacing.lg,
  minTouchTarget: 48,
  stickyBottomInset: 104,
} as const;
