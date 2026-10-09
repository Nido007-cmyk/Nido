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
import {
  getReadAloudEnabled,
  setReadAloudEnabled,
} from "../models/settings";

// Haptic feedback is an app-wide setting (src/services/haptics.ts), not
// voice-specific — its toggle lives in the Display & Theme section now
// (ModelSetupScreen.tsx), alongside the rest of the interface/feedback
// preferences, not here.
export function VoiceSettings() {
  const { t } = useTranslation();
  const [voiceAvailable, setVoiceAvailable] = useState<boolean | null>(null);
  const [enabled, setEnabled] = useState(true);
  // FIX 2026-10-09 (UI-AUDIT): exponer el switch de lectura en voz alta.
  // El backend (src/voice/tts.ts, expo-speech offline) y los 3 call sites
  // en ChatScreen ya existen; solo faltaba la superficie.
  const [readAloud, setReadAloud] = useState(false);

  useEffect(() => {
    isVoiceInputAvailable().then(setVoiceAvailable).catch(() => setVoiceAvailable(false));
    getVoiceInputEnabled().then(setEnabled);
    getReadAloudEnabled().then(setReadAloud);
  }, []);

  const toggle = async (value: boolean) => {
    const prev = enabled;
    setEnabled(value);
    try {
      await setVoiceInputEnabled(value);
    } catch {
      // FIX 2026-10-09 (UI-AUDIT/F4): revertir si no se pudo persistir.
      setEnabled(prev);
    }
  };

  const toggleReadAloud = async (value: boolean) => {
    // Optimista con reversión: si la persistencia falla, restaurar visual.
    const prev = readAloud;
    setReadAloud(value);
    try {
      await setReadAloudEnabled(value);
    } catch {
      setReadAloud(prev);
    }
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

      {/* FIX 2026-10-09 (UI-AUDIT): lectura en voz alta (TTS offline). */}
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Text style={styles.rowLabel}>{t("voiceSettings.readAloudLabel")}</Text>
          <Text style={styles.rowValue}>{t("voiceSettings.readAloudValue")}</Text>
        </View>
        <Switch
          value={readAloud}
          onValueChange={toggleReadAloud}
          trackColor={{ false: "#333", true: "#3a7a4a" }}
          accessibilityLabel={t("voiceSettings.readAloudLabel")}
        />
      </View>
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
