import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, Alert } from "react-native";
import { impact, ImpactFeedbackStyle } from "../services/haptics";
import { useTranslation } from "react-i18next";
import {
  listRecentExecutions,
  clearExecutionTelemetry,
  exportExecutionTelemetry,
  ExecutionTelemetryRecord,
} from "../services/executionTelemetry";
import { useTheme } from "./theme";
import type { Colors } from "./theme/colors";
import { typography } from "./theme/typography";
import { NidoIcon } from "./components/icons/NidoIcon";
import { calmSpacing, calmRadii, calmShadows } from "./theme/calm";
import { EvaluationScreen } from "./EvaluationScreen";
import { MODEL_CATALOG } from "../models/manifest";

interface Props {
  onClose?: () => void;
  chatBusy?: boolean;
}

function formatMs(ms: number | undefined): string {
  if (ms == null) return "—";
  return ms < 1000 ? `${ms.toFixed(0)}ms` : `${(ms / 1000).toFixed(2)}s`;
}

function formatMB(bytes: number | undefined): string {
  if (bytes == null) return "—";
  return `${(bytes / (1024 * 1024)).toFixed(0)}MB`;
}

function residencyIcon(residency: ExecutionTelemetryRecord["modelResidency"]): string {
  if (residency === "cold") return "🧊";
  if (residency === "switched") return "🔀";
  if (residency === "resident") return "♻️";
  return "—";
}

function outcomeColor(colors: Colors, outcome: ExecutionTelemetryRecord["outcome"]): string {
  if (outcome === "failure") return colors.crimson[400];
  if (outcome === "cancelled") return colors.text.accentAmber ?? colors.amber[400];
  return colors.text.accentEmerald;
}

/**
 * Phase 7 (docs/ADAPTIVE_ROUTING.md) — dedicated diagnostic/comparison
 * screen for persisted execution_telemetry records (src/services/
 * executionTelemetry.ts). Deliberately NOT part of Settings — this is
 * engineering/debugging data for browsing and comparing runs across
 * models, not a user-facing preference. Kept simple: a scrollable list of
 * recent executions plus export, no charts/analytics.
 */
