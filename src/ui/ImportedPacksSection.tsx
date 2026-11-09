/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "./theme";
import type { Colors } from "./theme/colors";
import type { Typography } from "./theme/typography";
import { spacing, radii } from "./theme/spacing";
import { PACK_IMPORT_MAX_BYTES, PACK_ORIGIN_LABEL, type PackOrigin } from "../models/packImport";
import {
  importPackFromFile,
  listImportedPacks,
  removeImportedPack,
  type ImportedPackItem,
  type PackImportRejectionReason,
} from "../services/packImporter";
import { activeEmbeddingModel } from "../rag/embeddingSwitch";

function formatMB(bytes: number): string {
  if (bytes <= 0) return "0 MB";
  return bytes >= 1024 * 1024 * 1024
    ? `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
    : `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
}

/** A.3 chain for each rejection reason (too-large interpolates its cap). */
const REJECTION_KEYS: Record<PackImportRejectionReason, string> = {
  "missing-manifest": "packImport.missingManifest",
  "hash-mismatch": "packImport.hashMismatch",
  "not-signed-by-us": "packImport.notSignedByUs",
  "not-a-pack": "packImport.notAPack",
  damaged: "packImport.damaged",
  "too-large": "packImport.tooLarge",
};

/**
 * The signed-pack door in Settings > Knowledge Base (Pieza A, PI-1/PI-3/
 * PI-4): the "add a pack from a file" gesture, and the packs this door
 * verified, each with the origin mark of the key that signed it. Packs
 * that arrived any other way carry no mark here — the word "signed" is
 * only ever shown for packs that passed the door's verification (AI-05).
 * Catalog-named packs (the Esencial) present on their catalog card, not
 * here (packImporter.listImportedPacks).
 */
