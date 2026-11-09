/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "./theme";
import { CatalogModel } from "../models/manifest";
import { CatalogItemCard, CatalogRowState } from "./CatalogItemCard";
import { PersonalDocumentsManager } from "./PersonalDocumentsManager";
import { ImportedPacksSection } from "./ImportedPacksSection";
import { MultilingualSearchCard } from "./MultilingualSearchCard";
import { activeEmbeddingModel, embeddingIdForPack } from "../rag/embeddingSwitch";

interface Props {
  corpusItems: CatalogModel[];
  getRow: (item: CatalogModel) => CatalogRowState;
  download: (item: CatalogModel) => void;
  remove: (item: CatalogModel) => void;
  /**
   * 0.1.86: abre el lector de guías (la capa de App, sobre el chat).
   * Solo lo pasa el sitio de Ajustes: sin él no hay botón, porque el
   * lector vive en App y los demás sitios de esta pestaña (asistente,
   * Biblioteca) no tienen esa capa encima.
   */
  onOpenLibrary?: () => void;
}

/**
 * Knowledge Base settings content: the app's downloadable corpus packs
 * (unchanged, lifted out of ModelSetupScreen for readability) plus
 * PersonalDocumentsManager (also reachable on its own from the drawer as
 * KnowledgeBaseScreen — same component, not duplicated).
 */
export function CorpusSettingsTab({ corpusItems, getRow, download, remove, onOpenLibrary }: Props) {
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

      {/* 0.1.86: la entrada al lector de guías en uso normal. Hasta
          aquí el lector solo se abría desde la franja del asistente
          de primera vez; con la app ya configurada no había gesto que
          lo abriera. El botón usa la clave ya traducida y solo existe
          cuando el sitio pasa onOpenLibrary (Ajustes): el lector es la
          capa de App, no una segunda copia dentro de esta pestaña. */}
      {onOpenLibrary && (
        <Pressable
          onPress={onOpenLibrary}
          accessibilityRole="button"
          accessibilityLabel={t("guideLibrary.open")}
          style={styles.libraryBtn}
        >
          <Text style={[styles.libraryBtnText, { color: colors.text.accentEmerald }]}>{t("guideLibrary.open")}</Text>
        </Pressable>
      )}

      {/* Pieza A: the signed-pack door — its own surface, apart from "Tus
          documentos" (a different promise: documents are the user's own
          notes; packs enter only with our signature). */}
      <ImportedPacksSection />

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
  libraryBtn: { marginHorizontal: 16, marginTop: 12, minHeight: 44, justifyContent: "center" },
  libraryBtnText: { fontSize: 15, fontWeight: "600" },
});
