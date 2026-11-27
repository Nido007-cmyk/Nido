/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * "Aprende a usar NIDO" — the user guide (0.1.14).
 *
 * Modules → lessons; a lesson opens in place and shows what it does, steps,
 * examples and a tip. Tapping an example closes the guide and types it into
 * the chat; it is NEVER sent automatically (same rule as Share → NIDO).
 * A lesson whose tool is switched off says so instead of promising it.
 * Opened lessons get a check mark (kept in settings; harmless if lost).
 *
 * Content: locale files (guide.*). Structure and promises: src/guide/guideCatalog.ts,
 * checked by src/guide/guideRouting.test.ts.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { useTranslation } from "react-i18next";
import { impact, ImpactFeedbackStyle } from "../services/haptics";
import { useTheme } from "./theme";
import type { Colors } from "./theme/colors";
import type { Typography } from "./theme/typography";
import { makeSurfaces } from "./theme/surfaces";
import { calmSpacing } from "./theme/calm";
import { NidoIcon } from "./components/icons/NidoIcon";
import type { IconName } from "./components/icons/iconRegistry";
import { GUIDE_MODULES, allLessonIds } from "../guide/guideCatalog";
import { getDisabledToolNames, getGuideVisited, markGuideVisited } from "../models/settings";

interface Props {
  onClose: () => void;
  /** Types the example into the chat input (not sent). */
  onTryExample: (text: string) => void;
}

