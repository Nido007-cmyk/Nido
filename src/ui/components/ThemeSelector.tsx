/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import React from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { impact, ImpactFeedbackStyle } from "../../services/haptics";
import { useTheme, THEMES, FONT_SCALES } from "../theme";
import { useTranslation } from "react-i18next";
import { ThemeId, FontScale } from "../../models/settings";
import { spacing, radii } from "../theme/spacing";

interface Props {
  compact?: boolean;
}

export function ThemeSelector({ compact = false }: Props) {
  const { themeId, fontScale, colors, typography, setTheme, setFontScale } = useTheme();
  const { t } = useTranslation();

  const handleSelectTheme = (id: ThemeId) => {
    impact(ImpactFeedbackStyle.Light);
    setTheme(id);
  };

  const handleSelectFontScale = (scale: FontScale) => {
    impact(ImpactFeedbackStyle.Light);
    setFontScale(scale);
  };

  return (
    <View style={styles.container}>
      {/* 1. Theme Selection */}
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, { color: colors.text.heading }]}>
          {t("themeSelector.paletteTitle")}
        </Text>
        <Text style={[styles.sectionSubtitle, { color: colors.text.dim }]}>
          {t("themeSelector.paletteSubtitle")}
        </Text>
      </View>

      <View style={styles.themesRow}>
        {THEMES.map((t) => {
          const isSelected = themeId === t.id;
          return (
            <Pressable accessibilityRole="button"
              key={t.id}
              style={[
                styles.themeBtn,
                {
                  backgroundColor: t.bg.cardElevated,
                  borderColor: isSelected ? t.border.focus : colors.border.default,
                },
                isSelected && styles.themeBtnSelected,
              ]}
              onPress={() => handleSelectTheme(t.id)}
            >
              <View style={styles.swatchRow}>
                <View style={[styles.swatchDot, { backgroundColor: t.bg.terminal }]} />
                <View style={[styles.swatchDot, { backgroundColor: t.border.focus }]} />
                <View style={[styles.swatchDot, { backgroundColor: t.text.primary }]} />
              </View>
              <View style={styles.themeInfo}>
                <Text style={styles.themeIcon}>{t.icon}</Text>
                <Text
                  style={[
                    styles.themeName,
                    { color: isSelected ? t.text.heading : colors.text.secondary },
                    isSelected && { fontWeight: "800" },
                  ]}
                  numberOfLines={1}
                >
                  {t.name}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      {/* 2. Font Size Selection */}
      <View style={[styles.sectionHeader, { marginTop: spacing.md }]}>
        <Text style={[styles.sectionTitle, { color: colors.text.heading }]}>
          {t("themeSelector.textTitle")}
        </Text>
        <Text style={[styles.sectionSubtitle, { color: colors.text.dim }]}>
          {t("themeSelector.textSubtitle")}
        </Text>
      </View>

      <View style={styles.fontScalesRow}>
        {FONT_SCALES.map((s) => {
          const isSelected = fontScale === s.id;
          return (
            <Pressable accessibilityRole="button"
              key={s.id}
              style={[
                styles.fontBtn,
                {
                  backgroundColor: colors.bg.cardElevated,
                  borderColor: isSelected ? colors.border.focus : colors.border.default,
                },
                isSelected && { backgroundColor: colors.cyan.bgSubtle },
              ]}
              onPress={() => handleSelectFontScale(s.id)}
            >
              <Text
                style={[
                  styles.fontSample,
                  {
                    color: isSelected ? colors.text.accentCyan : colors.text.muted,
                    fontSize: s.id === "compact" ? 12 : s.id === "standard" ? 15 : 19,
                  },
                ]}
              >
                {s.sample}
              </Text>
              <Text
                style={[
                  styles.fontLabel,
                  {
                    color: isSelected ? colors.text.heading : colors.text.secondary,
                    fontWeight: isSelected ? "800" : "600",
                  },
                ]}
              >
                {s.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* 3. Live Interactive Preview */}
      {!compact && (
        <View
          style={[
            styles.previewContainer,
            {
              backgroundColor: colors.bg.terminal,
              borderColor: colors.border.default,
            },
          ]}
        >
          <View style={styles.previewHeader}>
            <View style={styles.previewHeaderLeft}>
              <View style={[styles.liveDot, { backgroundColor: colors.emerald[400] }]} />
              <Text style={[styles.previewHeaderTitle, { color: colors.text.muted }]}>
                {t("themeSelector.previewTitle")}
              </Text>
            </View>
            <Text style={[styles.previewBadge, { color: colors.text.accentCyan }]}>
              {themeId.toUpperCase()} • {fontScale.toUpperCase()}
            </Text>
          </View>

          <View
            style={[
              styles.previewBubble,
              {
                backgroundColor: colors.bg.cardElevated,
                borderColor: colors.border.default,
              },
            ]}
          >
            <Text style={[typography.ui.caption, { color: colors.text.accentEmerald }]}>
              NIDO
            </Text>
            <Text style={[typography.ui.body, { color: colors.text.primary, marginTop: 4 }]}>
              {t("themeSelector.previewBody")}
            </Text>
            <View style={styles.previewTelemetryRow}>
              <Text style={[typography.mono.xs, { color: colors.text.dim }]}>
                {t("themeSelector.previewMeta")}
              </Text>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.sm,
  },
  sectionHeader: {
    gap: 2,
  },
  sectionTitle: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.6,
  },
  sectionSubtitle: {
    fontSize: 11,
    lineHeight: 15,
  },
  themesRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: 4,
  },
  themeBtn: {
    flex: 1,
    padding: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
    gap: 6,
  },
  themeBtnSelected: {
    borderWidth: 2,
  },
  swatchRow: {
    flexDirection: "row",
    gap: 4,
  },
  swatchDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
  },
  themeInfo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  themeIcon: {
    fontSize: 12,
  },
  themeName: {
    fontSize: 11,
    flex: 1,
  },
  fontScalesRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: 4,
  },
  fontBtn: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: radii.md,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  fontSample: {
    fontWeight: "900",
  },
  fontLabel: {
    fontSize: 11,
  },
  previewContainer: {
    marginTop: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    padding: spacing.sm,
    gap: 8,
  },
  previewHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  previewHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  previewHeaderTitle: {
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  previewBadge: {
    fontSize: 9,
    fontWeight: "700",
  },
  previewBubble: {
    borderRadius: radii.sm,
    borderWidth: 1,
    padding: spacing.sm,
  },
  previewTelemetryRow: {
    marginTop: 6,
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.05)",
  },
});
