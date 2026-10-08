/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import React, { useMemo } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { impact, ImpactFeedbackStyle } from "../services/haptics";
import { useTranslation } from "react-i18next";
import { PersonalDocumentsManager } from "./PersonalDocumentsManager";
import { useTheme } from "./theme";
import type { Colors } from "./theme/colors";
import type { Typography } from "./theme/typography";
import { NidoIcon } from "./components/icons/NidoIcon";
import { calmSpacing, calmRadii, calmShadows } from "./theme/calm";

/**
 * Drawer shortcut straight to "manage my documents" — the same
 * PersonalDocumentsManager also embedded in Settings > Knowledge Base
 * (CorpusSettingsTab), so users who just want to add/toggle/remove their
 * own notes don't have to go through Settings to get there. Settings keeps
 * its own path too, alongside the downloadable corpus packs.
 */
export function KnowledgeBaseScreen({ onClose }: { onClose: () => void }) {
  const { colors, typography } = useTheme();
  const styles = useMemo(() => getStyles(colors, typography), [colors, typography]);
  const { t } = useTranslation();
  const handleClose = () => {
    impact(ImpactFeedbackStyle.Light);
    onClose();
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <NidoIcon name="knowledge" size={20} />
          <Text style={styles.title}>{t("knowledgeBaseScreen.title")}</Text>
        </View>
        <Pressable onPress={handleClose} hitSlop={8} style={styles.closeBtn}
            accessibilityRole="button"
            accessibilityLabel={t("common.done")}>
          <Text style={styles.closeBtnText}>{t("common.done")}</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.body}>
        <PersonalDocumentsManager />
      </ScrollView>
    </View>
  );
}

const getStyles = (colors: Colors, typography: Typography) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg.surface },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: calmSpacing.comfortable,
    paddingVertical: calmSpacing.comfortable,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.default,
    backgroundColor: colors.bg.cardElevated,
    ...calmShadows.none,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: calmSpacing.cozy,
  },
  headerIcon: {
    fontSize: 18,
  },
  title: {
    ...typography.ui.titleSm,
    color: colors.text.heading,
  },
  closeBtn: {
    paddingHorizontal: calmSpacing.cozy,
    paddingVertical: calmSpacing.tight,
    borderRadius: calmRadii.subtle,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
  },
  closeBtnText: {
    ...typography.mono.xs,
    color: colors.text.accentCyan,
    fontWeight: "800",
  },
  body: { paddingBottom: calmSpacing.generous },
});
