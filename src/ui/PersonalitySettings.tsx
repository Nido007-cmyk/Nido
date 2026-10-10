/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, TextInput, Switch } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "./theme";
import type { Colors } from "./theme/colors";
import type { Typography } from "./theme/typography";
import { makeSurfaces, MIN_TOUCH } from "./theme/surfaces";
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
  const { colors, typography } = useTheme();
  const styles = useMemo(() => getStyles(colors, typography), [colors, typography]);
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
        <Pressable accessibilityRole="button"
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
          placeholderTextColor={colors.text.muted}
          multiline
        />
      )}

      <Text style={styles.subheading}>{t("personalitySettings.maxOutputTokens")}</Text>
      <View style={styles.tokenRow}>
        {MAX_TOKENS_OPTIONS.map((n) => (
          <Pressable accessibilityRole="button"
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
            trackColor={{ false: colors.border.elevated, true: colors.emerald[400] }}
            thumbColor={colors.bg.card}
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
            trackColor={{ false: colors.border.elevated, true: colors.emerald[400] }}
            thumbColor={colors.bg.card}
          />
        </View>
    </View>
    </>
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
    deepResearchRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: MIN_TOUCH },
    option: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      padding: 10,
      borderRadius: 12,
      minHeight: MIN_TOUCH,
    },
    optionSelected: { backgroundColor: colors.emerald.bgSubtle },
    radio: {
      width: 20,
      height: 20,
      borderRadius: 10,
      borderWidth: 2,
      borderColor: colors.border.elevated,
      alignItems: "center",
      justifyContent: "center",
    },
    radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.emerald[500] },
    optionLabel: { ...typography.ui.body, color: colors.text.primary, fontWeight: "600" },
    optionDescription: { ...typography.ui.caption, color: colors.text.secondary, marginTop: 2 },
    customInput: { ...ui.input, minHeight: 80, textAlignVertical: "top" },
    tokenRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
    tokenPill: pill,
    tokenPillSelected: { backgroundColor: colors.emerald[500] },
    tokenPillText: { ...typography.ui.caption, color: colors.text.secondary },
    tokenPillTextSelected: { color: colors.text.inverse, fontWeight: "700" },
  });
};
