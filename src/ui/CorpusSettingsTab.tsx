/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, FlatList } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "./theme";
import { CatalogModel } from "../models/manifest";
import { CatalogItemCard, CatalogRowState } from "./CatalogItemCard";
import { PersonalDocumentsManager } from "./PersonalDocumentsManager";
import { MultilingualSearchCard } from "./MultilingualSearchCard";
import { activeEmbeddingModel, embeddingIdForPack } from "../rag/embeddingSwitch";

interface Props {
  corpusItems: CatalogModel[];
  getRow: (item: CatalogModel) => CatalogRowState;
  download: (item: CatalogModel) => void;
  remove: (item: CatalogModel) => void;
}

/**
 * Knowledge Base settings content: the app's downloadable corpus packs
 * (unchanged, lifted out of ModelSetupScreen for readability) plus
 * PersonalDocumentsManager (also reachable on its own from the drawer as
 * KnowledgeBaseScreen — same component, not duplicated).
 */
export function CorpusSettingsTab({ corpusItems, getRow, download, remove }: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  // Packs with per-model vectors (Wikipedia Vital): offer the variant for the
  // search model in use; an installed variant for the other model stays
  // listed (keyword search only) so it can be removed.
  const [embeddingId, setEmbeddingId] = useState<string | null>(null);
  const refreshEmbedding = useCallback(() => {
    activeEmbeddingModel()
      .then((m) => setEmbeddingId(m.id))
      .catch(() => {});
  }, []);
  useEffect(refreshEmbedding, [refreshEmbedding]);
  const otherModel = (item: CatalogModel) => {
    const forModel = embeddingIdForPack(item.id);
    return forModel !== null && embeddingId !== null && forModel !== embeddingId;
  };
  const visible = corpusItems.filter((item) => !otherModel(item) || getRow(item).present);
  return (
    <View style={{ gap: 4 }}>
      <MultilingualSearchCard onChanged={refreshEmbedding} />
      <Text style={[styles.sectionHeading, { color: colors.text.dim }]}>{t("corpusSettingsTab.downloadablePacks")}</Text>
      <FlatList
        data={visible}
        keyExtractor={(m) => m.id}
        scrollEnabled={false}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <View>
            <CatalogItemCard
              item={item}
              row={getRow(item)}
              isActive={getRow(item).present}
              onDownload={download}
              onUse={() => {}}
              onRemove={remove}
            />
            {otherModel(item) && (
              <Text style={[styles.note, { color: colors.text.secondary }]}>{t("multilingual.packOtherModel")}</Text>
            )}
          </View>
        )}
      />

      <Text style={[styles.sectionHeading, { color: colors.text.dim }]}>{t("corpusSettingsTab.yourDocuments")}</Text>
      <PersonalDocumentsManager />
    </View>
  );
}

const styles = StyleSheet.create({
  sectionHeading: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginHorizontal: 16,
    marginTop: 12,
  },
  list: { padding: 12, gap: 10 },
  note: { fontSize: 12, marginTop: 4, marginHorizontal: 4 },
});
