/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * 0.1.56 — Emergency tab. The checked emergency numbers of the chosen country
 * (straight from the knowledge packs' verified facts: no model, source and
 * date shown), one-tap calling (opens the phone's dialer, the person presses
 * call), "describe what's happening" into the chat, and quick guides.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "./theme/ThemeContext";
import type { Colors } from "./theme/colors";
import type { Typography } from "./theme/typography";
import { NidoIcon } from "./components/icons/NidoIcon";
import { impact, ImpactFeedbackStyle } from "../services/haptics";
import { loadAllPackFacts } from "../rag/packs";
import { emergencyCard, emergencyRegions, type FactLang, type PackFact, type PackRegion } from "../rag/packFacts";
import { getEmergencyRegion, setEmergencyRegion } from "../models/settings";
import { QUICK_GUIDES } from "./emergency/quickGuides";

interface Props {
  /** Sends a question to the chat (switches to the Chat tab). */
  onAsk: (question: string) => void;
  /** Opens the Library tab (where NIDO Local is downloaded). */
  onOpenLibrary: () => void;
}

function toFactLang(lang: string | undefined): FactLang {
  const l = (lang ?? "es").slice(0, 2);
  return l === "en" || l === "pt" ? l : "es";
}

export function EmergencyScreen({ onAsk, onOpenLibrary }: Props) {
  const { colors, typography } = useTheme();
  const styles = useMemo(() => getStyles(colors, typography), [colors, typography]);
  const { t, i18n } = useTranslation();
  const lang = toFactLang(i18n.resolvedLanguage ?? i18n.language);

  const [data, setData] = useState<{ regions: PackRegion[]; facts: PackFact[] } | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [question, setQuestion] = useState("");

  useEffect(() => {
    let alive = true;
    void Promise.all([loadAllPackFacts(), getEmergencyRegion().catch(() => null)]).then(([d, saved]) => {
      if (!alive) return;
      setData(d);
      setCode(saved);
    });
    return () => {
      alive = false;
    };
  }, []);

  const countries = useMemo(() => (data ? emergencyRegions(lang, data.regions, data.facts) : []), [data, lang]);
  const card = useMemo(() => (data && code ? emergencyCard(code, lang, data.regions, data.facts) : null), [data, code, lang]);
  const hasPack = countries.length > 0;
  const countryName = card?.name ?? countries.find((c) => c.code === code)?.name ?? code ?? "";

  const choose = useCallback((next: string) => {
    impact(ImpactFeedbackStyle.Light);
    setCode(next);
    setPicking(false);
    void setEmergencyRegion(next).catch(() => {});
  }, []);

  const call = useCallback((tel: string) => {
    impact(ImpactFeedbackStyle.Medium);
    // Opens the dialer with the number typed in; the person presses call.
    void Linking.openURL(tel).catch(() => {});
  }, []);

  const ask = useCallback(
    (text: string) => {
      const q = text.trim();
      if (!q) return;
      setQuestion("");
      onAsk(q);
    },
    [onAsk]
  );

  const [first, ...rest] = card?.numbers ?? [];
  const source = card?.sources[0];

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title} accessibilityRole="header">
          {t("emergency.title")}
        </Text>
        {hasPack && (
          <Pressable
            onPress={() => setPicking(true)}
            style={styles.countryBtn}
            accessibilityRole="button"
            accessibilityLabel={code ? t("emergency.changeCountry", { name: countryName }) : t("emergency.pickCountry")}
          >
            <Text style={styles.countryText} numberOfLines={1}>
              {code ? countryName : t("emergency.pickCountry")}
            </Text>
            <NidoIcon name="chev-down" size={14} color={colors.text.primary} />
          </Pressable>
        )}
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {data && !hasPack && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{t("emergency.noPackTitle")}</Text>
            <Text style={styles.note}>{t("emergency.noPackBody")}</Text>
            <Pressable onPress={onOpenLibrary} style={styles.primaryBtn} accessibilityRole="button">
              <Text style={styles.primaryBtnText}>{t("emergency.openLibrary")}</Text>
            </Pressable>
          </View>
        )}

        {hasPack && !card && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>
              {code ? t("emergency.noCountryTitle", { name: countryName }) : t("emergency.chooseCountry")}
            </Text>
            <Text style={styles.note}>{t("emergency.noCountryBody")}</Text>
            <Pressable onPress={() => setPicking(true)} style={styles.primaryBtn} accessibilityRole="button">
              <Text style={styles.primaryBtnText}>{t("emergency.pickCountry")}</Text>
            </Pressable>
          </View>
        )}

        {first && (
          <Pressable
            onPress={() => call(first.tel)}
            style={styles.bigCall}
            accessibilityRole="button"
            accessibilityLabel={t("emergency.callA11y", { number: first.value, label: first.label })}
            testID="emergency-call-primary"
          >
            <View style={styles.bigCallText}>
              <Text style={styles.bigCallLabel}>{first.label}</Text>
              <Text style={styles.bigCallNumber}>{first.value}</Text>
              {first.note ? <Text style={styles.bigCallNote}>{first.note}</Text> : null}
            </View>
            <Text style={styles.bigCallAction}>{t("emergency.call")}</Text>
          </Pressable>
        )}

        {rest.length > 0 && (
          <View style={styles.grid}>
            {rest.map((n) => (
              <Pressable
                key={n.key}
                onPress={() => call(n.tel)}
                style={styles.tile}
                accessibilityRole="button"
                accessibilityLabel={t("emergency.callA11y", { number: n.value, label: n.label })}
              >
                <Text style={styles.tileLabel} numberOfLines={2}>
                  {n.label}
                </Text>
                <Text style={styles.tileNumber}>{n.value}</Text>
                {n.note ? (
                  <Text style={styles.tileNote} numberOfLines={3}>
                    {n.note}
                  </Text>
                ) : null}
              </Pressable>
            ))}
          </View>
        )}

        {source && (
          <Text style={styles.source}>
            {t("emergency.checked", { date: source.checked, source: source.title })}
          </Text>
        )}

        <Text style={styles.disclaimer}>{t("emergency.disclaimer")}</Text>

        <View style={styles.card}>
          <Text style={styles.cardTitle} nativeID="emergency-describe">
            {t("emergency.describeLabel")}
          </Text>
          <View style={styles.askRow}>
            <TextInput
              value={question}
              onChangeText={setQuestion}
              placeholder={t("emergency.describePlaceholder")}
              placeholderTextColor={colors.text.muted}
              style={styles.input}
              accessibilityLabelledBy="emergency-describe"
              returnKeyType="send"
              onSubmitEditing={() => ask(question)}
            />
            <Pressable
              onPress={() => ask(question)}
              style={[styles.askBtn, !question.trim() && styles.askBtnDisabled]}
              disabled={!question.trim()}
              accessibilityRole="button"
              accessibilityLabel={t("emergency.ask")}
            >
              <NidoIcon name="send" size={18} color={colors.text.inverse} />
            </Pressable>
          </View>
          <Text style={styles.note}>{t("emergency.describeHint")}</Text>
        </View>

        <Text style={styles.section} accessibilityRole="header">
          {t("emergency.quickGuides")}
        </Text>
        <View style={styles.grid}>
          {QUICK_GUIDES.map((g) => (
            <Pressable
              key={g.key}
              onPress={() => ask(t(`emergency.questions.${g.key}`))}
              style={styles.guide}
              accessibilityRole="button"
            >
              <View style={[styles.guideIcon, g.urgent ? styles.guideIconUrgent : null]}>
                <NidoIcon name={g.icon} size={18} color={g.urgent ? colors.crimson[500] : colors.emerald[500]} />
              </View>
              <Text style={styles.guideText} numberOfLines={2}>
                {t(`emergency.guides.${g.key}`)}
              </Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>

      <Modal visible={picking} transparent animationType="slide" onRequestClose={() => setPicking(false)}>
        <View style={styles.sheetBackdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.cardTitle}>{t("emergency.chooseCountry")}</Text>
              <Pressable onPress={() => setPicking(false)} accessibilityRole="button" accessibilityLabel={t("emergency.close")} style={styles.sheetClose}>
                <NidoIcon name="close" size={18} color={colors.text.primary} />
              </Pressable>
            </View>
            <FlatList
              data={countries}
              keyExtractor={(c) => c.code}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => choose(item.code)}
                  style={styles.countryRow}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: item.code === code }}
                >
                  <Text style={styles.countryRowText}>{item.name}</Text>
                  {item.code === code ? <NidoIcon name="check" size={16} color={colors.emerald[500]} /> : null}
                </Pressable>
              )}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const getStyles = (colors: Colors, typography: Typography) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg.black },
    header: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8 },
    title: { ...typography.ui.headline, color: colors.text.heading, flex: 1 },
    countryBtn: {
      minHeight: 40,
      maxWidth: 200,
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingHorizontal: 12,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: colors.border.elevated,
      backgroundColor: colors.bg.surface,
    },
    countryText: { ...typography.ui.titleSm, color: colors.text.primary, flexShrink: 1 },
    body: { padding: 16, paddingTop: 4, gap: 14 },
    card: {
      backgroundColor: colors.bg.surface,
      borderWidth: 1,
      borderColor: colors.border.default,
      borderRadius: 16,
      padding: 14,
      gap: 8,
    },
    cardTitle: { ...typography.ui.title, color: colors.text.heading },
    note: { ...typography.ui.subtext, color: colors.text.secondary },
    primaryBtn: {
      minHeight: 44,
      borderRadius: 12,
      backgroundColor: colors.emerald[500],
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 16,
    },
    primaryBtnText: { ...typography.ui.titleSm, color: colors.text.inverse },
    bigCall: {
      minHeight: 84,
      borderRadius: 20,
      backgroundColor: colors.crimson[500],
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 18,
      gap: 12,
    },
    bigCallText: { flex: 1, paddingVertical: 10 },
    bigCallLabel: { ...typography.ui.subtext, color: colors.text.inverse, opacity: 0.92 },
    bigCallNumber: { fontSize: 32, lineHeight: 38, fontWeight: "800", color: colors.text.inverse, fontVariant: ["tabular-nums"] },
    bigCallNote: { ...typography.ui.caption, color: colors.text.inverse, opacity: 0.9 },
    bigCallAction: { ...typography.ui.title, color: colors.text.inverse },
    grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
    tile: {
      flexGrow: 1,
      flexBasis: "45%",
      minHeight: 76,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border.default,
      backgroundColor: colors.bg.surface,
      padding: 12,
      gap: 2,
    },
    tileLabel: { ...typography.ui.subtext, color: colors.text.secondary },
    tileNumber: { fontSize: 24, lineHeight: 30, fontWeight: "800", color: colors.text.primary, fontVariant: ["tabular-nums"] },
    tileNote: { ...typography.ui.caption, color: colors.text.secondary },
    source: { ...typography.ui.caption, color: colors.text.secondary },
    disclaimer: { ...typography.ui.caption, color: colors.text.secondary },
    askRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    input: {
      flex: 1,
      minHeight: 44,
      borderWidth: 1,
      borderColor: colors.border.default,
      borderRadius: 10,
      paddingHorizontal: 10,
      color: colors.text.primary,
      backgroundColor: colors.bg.black,
      ...typography.ui.body,
    },
    askBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.emerald[500], alignItems: "center", justifyContent: "center" },
    askBtnDisabled: { opacity: 0.45 },
    section: { ...typography.ui.title, color: colors.text.heading, marginTop: 4 },
    guide: {
      flexGrow: 1,
      flexBasis: "45%",
      minHeight: 60,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingHorizontal: 12,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border.default,
      backgroundColor: colors.bg.surface,
    },
    guideIcon: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: colors.emerald.bgSubtle },
    guideIconUrgent: { backgroundColor: colors.crimson.bgSubtle },
    guideText: { ...typography.ui.titleSm, color: colors.text.primary, flexShrink: 1 },
    sheetBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: colors.bg.modalOverlay },
    sheet: { maxHeight: "75%", backgroundColor: colors.bg.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 12 },
    sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16 },
    sheetClose: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
    countryRow: {
      minHeight: 52,
      paddingHorizontal: 16,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border.subtle,
    },
    countryRowText: { ...typography.ui.bodyLg, color: colors.text.primary },
  });
