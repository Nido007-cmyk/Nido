/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * CrashReportCard — "Diagnóstico de cierres" en Acerca de.
 *
 * Si la app se cerró sola, aquí se ve el motivo que Android registró
 * (falta de memoria, fallo nativo, fallo Java/JS…) y se puede copiar el
 * informe para pegarlo en un issue. No necesita cable ni adb. El informe
 * no contiene mensajes, notas ni memoria: solo motivos y pilas de llamadas.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import * as Clipboard from "expo-clipboard";
import { useTranslation } from "react-i18next";
import { getCrashReport, clearCrashReport, type CrashReport } from "ram-monitor";
import { useTheme } from "./theme";
import type { Colors } from "./theme/colors";
import type { Typography } from "./theme/typography";
import { calmSpacing } from "./theme/calm";
import { makeSurfaces } from "./theme/surfaces";
import { formatCrashReport, latestFailure } from "../diagnostics/crashReport";
import {
  isBackgroundIndexingHeld,
  readNativeSessionRecord,
  type NativeSessionRecord,
} from "../diagnostics/nativeSession";
import appConfig from "../../app.json";

export function CrashReportCard() {
  const { colors, typography } = useTheme();
  const styles = useMemo(() => getStyles(colors, typography), [colors, typography]);
  const { t } = useTranslation();
  const [report, setReport] = useState<CrashReport | null>(() => getCrashReport());
  const [copied, setCopied] = useState(false);
  // M2 (crash nativo): el veredicto del cruce del registro de sesión
  // («murió generando · indexado en curso: sí/no · perfil · nCtx») y
  // M3: si esta sesión corre con el indexado de fondo desactivado
  // por aquella muerte, la tarjeta lo dice.
  const [session, setSession] = useState<NativeSessionRecord | null>(null);
  const [backgroundHeld] = useState(() => isBackgroundIndexingHeld());
  useEffect(() => {
    let cancelled = false;
    void readNativeSessionRecord().then((record) => {
      if (!cancelled) setSession(record);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const failure = report ? latestFailure(report) : null;
  const hasData = !!report && (failure !== null || report.lastCrash !== null);

  const copy = useCallback(async () => {
    if (!report) return;
    try {
      await Clipboard.setStringAsync(formatCrashReport(report, appConfig.expo.version, {
        exitsTitle: t("crashReport.fmtExitsTitle"),
        noRecords: t("crashReport.fmtNoRecords"),
        traceLabel: t("crashReport.fmtTraceLabel"),
        lastCrashTitle: t("crashReport.fmtLastCrashTitle"),
        noneLabel: t("crashReport.fmtNone"),
      }));
      setCopied(true);
    } catch {
      /* sin portapapeles: nada que hacer */
    }
  }, [report, t]);

  const clear = useCallback(() => {
    clearCrashReport();
    setReport(getCrashReport());
    setCopied(false);
  }, []);

  if (!report) return null; // build nativo sin soporte

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{t("crashReport.title")}</Text>
      <Text style={styles.paragraph}>{t("crashReport.body")}</Text>
      <Text style={styles.status}>
        {failure
          ? t("crashReport.lastFailure", {
              reason: failure.reason,
              when: new Date(failure.timestamp).toISOString().replace("T", " ").slice(0, 16),
            })
          : report.lastCrash
            ? t("crashReport.lastJsCrash")
            : t("crashReport.none")}
      </Text>
      {session?.verdict && (
        <Text style={styles.status}>
          {t(session.verdict.diedGenerating ? "crashReport.nativeDiedGenerating" : "crashReport.nativeDiedIdle", {
            model: session.verdict.model,
            nCtx: session.verdict.nCtx,
            profile: session.verdict.memoryProfile ?? "—",
            reembed: t(session.verdict.reembedRunning ? "crashReport.nativeYes" : "crashReport.nativeNo"),
          })}
        </Text>
      )}
      {backgroundHeld && <Text style={styles.status}>{t("crashReport.nativeHold")}</Text>}
      {hasData && (
        <View style={styles.row}>
          <Pressable
            style={styles.actionBtn}
            onPress={copy}
            accessibilityRole="button"
            accessibilityLabel={t("crashReport.copy")}
          >
            <Text style={styles.actionBtnText}>
              {copied ? t("crashReport.copied") : t("crashReport.copy")}
            </Text>
          </Pressable>
          <Pressable
            style={styles.secondaryBtn}
            onPress={clear}
            accessibilityRole="button"
            accessibilityLabel={t("crashReport.clear")}
          >
            <Text style={styles.secondaryBtnText}>{t("crashReport.clear")}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const getStyles = (colors: Colors, typography: Typography) => {
  const ui = makeSurfaces(colors, typography);
  return StyleSheet.create({
    card: ui.card,
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
