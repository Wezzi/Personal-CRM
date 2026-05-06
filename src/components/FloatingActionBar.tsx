import { StyleProp, StyleSheet, View, ViewStyle } from "react-native";

import { radius, useTheme, useThemedStyles } from "../theme/tokens";
import { Button } from "./ui/Button";

type FloatingAction = {
  label: string;
  onPress: () => void;
  variant?: "primary" | "ghost";
};

type FloatingActionBarProps = {
  actions: FloatingAction[];
  style?: StyleProp<ViewStyle>;
};

export function FloatingActionBar({ actions, style }: FloatingActionBarProps) {
  const styles = useThemedStyles(createStyles);

  return (
    <View style={[styles.container, style]}>
      {actions.map((action) => (
        <Button
          key={action.label}
          label={action.label}
          onPress={action.onPress}
          variant={action.variant || "primary"}
          fullWidth={false}
          style={styles.actionButton}
        />
      ))}
    </View>
  );
}

const createStyles = (colors: ReturnType<typeof useTheme>["colors"]) => StyleSheet.create({
  container: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 18,
    zIndex: 40,
    flexDirection: "row",
    gap: 10,
    padding: 12,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 18,
    elevation: 6,
  },
  actionButton: {
    flex: 1,
  },
});