export function ImportedPacksSection({ onOpenLibrary }: { onOpenLibrary?: () => void } = {}) {
  const { colors, typography } = useTheme();
  const styles = useMemo(() => getStyles(colors, typography), [colors, typography]);
  const { t } = useTranslation();
  const [items, setItems] = useState<ImportedPackItem[]>([]);
  const [busy, setBusy] = useState(false);
  // 0.1.87 (pieza 4): la huella del modelo de búsqueda activo, para
  // avisar cuando un pack importado se embebió con el otro modelo,
  // como ya hace CorpusSettingsTab con el catálogo. Sin la huella
  // (no leída aún, o el modelo no resuelve) el aviso calla: no se
  // afirma un desajuste que no se puede comprobar.
  const [activeSha256, setActiveSha256] = useState<string | null>(null);
  useEffect(() => {
    activeEmbeddingModel()
      .then((m) => setActiveSha256(m.sha256))
      .catch(() => {});
  }, []);

  const refresh = useCallback(() => {
    listImportedPacks()
      .then(setItems)
      .catch(() => {});
  }, []);
  useEffect(refresh, [refresh]);

  /** A.3 chain 3, shown BEFORE anything is copied, naming who signed. */
  const confirmWithDialog = useCallback(
    (origin: PackOrigin) =>
      new Promise<boolean>((resolve) => {
        Alert.alert(
          t("packImport.confirmTitle"),
          t("packImport.confirmBody", { origin: PACK_ORIGIN_LABEL[origin] }),
          [
            { text: t("common.cancel"), style: "cancel", onPress: () => resolve(false) },
            { text: t("common.confirm"), onPress: () => resolve(true) },
          ],
          { onDismiss: () => resolve(false) }
        );
      }),
    [t]
  );

  const onAdd = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const outcome = await importPackFromFile(confirmWithDialog);
      if (outcome.status === "rejected") {
        const key = REJECTION_KEYS[outcome.reason];
        Alert.alert(
          outcome.reason === "too-large"
            ? t(key, { max: String(Math.round(PACK_IMPORT_MAX_BYTES / (1024 * 1024))) })
            : t(key)
        );
      }
      refresh();
    } catch {
      Alert.alert(t("packImport.damaged"));
    } finally {
      setBusy(false);
    }
  }, [busy, confirmWithDialog, refresh, t]);

  const onRemove = useCallback(
    (item: ImportedPackItem) => {
      Alert.alert(t("packImport.removeAction"), t("packImport.removeConfirmBody"), [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("packImport.removeAction"),
          style: "destructive",
          onPress: () => {
            removeImportedPack(item.filename)
              .catch(() => {})
              .finally(refresh);
          },
        },
      ]);
    },
    [refresh, t]
  );

  return (
    <View>
      <View style={styles.headingRow}>
        <Text style={[styles.sectionHeading, { color: colors.text.dim }]}>{t("packImport.addedHeading")}</Text>
        {/* 0.1.87 (pieza 5): el segundo botón del lector, en el
            encabezado de la lista de packs — donde el dueño busca
            sus guías. Solo existe con la prop (la capa de App
            encima); sin ella no se enseña un botón sin destino. */}
        {onOpenLibrary ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("guideLibrary.open")}
            style={styles.libraryBtn}
            onPress={onOpenLibrary}
          >
            <Text style={styles.libraryBtnText}>{t("guideLibrary.open")}</Text>
          </Pressable>
        ) : null}
      </View>
      <View style={styles.list}>
        {items.map((item) => (
          <View key={item.filename} style={styles.card}>
            <Text style={styles.label}>{item.name}</Text>
            <Text style={styles.signedBy}>
              {t("packImport.signedBy", { origin: PACK_ORIGIN_LABEL[item.origin] })}
            </Text>
            <Text style={styles.meta}>
              {formatMB(item.sizeBytes)} • {item.filename}
            </Text>
            {item.embeddingModelSha256 && activeSha256 && item.embeddingModelSha256 !== activeSha256 ? (
              <Text style={styles.otherModelNote}>{t("multilingual.packOtherModel")}</Text>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("packImport.removeAction")}
              style={styles.removeBtn}
              onPress={() => onRemove(item)}
            >
              <Text style={styles.removeBtnText}>{t("packImport.removeAction")}</Text>
            </Pressable>
          </View>
        ))}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("packImport.addButton")}
          style={[styles.addBtn, busy && styles.disabled]}
          onPress={onAdd}
          disabled={busy}
        >
          {busy ? (
            <ActivityIndicator size="small" color={colors.text.accentEmerald} />
          ) : (
            <Text style={styles.addBtnText}>{t("packImport.addButton")}</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const getStyles = (colors: Colors, typography: Typography) =>
  StyleSheet.create({
    sectionHeading: {
      fontSize: 11,
      fontWeight: "700",
      letterSpacing: 0.8,
      textTransform: "uppercase",
      marginHorizontal: 16,
      marginTop: 12,
    },
    headingRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingRight: 16 },
    libraryBtn: {
      marginTop: 8,
      paddingVertical: 6,
      paddingHorizontal: 10,
      borderRadius: 9999,
      borderWidth: 1,
      borderColor: colors.emerald.border,
      backgroundColor: colors.emerald.bgSubtle,
    },
    libraryBtnText: {
      ...typography.ui.caption,
      color: colors.text.accentEmerald,
      fontWeight: "700",
    },
    list: { padding: 12, gap: 10 },
    card: {
      backgroundColor: colors.bg.cardElevated,
      borderRadius: radii.lg,
      padding: spacing.md,
      gap: spacing.sm,
      borderWidth: 1,
      borderColor: colors.border.default,
    },
    label: {
      ...typography.ui.titleSm,
      color: colors.text.heading,
    },
    signedBy: {
      ...typography.mono.xs,
      color: colors.text.accentEmerald,
      fontWeight: "700",
    },
    meta: {
      ...typography.mono.xs,
      color: colors.text.dim,
    },
    otherModelNote: {
      ...typography.ui.caption,
      color: colors.text.secondary,
    },
    removeBtn: {
      alignSelf: "flex-start",
      paddingVertical: 6,
      paddingHorizontal: 10,
      borderRadius: radii.sm,
      backgroundColor: colors.bg.subtle,
    },
    removeBtnText: {
      ...typography.ui.caption,
      color: colors.crimson[400],
      fontWeight: "600",
    },
    addBtn: {
      backgroundColor: colors.emerald.bgSubtle,
      borderColor: colors.emerald.border,
      borderWidth: 1,
      borderRadius: 9999,
      paddingHorizontal: 14,
      paddingVertical: 8,
      minHeight: 44,
      justifyContent: "center",
      alignItems: "center",
    },
    addBtnText: {
      ...typography.ui.titleSm,
      fontSize: 12,
      color: colors.text.accentEmerald,
    },
    disabled: { opacity: 0.4 },
  });
