/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * Evidencia primero (programa «Lo mejor de la bounty», tanda 1; patrón
 * de la EvidenceCard de Commonplace, Apache-2.0, con implementación
 * propia): la fuente principal de la respuesta se enseña ENCIMA de
 * ella, con la frase que mejor responde a la pregunta en negrita
 * dentro de su pasaje. Las notas de fuentes completas siguen debajo
 * de la respuesta, como siempre; esto es el «antes de la primera
 * palabra» para hardware modesto, no un sustituto.
 */

import React, { useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { useTranslation } from "react-i18next";
import { impact, ImpactFeedbackStyle } from "../../services/haptics";
import type { EvidenceCardData } from "../../rag/evidenceCard";
import { parsePackChunkId } from "../../rag/packSource";
import { useTheme } from "../theme";
import type { Colors } from "../theme/colors";
import type { Typography } from "../theme/typography";
import { spacing, radii } from "../theme/spacing";
import { SourceReader } from "./SourceReader";
import { sourceAccent } from "./sourceColors";

interface Props {
  card: EvidenceCardData;
}

export function EvidenceFirstCard({ card }: Props) {
  const { colors, typography } = useTheme();
  const styles = useMemo(() => getStyles(colors, typography), [colors, typography]);
  const { t } = useTranslation();
  const [readerOpen, setReaderOpen] = useState(false);
  const accent = sourceAccent(colors, 0);
  const canRead = !!parsePackChunkId(card.chunkId);

  // El pasaje con su frase en negrita: texto real partido en tres, no
  // un color solo (la negrita también la percibe quien no distingue
  // el acento).
  const at = card.excerpt.indexOf(card.highlight);
  const before = at >= 0 ? card.excerpt.slice(0, at) : card.excerpt;
  const after = at >= 0 ? card.excerpt.slice(at + card.highlight.length) : "";

  const body = (
    <>
      <View style={styles.header}>
        <View style={[styles.disc, { backgroundColor: accent.subtle, borderColor: accent.border }]}>
          <Text style={[styles.discText, { color: accent.solid }]}>1</Text>
        </View>
        <View style={styles.headerText}>
          <Text style={styles.caption}>{t("sourceFootnotes.evidenceFirst")}</Text>
          <Text style={styles.title} numberOfLines={1}>
            {card.title}
          </Text>
        </View>
      </View>
      <Text style={styles.excerpt}>
        {before}
        {at >= 0 ? <Text style={styles.highlight}>{card.highlight}</Text> : null}
        {after}
      </Text>
      {canRead ? <Text style={styles.readWhole}>{t("sourceFootnotes.readWhole")}</Text> : null}
    </>
  );

  return (
    <View style={styles.container}>
      {canRead ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("sourceFootnotes.readWhole")}
          onPress={() => {
            impact(ImpactFeedbackStyle.Light);
            setReaderOpen(true);
          }}
        >
          {body}
        </Pressable>
      ) : (
        body
      )}
      <SourceReader chunkId={readerOpen ? card.chunkId : null} onClose={() => setReaderOpen(false)} />
    </View>
  );
}

const getStyles = (colors: Colors, typography: Typography) =>
  StyleSheet.create({
    container: {
      backgroundColor: colors.bg.cardElevated,
      borderColor: colors.border.default,
      borderWidth: 1,
      borderRadius: radii.sm,
      padding: spacing.sm,
      gap: 6,
      marginBottom: spacing.sm,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    disc: {
      width: 20,
      height: 20,
      borderRadius: 10,
      borderWidth: 1,
      alignItems: "center",
      justifyContent: "center",
    },
    discText: {
      ...typography.ui.caption,
      fontWeight: "700",
      fontSize: 11,
      lineHeight: 13,
      includeFontPadding: false,
      textAlign: "center",
      textAlignVertical: "center",
    },
    headerText: {
      flex: 1,
      gap: 1,
    },
    caption: {
      ...typography.ui.caption,
      color: colors.text.dim,
      fontWeight: "600",
    },
    title: {
      ...typography.ui.caption,
      color: colors.text.heading,
      fontWeight: "700",
      fontSize: 13,
    },
    excerpt: {
      ...typography.ui.body,
      color: colors.text.secondary,
      lineHeight: 21,
    },
    highlight: {
      color: colors.text.heading,
      fontWeight: "700",
    },
    readWhole: {
      ...typography.ui.caption,
      color: colors.text.accentEmerald,
      fontWeight: "700",
    },
  });
