import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import { ModelManager } from "../models/ModelManager";
import { RAM_BUDGET_BYTES, STORAGE_BUDGET_BYTES } from "../models/manifest";
import { getMemoryInfo } from "ram-monitor";
import { getLastQueryStats, subscribeQueryStats } from "../services/telemetry";
import { useTheme } from "./theme";
import type { Colors } from "./theme/colors";
import { typography } from "./theme/typography";
import { radii } from "./theme/spacing";

const modelManager = new ModelManager();

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
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);

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
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);

  const { t } = useTranslation();
  const [storageBytes, setStorageBytes] = useState(0);
  const [rssBytes, setRssBytes] = useState(0);
  const [tokPerSec, setTokPerSec] = useState<number | null>(
    getLastQueryStats()?.tokPerSec ?? null
  );

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      const used = await modelManager.currentStorageUsageBytes();
      if (!cancelled) setStorageBytes(used);
      try {
        if (!cancelled) setRssBytes(getMemoryInfo().rssBytes);
      } catch {
        // Native module not linked
      }
    }
    poll();
    const id = setInterval(poll, 5000);
    const unsubscribe = subscribeQueryStats((s) => setTokPerSec(s.tokPerSec));
    return () => {
      cancelled = true;
      clearInterval(id);
      unsubscribe();
    };
  }, []);

  const ramFraction = rssBytes / RAM_BUDGET_BYTES;
  const storageFraction = storageBytes / STORAGE_BUDGET_BYTES;

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <Text style={styles.label}>{t("drawerFooterStats.ram")}</Text>
        <MiniBar
          fraction={ramFraction}
          over={ramFraction > 1}
          color={colors.emerald[400]}
        />
        <Text style={styles.value}>
          {formatGB(rssBytes)}/{formatGB(RAM_BUDGET_BYTES)}
        </Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>{t("drawerFooterStats.disk")}</Text>
        <MiniBar
          fraction={storageFraction}
          over={storageFraction > 1}
          color={colors.cyan[400]}
        />
        <Text style={styles.value}>
          {formatGB(storageBytes)}/{formatGB(STORAGE_BUDGET_BYTES)}
        </Text>
      </View>
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

const getStyles = (colors: Colors) => StyleSheet.create({
  container: {
    paddingTop: 10,
    paddingBottom: 16,
    gap: 6,
    borderTopWidth: 1,
    borderTopColor: colors.border.subtle,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 6 },
  label: {
    ...typography.mono.xs,
    fontSize: 9,
    color: colors.text.dim,
    width: 28,
    fontWeight: "700",
  },
  track: {
    flex: 1,
    height: 5,
    borderRadius: radii.xs,
    backgroundColor: "rgba(0,0,0,0.5)",
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.border.default,
  },
  fill: { height: "100%", borderRadius: radii.xs },
  fillOver: { backgroundColor: colors.crimson[500] },
  value: {
    ...typography.mono.xs,
    fontSize: 9,
    color: colors.text.muted,
    fontVariant: ["tabular-nums"],
  },
  tokRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 2,
  },
  tokDot: {
    color: colors.cyan[400],
    fontSize: 8,
  },
  tokLine: {
    ...typography.mono.xs,
    fontSize: 9,
    color: colors.text.accentCyan,
    fontWeight: "600",
  },
});