export function ExecutionTelemetryScreen({ onClose, chatBusy }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const { t } = useTranslation();
  const [records, setRecords] = useState<ExecutionTelemetryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [showEvaluation, setShowEvaluation] = useState(false);
  // Model id -> readable name; Hugging Face ids are long file-derived strings.
  const [modelLabels, setModelLabels] = useState<Record<string, string>>(
    () => Object.fromEntries(MODEL_CATALOG.map((m) => [m.id, m.label]))
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setRecords(await listRecentExecutions(200));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleClose = () => {
    impact(ImpactFeedbackStyle.Light);
    onClose?.();
  };

  const handleExport = async (format: "json" | "csv") => {
    impact(ImpactFeedbackStyle.Light);
    setExporting(true);
    try {
      await exportExecutionTelemetry(format);
    } catch (e: any) {
      Alert.alert(t("executionTelemetry.exportFailedTitle"), e?.message ?? String(e));
    } finally {
      setExporting(false);
    }
  };

  const handleClear = () => {
    Alert.alert(
      t("executionTelemetry.clearTitle"),
      t("executionTelemetry.clearMessage"),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("executionTelemetry.clearConfirm"),
          style: "destructive",
          onPress: async () => {
            await clearExecutionTelemetry();
            await refresh();
          },
        },
      ]
    );
  };

  if (showEvaluation) {
    return (
      <EvaluationScreen
        chatBusy={chatBusy}
        onClose={() => {
          setShowEvaluation(false);
          refresh();
        }}
      />
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <NidoIcon name="telemetry" size={20} />
          <View>
            <Text style={styles.headerTitle}>{t("executionTelemetry.title")}</Text>
            <Text style={styles.headerSubtitle}>{t("executionTelemetry.subtitle", { count: records.length })}</Text>
          </View>
        </View>
        <Pressable onPress={handleClose} hitSlop={8} style={styles.closeBtn}
            accessibilityRole="button"
            accessibilityLabel={t("common.done")}>
          <Text style={styles.closeBtnText}>{t("common.done")}</Text>
        </Pressable>
      </View>

      <View style={styles.actionsRow}>
        <Pressable
          style={styles.actionBtn}
          onPress={() => setShowEvaluation(true)}
          accessibilityRole="button"
          accessibilityLabel={t("executionTelemetry.runEvaluation")}
        >
          <Text style={styles.actionBtnText}>{t("executionTelemetry.runEvaluation")}</Text>
        </Pressable>
        <Pressable
          style={styles.actionBtn}
          onPress={() => handleExport("json")}
          disabled={exporting}
          accessibilityRole="button"
          accessibilityLabel={t("executionTelemetry.exportJson")}
        >
          <Text style={styles.actionBtnText}>{t("executionTelemetry.exportJson")}</Text>
        </Pressable>
        <Pressable
          style={styles.actionBtn}
          onPress={() => handleExport("csv")}
          disabled={exporting}
          accessibilityRole="button"
          accessibilityLabel={t("executionTelemetry.exportCsv")}
        >
          <Text style={styles.actionBtnText}>{t("executionTelemetry.exportCsv")}</Text>
        </Pressable>
        <Pressable
          style={[styles.actionBtn, styles.clearBtn]}
          onPress={handleClear}
          accessibilityRole="button"
          accessibilityLabel={t("executionTelemetry.clear")}
        >
          <Text style={[styles.actionBtnText, styles.clearBtnText]}>{t("executionTelemetry.clear")}</Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.emerald[400]} />
        </View>
      ) : records.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.emptyText}>{t("executionTelemetry.empty")}</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {records.map((r) => (
            <View key={r.id} style={styles.row}>
              <View style={styles.rowHeader}>
                <Text style={styles.modelLabel} numberOfLines={1}>
                  {r.modelId ? modelLabels[r.modelId] ?? r.modelId : t("executionTelemetry.noModel")}
                </Text>
                <Text style={[styles.outcomeLabel, { color: outcomeColor(colors, r.outcome) }]}>
                  {(r.outcome ?? "—").toUpperCase()}
                </Text>
              </View>
              <View style={styles.rowMeta}>
                <Text style={styles.metaText}>{r.taskType ?? "—"}</Text>
                <Text style={styles.metaDot}>•</Text>
                <Text style={styles.metaText}>
                  {residencyIcon(r.modelResidency)} {r.modelResidency ?? "n/a"}
                </Text>
                {r.adaptiveRoutingUsed && (
                  <>
                    <Text style={styles.metaDot}>•</Text>
                    <View style={styles.adaptiveTag}>
                    <NidoIcon name="compass" size={11} color={colors.text.dim} />
                    <Text style={styles.metaText}>adaptive</Text>
                  </View>
                  </>
                )}
              </View>
              <View style={styles.statsGrid}>
                <StatCell label={t("executionTelemetry.tokPerSec")} value={r.tokPerSec ? `${r.tokPerSec.toFixed(1)} t/s` : "—"} />
                <StatCell label={t("executionTelemetry.loadTime")} value={formatMs(r.modelLoadMs)} />
                <StatCell label={t("executionTelemetry.ttft")} value={formatMs(r.ttftMs)} />
                <StatCell label={t("executionTelemetry.totalTime")} value={formatMs(r.totalLatencyMs)} />
                <StatCell label={t("executionTelemetry.memory")} value={formatMB(r.peakRssBytes)} />
                <StatCell label={t("executionTelemetry.tokens")} value={r.tokensGenerated != null ? `${r.tokensGenerated}` : "—"} />
              </View>
              <Text style={styles.timestamp}>{new Date(r.createdAt).toLocaleString()}</Text>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

function StatCell({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  return (
    <View style={styles.statCell}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const getStyles = (colors: Colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg.surface },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: calmSpacing.comfortable,
    paddingVertical: calmSpacing.comfortable,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.default,
    backgroundColor: colors.bg.cardElevated,
    ...calmShadows.none,
  },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: calmSpacing.cozy },
  headerIcon: { fontSize: 20 },
  closeBtn: {
    paddingHorizontal: calmSpacing.cozy,
    paddingVertical: calmSpacing.tight,
    borderRadius: calmRadii.subtle,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
  },
  closeBtnText: { ...typography.mono.xs, color: colors.text.accentCyan, fontWeight: "800" },
  headerTitle: { ...typography.ui.titleSm, color: colors.text.heading, letterSpacing: 0.5 },
  headerSubtitle: { ...typography.mono.xs, fontSize: 9, color: colors.text.dim },
  actionsRow: {
    flexDirection: "row",
    gap: calmSpacing.cozy,
    paddingHorizontal: calmSpacing.comfortable,
    paddingVertical: calmSpacing.cozy,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.subtle,
  },
  actionBtn: {
    flex: 1,
    paddingVertical: calmSpacing.cozy,
    borderRadius: calmRadii.subtle,
    backgroundColor: colors.bg.cardElevated,
    borderWidth: 1,
    borderColor: colors.border.default,
    alignItems: "center",
    ...calmShadows.none,
  },
  actionBtnText: { ...typography.mono.xs, color: colors.text.accentCyan, fontWeight: "700" },
  clearBtn: { borderColor: colors.crimson.border, backgroundColor: colors.crimson.bgSubtle },
  clearBtnText: { color: colors.crimson[400] },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: calmSpacing.spacious },
  emptyText: { ...typography.ui.subtext, color: colors.text.dim, textAlign: "center" },
  scrollContent: { padding: calmSpacing.comfortable, gap: calmSpacing.cozy, paddingBottom: calmSpacing.generous },
  row: {
    backgroundColor: colors.bg.cardElevated,
    borderRadius: calmRadii.soft,
    borderWidth: 1,
    borderColor: colors.border.default,
    padding: calmSpacing.cozy,
    gap: calmSpacing.cozy,
    marginBottom: calmSpacing.cozy,
    ...calmShadows.none,
  },
  rowHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  modelLabel: { ...typography.ui.subtext, color: colors.text.heading, fontWeight: "700", flex: 1 },
  outcomeLabel: { ...typography.mono.xs, fontSize: 9, fontWeight: "800" },
  rowMeta: { flexDirection: "row", alignItems: "center", gap: calmSpacing.cozy },
  metaText: { ...typography.mono.xs, fontSize: 10, color: colors.text.dim },
  metaDot: { color: colors.text.dim, fontSize: 10 },
  adaptiveTag: { flexDirection: "row", alignItems: "center", gap: calmSpacing.tight },
  statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: calmSpacing.cozy },
  statCell: { minWidth: 70 },
  statValue: { ...typography.mono.sm, color: colors.text.primary, fontWeight: "700", fontVariant: ["tabular-nums"] },
  statLabel: { ...typography.mono.xs, fontSize: 8, color: colors.text.dim },
  timestamp: { ...typography.mono.xs, fontSize: 8, color: colors.text.dim, textAlign: "right" },
});
