/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, Switch, Pressable, Alert } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "./theme";
import type { Colors } from "./theme/colors";
import type { Typography } from "./theme/typography";
import { makeSurfaces, MIN_TOUCH } from "./theme/surfaces";
import { getMemorySettings, setMemorySettings, MemorySettings as MemorySettingsType } from "../models/settings";
import { clearAllHistory } from "../services/chatHistory";
import { NidoIcon } from "./components/icons/NidoIcon";

const TURN_OPTIONS = [4, 6, 8, 10] as const;
const SESSION_OPTIONS = [
  { value: 10, label: "10" },
  { value: 25, label: "25" },
  { value: 50, label: "50" },
  { value: 0, label: null },
] as const;

export function MemorySettings({ onCleared }: { onCleared?: () => void }) {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
  const styles = useMemo(() => getStyles(colors, typography), [colors, typography]);
  const [settings, setSettings] = useState<MemorySettingsType | null>(null);

  useEffect(() => {
    getMemorySettings().then(setSettings);
  }, []);

  const update = async (patch: Partial<MemorySettingsType>) => {
    // FIX 2026-10-09 (UI-AUDIT/F4): optimista con reversión — el switch
    // nunca muestra un estado distinto del persistido.
    const prev = settings;
    setSettings((p) => (p ? { ...p, ...patch } : p));
    try {
      await setMemorySettings(patch);
    } catch {
      setSettings(prev);
    }
  };

  const confirmClearAll = () => {
    Alert.alert(
      t("memorySettings.clearAllConfirmTitle"),
      t("memorySettings.clearAllConfirmMessage"),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("memorySettings.clearAllButton"),
          style: "destructive",
          onPress: async () => {
            await clearAllHistory();
            onCleared?.();
          },
        },
      ]
    );
  };

  if (!settings) return null;

  return (
    <View style={styles.card}>
      <View style={styles.titleRow}>
        <NidoIcon name="memory" size={18} />
        <Text style={styles.title}>{t("memorySettings.title")}</Text>
      </View>

      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Text style={styles.rowLabel}>{t("memorySettings.autoSummarizeLabel")}</Text>
          <Text style={styles.rowValue}>{t("memorySettings.autoSummarizeValue")}</Text>
        </View>
        <Switch
          value={settings.autoSummarize}
          onValueChange={(v) => update({ autoSummarize: v })}
          trackColor={{ false: colors.border.elevated, true: colors.emerald[400] }}
            thumbColor={colors.bg.card}
        />
      </View>

      <Text style={styles.subheading}>{t("memorySettings.turnsBeforeSummarizing")}</Text>
      <View style={styles.pillRow}>
        {TURN_OPTIONS.map((n) => (
          <Pressable accessibilityRole="button"
            key={n}
            style={[styles.pill, settings.historyTurnThreshold === n && styles.pillSelected]}
            onPress={() => update({ historyTurnThreshold: n })}
          >
            <Text style={[styles.pillText, settings.historyTurnThreshold === n && styles.pillTextSelected]}>
              {n}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.subheading}>{t("memorySettings.maxSavedSessions")}</Text>
      <View style={styles.pillRow}>
        {SESSION_OPTIONS.map((opt) => (
          <Pressable accessibilityRole="button"
            key={opt.value}
            style={[styles.pill, settings.maxSavedSessions === opt.value && styles.pillSelected]}
            onPress={() => update({ maxSavedSessions: opt.value })}
          >
            <Text
              style={[styles.pillText, settings.maxSavedSessions === opt.value && styles.pillTextSelected]}
            >
              {opt.label ?? t("memorySettings.unlimited")}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Text style={styles.rowLabel}>{t("memorySettings.autoTitlesLabel")}</Text>
          <Text style={styles.rowValue}>{t("memorySettings.autoTitlesValue")}</Text>
        </View>
        <Switch
          value={settings.autoGenerateTitles}
          onValueChange={(v) => update({ autoGenerateTitles: v })}
          trackColor={{ false: colors.border.elevated, true: colors.emerald[400] }}
            thumbColor={colors.bg.card}
        />
      </View>

      <Pressable accessibilityRole="button" accessibilityLabel={t("memorySettings.clearAllChatHistory")} style={styles.clearBtn} onPress={confirmClearAll}>
        <View style={styles.clearBtnRow}>
          <NidoIcon name="delete" size={14} color={colors.crimson[500]} />
          <Text style={styles.clearBtnText}>{t("memorySettings.clearAllChatHistory")}</Text>
        </View>
      </Pressable>
    </View>
  );
}

const getStyles = (colors: Colors, typography: Typography) => {
  const ui = makeSurfaces(colors, typography);
  const pill = {
    minHeight: 40,
    minWidth: 48,
    backgroundColor: colors.bg.cardElevated,
    borderRadius: 9999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  };
  return StyleSheet.create({
    // Va dentro de una sección plegable que ya es la tarjeta: sin borde propio.
    card: { paddingHorizontal: 16, paddingVertical: 12, gap: 12 },
    titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    title: { ...typography.ui.body, color: colors.text.heading, fontWeight: "700" },
    row: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: MIN_TOUCH },
    rowLabel: { ...typography.ui.body, color: colors.text.primary, fontWeight: "600" },
    rowValue: { ...typography.ui.caption, color: colors.text.secondary, marginTop: 2 },
    subheading: { ...ui.sectionLabel, marginTop: 4 },
    note: { ...typography.ui.caption, color: colors.text.muted },
    clearBtnRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
    pillRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
    pill,
    pillSelected: { backgroundColor: colors.emerald[500] },
    pillText: { ...typography.ui.caption, color: colors.text.secondary },
    pillTextSelected: { color: colors.text.inverse, fontWeight: "700" },
    clearBtn: ui.dangerButton,
    clearBtnText: ui.dangerButtonText,
  });
};
