/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, Switch, Alert, ActivityIndicator } from "react-native";
import { PrivateTextInput as TextInput } from "./components/PrivateTextInput";
import { useTranslation } from "react-i18next";
import { useTheme } from "./theme";
import type { Colors } from "./theme/colors";
import {
  pickDocuments,
  importDocuments,
  exportCollection,
  listCustomCollections,
  setCustomCollectionActive,
  deleteCustomCollection,
  listImportWarnings,
  dismissImportWarnings,
  ensureImportFingerprintRegistry,
  ImportProgress,
  ImportWarning,
  ImportWarningReason,
} from "../services/documentImporter";
import { CustomCollection } from "../rag/db";
import { NidoIcon } from "./components/icons/NidoIcon";
import { EmptyState } from "./components/calm/EmptyState";

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0KB";
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)}MB` : `${(bytes / 1024).toFixed(0)}KB`;
}

/** Orden en que la tarjeta enseña los grupos de avisos: primero lo que no se pudo leer. */
const WARNING_REASON_ORDER: ImportWarningReason[] = [
  "ocrFailed",
  "ocrEmpty",
  "imageNoOcr",
  "noText",
  "alreadyImported",
  "similarImported",
];

interface WarningGroup {
  reason: ImportWarningReason;
  /** C-06: la colección del parecido/duplicado; los grupos de identidad se separan por ella. */
  detail?: string;
  warnings: ImportWarning[];
}

/**
 * H-11: los avisos de una colección se agrupan por razón — cada
 * grupo con SU cadena (la superficie anterior fundía todas las
 * razones en una sola frase «no aportó texto», ADV2-05). Los grupos
 * de identidad se separan además por la colección que nombran.
 */
function groupWarnings(warnings: ImportWarning[]): WarningGroup[] {
  const groups: WarningGroup[] = [];
  for (const reason of WARNING_REASON_ORDER) {
    const ofReason = warnings.filter((w) => w.reason === reason);
    if (ofReason.length === 0) continue;
    if (reason === "alreadyImported" || reason === "similarImported") {
      const byDetail = new Map<string, ImportWarning[]>();
      for (const w of ofReason) {
        const key = w.detail ?? "";
        const arr = byDetail.get(key);
        if (arr) arr.push(w);
        else byDetail.set(key, [w]);
      }
      for (const [detail, ws] of byDetail) {
        groups.push({ reason, detail: detail || undefined, warnings: ws });
      }
    } else {
      groups.push({ reason, warnings: ofReason });
    }
  }
  return groups;
}

/**
 * Import, list, toggle, export, and delete the user's own document
 * collections (see src/services/documentImporter.ts) — fully self-contained
 * (no props), so it can be dropped into both Settings > Knowledge Base
 * (CorpusSettingsTab, alongside the downloadable corpus packs) and its own
 * drawer-accessible screen (KnowledgeBaseScreen) without duplicating logic.
 */
export function PersonalDocumentsManager() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const [collections, setCollections] = useState<CustomCollection[]>([]);
  const [newName, setNewName] = useState("");
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // H-11: los avisos de cada colección, por id, LEÍDOS DE LA BASE
  // en cada refresh — persisten con su colección y sobreviven a la
  // pantalla que vio la importación (antes vivían en este estado y
  // morían al salir; y la siembra desde el resultado se ha retirado:
  // el refresh es el único dueño de este mapa).
  const [warningsById, setWarningsById] = useState<Record<string, ImportWarning[]>>({});
  // C-06: el «importar de todos modos» del caso 1-total vive solo
  // en el momento: la app no conserva el fichero tras importar, así
  // que la acción guarda lote y nombre en memoria junto a la
  // colección que ya guarda el duplicado, y muere con la pantalla.
  const [forceRetryById, setForceRetryById] = useState<
    Record<string, { files: Parameters<typeof importDocuments>[0]; name: string }>
  >({});

  const refresh = useCallback(async () => {
    // C-06: la apertura de la Biblioteca es el momento del registro
    // perezoso (una sola vez; best-effort, nunca bloquea la lista).
    await ensureImportFingerprintRegistry().catch(() => {});
    const cols = await listCustomCollections();
    setCollections(cols);
    try {
      setWarningsById(await listImportWarnings(cols.map((c) => c.id)));
    } catch {
      // Si la lectura de avisos falla, la tarjeta conserva los que
      // ya enseñaba en vez de vaciar la superficie.
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const alertImportError = useCallback(
    (e: any) => {
      // 0.1.18: known import errors in the app language.
      const code = typeof e?.code === "string" && e?.name === "DocImportError" ? e.code : null;
      Alert.alert(
        t("personalDocumentsManager.importFailedTitle"),
        // Auditoría completa 2026-10-31 (F9-03): sin código, el
        // genérico localizado; el mensaje interno crudo ya no llega
        // a la alerta.
        (code ? t(`personalDocumentsManager.errors.${code}`, e.vars ?? {}) : t("personalDocumentsManager.importFailedBody")) as string,
      );
    },
    []
  );

  const handleImport = useCallback(async () => {
    const name = newName.trim();
    if (!name) {
      Alert.alert(t("personalDocumentsManager.nameRequiredTitle"), t("personalDocumentsManager.nameRequiredMessage"));
      return;
    }
    const files = await pickDocuments();
    if (!files || files.length === 0) return;

    setImportProgress({ stage: "reading" });
    try {
      const imported = await importDocuments(files, name, setImportProgress);
      setNewName("");
      if (imported.duplicateImport) {
        // Nada entró: la colección devuelta es la que ya guarda el
        // duplicado, y su tarjeta ofrece forzar la copia ahora.
        setForceRetryById((prev) => ({ ...prev, [imported.id]: { files, name } }));
      }
      await refresh();
    } catch (e: any) {
      alertImportError(e);
    } finally {
      setImportProgress(null);
    }
  }, [newName, refresh, alertImportError]);

  const handleImportAnyway = useCallback(
    async (collectionId: string) => {
      const pending = forceRetryById[collectionId];
      if (!pending) return;
      setImportProgress({ stage: "reading" });
      try {
        await importDocuments(pending.files, pending.name, setImportProgress, {
          forceDuplicates: true,
        });
        setForceRetryById((prev) => {
          const next = { ...prev };
          delete next[collectionId];
          return next;
        });
        await refresh();
      } catch (e: any) {
        alertImportError(e);
      } finally {
        setImportProgress(null);
      }
    },
    [forceRetryById, refresh, alertImportError]
  );

  const handleDismissWarnings = useCallback(
    async (collectionId: string, reason: ImportWarningReason) => {
      await dismissImportWarnings(collectionId, reason).catch(() => {});
      if (reason === "alreadyImported") {
        // Descartar el aviso de identidad retira también la acción
        // del momento: la persona ya ha decidido que no la quiere.
        setForceRetryById((prev) => {
          const next = { ...prev };
          delete next[collectionId];
          return next;
        });
      }
      await refresh();
    },
    [refresh]
  );

  /** La línea de un grupo de avisos, con la cadena de SU razón. */
  const warningLine = useCallback(
    (group: WarningGroup): string => {
      const names = group.warnings
        .map((w) => {
          if (group.reason === "ocrFailed") return w.ocrCode ? `${w.name} (${w.ocrCode})` : w.name;
          if (group.reason === "alreadyImported" || group.reason === "similarImported") {
            return w.previousName && w.previousName !== w.name ? `${w.name} (${w.previousName})` : w.name;
          }
          return w.name;
        })
        .join(", ");
      const count = group.warnings.length;
      switch (group.reason) {
        case "ocrFailed":
          return t("personalDocumentsManager.warningOcrFailed", { count, names });
        case "ocrEmpty":
          return t("personalDocumentsManager.warningOcrEmpty", { count, names });
        case "imageNoOcr":
          return t("personalDocumentsManager.warningImageNoOcr", { count, names });
        case "alreadyImported":
          return group.detail
            ? t("personalDocumentsManager.warningAlreadyImported", { count, names, detail: group.detail })
            : t("personalDocumentsManager.warningAlreadyHere", { count, names });
        case "similarImported":
          return t("personalDocumentsManager.warningSimilarImported", { count, names, detail: group.detail ?? "" });
        default:
          return t("personalDocumentsManager.noTextWarning", { count, names });
      }
    },
    []
  );

  const handleToggle = useCallback(
    async (collection: CustomCollection, active: boolean) => {
      try {
        await setCustomCollectionActive(collection.id, active);
      } catch {
        // FIX 2026-10-09 (UI-AUDIT/F4): si falla la escritura, refresh()
        // restaura el estado real desde la BD (no queda optimista falso).
      }
      await refresh();
    },
    [refresh]
  );

  const handleDelete = useCallback(
    (collection: CustomCollection) => {
      Alert.alert(
        t("personalDocumentsManager.removeConfirmTitle"),
        t("personalDocumentsManager.removeConfirmMessage", { name: collection.name, count: collection.chunkCount }),
        [
          { text: t("common.cancel"), style: "cancel" },
          {
            text: t("common.remove"),
            style: "destructive",
            onPress: async () => {
              await deleteCustomCollection(collection.id);
              await refresh();
            },
          },
        ]
      );
    },
    [refresh]
  );

  const handleExport = useCallback(async (collection: CustomCollection) => {
    setBusyId(collection.id);
    try {
      await exportCollection(collection);
    } catch (e: any) {
      Alert.alert(t("personalDocumentsManager.exportFailedTitle"), t("personalDocumentsManager.exportFailedBody"));
    } finally {
      setBusyId(null);
    }
  }, []);

  return (
    <View style={{ gap: 4 }}>
      <Text style={styles.hint}>{t("personalDocumentsManager.hint")}</Text>

      <View style={styles.importCard}>
        <TextInput
          style={styles.nameInput}
          placeholder={t("personalDocumentsManager.namePlaceholder")}
          placeholderTextColor={colors.text.muted}
          value={newName}
          maxLength={60}
          onChangeText={setNewName}
          editable={!importProgress}
        />
        <Pressable accessibilityRole="button" accessibilityLabel={t("personalDocumentsManager.pickButton")}
          style={[styles.importBtn, !!importProgress && styles.importBtnDisabled]}
          onPress={handleImport}
          disabled={!!importProgress}
        >
          {importProgress ? (
            <ActivityIndicator color={colors.text.inverse} />
          ) : (
            <View style={styles.importBtnRow}>
              <NidoIcon name="download" size={14} color={colors.text.inverse} />
              <Text style={styles.importBtnText}>{t("personalDocumentsManager.pickButton")}</Text>
            </View>
          )}
        </Pressable>
        {importProgress && (
          <Text style={styles.progressText}>
            {importProgress.stage === "reading" && t("personalDocumentsManager.stageReading")}
            {importProgress.stage === "ocr" && t("personalDocumentsManager.stageOcr")}
            {importProgress.stage === "chunking" && t("personalDocumentsManager.stageChunking")}
            {importProgress.stage === "embedding" &&
              t("personalDocumentsManager.stageEmbedding", {
                current: (importProgress.chunkIndex ?? 0) + 1,
                total: importProgress.chunkCount,
              })}
          </Text>
        )}
      </View>

      {collections.length === 0 && !importProgress && (
        <EmptyState
          title={t("personalDocumentsManager.emptyTitle")}
          description={t("personalDocumentsManager.emptyDescription")}
          actionLabel={t("personalDocumentsManager.emptyAction")}
          onAction={handleImport}
        />
      )}

      <View style={styles.list}>
        {collections.map((c) => (
          <View key={c.id} style={[styles.collectionCard, !c.active && styles.collectionCardInactive]}>
            <View style={styles.collectionHeaderRow}>
              <Text style={styles.collectionName}>{c.name}</Text>
              <Switch value={c.active} onValueChange={(v) => handleToggle(c, v)} />
            </View>
            <Text style={styles.collectionMeta}>
              {t("personalDocumentsManager.docCount", { count: c.docCount })} · {" "}
              {t("personalDocumentsManager.chunkCount", { count: c.chunkCount })} · {formatBytes(c.sizeBytes)}
            </Text>
            {groupWarnings(warningsById[c.id] ?? []).map((group, gi) => (
              <View key={`${group.reason}-${group.detail ?? ""}-${gi}`} style={styles.warningRow}>
                <Text style={[styles.collectionWarning, styles.warningText]}>{warningLine(group)}</Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => handleDismissWarnings(c.id, group.reason)}
                  hitSlop={8}
                  style={styles.dismissBtn}
                >
                  <Text style={styles.dismissText}>{t("common.dismiss")}</Text>
                </Pressable>
              </View>
            ))}
            {forceRetryById[c.id] && (
              <Pressable
                accessibilityRole="button"
                onPress={() => handleImportAnyway(c.id)}
                disabled={!!importProgress}
                style={styles.importAnywayBtn}
              >
                <Text style={styles.importAnywayText}>{t("personalDocumentsManager.importAnyway")}</Text>
              </Pressable>
            )}
            <View style={styles.collectionActions}>
              <Pressable accessibilityRole="button" onPress={() => handleExport(c)} disabled={busyId === c.id} style={styles.exportBtn}>
                {busyId === c.id ? (
                  <Text style={styles.exportBtnText}>{t("personalDocumentsManager.exporting")}</Text>
                ) : (
                  <View style={styles.exportBtnRow}>
                    <NidoIcon name="external" size={13} color={colors.text.accentEmerald} />
                    <Text style={styles.exportBtnText}>{t("personalDocumentsManager.exportButton")}</Text>
                  </View>
                )}
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel={t("personalDocumentsManager.removeConfirmTitle")} onPress={() => handleDelete(c)} hitSlop={12} style={styles.trashBtn}>
                <NidoIcon name="delete" size={14} />
              </Pressable>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

const getStyles = (colors: Colors) =>
  StyleSheet.create({
    hint: { color: colors.text.muted, fontSize: 11, marginHorizontal: 12, marginTop: 4, lineHeight: 16 },
    list: { padding: 12, gap: 10 },
    importCard: {
      marginHorizontal: 12,
      marginTop: 10,
      backgroundColor: colors.bg.card,
      borderRadius: 10,
      padding: 12,
      gap: 8,
      borderWidth: 1,
      borderColor: colors.border.default,
    },
    nameInput: {
      backgroundColor: colors.bg.surface,
      borderRadius: 6,
      paddingHorizontal: 10,
      paddingVertical: 8,
      color: colors.text.primary,
      fontSize: 13,
      borderWidth: 1,
      borderColor: colors.border.default,
    },
    importBtn: {
      backgroundColor: colors.text.accentEmerald,
      borderRadius: 9999,
      paddingVertical: 10,
      alignItems: "center",
      minHeight: 44,
      justifyContent: "center",
    },
    importBtnDisabled: { backgroundColor: colors.border.default },
    importBtnText: { color: colors.text.inverse, fontWeight: "700", fontSize: 13 },
    importBtnRow: { flexDirection: "row", alignItems: "center", gap: 6 },
    exportBtnRow: { flexDirection: "row", alignItems: "center", gap: 6 },
    progressText: { color: colors.text.accentEmerald, fontSize: 11, textAlign: "center" },
    empty: { color: colors.text.muted, fontSize: 12, marginHorizontal: 12, marginTop: 8 },
    collectionCard: {
      backgroundColor: colors.bg.card,
      borderRadius: 10,
      padding: 12,
      gap: 6,
      borderWidth: 1,
      borderColor: colors.border.default,
    },
    collectionCardInactive: { opacity: 0.55 },
    collectionHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    collectionName: { color: colors.text.primary, fontSize: 14, fontWeight: "600", flex: 1 },
    collectionMeta: { color: colors.text.accentEmerald, fontSize: 11 },
    collectionWarning: { color: colors.amber[600], fontSize: 11, lineHeight: 15 },
    warningRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
    warningText: { flex: 1 },
    dismissBtn: { paddingVertical: 2 },
    dismissText: { color: colors.text.accentEmerald, fontSize: 11, fontWeight: "600" },
    importAnywayBtn: { alignSelf: "flex-start", paddingVertical: 2 },
    importAnywayText: { color: colors.text.accentEmerald, fontSize: 11, fontWeight: "700" },
    collectionActions: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 4 },
    exportBtn: { backgroundColor: colors.emerald.bgSubtle, borderRadius: 6, paddingHorizontal: 12, paddingVertical: 6 },
    exportBtnText: { color: colors.text.accentEmerald, fontSize: 12, fontWeight: "600" },
    trashBtn: { marginLeft: "auto", padding: 4 },
    trashIcon: { fontSize: 15 },
  });
