/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Alert } from "react-native";
import { impact, ImpactFeedbackStyle } from "../services/haptics";
import { useTranslation } from "react-i18next";
import { CatalogModel } from "../models/manifest";
import { computeCompatibility } from "../models/compatibility";
import { getDeviceTotalRamBytes } from "ram-monitor";
import { useTheme } from "./theme";
import type { Colors } from "./theme/colors";
import { typography } from "./theme/typography";
import { NidoIcon } from "./components/icons/NidoIcon";
import { spacing, radii } from "./theme/spacing";

function formatMB(bytes: number): string {
  if (bytes <= 0) return "0 MB";
  return bytes >= 1024 * 1024 * 1024
    ? `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
    : `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
}

function formatSpeed(bytesPerSec: number | undefined, calculating: string): string {
  if (!bytesPerSec || bytesPerSec <= 0) return calculating;
  if (bytesPerSec >= 1024 * 1024) {
    return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
  }
  return `${(bytesPerSec / 1024).toFixed(0)} KB/s`;
}

function formatEta(seconds: number | undefined, calculating: string): string {
  if (seconds == null || seconds <= 0 || !isFinite(seconds)) return calculating;
  if (seconds < 60) return `${Math.ceil(seconds)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.ceil(seconds % 60);
  return `${mins}m ${secs}s`;
}

export interface CatalogRowState {
  present: boolean;
  downloading: boolean;
  progress: number;
  error: string | null;
  bytesWritten?: number;
  bytesExpected?: number;
  speedBytesPerSec?: number;
  etaSeconds?: number;
}

interface Props {
  item: CatalogModel;
  row: CatalogRowState | undefined;
  isActive: boolean;
  onDownload: (item: CatalogModel) => void;
  onUse: (item: CatalogModel) => void;
  onRemove: (item: CatalogModel) => void;
  /** This model is being loaded after "Use" was tapped. */
  activating?: boolean;
  /** Some model is being loaded: Use and delete are unavailable until it finishes. */
  busy?: boolean;
}

export function CatalogItemCard({ item, row, isActive, onDownload, onUse, onRemove, activating, busy }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);

  const { t } = useTranslation();
  const isCorpus = item.kind === "corpus";
  const present = row?.present ?? false;
  const effectivelyActive = isCorpus ? present : isActive;

  const [deviceRam, setDeviceRam] = useState(0);
  useEffect(() => {
    try {
      setDeviceRam(getDeviceTotalRamBytes());
    } catch {
      // native module fallback
    }
  }, []);

  const compatibility = item.kind === "llm" ? computeCompatibility(item, deviceRam) : "unknown";
  const calculating = t("catalogItemCard.calculating");

  // Models added from the Hugging Face browser can be dropped from the list even if never downloaded.
  const fromHuggingFace = item.id.startsWith("hf-");
  const listOnly = fromHuggingFace && !present;

  const confirmRemove = () => {
    impact(ImpactFeedbackStyle.Medium);
    Alert.alert(
      listOnly
        ? t("catalogItemCard.removeFromListTitle")
        : isCorpus
          ? t("catalogItemCard.removeCorpusTitle")
          : t("catalogItemCard.removeModelTitle"),
      listOnly
        ? t("catalogItemCard.removeFromListMessage")
        : isCorpus
          ? t("catalogItemCard.removeCorpusMessage", { size: formatMB(item.sizeBytes) })
          : t("catalogItemCard.removeModelMessage", { size: formatMB(item.sizeBytes) }),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("catalogItemCard.removeAssetButton"),
          style: "destructive",
          onPress: () => onRemove(item),
        },
      ]
    );
  };

  const handleAction = (cb: () => void) => {
    impact(ImpactFeedbackStyle.Light);
    cb();
  };

  return (
    <View style={[styles.card, effectivelyActive && styles.cardActive]}>
      {/* Top Header Row */}
      <View style={styles.headerRow}>
        <View style={styles.titleColumn}>
          <Text style={styles.label}>{item.label}</Text>
          <View style={styles.metaChipsRow}>
            <View style={styles.kindChip}>
              <Text style={styles.kindChipText}>{t(`catalogItemCard.kind.${item.kind}`)}</Text>
            </View>
            <Text style={styles.metaText}>{formatMB(item.sizeBytes)}</Text>
            <Text style={styles.metaBullet}>•</Text>
            <Text style={styles.metaText}>{item.license}</Text>
            {item.required && (
              <>
                <Text style={styles.metaBullet}>•</Text>
                <Text style={styles.defaultChipText}>{t("catalogItemCard.default")}</Text>
              </>
            )}
          </View>
        </View>

        <StatusBadge
          present={present}
          active={effectivelyActive}
          downloading={row?.downloading ?? false}
        />
      </View>

      {/* Compatibility Badge */}
      {compatibility !== "unknown" && (
        <View style={styles.compatRow}>
          {compatibility === "green" && (
            <View style={[styles.compatPill, styles.compatGreen]}>
              <NidoIcon name="check" size={12} color={colors.text.accentEmerald} />
              <Text style={styles.compatGreenText}>{t("catalogItemCard.compat.green")}</Text>
            </View>
          )}
          {compatibility === "yellow" && (
            <View style={[styles.compatPill, styles.compatAmber]}>
              <NidoIcon name="warning" size={12} color={colors.text.accentAmber} />
              <Text style={styles.compatAmberText}>{t("catalogItemCard.compat.yellow")}</Text>
            </View>
          )}
          {compatibility === "red" && (
            <View style={[styles.compatPill, styles.compatRed]}>
              <NidoIcon name="error" size={12} color={colors.crimson[400]} />
              <Text style={styles.compatRedText}>{t("catalogItemCard.compat.red")}</Text>
            </View>
          )}
        </View>
      )}

      {/* Description */}
      <Text style={styles.description}>{item.description}</Text>

      {/* Error Callout */}
      {row?.error && (
        <View style={styles.errorBox}>
          <NidoIcon name="warning" size={14} />
          <Text style={styles.errorText}>{row.error}</Text>
        </View>
      )}

      {/* Smooth Background Download Progress Card */}
      {row?.downloading && (
        <View style={styles.downloadProgressCard}>
          <View style={styles.downloadProgressHeader}>
            <View style={styles.downloadProgressLeft}>
              <ActivityIndicator size="small" color={colors.emerald[400]} />
              <Text style={styles.downloadStatusTitle}>{t("catalogItemCard.downloadingAsset")}</Text>
            </View>
            <Text style={styles.downloadProgressPct}>
              {(row.progress * 100).toFixed(0)}%
            </Text>
          </View>

          {/* Progress Bar Track */}
          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                { width: `${Math.max(row.progress * 100, 2)}%` },
              ]}
            />
          </View>

          {/* Download Telemetry Row (Bytes, Speed, ETA) */}
          <View style={styles.downloadMetricsRow}>
            <Text style={styles.metricText}>
              {row.bytesWritten ? formatMB(row.bytesWritten) : "0 MB"} / {formatMB(item.sizeBytes)}
            </Text>
            <View style={styles.metricsRight}>
              <Text style={styles.metricSpeedText}>
                {formatSpeed(row.speedBytesPerSec, calculating)}
              </Text>
              <Text style={styles.metricBullet}>•</Text>
              <Text style={styles.metricEtaText}>
                {t("catalogItemCard.eta", { eta: formatEta(row.etaSeconds, calculating) })}
              </Text>
            </View>
          </View>
        </View>
      )}

      {/* Action Controls */}
      {!row?.downloading && (
        <View style={styles.actionsRow}>
          {!present && (
            <Pressable
              style={styles.downloadBtn}
              onPress={() => handleAction(() => onDownload(item))}
            >
              <Text style={styles.downloadBtnText}>
                {row?.error ? t("catalogItemCard.retryDownload") : t("catalogItemCard.downloadAsset")}
              </Text>
            </Pressable>
          )}

          {present && !isCorpus && !isActive && activating && (
            <View style={styles.activeCheckRow}>
              <ActivityIndicator size="small" color={colors.emerald[400]} />
              <Text style={styles.activeNote}>{t("catalogItemCard.loadingModel")}</Text>
            </View>
          )}

          {present && !isCorpus && !isActive && !activating && (
            <Pressable
              style={[styles.useBtn, busy && styles.disabled]}
              onPress={() => handleAction(() => onUse(item))}
              disabled={busy}
            >
              <Text style={styles.useBtnText}>{t("catalogItemCard.selectUse")}</Text>
            </Pressable>
          )}

          {present && isCorpus && (
            <View style={styles.activeCheckRow}>
              <NidoIcon name="check" size={14} color={colors.text.accentEmerald} />
              <Text style={styles.activeNote}>{t("catalogItemCard.indexedNote")}</Text>
            </View>
          )}

          {present && !isCorpus && isActive && (
            <View style={styles.activeCheckRow}>
              <NidoIcon name="check" size={14} color={colors.text.accentEmerald} />
              <Text style={styles.activeNote}>{t("catalogItemCard.activeNote")}</Text>
            </View>
          )}

          {(present || fromHuggingFace) && !item.required && (
            <Pressable
              onPress={confirmRemove}
              hitSlop={8}
              disabled={busy}
              style={[styles.trashBtn, busy && styles.disabled]}
              accessibilityLabel={t("catalogItemCard.deleteAccessibility")}
            >
              <NidoIcon name="delete" size={16} />
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

function StatusBadge({
  present,
  active,
  downloading,
}: {
  present: boolean;
  active: boolean;
  downloading: boolean;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);

  const { t } = useTranslation();
  if (downloading) {
    return (
      <View style={[styles.badge, styles.badgeDownloading]}>
        <Text style={styles.badgeTextCyan}>{t("catalogItemCard.badge.downloading")}</Text>
      </View>
    );
  }
  if (!present) {
    return (
      <View style={[styles.badge, styles.badgeGrey]}>
        <Text style={styles.badgeTextMuted}>{t("catalogItemCard.badge.notOnDisk")}</Text>
      </View>
    );
  }
  if (active) {
    return (
      <View style={[styles.badge, styles.badgeActive]}>
        <View style={styles.activeDot} />
        <Text style={styles.badgeTextEmerald}>{t("catalogItemCard.badge.active")}</Text>
      </View>
    );
  }
  return (
    <View style={[styles.badge, styles.badgeCached]}>
      <Text style={styles.badgeTextCached}>{t("catalogItemCard.badge.cached")}</Text>
    </View>
  );
}

const getStyles = (colors: Colors) => StyleSheet.create({
  card: {
    backgroundColor: colors.bg.cardElevated,
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border.default,
  },
  cardActive: {
    borderColor: colors.emerald.border,
    backgroundColor: "rgba(16, 185, 129, 0.06)",
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 8,
  },
  titleColumn: {
    flex: 1,
    gap: 4,
  },
  label: {
    ...typography.ui.titleSm,
    color: colors.text.heading,
  },
  metaChipsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  kindChip: {
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: radii.xs,
  },
  kindChipText: {
    ...typography.mono.xs,
    fontSize: 9,
    color: colors.text.secondary,
    fontWeight: "700",
  },
  metaText: {
    ...typography.mono.xs,
    color: colors.text.dim,
  },
  metaBullet: {
    ...typography.mono.xs,
    color: colors.text.dim,
  },
  defaultChipText: {
    ...typography.mono.xs,
    fontSize: 9,
    color: colors.text.accentCyan,
    fontWeight: "700",
  },
  compatRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  compatPill: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radii.sm,
    borderWidth: 1,
    gap: 5,
  },
  compatIcon: {
    fontSize: 10,
  },
  compatGreen: {
    backgroundColor: colors.emerald.bgSubtle,
    borderColor: colors.emerald.border,
  },
  compatGreenText: {
    ...typography.mono.xs,
    color: colors.text.accentEmerald,
    fontWeight: "700",
  },
  compatAmber: {
    backgroundColor: colors.amber.bgSubtle,
    borderColor: colors.amber.border,
  },
  compatAmberText: {
    ...typography.mono.xs,
    color: colors.text.accentAmber,
    fontWeight: "700",
  },
  compatRed: {
    backgroundColor: colors.crimson.bgSubtle,
    borderColor: colors.crimson.border,
  },
  compatRedText: {
    ...typography.mono.xs,
    color: colors.crimson[400],
    fontWeight: "700",
  },
  description: {
    ...typography.ui.caption,
    color: colors.text.secondary,
    lineHeight: 18,
  },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.crimson.bgSubtle,
    borderColor: colors.crimson.border,
    borderWidth: 1,
    borderRadius: radii.sm,
    padding: spacing.sm,
    gap: 6,
  },
  errorIcon: {
    fontSize: 12,
  },
  errorText: {
    ...typography.mono.xs,
    color: colors.crimson[400],
    flex: 1,
  },
  downloadProgressCard: {
    backgroundColor: colors.bg.terminal,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border.default,
    padding: spacing.sm,
    gap: 6,
  },
  downloadProgressHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  downloadProgressLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  downloadStatusTitle: {
    ...typography.mono.xs,
    color: colors.text.accentCyan,
    fontWeight: "700",
  },
  downloadProgressPct: {
    ...typography.mono.xs,
    color: colors.text.heading,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
  progressTrack: {
    height: 8,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    borderRadius: radii.xs,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: colors.emerald[500],
    borderRadius: radii.xs,
  },
  downloadMetricsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  metricText: {
    ...typography.mono.xs,
    color: colors.text.dim,
    fontVariant: ["tabular-nums"],
  },
  metricsRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  metricSpeedText: {
    ...typography.mono.xs,
    color: colors.text.accentCyan,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  metricBullet: {
    ...typography.mono.xs,
    color: colors.text.dim,
  },
  metricEtaText: {
    ...typography.mono.xs,
    color: colors.text.accentAmber,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
  actionsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 4,
  },
  downloadBtn: {
    backgroundColor: colors.emerald.bgSubtle,
    borderColor: colors.emerald.border,
    borderWidth: 1,
    borderRadius: radii.sm,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  downloadBtnText: {
    ...typography.ui.titleSm,
    fontSize: 12,
    color: colors.text.accentEmerald,
  },
  disabled: { opacity: 0.4 },
  useBtn: {
    backgroundColor: colors.cyan.bgSubtle,
    borderColor: colors.cyan.border,
    borderWidth: 1,
    borderRadius: radii.sm,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  useBtnText: {
    ...typography.ui.titleSm,
    fontSize: 12,
    color: colors.text.accentCyan,
  },
  activeCheckRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    flex: 1,
  },
  activeCheckIcon: {
    color: colors.text.accentEmerald,
    fontWeight: "800",
  },
  activeNote: {
    ...typography.mono.xs,
    color: colors.text.accentEmerald,
    fontWeight: "600",
  },
  trashBtn: {
    marginLeft: "auto",
    padding: 6,
    borderRadius: radii.xs,
    backgroundColor: "rgba(255, 255, 255, 0.05)",
  },
  trashIcon: {
    fontSize: 14,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radii.xs,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  badgeGrey: {
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    borderColor: colors.border.subtle,
  },
  badgeTextMuted: {
    ...typography.mono.xs,
    fontSize: 9,
    color: colors.text.dim,
    fontWeight: "700",
  },
  badgeActive: {
    backgroundColor: colors.emerald.bgSubtle,
    borderColor: colors.emerald.border,
  },
  activeDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: colors.emerald[400],
  },
  badgeTextEmerald: {
    ...typography.mono.xs,
    fontSize: 9,
    color: colors.text.accentEmerald,
    fontWeight: "800",
  },
  badgeCached: {
    backgroundColor: colors.cyan.bgSubtle,
    borderColor: colors.cyan.border,
  },
  badgeTextCached: {
    ...typography.mono.xs,
    fontSize: 9,
    color: colors.text.accentCyan,
    fontWeight: "700",
  },
  badgeDownloading: {
    backgroundColor: "rgba(6, 182, 212, 0.15)",
    borderColor: colors.cyan.border,
  },
  badgeTextCyan: {
    ...typography.mono.xs,
    fontSize: 9,
    color: colors.text.accentCyan,
    fontWeight: "800",
  },
});
