/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, Alert, Switch } from "react-native";
import * as Clipboard from "expo-clipboard";
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
import type { Typography } from "./theme/typography";
import { NidoIcon } from "./components/icons/NidoIcon";
import { calmSpacing, calmRadii, calmShadows } from "./theme/calm";
import { EvaluationScreen } from "./EvaluationScreen";
import { MODEL_CATALOG } from "../models/manifest";
import { displayLang, formatDateTime } from "../utils/safeFormat";
import {
  listRouterSamples,
  clearRouterSamples,
  summarizeRouterSamples,
  formatRouterMs,
  percentOf,
  type RouterSummary,
} from "../services/routerStats";
import {
  clearMissedPhrases,
  formatMissedForCopy,
  isMissedPhraseLogOn,
  listMissedPhrases,
  missedSignal,
  setMissedPhraseLog,
  type MissedPhrase,
} from "../services/missedPhrases";

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
  const { colors, typography } = useTheme();
  const styles = useMemo(() => getStyles(colors, typography), [colors, typography]);
  const { t, i18n } = useTranslation();
  const [records, setRecords] = useState<ExecutionTelemetryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [showEvaluation, setShowEvaluation] = useState(false);
  // 0.1.33: coste del pre-router y adónde va cada mensaje.
  const [routerSummary, setRouterSummary] = useState<RouterSummary | null>(null);
  // 0.1.39: registro opcional de frases que el router no reconoció.
  const [missedOn, setMissedOn] = useState(false);
  const [missed, setMissed] = useState<MissedPhrase[]>([]);
  // Model id -> readable name; Hugging Face ids are long file-derived strings.
  const [modelLabels, setModelLabels] = useState<Record<string, string>>(
    () => Object.fromEntries(MODEL_CATALOG.map((m) => [m.id, m.label]))
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setRecords(await listRecentExecutions(200));
      setRouterSummary(summarizeRouterSamples(await listRouterSamples().catch(() => [])));
      const on = await isMissedPhraseLogOn().catch(() => false);
      setMissedOn(on);
      setMissed(on ? await listMissedPhrases().catch(() => []) : []);
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
            await clearRouterSamples().catch(() => {});
            await clearMissedPhrases().catch(() => {});
            await refresh();
          },
        },
      ]
    );
  };

  const toggleMissed = async (on: boolean) => {
    impact(ImpactFeedbackStyle.Light);
    setMissedOn(on);
    try {
      await setMissedPhraseLog(on);
    } catch {
      setMissedOn(!on);
    }
    setMissed(on ? await listMissedPhrases().catch(() => []) : []);
  };

  const copyMissed = async () => {
    impact(ImpactFeedbackStyle.Light);
    await Clipboard.setStringAsync(formatMissedForCopy(missed)).catch(() => {});
  };

  const clearMissed = async () => {
    impact(ImpactFeedbackStyle.Light);
    await clearMissedPhrases().catch(() => {});
    setMissed([]);
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
      ) : (
        // 0.1.39: una sola zona con scroll. Las tarjetas del router crecieron
        // y, fijas encima de la lista, la empujaban fuera de pantallas pequeñas.
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {routerSummary ? (
            <RouterCard summary={routerSummary} decimalComma={displayLang(i18n.language) !== "en"} />
          ) : null}
          <MissedCard
            on={missedOn}
            rows={missed}
            onToggle={toggleMissed}
            onCopy={copyMissed}
            onClear={clearMissed}
          />
          {records.length === 0 ? (
            <Text style={[styles.emptyText, styles.emptyInline]}>{t("executionTelemetry.empty")}</Text>
          ) : null}
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
              <Text style={styles.timestamp}>{formatDateTime(r.createdAt, displayLang(i18n.language))}</Text>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

function RouterCard({ summary, decimalComma }: { summary: RouterSummary; decimalComma: boolean }) {
  const { colors, typography } = useTheme();
  const styles = useMemo(() => getStyles(colors, typography), [colors, typography]);
  const { t } = useTranslation();
  const o = summary.outcomes;
  return (
    <View style={[styles.row, styles.routerCard]} accessibilityLabel={t("executionTelemetry.router.title")}>
      <Text style={styles.modelLabel}>{t("executionTelemetry.router.title")}</Text>
      <Text style={styles.metaText}>{t("executionTelemetry.router.hint")}</Text>
      {summary.count === 0 ? (
        <Text style={styles.metaText}>{t("executionTelemetry.router.empty")}</Text>
      ) : (
        <>
          <View style={styles.statsGrid}>
            <StatCell label={t("executionTelemetry.router.messages")} value={`${summary.count}`} />
            <StatCell label={t("executionTelemetry.router.p50")} value={formatRouterMs(summary.p50Ms, decimalComma)} />
            <StatCell label={t("executionTelemetry.router.p95")} value={formatRouterMs(summary.p95Ms, decimalComma)} />
            <StatCell label={t("executionTelemetry.router.max")} value={formatRouterMs(summary.maxMs, decimalComma)} />
          </View>
          <View style={styles.statsGrid}>
            <StatCell label={t("executionTelemetry.router.router")} value={`${o.router} · ${percentOf(o.router, summary.count)}`} />
            <StatCell label={t("executionTelemetry.router.model")} value={`${o.model} · ${percentOf(o.model, summary.count)}`} />
            <StatCell label={t("executionTelemetry.router.notUnderstood")} value={`${o.notUnderstood} · ${percentOf(o.notUnderstood, summary.count)}`} />
            <StatCell label={t("executionTelemetry.router.chat")} value={`${o.chat} · ${percentOf(o.chat, summary.count)}`} />
          </View>
          <LeakSection summary={summary} />
        </>
      )}
    </View>
  );
}

/**
 * 0.1.39: de las órdenes (turnos del asistente), cuántas se colaron al
 * modelo y cuáles pidió el modelo como herramienta — cada una de esas es
 * una frase que el router debió atrapar. Solo cuentas y nombres de
 * herramienta: nunca texto.
 */
function LeakSection({ summary }: { summary: RouterSummary }) {
  const { colors, typography } = useTheme();
  const styles = useMemo(() => getStyles(colors, typography), [colors, typography]);
  const { t } = useTranslation();
  const l = summary.leak;
  return (
    <View style={styles.leakBox} accessibilityLabel={t("executionTelemetry.router.leakTitle")}>
      <Text style={styles.sectionLabel}>{t("executionTelemetry.router.leakTitle")}</Text>
      {l.measured === 0 ? (
        <Text style={styles.metaText}>{t("executionTelemetry.router.leakEmpty")}</Text>
      ) : (
        <>
          <View style={styles.statsGrid}>
            <StatCell label={t("executionTelemetry.router.leakMeasured")} value={`${l.measured}`} />
            <StatCell label={t("executionTelemetry.router.leakToModel")} value={`${l.toModel} · ${percentOf(l.toModel, l.measured)}`} />
            <StatCell label={t("executionTelemetry.router.leakAskedTool")} value={`${l.modelAskedTool} · ${percentOf(l.modelAskedTool, l.measured)}`} />
            <StatCell label={t("executionTelemetry.router.leakRetried")} value={`${l.retried} · ${percentOf(l.retried, l.toModel)}`} />
          </View>
          {l.byTool.length > 0 ? (
            <Text style={styles.metaText}>
              {t("executionTelemetry.router.leakByTool")}: {l.byTool.slice(0, 6).map(([k, n]) => `${k} ${n}`).join(" · ")}
            </Text>
          ) : null}
          {l.byRoute.length > 0 ? (
            <Text style={styles.metaText}>
              {t("executionTelemetry.router.leakByRoute")}: {l.byRoute.slice(0, 6).map(([k, n]) => `${k} ${n}`).join(" · ")}
            </Text>
          ) : null}
          <Text style={styles.metaText}>{t("executionTelemetry.router.leakHint")}</Text>
        </>
      )}
    </View>
  );
}

/**
 * 0.1.39: registro OPCIONAL de las frases que el router no reconoció.
 * Apagado por defecto; apagarlo borra lo guardado (missedPhrases.ts).
 */
function MissedCard({
  on,
  rows,
  onToggle,
  onCopy,
  onClear,
}: {
  on: boolean;
  rows: MissedPhrase[];
  onToggle: (on: boolean) => void;
  onCopy: () => void;
  onClear: () => void;
}) {
  const { colors, typography } = useTheme();
  const styles = useMemo(() => getStyles(colors, typography), [colors, typography]);
  const { t } = useTranslation();
  return (
    <View style={styles.row} accessibilityLabel={t("executionTelemetry.missed.title")}>
      <View style={styles.rowHeader}>
        <Text style={styles.modelLabel}>{t("executionTelemetry.missed.title")}</Text>
        {/* 0.1.41 (prueba física): en el tema oscuro solo se veía la bolita
            blanca; con colores propios y el estado escrito se ve que es un
            interruptor y si está encendido. */}
        <View style={styles.toggleRow}>
          <Text style={[styles.toggleState, on ? styles.toggleStateOn : null]}>
            {on ? t("executionTelemetry.missed.stateOn") : t("executionTelemetry.missed.stateOff")}
          </Text>
          <Switch
            value={on}
            onValueChange={onToggle}
            trackColor={{ false: colors.text.dim, true: colors.emerald[400] }}
            thumbColor={on ? colors.emerald[600] : colors.text.secondary}
            ios_backgroundColor={colors.text.dim}
            accessibilityRole="switch"
            accessibilityLabel={t("executionTelemetry.missed.toggle")}
            testID="missed-phrases-toggle"
          />
        </View>
      </View>
      <Text style={styles.metaText}>{t("executionTelemetry.missed.hint")}</Text>
      {on ? (
        rows.length === 0 ? (
          <Text style={styles.metaText}>{t("executionTelemetry.missed.empty")}</Text>
        ) : (
          <>
            {rows.map((r, i) => (
              <Text key={`${r.ts}-${i}`} style={styles.missedText} selectable>
                <Text style={styles.metaText}>[{missedSignal(r)}]</Text>
                {"  "}
                {r.text}
              </Text>
            ))}
            <View style={styles.missedActions}>
              <Pressable style={styles.actionBtn} onPress={onCopy} accessibilityRole="button" accessibilityLabel={t("executionTelemetry.missed.copy")}>
                <Text style={styles.actionBtnText}>{t("executionTelemetry.missed.copy")}</Text>
              </Pressable>
              <Pressable
                style={[styles.actionBtn, styles.clearBtn]}
                onPress={onClear}
                accessibilityRole="button"
                accessibilityLabel={t("executionTelemetry.missed.clear")}
              >
                <Text style={[styles.actionBtnText, styles.clearBtnText]}>{t("executionTelemetry.missed.clear")}</Text>
              </Pressable>
            </View>
          </>
        )
      ) : null}
    </View>
  );
}

function StatCell({ label, value }: { label: string; value: string }) {
  const { colors, typography } = useTheme();
  const styles = useMemo(() => getStyles(colors, typography), [colors, typography]);
  return (
    <View style={styles.statCell}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const getStyles = (colors: Colors, typography: Typography) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg.black },
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
    backgroundColor: colors.bg.subtle,
  },
  closeBtnText: { ...typography.ui.caption, color: colors.emerald[600], fontWeight: "700" },
  headerTitle: { ...typography.ui.titleSm, color: colors.text.heading, letterSpacing: 0.5 },
  headerSubtitle: { ...typography.ui.caption, fontSize: 9, color: colors.text.dim },
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
    borderRadius: 9999,
    backgroundColor: colors.bg.cardElevated,
    borderWidth: 1,
    borderColor: colors.border.default,
    alignItems: "center",
    ...calmShadows.none,
    minHeight: 44,
    justifyContent: "center",
  },
  actionBtnText: { ...typography.ui.caption, color: colors.text.accentCyan, fontWeight: "700" },
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
  routerCard: {},
  emptyInline: { paddingVertical: calmSpacing.comfortable },
  leakBox: { gap: calmSpacing.tight, paddingTop: calmSpacing.tight },
  sectionLabel: { ...typography.ui.caption, color: colors.text.heading, fontWeight: "700" },
  missedText: { ...typography.ui.subtext, color: colors.text.primary },
  missedActions: { flexDirection: "row", gap: calmSpacing.cozy },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: calmSpacing.tight },
  toggleState: { ...typography.ui.caption, color: colors.text.dim, fontWeight: "700" },
  toggleStateOn: { color: colors.emerald[600] },
});
