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
import type { GroundingStatus } from "../../rag/grounding";
import { useTheme } from "../theme";
import type { Colors } from "../theme/colors";
import { NidoIcon } from "./icons/NidoIcon";
import type { Typography } from "../theme/typography";
import { spacing, radii } from "../theme/spacing";
import { parsePackChunkId } from "../../rag/packSource";
import { SourceReader } from "./SourceReader";
import { sourceAccent } from "./sourceColors";
import { summarizeProvenance, type ProvenanceLang, type SentenceProvenance } from "../../rag/provenance";
import type { NumberConflict } from "../../rag/sourceCheck";

interface Props {
  citations: RetrievedChunk[];
  /**
   * RAG-GROUNDING 2026-10-11: el título antiguo ("Offline sources ·
   * relevance-ranked") daba a entender que la respuesta estaba respaldada
   * aunque el modelo hubiera inventado. Ahora el título dice lo que se
   * comprobó de verdad (src/rag/grounding.ts).
   */
  grounding?: GroundingStatus;
  /**
   * 0.1.61: de dónde sale cada frase (provenance.ts). Se resume en una línea
   * de texto real: «3 frases de la guía · 1 del modelo sin fuente».
   */
  provenance?: SentenceProvenance[];
  /**
   * Programa bounty, tanda 8: contradicciones de cifras contra las
   * fuentes (src/rag/sourceCheck.ts). Se enseña la frase de la FUENTE
   * para que el usuario juzgue con ella delante.
   */
  numberConflicts?: NumberConflict[];
}

const TITLE_KEY: Record<GroundingStatus, string> = {
  grounded: "sourceFootnotes.titleGrounded",
  partial: "sourceFootnotes.titlePartial",
  abstained: "sourceFootnotes.titleAbstained",
  unverified: "sourceFootnotes.titleUnverified",
  skipped: "sourceFootnotes.title",
};

export function SourceFootnotes({ citations, grounding, provenance, numberConflicts }: Props) {
  const { colors, typography } = useTheme();
  const styles = useMemo(() => getStyles(colors, typography), [colors, typography]);
  const { t, i18n } = useTranslation();
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  // 0.1.55: la guía entera, con la parte usada resaltada.
  const [readerChunkId, setReaderChunkId] = useState<string | null>(null);

  if (!citations || citations.length === 0) return null;

  const uiLang = (i18n?.language ?? "").slice(0, 2);
  const provLang: ProvenanceLang = uiLang === "es" || uiLang === "pt" ? uiLang : "en";
  const provenanceSummary = provenance && provenance.length > 0 ? summarizeProvenance(provenance, provLang) : "";

  const toggle = (idx: number) => {
    impact(ImpactFeedbackStyle.Light);
    setExpandedIndex(expandedIndex === idx ? null : idx);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <NidoIcon name="knowledge" size={20} />
          <Text style={styles.headerTitle}>{t(grounding ? TITLE_KEY[grounding] : "sourceFootnotes.title")}</Text>
        </View>
        <Text style={styles.sourceCountBadge}>{citations.length}</Text>
      </View>
      {/* Honesty caption (2026-09-28): the number is the raw cosine
          similarity against the local index — an absolute match-strength
          measure, not confidence. The old fused-relative score rendered a
          weight-scheme-constant "50%" for any lone single-source chunk. */}
      {provenanceSummary ? <Text style={styles.provenanceLine}>{provenanceSummary}</Text> : null}
      {/* Programa bounty, tanda 8: la caja de comprobación enseña lo
          que la fuente dice cuando una cifra de la respuesta discrepa. */}
      {(numberConflicts ?? []).map((conflict, i) => (
        <Text key={`conflict-${i}`} style={styles.provenanceLine}>
          {t("sourceFootnotes.numberConflict", { source: conflict.sourceSentence })}
        </Text>
      ))}
      <Text style={styles.relevanceCaption}>{t("sourceFootnotes.relevanceCaption")}</Text>

      <View style={styles.chipsRow}>
        {citations.map((c, i) => {
          const isExpanded = expandedIndex === i;
          // Programa bounty, tanda 1: color por fuente — la píldora de
          // cada fuente lleva su acento, el mismo que tiñe su marcador
          // [n] en la respuesta (sourceColors.ts). El número sigue ahí:
          // el color nunca es la única señal.
          const accent = sourceAccent(colors, i);
          return (
            <View key={i} style={styles.cardWrapper}>
              <Pressable accessibilityRole="button"
                style={[styles.chip, isExpanded && styles.chipActive]}
                onPress={() => toggle(i)}
                hitSlop={4}
              >
                <View style={[styles.chipIndexPill, { backgroundColor: accent.subtle }]}>
                  <Text style={[styles.chipIndexText, { color: accent.solid }]}>{i + 1}</Text>
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
                  {parsePackChunkId(c.chunkId) ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t("sourceFootnotes.readWhole")}
                      onPress={() => setReaderChunkId(c.chunkId)}
                      hitSlop={6}
                    >
                      <Text style={styles.readWhole}>{t("sourceFootnotes.readWhole")}</Text>
                    </Pressable>
                  ) : null}
                </View>
              )}
            </View>
          );
        })}
      </View>
      <SourceReader chunkId={readerChunkId} onClose={() => setReaderChunkId(null)} />
    </View>
  );
}

const getStyles = (colors: Colors, typography: Typography) => StyleSheet.create({
  container: {
    marginTop: spacing.sm,
    paddingTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.border.subtle,
    gap: 6,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  provenanceLine: {
    ...typography.ui.caption,
    color: colors.text.secondary,
    fontWeight: "600",
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
    ...typography.ui.caption,
    color: colors.text.accentCyan,
    fontWeight: "700",
  },
  relevanceCaption: {
    ...typography.ui.caption,
    color: colors.text.dim,
  },
  sourceCountBadge: {
    ...typography.ui.caption,
    color: colors.text.muted,
    backgroundColor: colors.bg.subtle,
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
    backgroundColor: colors.cyan.bgSubtle,
  },
  chipIndexPill: {
    // 0.1.20 (evidencia Tab A9+): con 16px y el estilo caption
    // (lineHeight 15 + font padding de Android) el glifo no cabía y
    // Android recortaba la parte superior de los dígitos (el 2 y el 3
    // se veían cortados). Píldora de 18px y texto con métricas propias.
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.cyan.bgSubtle,
    alignItems: "center",
    justifyContent: "center",
  },
  chipIndexText: {
    ...typography.ui.caption,
    color: colors.text.accentCyan,
    fontWeight: "700",
    fontSize: 10,
    lineHeight: 12,
    includeFontPadding: false,
    textAlign: "center",
    textAlignVertical: "center",
  },
  chipTitle: {
    ...typography.ui.caption,
    color: colors.text.heading,
    flex: 1,
    fontWeight: "600",
  },
  scoreText: {
    ...typography.ui.caption,
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
    ...typography.ui.caption,
    color: colors.text.accentEmerald,
    fontWeight: "700",
  },
  snippetDocId: {
    ...typography.ui.caption,
    color: colors.text.dim,
    flex: 1,
    textAlign: "right",
  },
  snippetText: {
    ...typography.ui.caption,
    color: colors.text.secondary,
    lineHeight: 16,
  },
  readWhole: {
    ...typography.ui.caption,
    color: colors.text.accentEmerald,
    fontWeight: "700",
    marginTop: 2,
  },
});
