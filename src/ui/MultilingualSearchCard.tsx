/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * "Búsqueda en español y portugués" — Ajustes → Base de conocimiento.
 * Diseño: docs/design/BUSQUEDA_MULTILINGUE.md.
 *
 * Optional for existing installs (new installs in es/pt get it from the
 * setup wizard). Turning it on downloads the multilingual model (~126 MB,
 * verified like every catalog asset), switches to it and rebuilds the
 * vectors in the background. Keyword search keeps working meanwhile.
 * Turning it off goes back to the original English model the same way.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, View, Text, StyleSheet, Pressable } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "./theme";
import type { Colors } from "./theme/colors";
import type { Typography } from "./theme/typography";
import { calmSpacing } from "./theme/calm";
import { makeSurfaces } from "./theme/surfaces";
import { ModelManager } from "../models/ModelManager";
import { downloadUntilSettled, getDownloadState, isDownloading, subscribeDownloads } from "../services/downloadManager";
import {
  activeEmbeddingModel,
  defaultEmbeddingModel,
  embeddingModelById,
  isMultilingualEmbedding,
  MULTILINGUAL_EMBEDDING_ID,
  switchEmbeddingModel,
} from "../rag/embeddingSwitch";
import { onReembedProgress, type ReembedProgress } from "../rag/reembed";

const modelManager = new ModelManager();

export function MultilingualSearchCard({ onChanged }: { onChanged?: () => void }) {
  const { colors, typography } = useTheme();
  const styles = useMemo(() => getStyles(colors, typography), [colors, typography]);
  const { t } = useTranslation();
  const target = embeddingModelById(MULTILINGUAL_EMBEDDING_ID);
  const [active, setActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [progress, setProgress] = useState<ReembedProgress | null>(null);
  const [, rerender] = useState(0);
  // A second confirm while a change is running is ignored (the button is
  // already disabled; this also covers two dialogs confirmed quickly).
  const running = useRef(false);

  const refresh = useCallback(async () => {
    setActive(isMultilingualEmbedding(await activeEmbeddingModel()));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);
  useEffect(() => subscribeDownloads(() => rerender((n) => n + 1)), []);
  useEffect(() => onReembedProgress(setProgress), []);

  const run = useCallback(
    async (enable: boolean) => {
      if (!target || running.current) return;
      running.current = true;
      setBusy(true);
      setMessage(null);
      try {
        const model = enable ? target : defaultEmbeddingModel();
        const [status] = await modelManager.statusAll().then((all) => all.filter((s) => s.asset.id === model.id));
        if (!status?.present) {
          // Waits through automatic retries: only a final failure is an error.
          const err = await downloadUntilSettled(model);
          if (err) throw new Error(err);
        }
        await switchEmbeddingModel(model);
        await refresh();
        setMessage(t(enable ? "multilingual.enabled" : "multilingual.disabled"));
        onChanged?.();
      } catch (e) {
        setMessage(t("multilingual.failed", { error: e instanceof Error ? e.message : String(e) }));
        await refresh();
      } finally {
        running.current = false;
        setBusy(false);
      }
    },
    [onChanged, refresh, t, target]
  );

  const confirm = (enable: boolean) =>
    Alert.alert(
      t(enable ? "multilingual.confirmOnTitle" : "multilingual.confirmOffTitle"),
      t(enable ? "multilingual.confirmOnBody" : "multilingual.confirmOffBody"),
      [
        { text: t("common.cancel"), style: "cancel" },
        { text: t(enable ? "multilingual.turnOn" : "multilingual.turnOff"), onPress: () => run(enable) },
      ]
    );

  if (!target) return null;

  const dl = getDownloadState(target.id);
  const downloading = isDownloading(target.id) || !!dl?.autoRetrying;
  const reindexing = progress?.running && progress.total > 0;

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{t("multilingual.title")}</Text>
      <Text style={styles.paragraph}>{t("multilingual.body")}</Text>
      <Text style={styles.status}>{t(active ? "multilingual.statusOn" : "multilingual.statusOff")}</Text>
      {downloading && (
        <Text style={styles.status}>
          {t("multilingual.downloading", { pct: String(Math.round((dl?.progress ?? 0) * 100)) })}
        </Text>
      )}
      {reindexing && (
        <Text style={styles.status}>
          {t("multilingual.reindexing", {
            done: progress!.done.toLocaleString(),
            total: progress!.total.toLocaleString(),
          })}
        </Text>
      )}
      {message && <Text style={styles.status}>{message}</Text>}
      <View style={styles.row}>
        {active ? (
          <Pressable
            style={[styles.secondaryBtn, busy && { opacity: 0.5 }]}
            onPress={() => confirm(false)}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={t("multilingual.turnOff")}
          >
            <Text style={styles.secondaryBtnText}>{t("multilingual.turnOff")}</Text>
          </Pressable>
        ) : (
          <Pressable
            style={[styles.actionBtn, busy && { opacity: 0.5 }]}
            onPress={() => confirm(true)}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={t("multilingual.turnOn")}
          >
            <Text style={styles.actionBtnText}>{busy ? t("multilingual.working") : t("multilingual.turnOn")}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const getStyles = (colors: Colors, typography: Typography) => {
  const ui = makeSurfaces(colors, typography);
  return StyleSheet.create({
    card: { ...ui.card, marginHorizontal: 12, marginTop: 12 },
    cardTitle: ui.sectionLabel,
    paragraph: ui.body,
    status: {
      ...typography.mono.xs,
      color: colors.text.secondary,
      marginTop: calmSpacing.tight,
    },
    row: {
      flexDirection: "row",
      gap: calmSpacing.cozy,
      marginTop: calmSpacing.cozy,
      flexWrap: "wrap",
    },
    actionBtn: ui.primaryButton,
    actionBtnText: ui.primaryButtonText,
    secondaryBtn: {
      ...ui.primaryButton,
      backgroundColor: "transparent",
      borderWidth: 1,
      borderColor: colors.text.secondary,
    },
    secondaryBtnText: {
      ...ui.primaryButtonText,
      color: colors.text.secondary,
    },
  });
};
