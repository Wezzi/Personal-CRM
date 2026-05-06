import { forwardRef } from "react";
import { StyleProp, StyleSheet, TextInput, TextInputProps, TextStyle } from "react-native";

import { layout, typography, useTheme, useThemedStyles } from "../../theme/tokens";

type GhostInputProps = TextInputProps & {
  style?: StyleProp<TextStyle>;
};

export const GhostInput = forwardRef<TextInput, GhostInputProps>(
  ({ style, placeholderTextColor, ...props }, ref) => {
    const { colors } = useTheme();
    const styles = useThemedStyles(createStyles);

    return (
      <TextInput
        ref={ref}
        multiline
        textAlignVertical="top"
        placeholderTextColor={placeholderTextColor || colors.textSecondary}
        style={[styles.input, style]}
        {...props}
      />
    );
  }
);

GhostInput.displayName = "GhostInput";

const createStyles = (colors: ReturnType<typeof useTheme>["colors"]) => StyleSheet.create({
  input: {
    ...typography.display,
    color: colors.textPrimary,
    minHeight: 160,
    width: "100%",
    paddingVertical: layout.stackGap,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
});
