/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * GuideLibraryScreen: las guías de los packs instalados, abiertas como
 * documentos para leerlas de principio a fin, sin cargar el modelo.
 *
 * Es la puerta de lectura que no pasa por el chat: App la monta como capa
 * propia (también sobre el wizard de instalación), y esta pantalla solo
 * usa la lectura de packs (knowledgePacks, listPackGuides, readPackGuide),
 * que nunca toca los motores. ChatScreen no se monta por estar aquí, y el
 * modelo solo carga cuando el usuario entra al chat, como siempre.
 */
import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { impact, ImpactFeedbackStyle } from "../services/haptics";
import { useTheme } from "./theme";
import type { Colors } from "./theme/colors";
import type { Typography } from "./theme/typography";
import { NidoIcon } from "./components/icons/NidoIcon";
import { calmSpacing, calmRadii } from "./theme/calm";
import { knowledgePacks, listPackGuides, readPackGuide } from "../rag/packs";
import type { PackGuideDoc, PackGuideEntry } from "../rag/packs";

interface PackSection {
  packId: string;
  label: string;
  guides: PackGuideEntry[];
}

type Selection = { packId: string; guideId: number } | null;

/**
 * Tope de pintado del lector (RED TEAM 2026-11-08): montar un texto
 * gigante en un solo <Text> puede tumbar un teléfono de gama baja, así
 * que el cuerpo se recorta en pantalla por encima de este tamaño y se
 * avisa. El tope está muy por encima de cualquier guía real: medido
 * sobre el catálogo firmado v15 (174 guías), el cuerpo más largo mide
 * 3.209 caracteres, así que 100.000 es unas 31 veces ese máximo y una
 * guía real se pinta siempre entera. La guía guardada no se toca: el
 * recorte es solo de pantalla.
 */
export const MAX_PAINTED_BODY_CHARS = 100_000;

