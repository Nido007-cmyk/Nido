/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */
import React, { useMemo } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { impact, ImpactFeedbackStyle } from "../services/haptics";
import { useTranslation } from "react-i18next";
import { useTheme } from "./theme";
import type { Colors } from "./theme/colors";
import { NidoIcon } from "./components/icons/NidoIcon";
import { NidoMascot } from "./components/calm/NidoMascot";
import type { Typography } from "./theme/typography";
import { spacing, radii } from "./theme/spacing";

interface Props {
  toneIcon: string;
  deepResearchActive: boolean;
  activeModelLabel?: string;
  onOpenDrawer: () => void;
  onCycleTone: () => void;
  onNewChat: () => void;
  onToggleDeepResearch?: () => void;
}

/**
 * ChatHeader: Calm Agent top bar.
 * NIDO mascot, offline status, deep research indicator, quick actions.
 */
export function ChatHeader({
  toneIcon,
  deepResearchActive,
  activeModelLabel,
  onOpenDrawer,
  onCycleTone,
  onNewChat,
  onToggleDeepResearch,
}: Props) {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
  const styles = useMemo(() => getStyles(colors, typography), [colors, typography]);

  const handlePress = (callback: () => void, feedback: ImpactFeedbackStyle = ImpactFeedbackStyle.Light) => {
    impact(feedback);
    callback();
  };

  return (
    <View
      style={[
        styles.headerContainer,
        deepResearchActive && styles.headerContainerDeepResearch,
      ]}
    >
      <View style={styles.topRow}>
        {/* Drawer Hamburger */}
        <Pressable accessibilityRole="button"
          style={styles.iconBtn}
          onPress={() => handlePress(onOpenDrawer)}
          hitSlop={10}
          accessibilityLabel={t("chatHeader.openDrawer")}
        >
          <NidoIcon name="menu" size={20} color={colors.text.heading} />
        </Pressable>

        {/* Brand & Mascot (rol: brand — identidad, no mensaje) */}
        <View style={styles.brandContainer}>
          <NidoMascot role="brand" size={34} />
          <View style={styles.titleColumn}>
            <View style={styles.titleRow}>
              <Text style={styles.titleText}>NIDO</Text>
            </View>
            {/* Rediseño 2026-10-10: estado en lenguaje llano. El nombre técnico
                del modelo se sigue leyendo por accesibilidad y vive en Ajustes. */}
            <View
              style={styles.statusRow}
              accessible
              accessibilityLabel={`${t("chatHeader.statusLine")}. ${activeModelLabel ?? t("chatHeader.localLlmCore")}`}
            >
              <View style={styles.offlineDot} />
              <Text style={styles.statusText} numberOfLines={1}>
                {t("chatHeader.statusLine")}
              </Text>
            </View>
          </View>
        </View>

        {/* Right Action Controls */}
        <View style={styles.rightActions}>
          {/* Tone Selector Pill */}
          <Pressable accessibilityRole="button"
            style={styles.tonePill}
            onPress={() => handlePress(onCycleTone)}
            hitSlop={6}
            accessibilityLabel={t("chatHeader.cycleTone")}
          >
            <Text style={styles.tonePillEmoji}>{toneIcon}</Text>
          </Pressable>

          {/* New Chat Button */}
          <Pressable accessibilityRole="button"
            style={styles.newChatBtn}
            onPress={() => handlePress(onNewChat, ImpactFeedbackStyle.Medium)}
            hitSlop={6}
            accessibilityLabel={t("chatHeader.newChatSession")}
          >
            <NidoIcon name="new-chat" size={18} color={colors.text.accentEmerald} />
          </Pressable>
        </View>
      </View>

      {/* Sub-bar: Telemetry & Deep Research Indicator / Toggle */}
      <View style={styles.subBar}>
        {onToggleDeepResearch ? (
          <Pressable accessibilityRole="button" accessibilityLabel={t("chatHeader.deepResearch")}
            style={[
              styles.deepResearchPill,
              deepResearchActive && styles.deepResearchPillActive,
            ]}
            onPress={() => handlePress(onToggleDeepResearch, ImpactFeedbackStyle.Medium)}
            hitSlop={6}
          >
            <NidoIcon name="deep-research" size={14} />
            <Text
              style={[
                styles.deepResearchText,
                deepResearchActive && styles.deepResearchTextActive,
              ]}
            >
              {t("chatHeader.deepResearch")}
            </Text>
            <View
              style={[
                styles.deepResearchStatusIndicator,
                deepResearchActive && styles.deepResearchStatusIndicatorActive,
              ]}
            />
          </Pressable>
        ) : deepResearchActive ? (
          <View style={[styles.deepResearchPill, styles.deepResearchPillActive]}>
            <NidoIcon name="deep-research" size={14} />
            <Text style={[styles.deepResearchText, styles.deepResearchTextActive]}>
              {t("chatHeader.deepResearchActive")}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const getStyles = (colors: Colors, typography: Typography) => StyleSheet.create({
  headerContainer: {
    backgroundColor: colors.bg.black,
    borderBottomWidth: 0,
    borderBottomColor: "transparent",
    paddingHorizontal: spacing.md,
    paddingTop: 8,
    paddingBottom: 8,
    gap: 6,
  },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 1 },
  statusText: { ...typography.ui.subtext, color: colors.text.secondary },
  headerContainerDeepResearch: {
    backgroundColor: "#111028",
    borderBottomColor: colors.border.frontier,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  hamburgerIcon: {
    color: colors.text.heading,
    fontSize: 18,
    fontWeight: "700",
  },
  brandContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1,
    marginLeft: 8,
  },
  titleColumn: {
    flex: 1,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  titleText: {
    ...typography.ui.title,
    color: colors.text.heading,
    letterSpacing: 0.5,
  },
  offlineStatusPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.emerald.bgSubtle,
    borderColor: colors.emerald.border,
    borderWidth: 1,
    borderRadius: radii.xs,
    paddingHorizontal: 5,
    paddingVertical: 1,
    gap: 3,
  },
  offlineDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.emerald[400],
  },
  offlineText: {
    ...typography.mono.xs,
    fontSize: 8,
    fontWeight: "800",
    color: colors.text.accentEmerald,
  },
  modelPillText: {
    ...typography.mono.xs,
    color: colors.text.dim,
    marginTop: 1,
  },
  rightActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  tonePill: {
    backgroundColor: colors.bg.card,
    borderColor: colors.border.default,
    borderWidth: 1,
    borderRadius: 16,
    height: 32,
    paddingHorizontal: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  tonePillEmoji: {
    fontSize: 14,
  },
  newChatBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: colors.emerald.bgSubtle,
    borderColor: "transparent",
    borderWidth: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  newChatIcon: {
    color: colors.text.accentEmerald,
    fontSize: 18,
    fontWeight: "700",
    marginTop: -1,
  },
  subBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  deepResearchPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    borderColor: colors.border.subtle,
    borderWidth: 1,
    borderRadius: radii.sm,
    paddingHorizontal: 8,
    paddingVertical: 4,
    gap: 5,
  },
  deepResearchPillActive: {
    backgroundColor: colors.frontier.badgeBg,
    borderColor: colors.frontier.badgeBorder,
  },
  deepResearchIcon: {
    fontSize: 11,
  },
  deepResearchText: {
    ...typography.mono.xs,
    color: colors.text.muted,
    fontWeight: "600",
  },
  deepResearchTextActive: {
    color: colors.frontier.text,
    fontWeight: "700",
  },
  deepResearchStatusIndicator: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.text.dim,
  },
  deepResearchStatusIndicatorActive: {
    backgroundColor: colors.frontier.glow,
  },
  telemetryBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(6, 182, 212, 0.12)",
    borderColor: colors.cyan.border,
    borderWidth: 1,
    borderRadius: radii.sm,
    paddingHorizontal: 8,
    paddingVertical: 3,
    gap: 5,
    marginLeft: "auto",
  },
  telemetryPulseDot: {
    color: colors.cyan[400],
    fontSize: 8,
  },
  telemetryText: {
    ...typography.mono.xs,
    color: colors.text.accentCyan,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  telemetryUnit: {
    color: colors.text.muted,
    fontWeight: "500",
  },
});
