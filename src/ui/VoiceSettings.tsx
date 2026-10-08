/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Switch } from "react-native";
import { useTranslation } from "react-i18next";
import { NidoIcon } from "./components/icons/NidoIcon";
import { isVoiceInputAvailable } from "../voice/VoiceInput";
import { getVoiceInputEnabled, setVoiceInputEnabled } from "../models/settings";

// Haptic feedback is an app-wide setting (src/services/haptics.ts), not
// voice-specific — its toggle lives in the Display & Theme section now
// (ModelSetupScreen.tsx), alongside the rest of the interface/feedback
// preferences, not here.
export function VoiceSettings() {
  const { t } = useTranslation();
  const [voiceAvailable, setVoiceAvailable] = useState<boolean | null>(null);
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    isVoiceInputAvailable().then(setVoiceAvailable).catch(() => setVoiceAvailable(false));
    getVoiceInputEnabled().then(setEnabled);
  }, []);

  const toggle = async (value: boolean) => {
    setEnabled(value);
    await setVoiceInputEnabled(value);
  };

  return (
    <View style={styles.card}>
      <View style={styles.titleRow}>
        <NidoIcon name="mic" size={18} />
        <Text style={styles.title}>{t("voiceSettings.title")}</Text>
      </View>

      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Text style={styles.rowLabel}>{t("voiceSettings.enabledLabel")}</Text>
          <Text style={styles.rowValue}>{t("voiceSettings.enabledValue")}</Text>
        </View>
        <Switch value={enabled} onValueChange={toggle} trackColor={{ false: "#333", true: "#3a7a4a" }} />
      </View>

      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Text style={styles.rowLabel}>{t("voiceSettings.speechEngineLabel")}</Text>
          <Text style={styles.rowValue}>
            {voiceAvailable == null
              ? t("voiceSettings.checking")
              : voiceAvailable
                ? t("voiceSettings.available")
                : t("voiceSettings.unavailable")}
          </Text>
        </View>
      </View>
      {voiceAvailable === false && (
        <Text style={styles.note}>{t("voiceSettings.unavailableNote")}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: "#111", borderRadius: 10, padding: 14, margin: 12, gap: 12 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { color: "#fff", fontSize: 14, fontWeight: "600" },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  rowLabel: { color: "#eee", fontSize: 13, fontWeight: "600" },
  rowValue: { color: "#999", fontSize: 12, marginTop: 2 },
  note: { color: "#666", fontSize: 11, lineHeight: 16 },
});
