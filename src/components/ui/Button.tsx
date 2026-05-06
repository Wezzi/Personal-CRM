import { ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleProp,
  StyleSheet,
  ViewStyle,
} from "react-native";

import { layout, radius, useTheme, useThemedStyles } from "../../theme/tokens";
import { Typography } from "./Typography";

type ButtonVariant = "primary" | "ghost";

type ButtonSize = "default" | "compact";

type ButtonProps = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  leftIcon?: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  style?: StyleProp<ViewStyle>;
};

export function Button({
  label,
  onPress,
  disabled,
  loading,
  fullWidth = true,
  leftIcon,
  variant = "primary",
  size = "default",
  style,
}: ButtonProps) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const isDisabled = disabled || loading;
  const primary = variant === "primary";

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        fullWidth && styles.fullWidth,
        size === "compact" ? styles.compact : null,
        primary ? styles.primary : styles.ghost,
        pressed && !isDisabled ? styles.pressed : null,
        isDisabled ? styles.disabled : null,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={primary ? colors.onPrimary : colors.primaryAction} />
      ) : (
        <>
          {leftIcon}
          <Typography
            variant="body"
            style={[styles.label, primary ? styles.primaryLabel : styles.ghostLabel]}
            numberOfLines={1}
          >
            {label}
          </Typography>
        </>
      )}
    </Pressable>
  );
}

const createStyles = (colors: ReturnType<typeof useTheme>["colors"]) => StyleSheet.create({
  base: {
    minHeight: layout.minTouchTarget,
    borderRadius: radius.button,
    paddingHorizontal: 18,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 10,
  },
  compact: {
    minHeight: 38,
    paddingHorizontal: 14,
    borderRadius: 14,
  },
  fullWidth: {
    width: "100%",
  },
  primary: {
    backgroundColor: colors.primaryAction,
    borderWidth: 1,
    borderColor: colors.primaryAction,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 2,
  },
  ghost: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  label: {
    flexShrink: 1,
    textAlign: "center",
  },
  primaryLabel: {
    color: colors.onPrimary,
    fontWeight: "700",
  },
  ghostLabel: {
    color: colors.primaryAction,
    fontWeight: "600",
  },
  pressed: {
    opacity: 0.92,
    transform: [{ scale: 0.99 }],
  },
  disabled: {
    opacity: 0.45,
  },
});
