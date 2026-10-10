/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import React, { useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { impact, ImpactFeedbackStyle } from "../../services/haptics";
import { useTranslation } from "react-i18next";
import { RetrievedChunk } from "../../rag/retrieve";
import { useTheme } from "../theme";
import type { Colors } from "../theme/colors";
import { NidoIcon } from "./icons/NidoIcon";
import type { Typography } from "../theme/typography";
import { spacing, radii } from "../theme/spacing";

interface Props {
  citations: RetrievedChunk[];
}

export function SourceFootnotes({ citations }: Props) {
  const { colors, typography } = useTheme();
  const styles = useMemo(() => getStyles(colors, typography), [colors, typography]);
  const { t } = useTranslation();
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  if (!citations || citations.length === 0) return null;

  const toggle = (idx: number) => {
    impact(ImpactFeedbackStyle.Light);
    setExpandedIndex(expandedIndex === idx ? null : idx);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <NidoIcon name="knowledge" size={20} />
          <Text style={styles.headerTitle}>{t("sourceFootnotes.title")}</Text>
        </View>
        <Text style={styles.sourceCountBadge}>{citations.length}</Text>
      </View>
      {/* Honesty caption (2026-09-28): the number is the raw cosine
          similarity against the local index — an absolute match-strength
          measure, not confidence. The old fused-relative score rendered a
          weight-scheme-constant "50%" for any lone single-source chunk. */}
      <Text style={styles.relevanceCaption}>{t("sourceFootnotes.relevanceCaption")}</Text>

      <View style={styles.chipsRow}>
        {citations.map((c, i) => {
          const isExpanded = expandedIndex === i;
          return (
            <View key={i} style={styles.cardWrapper}>
              <Pressable accessibilityRole="button"
                style={[styles.chip, isExpanded && styles.chipActive]}
                onPress={() => toggle(i)}
                hitSlop={4}
              >
                <View style={styles.chipIndexPill}>
                  <Text style={styles.chipIndexText}>{i + 1}</Text>
                </View>
                <Text style={styles.chipTitle} numberOfLines={1}>
                  {c.title}
                </Text>
                {/* rawScore only: the fused relative `score` is for sorting,
                    never for display — rendering it as % manufactured a
                    constant "50%" for lone single-source chunks. Lexical-only
                    chunks have no absolute scale (BM25 unbounded), so they
                    show no percentage rather than a dishonest one. */}
                {c.rawScore != null && (
                  <Text style={styles.scoreText}>{(c.rawScore * 100).toFixed(0)}%</Text>
                )}
                <NidoIcon name={isExpanded ? "chev-up" : "chev-down"} size={12} />
              </Pressable>

              {isExpanded && (
                <View style={styles.snippetBox}>
                  <View style={styles.snippetMeta}>
                    <Text style={styles.snippetPackTag}>{t("sourceFootnotes.localIndex")}</Text>
                    <Text style={styles.snippetDocId} numberOfLines={1}>
                      {c.docId || c.title}
                    </Text>
                  </View>
                  <Text style={styles.snippetText} numberOfLines={6}>
                    {c.body}
                  </Text>
                </View>
              )}
            </View>
          );
        })}
      </View>
    </View>
  );
}

const getStyles = (colors: Colors, typography: Typography) => StyleSheet.create({
  container: {
    marginTop: spacing.sm,
    paddingTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: "rgba(255, 255, 255, 0.08)",
    gap: 6,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  headerIcon: {
    fontSize: 11,
  },
  headerTitle: {
    ...typography.mono.xs,
    color: colors.text.accentCyan,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  relevanceCaption: {
    ...typography.mono.xs,
    color: colors.text.dim,
    fontSize: 9,
  },
  sourceCountBadge: {
    ...typography.mono.xs,
    color: colors.text.muted,
    backgroundColor: "rgba(255, 255, 255, 0.07)",
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: radii.xs,
  },
  chipsRow: {
    gap: 6,
  },
  cardWrapper: {
    gap: 4,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    // BUG-3-2026-10-06: antes rgba(15,23,42,0.8) hardcodeado, demasiado oscuro.
    // Usar color de superficie del tema para legibilidad en ambos modos.
    backgroundColor: colors.bg.cardElevated,
    borderColor: colors.border.default,
    borderWidth: 1,
    borderRadius: radii.sm,
    paddingHorizontal: 8,
    paddingVertical: 5,
    gap: 6,
  },
  chipActive: {
    borderColor: colors.cyan[500],
    backgroundColor: "rgba(6, 182, 212, 0.1)",
  },
  chipIndexPill: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.cyan.bgSubtle,
    alignItems: "center",
    justifyContent: "center",
  },
  chipIndexText: {
    ...typography.mono.xs,
    color: colors.text.accentCyan,
    fontWeight: "700",
    fontSize: 9,
  },
  chipTitle: {
    ...typography.ui.caption,
    color: colors.text.heading,
    flex: 1,
    fontWeight: "600",
  },
  scoreText: {
    ...typography.mono.xs,
    color: colors.text.accentEmerald,
    fontWeight: "600",
    // BUG-7-2026-10-06: sin flexShrink:0 el porcentaje se deforma/apreta
    // cuando el título es largo.
    flexShrink: 0,
  },
  expandChevron: {
    fontSize: 8,
    color: colors.text.dim,
  },
  snippetBox: {
    backgroundColor: colors.bg.terminal,
    borderColor: colors.border.default,
    borderWidth: 1,
    borderRadius: radii.sm,
    padding: spacing.sm,
    gap: 4,
  },
  snippetMeta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  snippetPackTag: {
    ...typography.mono.xs,
    color: colors.text.accentEmerald,
    fontWeight: "700",
  },
  snippetDocId: {
    ...typography.mono.xs,
    color: colors.text.dim,
    flex: 1,
    textAlign: "right",
  },
  snippetText: {
    ...typography.mono.xs,
    color: colors.text.secondary,
    lineHeight: 16,
  },
});
