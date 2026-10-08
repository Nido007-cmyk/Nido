/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import React from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "../theme";
import { spacing, radii } from "../theme/spacing";
import { useLanguage, LANGUAGES } from "../../i18n/LanguageContext";

interface Props {
  compact?: boolean;
}

/** Manual language picker — used in both Settings and the first-run setup wizard. */
export function LanguageSelector({ compact = false }: Props) {
  const { colors, typography } = useTheme();
  const { t } = useTranslation();
  const { languageId, setLanguage } = useLanguage();

  return (
    <View style={styles.container}>
      {!compact && (
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.text.heading }]}>
            {t("common.languageSection")}
          </Text>
        </View>
      )}
      <View style={styles.row}>
        {LANGUAGES.map((lang) => {
          const isSelected = languageId === lang.id;
          return (
            <Pressable
              key={lang.id}
              style={[
                styles.btn,
                {
                  backgroundColor: colors.bg.cardElevated,
                  borderColor: isSelected ? colors.border.focus : colors.border.default,
                },
                isSelected && { backgroundColor: colors.cyan.bgSubtle },
              ]}
              onPress={() => setLanguage(lang.id)}
            >
              <Text style={styles.flag}>{lang.icon}</Text>
              <Text
                style={[
                  typography.ui.caption,
                  { color: isSelected ? colors.text.accentCyan : colors.text.secondary },
                  isSelected && { fontWeight: "800" },
                ]}
              >
                {lang.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.sm },
  sectionHeader: { gap: 2 },
  sectionTitle: { fontSize: 10, fontWeight: "800", letterSpacing: 0.6 },
  row: { flexDirection: "row", gap: spacing.sm, marginTop: 4 },
  btn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: radii.md,
    borderWidth: 1,
  },
  flag: { fontSize: 15 },
});
