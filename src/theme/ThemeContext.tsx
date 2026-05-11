import { createContext, ReactNode, useContext } from "react";

export type ThemeMode = "light" | "dark";

export const lightColors = {
  primaryAction: "#10B981",
  primaryActionHover: "#059669",
  background: "#F8FAFC",
  surface: "#FFFFFF",
  surfaceMuted: "#F8FAFC",
  surfaceStrong: "#E2E8F0",
  border: "#E2E8F0",
  textPrimary: "#0F172A",
  textSecondary: "#64748B",
  textTertiary: "#64748B",
  destructive: "#DC2626",
  success: "#059669",
  successSoft: "#D1FAE5",
  accentSoft: "#F8FAFC",
  attention: "#DC2626",
  attentionSoft: "#FEE2E2",
  risk: "#DC2626",
  riskSoft: "#FEE2E2",
  highlight: "#10B981",
  highlightSoft: "#D1FAE5",
} as const;

export const darkColors = {
  primaryAction: "#10B981",
  primaryActionHover: "#34D399",
  background: "#0F172A",
  surface: "#1E293B",
  surfaceMuted: "#0F172A",
  surfaceStrong: "#334155",
  border: "#334155",
  textPrimary: "#F8FAFC",
  textSecondary: "#94A3B8",
  textTertiary: "#64748B",
  destructive: "#F87171",
  success: "#10B981",
  successSoft: "#064E3B",
  accentSoft: "#0F172A",
  attention: "#EF4444",
  attentionSoft: "rgba(220, 38, 38, 0.15)",
  risk: "#EF4444",
  riskSoft: "rgba(220, 38, 38, 0.15)",
  highlight: "#10B981",
  highlightSoft: "#064E3B",
} as const;

export type AppColors = { readonly [Key in keyof typeof lightColors]: string };

const ThemeContext = createContext<{ mode: ThemeMode; colors: AppColors }>({
  mode: "dark",
  colors: darkColors,
});

export function getThemeColors(mode: ThemeMode) {
  return (mode === "dark" ? darkColors : lightColors) as AppColors;
}

export function ThemeProvider({ children, mode }: { children: ReactNode; mode: ThemeMode }) {
  return <ThemeContext.Provider value={{ mode, colors: getThemeColors(mode) }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
