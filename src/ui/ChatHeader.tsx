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
import { typography } from "./theme/typography";
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
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);

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
        <Pressable
          style={styles.iconBtn}
          onPress={() => handlePress(onOpenDrawer)}
          hitSlop={10}
          accessibilityLabel={t("chatHeader.openDrawer")}
        >
          <NidoIcon name="menu" size={20} color={colors.text.heading} />
        </Pressable>

        {/* Brand & Mascot (rol: brand — identidad, no mensaje) */}
        <View style={styles.brandContainer}>
          <NidoMascot role="brand" />
          <View style={styles.titleColumn}>
            <View style={styles.titleRow}>
              <Text style={styles.titleText}>NIDO</Text>
              <View style={styles.offlineStatusPill}>
                <View style={styles.offlineDot} />
                <Text style={styles.offlineText}>{t("chatHeader.offline")}</Text>
              </View>
            </View>
            <Text style={styles.modelPillText} numberOfLines={1}>
              {activeModelLabel ? activeModelLabel.toUpperCase() : t("chatHeader.localLlmCore")}
            </Text>
          </View>
        </View>

        {/* Right Action Controls */}
        <View style={styles.rightActions}>
          {/* Tone Selector Pill */}
          <Pressable
            style={styles.tonePill}
            onPress={() => handlePress(onCycleTone)}
            hitSlop={6}
            accessibilityLabel={t("chatHeader.cycleTone")}
          >
            <Text style={styles.tonePillEmoji}>{toneIcon}</Text>
          </Pressable>

          {/* New Chat Button */}
          <Pressable
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
          <Pressable
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

const getStyles = (colors: Colors) => StyleSheet.create({
  headerContainer: {
    backgroundColor: colors.bg.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.default,
    paddingHorizontal: spacing.md,
    paddingTop: 8,
    paddingBottom: 8,
    gap: 6,
  },
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
    padding: 6,
    borderRadius: radii.sm,
    backgroundColor: "rgba(255, 255, 255, 0.05)",
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
    width: 5,
    height: 5,
    borderRadius: 2.5,
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
    backgroundColor: "rgba(255, 255, 255, 0.07)",
    borderColor: colors.border.subtle,
    borderWidth: 1,
    borderRadius: radii.md,
    paddingHorizontal: 9,
    paddingVertical: 5,
    alignItems: "center",
    justifyContent: "center",
  },
  tonePillEmoji: {
    fontSize: 14,
  },
  newChatBtn: {
    width: 32,
    height: 32,
    borderRadius: radii.md,
    backgroundColor: colors.emerald.bgSubtle,
    borderColor: colors.emerald.border,
    borderWidth: 1,
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