export function UserGuideScreen({ onClose, onTryExample }: Props) {
  const { colors, typography } = useTheme();
  const styles = useMemo(() => getStyles(colors, typography), [colors, typography]);
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState<string | null>(null);
  const [visited, setVisited] = useState<string[]>([]);
  const [disabledTools, setDisabledTools] = useState<string[]>([]);

  useEffect(() => {
    getGuideVisited().then(setVisited).catch(() => {});
    getDisabledToolNames().then(setDisabledTools).catch(() => {});
  }, []);

  const total = allLessonIds().length;
  const done = visited.filter((v) => allLessonIds().includes(v)).length;

  const toggle = useCallback((id: string) => {
    impact(ImpactFeedbackStyle.Light);
    setOpen((cur) => (cur === id ? null : id));
    setVisited((cur) => (cur.includes(id) ? cur : [...cur, id]));
    markGuideVisited(id).catch(() => {});
  }, []);

  // Arrays come from the locale; every string is then read by its own key so
  // nested labels ($t(...)) resolve to the names the user sees in the app.
  const count = (key: string): number => {
    if (!i18n.exists(key)) return 0;
    const v = t(key, { returnObjects: true }) as unknown;
    return Array.isArray(v) ? v.length : 0;
  };

  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <NidoIcon name="compass" size={20} color={colors.text.accentEmerald} />
          <Text style={styles.headerTitle} numberOfLines={1}>
            {t("guide.drawer")}
          </Text>
        </View>
        <Pressable
          onPress={() => {
            impact(ImpactFeedbackStyle.Light);
            onClose();
          }}
          hitSlop={8}
          style={styles.closeBtn}
          accessibilityRole="button"
          accessibilityLabel={t("common.done")}
        >
          <Text style={styles.closeBtnText}>{t("common.done")}</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {/* 0.1.117 (UI nueva): portada de la guía con el progreso a la vista. */}
        <View style={styles.hero}>
          <Text style={styles.title} accessibilityRole="header">
            {t("guide.title")}
          </Text>
          <Text style={styles.subtitle}>{t("guide.subtitle")}</Text>
          <View
            style={styles.progressTrack}
            accessible
            accessibilityRole="progressbar"
            accessibilityValue={{ min: 0, max: total, now: done }}
            accessibilityLabel={t("guide.progress", { done: String(done), total: String(total) })}
          >
            <View style={[styles.progressFill, { width: `${pct}%` }]} />
          </View>
          <Text style={styles.progress}>{t("guide.progress", { done: String(done), total: String(total) })}</Text>
        </View>

        {GUIDE_MODULES.map((mod, mi) => (
          <View key={mod.id} style={styles.module}>
            <View style={styles.moduleHead}>
              <View style={styles.moduleIcon}>
                <NidoIcon name={MODULE_ICON[mod.id] ?? "compass"} size={16} color={colors.text.accentEmerald} />
              </View>
              <Text style={styles.moduleTitle} accessibilityRole="header">
                {t(`guide.modules.${mi}.title`)}
              </Text>
            </View>
            <View style={styles.moduleCard}>
            {mod.lessons.map((lesson, li) => {
              const id = `${mod.id}.${lesson.id}`;
              const base = `guide.modules.${mi}.lessons.${li}`;
              const isOpen = open === id;
              const seen = visited.includes(id);
              const off = (lesson.tools ?? []).some((tool) => disabledTools.includes(tool));
              const nSteps = count(`${base}.steps`);
              const nExamples = count(`${base}.examples`);
              const tip = i18n.exists(`${base}.tip`) ? t(`${base}.tip`) : "";
              return (
                <View key={id} style={[styles.lesson, li > 0 && styles.lessonDivider]}>
                  <Pressable
                    style={styles.lessonHead}
                    onPress={() => toggle(id)}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: isOpen }}
                    accessibilityLabel={t(`${base}.title`)}
                  >
                    <View style={[styles.check, seen && styles.checkSeen]}>
                      {seen ? <NidoIcon name="check" size={12} color={colors.text.inverse} /> : null}
                    </View>
                    <Text style={styles.lessonTitle}>{t(`${base}.title`)}</Text>
                    <NidoIcon name={isOpen ? "chev-up" : "chev-down"} size={14} color={colors.text.dim} />
                  </Pressable>

                  {isOpen && (
                    <View style={styles.lessonBody}>
                      <Text style={styles.text}>{t(`${base}.what`)}</Text>

                      {off && (
                        <View style={styles.warning}>
                          <Text style={styles.warningText}>{t("guide.toolOff")}</Text>
                        </View>
                      )}

                      {nSteps > 0 && (
                        <View style={styles.block}>
                          <Text style={styles.label}>{t("guide.steps")}</Text>
                          {Array.from({ length: nSteps }, (_, i) => (
                            <View key={i} style={styles.stepRow}>
                              <View style={styles.stepNum}>
                                <Text style={styles.stepNumText}>{i + 1}</Text>
                              </View>
                              <Text style={[styles.text, styles.stepText]}>{t(`${base}.steps.${i}`)}</Text>
                            </View>
                          ))}
                        </View>
                      )}

                      {nExamples > 0 && (
                        <View style={styles.block}>
                          <Text style={styles.label}>{t("guide.try")}</Text>
                          <View style={styles.examples}>
                            {Array.from({ length: nExamples }, (_, i) => {
                              const ex = t(`${base}.examples.${i}`);
                              return (
                                <Pressable
                                  key={i}
                                  style={styles.example}
                                  onPress={() => {
                                    impact(ImpactFeedbackStyle.Medium);
                                    onTryExample(ex);
                                  }}
                                  accessibilityRole="button"
                                  accessibilityLabel={`${t("guide.try")}: ${ex}`}
                                >
                                  <NidoIcon name="chat" size={13} color={colors.text.accentEmerald} />
                                  <Text style={styles.exampleText}>{ex}</Text>
                                </Pressable>
                              );
                            })}
                          </View>
                        </View>
                      )}

                      {tip.length > 0 && (
                        <View style={styles.note}>
                          <NidoIcon name="info" size={16} color={colors.text.accentEmerald} />
                          <Text style={[styles.noteText, styles.noteTextFlex]}>{`${t("guide.tip")}: ${tip}`}</Text>
                        </View>
                      )}
                    </View>
                  )}
                </View>
              );
            })}
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

/** 0.1.117: un icono por módulo de la guía (solo iconos que ya existen). */
const MODULE_ICON: Record<string, IconName> = {
  start: "chat",
  organize: "ideas",
  knowledge: "knowledge",
  connect: "pairing",
  privacy: "security",
  personalize: "appearance",
};

const getStyles = (colors: Colors, typography: Typography) => {
  const ui = makeSurfaces(colors, typography);
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg.black },
    header: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingHorizontal: calmSpacing.comfortable,
      paddingVertical: 10,
      backgroundColor: colors.bg.black,
    },
    headerLeft: { flexDirection: "row", alignItems: "center", gap: calmSpacing.cozy, flexShrink: 1 },
    headerTitle: { ...typography.ui.titleSm, color: colors.text.secondary, flexShrink: 1 },
    closeBtn: ui.topBarAction,
    closeBtnText: ui.topBarActionText,
    body: { paddingHorizontal: calmSpacing.comfortable, paddingTop: 4, gap: 18, paddingBottom: calmSpacing.generous },
    hero: { gap: 8 },
    title: { ...typography.ui.headline, color: colors.text.heading },
    subtitle: { ...ui.body, color: colors.text.secondary },
    progressTrack: { height: 8, borderRadius: 4, backgroundColor: colors.bg.cardElevated, overflow: "hidden", marginTop: 6 },
    progressFill: { height: 8, borderRadius: 4, backgroundColor: colors.emerald[500] },
    progress: { ...ui.caption, color: colors.text.secondary },
    module: { gap: 10 },
    moduleHead: { flexDirection: "row", alignItems: "center", gap: 10 },
    moduleIcon: {
      width: 30,
      height: 30,
      borderRadius: 10,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.emerald.bgSubtle,
    },
    moduleTitle: { ...typography.ui.title, color: colors.text.heading, flex: 1 },
    moduleCard: { ...ui.card, gap: 0, padding: 0, overflow: "hidden" },
    lesson: {},
    lessonDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border.default },
    lessonHead: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 14, minHeight: 52 },
    check: {
      width: 22,
      height: 22,
      borderRadius: 11,
      borderWidth: 1.5,
      borderColor: colors.border.elevated,
      alignItems: "center",
      justifyContent: "center",
    },
    checkSeen: { backgroundColor: colors.emerald[500], borderColor: colors.emerald[500] },
    lessonTitle: { ...typography.ui.body, color: colors.text.primary, fontWeight: "700", flex: 1 },
    lessonBody: { paddingHorizontal: 16, paddingBottom: 16, gap: 12 },
    block: { gap: 8 },
    label: ui.sectionLabel,
    text: ui.body,
    stepRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
    stepNum: {
      width: 24,
      height: 24,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.emerald.bgSubtle,
      marginTop: 1,
    },
    stepNumText: { ...typography.ui.caption, color: colors.text.accentEmerald, fontWeight: "700" },
    stepText: { flex: 1 },
    examples: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    example: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      minHeight: 40,
      paddingVertical: 8,
      paddingHorizontal: 14,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: colors.emerald.border,
      backgroundColor: colors.emerald.bgSubtle,
    },
    exampleText: { ...typography.ui.subtext, color: colors.text.accentEmerald, fontWeight: "700", flexShrink: 1 },
    note: { ...ui.note, flexDirection: "row", alignItems: "flex-start", gap: 10 },
    noteText: ui.noteText,
    noteTextFlex: { flex: 1 },
    warning: ui.warning,
    warningText: ui.warningText,
  });
};
