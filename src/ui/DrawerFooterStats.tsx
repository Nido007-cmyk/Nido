/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import * as FileSystem from "expo-file-system/legacy";
import { getMemoryInfo, getDeviceTotalRamBytes } from "ram-monitor";
import { getLastQueryStats, subscribeQueryStats } from "../services/telemetry";
import { useTheme } from "./theme";
import type { Colors } from "./theme/colors";
import type { Typography } from "./theme/typography";
import { radii } from "./theme/spacing";
import { fontFamilies } from "./theme/typography";

function formatGB(bytes: number): string {
  if (bytes <= 0) return "0.0 GB";
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function MiniBar({
  fraction,
  over,
  color,
}: {
  fraction: number;
  over: boolean;
  color: string;
}) {
  const { colors, typography } = useTheme();
  const styles = useMemo(() => getStyles(colors, typography), [colors, typography]);

  return (
    <View style={styles.track}>
      <View
        style={[
          styles.fill,
          { width: `${Math.min(fraction, 1) * 100}%`, backgroundColor: color },
          over && styles.fillOver,
        ]}
      />
    </View>
  );
}

export function DrawerFooterStats() {
  const { colors, typography } = useTheme();
  const styles = useMemo(() => getStyles(colors, typography), [colors, typography]);

  const { t } = useTranslation();
  // Telemetría honesta (auditoría 0.1.106, orden del dueño «esos datos
  // se miden realmente»): cada cifra es la medición de lo que su
  // etiqueta afirma, leída de la fuente del sistema.
  // - RAM: RSS real del proceso (módulo nativo) sobre la RAM TOTAL
  //   real del aparato (ActivityManager.totalMem vía ram-monitor).
  //   Antes el denominador era RAM_BUDGET_BYTES (12 GB), el tope de
  //   la auditoría bounty: medía el proceso contra un presupuesto,
  //   no contra el aparato.
  // - DISCO: el disco real del aparato (capacidad total − libre, vía
  //   expo-file-system). Antes numeraba solo los archivos del
  //   catálogo de NIDO contra el tope de 50 GB. La fila no enseña
  //   cifra hasta que la primera medición real llega.
  // - tok/s: solo la última tasa con generación real; un turno sin
  //   generación (guía literal, texto seguro) registra 0 y no debe
  //   fabricar un «0,0 tok/s» ni borrar la última tasa verdadera.
  const [disk, setDisk] = useState<{ used: number; total: number } | null>(null);
  const [rssBytes, setRssBytes] = useState(0);
  const [totalRamBytes, setTotalRamBytes] = useState(0);
  const [tokPerSec, setTokPerSec] = useState<number | null>(() => {
    const last = getLastQueryStats()?.tokPerSec;
    return last != null && last > 0 ? last : null;
  });

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const [total, free] = await Promise.all([
          FileSystem.getTotalDiskCapacityAsync(),
          FileSystem.getFreeDiskStorageAsync(),
        ]);
        if (!cancelled && total > 0) {
          setDisk({ used: Math.max(0, total - free), total });
        }
      } catch {
        // Sin lectura del sistema no se enseña cifra: la fila queda fuera.
      }
      try {
        if (!cancelled) {
          setRssBytes(getMemoryInfo().rssBytes);
          setTotalRamBytes(getDeviceTotalRamBytes());
        }
      } catch {
        // Native module not linked
      }
    }
    poll();
    const id = setInterval(poll, 5000);
    const unsubscribe = subscribeQueryStats((s) => {
      if (s.tokPerSec > 0) setTokPerSec(s.tokPerSec);
    });
    return () => {
      cancelled = true;
      clearInterval(id);
      unsubscribe();
    };
  }, []);

  const ramFraction = totalRamBytes > 0 ? rssBytes / totalRamBytes : 0;
  const storageFraction = disk && disk.total > 0 ? disk.used / disk.total : 0;

  return (
    <View style={styles.container}>
      {/* 0.1.119 (foto del dueño, Tab A9+ con letra grande): con
          «RAM (NIDO)» la etiqueta, la barra y la cifra ya no cabían en
          una fila: la cifra se cortaba («3.3..») y la barra desaparecía.
          Ahora cada medida va en dos líneas: etiqueta y cifra arriba, la
          barra debajo a todo el ancho. */}
      <View style={styles.stat}>
        <View style={styles.row}>
          <Text style={styles.label} numberOfLines={1}>{t("drawerFooterStats.ram")}</Text>
          <Text style={styles.value} numberOfLines={1} testID="drawer-ram-value">
            {totalRamBytes > 0
              ? `${formatGB(rssBytes)} / ${formatGB(totalRamBytes)}`
              : formatGB(rssBytes)}
          </Text>
        </View>
        <MiniBar
          fraction={ramFraction}
          over={ramFraction > 1}
          color={colors.emerald[400]}
        />
      </View>
      {disk != null && (
        <View style={styles.stat}>
          <View style={styles.row}>
            <Text style={styles.label} numberOfLines={1}>{t("drawerFooterStats.disk")}</Text>
            <Text style={styles.value} numberOfLines={1} testID="drawer-disk-value">
              {`${formatGB(disk.used)} / ${formatGB(disk.total)}`}
            </Text>
          </View>
          <MiniBar
            fraction={storageFraction}
            over={storageFraction > 1}
            color={colors.cyan[400]}
          />
        </View>
      )}
      {tokPerSec != null && (
        <View style={styles.tokRow}>
          <Text style={styles.tokDot}>●</Text>
          <Text style={styles.tokLine}>
            {t("drawerFooterStats.lastQuery", { rate: tokPerSec.toFixed(1) })}
          </Text>
        </View>
      )}
    </View>
  );
}

const getStyles = (colors: Colors, typography: Typography) => StyleSheet.create({
  container: {
    paddingTop: 10,
    paddingBottom: 16,
    gap: 6,
    borderTopWidth: 1,
    borderTopColor: colors.border.subtle,
  },
  stat: { gap: 4 },
  row: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 8 },
  label: {
    ...typography.ui.caption,
    color: colors.text.dim,
    // 0.1.106 (Defecto D): la etiqueta va ENTERA en su línea. El
    // ancho fijo de 28 px la partía en vertical, letra por letra
    // («R A M», «DI SC O»), junto a la barra: sin ancho, sin
    // encoger, y la barra y el valor ceden lo que haga falta.
    flexShrink: 0,
    fontWeight: "700",
  },
  track: {
    alignSelf: "stretch",
    height: 5,
    borderRadius: radii.xs,
    backgroundColor: colors.bg.modalOverlay,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.border.default,
  },
  fill: { height: "100%", borderRadius: radii.xs },
  fillOver: { backgroundColor: colors.crimson[500] },
  value: {
    ...typography.ui.caption,
    color: colors.text.muted,
    fontVariant: ["tabular-nums"],
    // 0.1.119: la cifra ya no comparte fila con la barra; con la
    // letra del sistema muy grande cede antes que la etiqueta.
    flexShrink: 1,
    textAlign: "right",
  },
  tokRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 2,
  },
  tokDot: {
    color: colors.cyan[400],
    fontFamily: fontFamilies.sans,
    fontSize: 8,
  },
  tokLine: {
    ...typography.mono.xs,
    fontSize: 9,
    color: colors.text.accentCyan,
    fontWeight: "600",
  },
});
