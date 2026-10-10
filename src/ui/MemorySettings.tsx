/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Switch, Pressable, Alert } from "react-native";
import { useTranslation } from "react-i18next";
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
          trackColor={{ false: "#333", true: "#3a7a4a" }}
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
          trackColor={{ false: "#333", true: "#3a7a4a" }}
        />
      </View>

      <Pressable accessibilityRole="button" accessibilityLabel={t("memorySettings.clearAllChatHistory")} style={styles.clearBtn} onPress={confirmClearAll}>
        <View style={styles.clearBtnRow}>
          <NidoIcon name="delete" size={14} color="#f88" />
          <Text style={styles.clearBtnText}>{t("memorySettings.clearAllChatHistory")}</Text>
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: "#111", borderRadius: 10, padding: 14, margin: 12, gap: 12 },
  title: { color: "#fff", fontSize: 14, fontWeight: "600" },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  clearBtnRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  rowLabel: { color: "#eee", fontSize: 13, fontWeight: "600" },
  rowValue: { color: "#999", fontSize: 11, marginTop: 2 },
  subheading: { color: "#ccc", fontSize: 12, fontWeight: "600" },
  pillRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  pill: { backgroundColor: "#1a1a1a", borderRadius: 6, paddingHorizontal: 12, paddingVertical: 6 },
  pillSelected: { backgroundColor: "#2a5f3a" },
  pillText: { color: "#999", fontSize: 12 },
  pillTextSelected: { color: "#fff", fontWeight: "600" },
  clearBtn: {
    backgroundColor: "rgba(122,42,42,0.3)",
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(122,42,42,0.5)",
  },
  clearBtnText: { color: "#f88", fontSize: 13, fontWeight: "700" },
});
