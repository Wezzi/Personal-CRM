import { useEffect, useRef } from "react";
import { Animated, StyleSheet, View } from "react-native";

import { radius, useTheme, useThemedStyles } from "../theme/tokens";
import { Typography } from "./ui/Typography";

type LiveEventBadgeProps = {
  label?: string;
  eventDate?: string | null;
};

type EventTiming = "live" | "past" | "upcoming";

function parseDateOnly(value?: string | null) {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }

  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function startOfToday() {
  const today = new Date();
  return new Date(today.getFullYear(), today.getMonth(), today.getDate());
}

function getEventTiming(eventDate?: string | null): EventTiming {
  const parsed = parseDateOnly(eventDate);
  if (!parsed) {
    return "live";
  }

  const eventTime = parsed.getTime();
  const todayTime = startOfToday().getTime();

  if (eventTime < todayTime) {
    return "past";
  }

  if (eventTime > todayTime) {
    return "upcoming";
  }

  return "live";
}

export function LiveEventBadge({ label, eventDate }: LiveEventBadgeProps) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const pulse = useRef(new Animated.Value(0)).current;
  const timing = getEventTiming(eventDate);
  const isLive = timing === "live";
  const badgeLabel = label || (timing === "past" ? "Past event" : timing === "upcoming" ? "Upcoming event" : "Live event");

  useEffect(() => {
    if (!isLive) {
      pulse.setValue(0);
      return;
    }

    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 900,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 900,
          useNativeDriver: true,
        }),
      ])
    );

    animation.start();

    return () => {
      animation.stop();
    };
  }, [isLive, pulse]);

  const dotScale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.35],
  });

  const dotOpacity = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.55, 1],
  });

  return (
    <View style={[styles.badge, timing === "past" ? styles.badgePast : null, timing === "upcoming" ? styles.badgeUpcoming : null]}>
      {isLive ? (
        <Animated.View
          style={[
            styles.dot,
            {
              opacity: dotOpacity,
              transform: [{ scale: dotScale }],
            },
          ]}
        />
      ) : (
        <View style={[styles.dotMuted, timing === "upcoming" ? styles.dotUpcoming : null]} />
      )}
      <Typography variant="caption" style={[styles.text, timing === "past" ? styles.textPast : null, timing === "upcoming" ? styles.textUpcoming : null]}>
        {badgeLabel}
      </Typography>
    </View>
  );
}

const createStyles = (colors: ReturnType<typeof useTheme>["colors"]) => StyleSheet.create({
  badge: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: colors.successSoft,
    borderWidth: 1,
    borderColor: colors.border,
  },
  badgePast: {
    backgroundColor: colors.surfaceMuted,
  },
  badgeUpcoming: {
    backgroundColor: "#DBEAFE",
  },
  dot: {
    width: 9,
    height: 9,
    borderRadius: 999,
    backgroundColor: "#19A64A",
  },
  dotMuted: {
    width: 9,
    height: 9,
    borderRadius: 999,
    backgroundColor: colors.textTertiary,
  },
  dotUpcoming: {
    backgroundColor: "#2563EB",
  },
  text: {
    color: "#17843A",
  },
  textPast: {
    color: colors.textSecondary,
  },
  textUpcoming: {
    color: "#1D4ED8",
  },
});
