/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * 0.1.56 — Library tab: your documents, learning NIDO, and the way to the
 * knowledge packs. It reuses the existing pieces (PersonalDocumentsManager,
 * the user guide, the prompt ideas and Settings' knowledge-pack list, embedded)
 * so no control changes behaviour; only where it lives.
 */
import React, { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "./theme/ThemeContext";
import type { Colors } from "./theme/colors";
import type { Typography } from "./theme/typography";
import { NidoIcon } from "./components/icons/NidoIcon";
import { PersonalDocumentsManager } from "./PersonalDocumentsManager";
import { ModelSetupScreen } from "./ModelSetupScreen";

type Section = "documents" | "learn" | "packs";

interface Props {
  onOpenGuide: () => void;
  onOpenPromptIdeas: () => void;
}

export function LibraryScreen({ onOpenGuide, onOpenPromptIdeas }: Props) {
  const { colors, typography } = useTheme();
  const styles = useMemo(() => getStyles(colors, typography), [colors, typography]);
  const { t } = useTranslation();
  const [section, setSection] = useState<Section>("packs");

  const tabs: Array<{ key: Section; label: string }> = [
    { key: "packs", label: t("library.tabPacks") },
    { key: "documents", label: t("library.tabDocuments") },
    { key: "learn", label: t("library.tabLearn") },
  ];

  return (
    <View style={styles.container}>
      <Text style={styles.title} accessibilityRole="header">
        {t("library.title")}
      </Text>
      <View style={styles.segment} accessibilityRole="tablist">
        {tabs.map((tab) => {
          const on = tab.key === section;
          return (
            <Pressable
              key={tab.key}
              onPress={() => setSection(tab.key)}
              style={[styles.segmentItem, on && styles.segmentItemOn]}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
            >
              <Text style={[styles.segmentText, on && styles.segmentTextOn]} numberOfLines={1}>
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {section === "packs" ? (
        // Same download / remove / multilingual-search logic as Settings, embedded.
        <View style={styles.flex}>
          <ModelSetupScreen mode="optional" section="knowledge" onClose={() => {}} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {section === "documents" && <PersonalDocumentsManager />}

          {section === "learn" && (
            <View style={styles.card}>
              <View style={styles.cardHead}>
                <NidoIcon name="compass" size={20} color={colors.emerald[500]} />
                <Text style={styles.cardTitle}>{t("library.learnTitle")}</Text>
              </View>
              <Text style={styles.note}>{t("library.learnBody")}</Text>
              <Pressable onPress={onOpenGuide} style={styles.primaryBtn} accessibilityRole="button">
                <Text style={styles.primaryBtnText}>{t("library.openGuide")}</Text>
              </Pressable>
              <Pressable onPress={onOpenPromptIdeas} style={styles.secondaryBtn} accessibilityRole="button">
                <Text style={styles.secondaryBtnText}>{t("library.promptIdeas")}</Text>
              </Pressable>
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const getStyles = (colors: Colors, typography: Typography) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg.black },
    flex: { flex: 1, marginTop: 8 },
    title: { ...typography.ui.headline, color: colors.text.heading, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10 },
    segment: {
      flexDirection: "row",
      marginHorizontal: 16,
      padding: 4,
      gap: 4,
      borderRadius: 12,
      backgroundColor: colors.bg.cardElevated,
    },
    segmentItem: { flex: 1, minHeight: 40, borderRadius: 9, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
    segmentItemOn: { backgroundColor: colors.bg.surface },
    segmentText: { ...typography.ui.subtext, color: colors.text.secondary, fontWeight: "500" },
    segmentTextOn: { color: colors.text.primary, fontWeight: "700" },
    body: { padding: 16, gap: 12 },
    card: {
      backgroundColor: colors.bg.surface,
      borderWidth: 1,
      borderColor: colors.border.default,
      borderRadius: 16,
      padding: 14,
      gap: 10,
    },
    cardHead: { flexDirection: "row", alignItems: "center", gap: 8 },
    cardTitle: { ...typography.ui.title, color: colors.text.heading },
    note: { ...typography.ui.subtext, color: colors.text.secondary },
    primaryBtn: { minHeight: 44, borderRadius: 12, backgroundColor: colors.emerald[500], alignItems: "center", justifyContent: "center" },
    primaryBtnText: { ...typography.ui.titleSm, color: colors.text.inverse },
    secondaryBtn: {
      minHeight: 44,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border.elevated,
      alignItems: "center",
      justifyContent: "center",
    },
    secondaryBtnText: { ...typography.ui.titleSm, color: colors.text.primary },
  });
