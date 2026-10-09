/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, TextInput, Switch } from "react-native";
import { useTranslation } from "react-i18next";
import { PERSONALITIES, PersonalityId, MAX_TOKENS_OPTIONS } from "../constants/personalities";
import {
  getPersonalityId,
  setPersonalityId,
  getCustomSystemPrompt,
  setCustomSystemPrompt,
  getMaxTokens,
  setMaxTokens,
  getDeepResearchMode,
  setDeepResearchMode,
  getAdaptiveRoutingEnabled,
  setAdaptiveRoutingEnabled,
} from "../models/settings";
import { NidoIcon } from "./components/icons/NidoIcon";

/**
 * "Assistant Tone & Response Style" section of the Settings screen. Purely
 * local state (src/models/settings.ts) — no network, no model reload
 * needed, since the system prompt/max-tokens are applied per-generation in
 * ChatScreen.send(), not baked into the loaded model.
 */
export function PersonalitySettings() {
  const { t } = useTranslation();
  const [personalityId, setPersonalityIdState] = useState<PersonalityId>("succinct");
  const [customPrompt, setCustomPromptState] = useState("");
  const [maxTokens, setMaxTokensState] = useState(512);
  const [deepResearch, setDeepResearchState] = useState(false);
  const [adaptiveRouting, setAdaptiveRoutingState] = useState(false);

  useEffect(() => {
    (async () => {
      setPersonalityIdState(await getPersonalityId());
      setCustomPromptState(await getCustomSystemPrompt());
      setMaxTokensState(await getMaxTokens());
      setDeepResearchState(await getDeepResearchMode());
      setAdaptiveRoutingState(await getAdaptiveRoutingEnabled());
    })();
  }, []);

  const toggleDeepResearch = async (value: boolean) => {
    const prev = !value;
    setDeepResearchState(value);
    try {
      await setDeepResearchMode(value);
    } catch {
      // FIX 2026-10-09 (UI-AUDIT/F4): revertir si no se pudo persistir.
      setDeepResearchState(prev);
    }
  };

  const toggleAdaptiveRouting = async (value: boolean) => {
    const prev = !value;
    setAdaptiveRoutingState(value);
    try {
      await setAdaptiveRoutingEnabled(value);
    } catch {
      // FIX 2026-10-09 (UI-AUDIT/F4): revertir si no se pudo persistir.
      setAdaptiveRoutingState(prev);
    }
  };

  const selectPersonality = async (id: PersonalityId) => {
    setPersonalityIdState(id);
    await setPersonalityId(id);
  };

  const updateCustomPrompt = async (text: string) => {
    setCustomPromptState(text);
    await setCustomSystemPrompt(text);
  };

  const selectMaxTokens = async (n: number) => {
    setMaxTokensState(n);
    await setMaxTokens(n);
  };

  return (
    <>
    <View style={styles.card}>
      <Text style={styles.title}>{t("personalitySettings.title")}</Text>

      {PERSONALITIES.map((p) => (
        <Pressable
          key={p.id}
          style={[styles.option, personalityId === p.id && styles.optionSelected]}
          onPress={() => selectPersonality(p.id)}
        >
          <View style={styles.radio}>
            {personalityId === p.id && <View style={styles.radioDot} />}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.optionLabel}>
              {p.icon} {t(`personalities.${p.id}.label`)}
            </Text>
            <Text style={styles.optionDescription}>{t(`personalities.${p.id}.description`)}</Text>
          </View>
        </Pressable>
      ))}

      {personalityId === "custom" && (
        <TextInput
          style={styles.customInput}
          value={customPrompt}
          onChangeText={updateCustomPrompt}
          placeholder={t("personalitySettings.customPromptPlaceholder")}
          placeholderTextColor="#666"
          multiline
        />
      )}

      <Text style={styles.subheading}>{t("personalitySettings.maxOutputTokens")}</Text>
      <View style={styles.tokenRow}>
        {MAX_TOKENS_OPTIONS.map((n) => (
          <Pressable
            key={n}
            style={[styles.tokenPill, maxTokens === n && styles.tokenPillSelected]}
            onPress={() => selectMaxTokens(n)}
          >
            <Text style={[styles.tokenPillText, maxTokens === n && styles.tokenPillTextSelected]}>
              {n}
            </Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.note}>{t("personalitySettings.maxOutputTokensNote")}</Text>
      </View>

      <View style={styles.card}>
        <View style={styles.deepResearchRow}>
          <View style={{ flex: 1 }}>
            <View style={styles.titleRow}>
              <NidoIcon name="deep-research" size={18} />
              <Text style={styles.title}>{t("personalitySettings.deepResearchTitle")}</Text>
            </View>
            <Text style={styles.note}>{t("personalitySettings.deepResearchNote")}</Text>
          </View>
          <Switch
            value={deepResearch}
            onValueChange={toggleDeepResearch}
            trackColor={{ false: "#333", true: "#3a7a4a" }}
          />
        </View>
      </View>

      <View style={styles.card}>
        <View style={styles.deepResearchRow}>
          <View style={{ flex: 1 }}>
            <View style={styles.titleRow}>
              <NidoIcon name="compass" size={18} />
              <Text style={styles.title}>{t("personalitySettings.adaptiveRoutingTitle")}</Text>
            </View>
            <Text style={styles.note}>{t("personalitySettings.adaptiveRoutingNote")}</Text>
          </View>
          <Switch
            value={adaptiveRouting}
            onValueChange={toggleAdaptiveRouting}
            trackColor={{ false: "#333", true: "#3a7a4a" }}
          />
        </View>
    </View>
    </>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: "#111", borderRadius: 10, padding: 14, margin: 12, gap: 10 },
  deepResearchRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  title: { color: "#fff", fontSize: 14, fontWeight: "600" },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 8,
    borderRadius: 8,
  },
  optionSelected: { backgroundColor: "#0e1a12" },
  radio: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: "#555",
    alignItems: "center",
    justifyContent: "center",
  },
  radioDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#3a7a4a" },
  optionLabel: { color: "#eee", fontSize: 13, fontWeight: "600" },
  optionDescription: { color: "#999", fontSize: 11, marginTop: 2 },
  customInput: {
    backgroundColor: "#1a1a1a",
    color: "#fff",
    borderRadius: 8,
    padding: 10,
    fontSize: 13,
    minHeight: 70,
    textAlignVertical: "top",
  },
  subheading: { color: "#ccc", fontSize: 12, fontWeight: "600", marginTop: 4 },
  tokenRow: { flexDirection: "row", gap: 8 },
  tokenPill: {
    backgroundColor: "#1a1a1a",
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  tokenPillSelected: { backgroundColor: "#2a5f3a" },
  tokenPillText: { color: "#999", fontSize: 12 },
  tokenPillTextSelected: { color: "#fff", fontWeight: "600" },
  note: { color: "#666", fontSize: 11 },
});
