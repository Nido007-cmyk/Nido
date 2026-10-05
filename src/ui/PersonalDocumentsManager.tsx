import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, TextInput, Switch, Alert, ActivityIndicator } from "react-native";
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
  ImportProgress,
} from "../services/documentImporter";
import { CustomCollection } from "../rag/db";
import { NidoIcon } from "./components/icons/NidoIcon";
import { EmptyState } from "./components/calm/EmptyState";

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0KB";
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)}MB` : `${(bytes / 1024).toFixed(0)}KB`;
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

  const refresh = useCallback(async () => {
    setCollections(await listCustomCollections());
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

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
      await importDocuments(files, name, setImportProgress);
      setNewName("");
      await refresh();
    } catch (e: any) {
      Alert.alert(t("personalDocumentsManager.importFailedTitle"), e?.message ?? String(e));
    } finally {
      setImportProgress(null);
    }
  }, [newName, refresh]);

  const handleToggle = useCallback(
    async (collection: CustomCollection, active: boolean) => {
      await setCustomCollectionActive(collection.id, active);
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
      Alert.alert(t("personalDocumentsManager.exportFailedTitle"), e?.message ?? String(e));
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
          placeholderTextColor="#666"
          value={newName}
          onChangeText={setNewName}
          editable={!importProgress}
        />
        <Pressable
          style={[styles.importBtn, !!importProgress && styles.importBtnDisabled]}
          onPress={handleImport}
          disabled={!!importProgress}
        >
          {importProgress ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <View style={styles.importBtnRow}>
              <NidoIcon name="download" size={14} color="#fff" />
              <Text style={styles.importBtnText}>{t("personalDocumentsManager.pickButton")}</Text>
            </View>
          )}
        </Pressable>
        {importProgress && (
          <Text style={styles.progressText}>
            {importProgress.stage === "reading" && t("personalDocumentsManager.stageReading")}
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
            <View style={styles.collectionActions}>
              <Pressable onPress={() => handleExport(c)} disabled={busyId === c.id} style={styles.exportBtn}>
                {busyId === c.id ? (
                  <Text style={styles.exportBtnText}>{t("personalDocumentsManager.exporting")}</Text>
                ) : (
                  <View style={styles.exportBtnRow}>
                    <NidoIcon name="external" size={13} color="#9cc4ff" />
                    <Text style={styles.exportBtnText}>{t("personalDocumentsManager.exportButton")}</Text>
                  </View>
                )}
              </Pressable>
              <Pressable onPress={() => handleDelete(c)} hitSlop={8} style={styles.trashBtn}>
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
      borderRadius: 6,
      paddingVertical: 10,
      alignItems: "center",
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
    collectionActions: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 4 },
    exportBtn: { backgroundColor: colors.emerald.bgSubtle, borderRadius: 6, paddingHorizontal: 12, paddingVertical: 6 },
    exportBtnText: { color: colors.text.accentEmerald, fontSize: 12, fontWeight: "600" },
    trashBtn: { marginLeft: "auto", padding: 4 },
    trashIcon: { fontSize: 15 },
  });
