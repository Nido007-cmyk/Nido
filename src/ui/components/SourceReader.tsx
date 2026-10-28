/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * SourceReader — 0.1.55: la guía entera de la que salió una respuesta, sin
 * internet, con la parte que se usó resaltada. Así cualquiera comprueba de
 * dónde sale lo que dice NIDO. Idea vista en BOAR; código propio de NIDO.
 */
import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "../theme";
import type { Colors } from "../theme/colors";
import type { Typography } from "../theme/typography";
import { radii, spacing } from "../theme/spacing";
import type { PackSourceDoc } from "../../rag/packSource";

interface Props {
  /** chunkId del trozo usado (`pack:<id>:<fila>`); null = cerrado. */
  chunkId: string | null;
  onClose: () => void;
}

export function SourceReader({ chunkId, onClose }: Props) {
  const { colors, typography } = useTheme();
  const styles = useMemo(() => getStyles(colors, typography), [colors, typography]);
  const { t } = useTranslation();
  const [doc, setDoc] = useState<PackSourceDoc | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing">("loading");

  useEffect(() => {
    if (!chunkId) return;
    let cancelled = false;
    setState("loading");
    setDoc(null);
    import("../../rag/packs")
      .then(({ readPackSource }) => readPackSource(chunkId))
      .then((d) => {
        if (cancelled) return;
        setDoc(d);
        setState(d ? "ready" : "missing");
      })
      .catch(() => {
        if (!cancelled) setState("missing");
      });
    return () => {
      cancelled = true;
    };
  }, [chunkId]);

  return (
    <Modal visible={chunkId !== null} animationType="slide" onRequestClose={onClose}>
      <View style={styles.screen}>
        <View style={styles.header}>
          <Text style={styles.title} numberOfLines={2}>
            {doc?.title ?? t("sourceReader.title")}
          </Text>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={t("sourceReader.close")} hitSlop={8}>
            <Text style={styles.close}>{t("sourceReader.close")}</Text>
          </Pressable>
        </View>
        {state === "loading" ? (
          <ActivityIndicator style={{ marginTop: spacing.lg }} />
        ) : state === "missing" || !doc ? (
          <Text style={styles.body}>{t("sourceReader.notFound")}</Text>
        ) : (
          <ScrollView contentContainerStyle={styles.scroll}>
            <Text style={styles.hint}>{t("sourceReader.hint")}</Text>
            {doc.parts.map((p) => (
              <View key={p.id} style={p.used ? styles.usedPart : styles.part}>
                {p.used ? <Text style={styles.usedLabel}>{t("sourceReader.usedPart")}</Text> : null}
                <Text style={styles.body} selectable>
                  {p.body}
                </Text>
              </View>
            ))}
            {doc.source ? (
              <Text style={styles.source} selectable>
                {t("sourceReader.source", { source: doc.source })}
              </Text>
            ) : null}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

const getStyles = (colors: Colors, typography: Typography) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.bg.black, paddingTop: spacing.lg },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingBottom: spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: colors.border.subtle,
    },
    title: { ...typography.ui.title, color: colors.text.heading, flex: 1 },
    close: { ...typography.ui.body, color: colors.text.accentEmerald, fontWeight: "700" },
    scroll: { padding: spacing.md, gap: spacing.sm },
    hint: { ...typography.ui.caption, color: colors.text.dim },
    part: { paddingVertical: 2 },
    usedPart: {
      backgroundColor: colors.emerald[50],
      borderLeftWidth: 3,
      borderLeftColor: colors.text.accentEmerald,
      borderRadius: radii.sm,
      padding: spacing.sm,
      gap: 4,
    },
    usedLabel: { ...typography.ui.caption, color: colors.text.accentEmerald, fontWeight: "700" },
    body: { ...typography.ui.body, color: colors.text.primary, paddingHorizontal: 0 },
    source: { ...typography.ui.caption, color: colors.text.secondary, marginTop: spacing.md },
  });
