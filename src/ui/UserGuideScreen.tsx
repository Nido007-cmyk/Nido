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

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <NidoIcon name="compass" size={20} />
          <Text style={styles.title} numberOfLines={1}>
            {t("guide.title")}
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
        <Text style={styles.subtitle}>{t("guide.subtitle")}</Text>
        <Text style={styles.progress}>{t("guide.progress", { done: String(done), total: String(total) })}</Text>

        {GUIDE_MODULES.map((mod, mi) => (
          <View key={mod.id} style={styles.module}>
            <Text style={styles.moduleTitle}>{t(`guide.modules.${mi}.title`)}</Text>
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
                <View key={id} style={styles.lesson}>
                  <Pressable
                    style={styles.lessonHead}
                    onPress={() => toggle(id)}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: isOpen }}
                    accessibilityLabel={t(`${base}.title`)}
                  >
                    <Text style={[styles.check, seen && styles.checkSeen]}>{seen ? "✓" : "○"}</Text>
                    <Text style={styles.lessonTitle}>{t(`${base}.title`)}</Text>
                    <NidoIcon name={isOpen ? "chev-up" : "chev-down"} size={14} />
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
                            <Text key={i} style={styles.text}>
                              {`${i + 1}. ${t(`${base}.steps.${i}`)}`}
                            </Text>
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
                                  <Text style={styles.exampleText}>{ex}</Text>
                                </Pressable>
                              );
                            })}
                          </View>
                        </View>
                      )}

                      {tip.length > 0 && (
                        <View style={styles.note}>
                          <Text style={styles.noteText}>{`${t("guide.tip")}: ${tip}`}</Text>
                        </View>
                      )}
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const getStyles = (colors: Colors, typography: Typography) => {
  const ui = makeSurfaces(colors, typography);
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg.black },
    header: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingHorizontal: calmSpacing.comfortable,
      paddingVertical: calmSpacing.comfortable,
      borderBottomWidth: 1,
      borderBottomColor: colors.border.default,
      backgroundColor: colors.bg.cardElevated,
    },
    headerLeft: { flexDirection: "row", alignItems: "center", gap: calmSpacing.cozy, flexShrink: 1 },
    title: { ...typography.ui.title, color: colors.text.heading, flexShrink: 1 },
    closeBtn: ui.topBarAction,
    closeBtnText: ui.topBarActionText,
    body: { padding: calmSpacing.comfortable, gap: calmSpacing.cozy, paddingBottom: calmSpacing.generous },
    subtitle: ui.body,
    progress: { ...ui.caption, color: colors.text.dim },
    module: { marginTop: calmSpacing.cozy, gap: 8 },
    moduleTitle: ui.sectionLabel,
    lesson: { ...ui.card, gap: 0, padding: 0 },
    lessonHead: { flexDirection: "row", alignItems: "center", gap: 10, padding: 14, minHeight: 48 },
    check: { ...typography.ui.body, color: colors.text.dim, width: 18, textAlign: "center" },
    checkSeen: { color: colors.emerald[600], fontWeight: "700" },
    lessonTitle: { ...typography.ui.body, color: colors.text.primary, fontWeight: "600", flex: 1 },
    lessonBody: { paddingHorizontal: 14, paddingBottom: 14, gap: 10 },
    block: { gap: 6 },
    label: ui.sectionLabel,
    text: ui.body,
    examples: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    example: { ...ui.secondaryButton, minHeight: 40, paddingVertical: 8, paddingHorizontal: 14 },
    exampleText: { ...ui.secondaryButtonText, fontWeight: "500" },
    note: ui.note,
    noteText: ui.noteText,
    warning: ui.warning,
    warningText: ui.warningText,
  });
};
