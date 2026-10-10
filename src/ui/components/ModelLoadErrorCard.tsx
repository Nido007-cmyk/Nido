/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import React, { useMemo } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { impact, ImpactFeedbackStyle } from "../../services/haptics";
import { useTranslation } from "react-i18next";
import { NidoIcon } from "./icons/NidoIcon";
import { useTheme } from "../theme";
import type { Colors } from "../theme/colors";
import { diagnose } from "./modelLoadDiagnosis";
import type { Typography } from "../theme/typography";
import { spacing, radii } from "../theme/spacing";

export interface ModelLoadErrorCardProps {
  error: string;
  onOpenSettings?: () => void;
  onRelaunchWizard?: () => void;
  onRetry?: () => void;
}

export function ModelLoadErrorCard({
  error,
  onOpenSettings,
  onRelaunchWizard,
  onRetry,
}: ModelLoadErrorCardProps) {
  const { colors, typography } = useTheme();
  const styles = useMemo(() => getStyles(colors, typography), [colors, typography]);
  const { t } = useTranslation();
  const diagnosis = diagnose(error, t);

  const handleAction = (callback?: () => void) => {
    impact(ImpactFeedbackStyle.Light);
    callback?.();
  };

  // Storage and memory are both actionable local-resource issues:
  // amber treatment, never the generic danger framing.
  const isResourceIssue = diagnosis.category === "memory" || diagnosis.category === "storage";
  const isMemory = diagnosis.category === "memory";

  return (
    <View style={[styles.container, isResourceIssue ? styles.amberBorder : styles.dangerBorder]}>
      {/* Terminal Title Bar */}
      <View style={styles.header}>
        <View style={styles.badgeRow}>
          {isMemory ? (
            <Text style={styles.icon}>⚡</Text>
          ) : (
            <NidoIcon name="warning" size={14} />
          )}
          <Text style={[styles.badgeText, isResourceIssue ? styles.badgeTextAmber : styles.badgeTextDanger]}>
            {diagnosis.title.toUpperCase()}
          </Text>
        </View>
        <Text style={styles.codeTag}>ERR_LOCAL_INIT</Text>
      </View>

      {/* Diagnostic Message */}
      <View style={styles.body}>
        <Text style={styles.detailText}>{diagnosis.detail}</Text>
        <View style={styles.recommendationBox}>
          <Text style={styles.recommendationLabel}>{t("modelLoadErrorCard.actionRequired")}</Text>
          <Text style={styles.recommendationText}>{diagnosis.recommendation}</Text>
        </View>
      </View>

      {/* Action Shortcuts */}
      <View style={styles.actionsRow}>
        {onRetry && (
          <Pressable accessibilityRole="button" accessibilityLabel={t("common.retry")}
            style={styles.retryBtn}
            onPress={() => handleAction(onRetry)}
            android_ripple={{ color: "rgba(255,255,255,0.1)" }}
          >
            <View style={styles.btnRow}>
              <NidoIcon name="refresh" size={13} color={colors.text.accentEmerald} />
              <Text style={styles.retryBtnText}>{t("common.retry")}</Text>
            </View>
          </Pressable>
        )}
        {onOpenSettings && (
          <Pressable accessibilityRole="button" accessibilityLabel={t("modelLoadErrorCard.settings")}
            style={styles.actionBtn}
            onPress={() => handleAction(onOpenSettings)}
            android_ripple={{ color: "rgba(255,255,255,0.1)" }}
          >
            <View style={styles.btnRow}>
              <NidoIcon name="settings" size={13} color={colors.text.heading} />
              <Text style={styles.actionBtnText}>{t("modelLoadErrorCard.settings")}</Text>
            </View>
          </Pressable>
        )}
        {onRelaunchWizard && (
          <Pressable accessibilityRole="button" accessibilityLabel={t("modelLoadErrorCard.setupWizard")}
            style={[styles.actionBtn, styles.wizardBtn]}
            onPress={() => handleAction(onRelaunchWizard)}
            android_ripple={{ color: "rgba(6,182,212,0.2)" }}
          >
            <View style={styles.btnRow}>
              <NidoIcon name="wizard" size={13} color={colors.text.accentCyan} />
              <Text style={styles.wizardBtnText}>{t("modelLoadErrorCard.setupWizard")}</Text>
            </View>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const getStyles = (colors: Colors, typography: Typography) => StyleSheet.create({
  container: {
    marginHorizontal: spacing.md,
    marginVertical: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: colors.bg.cardElevated,
    borderWidth: 1,
    gap: spacing.sm,
  },
  amberBorder: {
    borderColor: colors.border.amber,
    backgroundColor: "rgba(245, 158, 11, 0.06)",
  },
  dangerBorder: {
    borderColor: colors.border.danger,
    backgroundColor: "rgba(239, 68, 68, 0.06)",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: colors.border.subtle,
    paddingBottom: spacing.xs,
  },
  badgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  icon: {
    fontSize: 16,
  },
  badgeText: {
    ...typography.ui.titleSm,
    letterSpacing: 0.5,
  },
  badgeTextAmber: {
    color: colors.text.accentAmber,
  },
  badgeTextDanger: {
    color: colors.crimson[400],
  },
  codeTag: {
    ...typography.mono.xs,
    color: colors.text.dim,
    backgroundColor: "rgba(0,0,0,0.3)",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radii.xs,
  },
  body: {
    gap: spacing.xs,
  },
  detailText: {
    ...typography.ui.body,
    color: colors.text.primary,
    lineHeight: 20,
  },
  recommendationBox: {
    backgroundColor: "rgba(0, 0, 0, 0.4)",
    borderRadius: radii.sm,
    padding: spacing.sm,
    borderLeftWidth: 2,
    borderLeftColor: colors.cyan[500],
    marginTop: 4,
    gap: 2,
  },
  recommendationLabel: {
    ...typography.mono.xs,
    color: colors.text.accentCyan,
    fontWeight: "700",
  },
  recommendationText: {
    ...typography.ui.caption,
    color: colors.text.secondary,
    lineHeight: 16,
  },
  actionsRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  btnRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  retryBtn: {
    flex: 1,
    backgroundColor: colors.emerald.bgSubtle,
    borderColor: colors.emerald.border,
    borderWidth: 1,
    borderRadius: radii.md,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  retryBtnText: {
    ...typography.ui.titleSm,
    color: colors.text.accentEmerald,
  },
  actionBtn: {
    flex: 1,
    backgroundColor: "rgba(255, 255, 255, 0.07)",
    borderColor: colors.border.default,
    borderWidth: 1,
    borderRadius: radii.md,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  actionBtnText: {
    ...typography.ui.titleSm,
    color: colors.text.heading,
  },
  wizardBtn: {
    backgroundColor: colors.cyan.bgSubtle,
    borderColor: colors.cyan.border,
  },
  wizardBtnText: {
    ...typography.ui.titleSm,
    color: colors.text.accentCyan,
  },
});
