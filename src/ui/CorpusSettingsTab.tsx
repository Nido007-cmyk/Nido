/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import React from "react";
import { View, Text, StyleSheet, FlatList } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "./theme";
import { CatalogModel } from "../models/manifest";
import { CatalogItemCard, CatalogRowState } from "./CatalogItemCard";
import { PersonalDocumentsManager } from "./PersonalDocumentsManager";

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
  return (
    <View style={{ gap: 4 }}>
      <Text style={[styles.sectionHeading, { color: colors.text.dim }]}>{t("corpusSettingsTab.downloadablePacks")}</Text>
      <FlatList
        data={corpusItems}
        keyExtractor={(m) => m.id}
        scrollEnabled={false}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <CatalogItemCard
            item={item}
            row={getRow(item)}
            isActive={getRow(item).present}
            onDownload={download}
            onUse={() => {}}
            onRemove={remove}
          />
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
});
