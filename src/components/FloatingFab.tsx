import { Pressable, StyleProp, StyleSheet, ViewStyle } from "react-native";

import { layout, useTheme, useThemedStyles } from "../theme/tokens";
import { Typography } from "./ui/Typography";

type FloatingFabProps = {
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
  label?: string;
  extended?: boolean;
};

export function FloatingFab({ onPress, style, label = "+", extended = false }: FloatingFabProps) {
  const styles = useThemedStyles(createStyles);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Add note"
      onPress={onPress}
      style={({ pressed }) => [
        styles.fabBase,
        extended ? styles.extendedFab : styles.roundFab,
        pressed ? styles.pressed : null,
        style,
      ]}
    >
      {extended ? (
        <>
          <Typography variant="h2" style={styles.plusLabel}>
            +
          </Typography>
          <Typography variant="body" style={styles.extendedLabel}>
            {label}
          </Typography>
        </>
      ) : (
        <Typography variant="h1" style={styles.roundLabel}>
          {label}
        </Typography>
      )}
    </Pressable>
  );
}

const createStyles = (colors: ReturnType<typeof useTheme>["colors"]) => StyleSheet.create({
  fabBase: {
    position: "absolute",
    right: 24,
    bottom: 28,
    zIndex: 50,
    borderRadius: 999,
    backgroundColor: colors.primaryAction,
    borderWidth: 1,
    borderColor: colors.primaryAction,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.18,
    shadowRadius: 18,
    elevation: 8,
  },
  roundFab: {
    width: 60,
    height: 60,
  },
  extendedFab: {
    minHeight: 56,
    minWidth: 180,
    paddingHorizontal: 20,
  },
  roundLabel: {
    color: colors.onPrimary,
    lineHeight: 28,
    marginTop: -2,
  },
  plusLabel: {
    color: colors.onPrimary,
  },
  extendedLabel: {
    color: colors.onPrimary,
    fontWeight: "700",
  },
  pressed: {
    opacity: 0.9,
    transform: [{ scale: 0.98 }],
  },
});
