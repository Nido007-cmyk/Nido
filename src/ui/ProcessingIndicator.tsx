import React, { useEffect, useMemo, useRef } from "react";
import { View, Text, StyleSheet, Animated } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "./theme";
import type { Colors } from "./theme/colors";
import { typography } from "./theme/typography";
import { radii } from "./theme/spacing";

export type ProcessingStatus = "idle" | "retrieving" | "thinking" | "generating";

function BouncingDot({ delay }: { delay: number }) {
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const y = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(y, { toValue: -4, duration: 300, useNativeDriver: true }),
        Animated.timing(y, { toValue: 0, duration: 300, useNativeDriver: true }),
        Animated.delay(400 - delay),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [delay, y]);

  return <Animated.View style={[styles.dot, { transform: [{ translateY: y }] }]} />;
}

export function ProcessingIndicator({
  status,
  label,
}: {
  status: Exclude<ProcessingStatus, "idle">;
  label?: string;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const { t } = useTranslation();
  const STATUS_LABEL: Record<Exclude<ProcessingStatus, "idle">, string> = {
    retrieving: t("processingIndicator.retrieving"),
    thinking: t("processingIndicator.thinking"),
    generating: t("processingIndicator.generating"),
  };
  const pulse = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 600, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.4, duration: 600, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const isDeep = label?.includes("🔬") || status === "thinking";

  return (
    <View style={styles.row}>
      <Animated.View
        style={[
          styles.statusDot,
          isDeep ? styles.statusDotFrontier : styles.statusDotEmerald,
          { opacity: pulse },
        ]}
      />
      <Text
        style={[
          styles.label,
          isDeep ? styles.labelFrontier : styles.labelDefault,
        ]}
      >
        {label ?? STATUS_LABEL[status]}
      </Text>
      <View style={styles.dots}>
        <BouncingDot delay={0} />
        <BouncingDot delay={130} />
        <BouncingDot delay={260} />
      </View>
    </View>
  );
}

const getStyles = (colors: Colors) => StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 4,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusDotEmerald: {
    backgroundColor: colors.emerald[400],
  },
  statusDotFrontier: {
    backgroundColor: colors.frontier.glow,
  },
  label: {
    ...typography.ui.body,
    fontSize: 13,
  },
  labelDefault: {
    color: colors.text.secondary,
  },
  labelFrontier: {
    color: colors.frontier.text,
    fontWeight: "600",
  },
  dots: {
    flexDirection: "row",
    gap: 4,
    marginLeft: 2,
  },
  dot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.cyan[400],
  },
});