export function GuideLibraryScreen({ onClose }: { onClose: () => void }) {
  const { colors, typography } = useTheme();
  const styles = useMemo(() => getStyles(colors, typography), [colors, typography]);
  const { t } = useTranslation();
  // 0.1.89: App monta esta pantalla en una capa absoluta a pantalla
  // completa, que no hereda el padding del SafeAreaView raíz: sin
  // este inset la cabecera nacía en el borde superior de la ventana
  // y la barra de estado del sistema se pintaba sobre «Guías» y el
  // botón de cierre (foto del dueño, 2026-11-09). La pantalla aplica
  // el área segura ella misma, como hace SetupWizardScreen, y las
  // dos vistas (lista y documento) comparten esta raíz.
  const insets = useSafeAreaInsets();
  // 0.1.89: la raíz suma el inset de arriba (la cabecera quedaba bajo
  // la barra de estado). 0.1.90: suma también el de abajo — la última
  // línea de la guía leída hasta el final quedaba cortada por la
  // barra del sistema (foto del dueño, Tab A9+, 2026-11-09).
  const rootStyle = [styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }];
  const [sections, setSections] = useState<PackSection[] | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [doc, setDoc] = useState<PackGuideDoc | null>(null);
  const [docState, setDocState] = useState<"idle" | "loading" | "ready" | "missing">("idle");

  useEffect(() => {
    let cancelled = false;
    Promise.resolve()
      .then(async () => {
        const packs = await knowledgePacks();
        const found: PackSection[] = [];
        for (const pack of packs) {
          const guides = await listPackGuides(pack.id).catch(() => [] as PackGuideEntry[]);
          if (guides.length > 0) found.push({ packId: pack.id, label: pack.label, guides });
        }
        if (!cancelled) setSections(found);
      })
      .catch(() => {
        if (!cancelled) setSections([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selection) return;
    let cancelled = false;
    setDocState("loading");
    setDoc(null);
    Promise.resolve()
      .then(() => readPackGuide(selection.packId, selection.guideId))
      .then((d) => {
        if (cancelled) return;
        setDoc(d);
        setDocState(d ? "ready" : "missing");
      })
      .catch(() => {
        if (!cancelled) setDocState("missing");
      });
    return () => {
      cancelled = true;
    };
  }, [selection]);

  const handleClose = () => {
    impact(ImpactFeedbackStyle.Light);
    onClose();
  };

  if (selection) {
    return (
      <View style={rootStyle}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={styles.title} numberOfLines={2}>
              {doc?.title ?? t("guideLibrary.title")}
            </Text>
          </View>
          <Pressable
            onPress={() => setSelection(null)}
            hitSlop={8}
            style={styles.closeBtn}
            accessibilityRole="button"
            accessibilityLabel={t("guideLibrary.back")}
          >
            <Text style={styles.closeBtnText}>{t("guideLibrary.back")}</Text>
          </Pressable>
        </View>
        {docState === "loading" ? (
          <ActivityIndicator style={{ marginTop: calmSpacing.generous }} color={colors.emerald[400]} />
        ) : docState === "missing" || !doc ? (
          <Text style={styles.bodyText}>{t("guideLibrary.readError")}</Text>
        ) : (
          <ScrollView contentContainerStyle={styles.body}>
            <Text style={styles.bodyText} selectable>
              {doc.body.length > MAX_PAINTED_BODY_CHARS ? doc.body.slice(0, MAX_PAINTED_BODY_CHARS) : doc.body}
            </Text>
            {doc.body.length > MAX_PAINTED_BODY_CHARS ? (
              <Text style={styles.truncatedNote}>{t("guideLibrary.truncated")}</Text>
            ) : null}
            {doc.source ? (
              <Text style={styles.source} selectable>
                {t("sourceReader.source", { source: doc.source })}
              </Text>
            ) : null}
          </ScrollView>
        )}
      </View>
    );
  }

  return (
    <View style={rootStyle}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <NidoIcon name="knowledge" size={20} />
          <Text style={styles.title}>{t("guideLibrary.title")}</Text>
        </View>
        <Pressable
          onPress={handleClose}
          hitSlop={8}
          style={styles.closeBtn}
          accessibilityRole="button"
          accessibilityLabel={t("common.done")}
        >
          <Text style={styles.closeBtnText}>{t("common.done")}</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.intro}>{t("guideLibrary.intro")}</Text>
        {sections === null ? (
          <>
            <ActivityIndicator style={{ marginTop: calmSpacing.comfortable }} color={colors.emerald[400]} />
            <Text style={styles.hint}>{t("guideLibrary.loading")}</Text>
          </>
        ) : sections.length === 0 ? (
          <Text style={styles.bodyText}>{t("guideLibrary.noPacks")}</Text>
        ) : (
          sections.map((section) => (
            <View key={section.packId} style={styles.packBlock}>
              <Text style={styles.packLabel}>{section.label}</Text>
              {section.guides.map((guide) => (
                <Pressable
                  key={`${section.packId}:${guide.id}`}
                  style={styles.guideRow}
                  accessibilityRole="button"
                  accessibilityLabel={guide.title}
                  onPress={() => {
                    impact(ImpactFeedbackStyle.Light);
                    setSelection({ packId: section.packId, guideId: guide.id });
                  }}
                >
                  <Text style={styles.guideTitle}>{guide.title}</Text>
                  {guide.category ? <Text style={styles.hint}>{guide.category}</Text> : null}
                </Pressable>
              ))}
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const getStyles = (colors: Colors, typography: Typography) =>
  StyleSheet.create({
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
    headerLeft: { flexDirection: "row", alignItems: "center", gap: calmSpacing.cozy, flex: 1 },
    title: { ...typography.ui.title, color: colors.text.heading, flexShrink: 1 },
    closeBtn: {
      paddingHorizontal: calmSpacing.cozy,
      paddingVertical: calmSpacing.tight,
      borderRadius: 9999,
      minHeight: 40,
      justifyContent: "center",
      backgroundColor: colors.emerald.bgSubtle,
    },
    closeBtnText: { ...typography.ui.caption, color: colors.emerald[600], fontWeight: "700" },
    body: { padding: calmSpacing.comfortable, paddingBottom: calmSpacing.generous, gap: calmSpacing.cozy },
    intro: { ...typography.ui.body, color: colors.text.secondary },
    hint: { ...typography.ui.caption, color: colors.text.dim },
    bodyText: { ...typography.ui.body, color: colors.text.primary, padding: calmSpacing.comfortable },
    packBlock: { gap: calmSpacing.tight, marginTop: calmSpacing.comfortable },
    packLabel: { ...typography.ui.caption, color: colors.text.secondary, fontWeight: "700" },
    guideRow: {
      paddingHorizontal: calmSpacing.comfortable,
      paddingVertical: calmSpacing.cozy,
      borderRadius: calmRadii.soft,
      backgroundColor: colors.bg.cardElevated,
      gap: 2,
    },
    guideTitle: { ...typography.ui.body, color: colors.text.primary },
    source: { ...typography.ui.caption, color: colors.text.secondary, marginTop: calmSpacing.comfortable },
    truncatedNote: { ...typography.ui.caption, color: colors.text.secondary, marginTop: calmSpacing.cozy, paddingHorizontal: calmSpacing.comfortable },
  });
