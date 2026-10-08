/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * AgencyReceipt — per-answer transparency receipt
 *
 * Calm Agent UI (2026-10-05). From deep research DR-1.
 * Shows: model, tokens/sec, latency, tools used.
 * Collapsible — tap "Details" on a message to reveal.
 *
 * This is NIDO's differentiator: visible proof of "user as authority."
 * BOAR has telemetry; NIDO shows policy decisions too.
 */

import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../theme/ThemeContext";
import { calmSpacing, calmRadii, calmType } from "../../theme/calm";

export interface AgencyReceiptProps {
  model: string;
  tokensPerSecond?: number;
  latencyMs?: number;
  toolsUsed?: string[];
  policyDecisions?: number;
}

export function AgencyReceipt({
  model,
  tokensPerSecond,
  latencyMs,
  toolsUsed,
  policyDecisions,
}: AgencyReceiptProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();

  const styles = StyleSheet.create({
    container: {
      backgroundColor: colors.bg.subtle,
      borderRadius: calmRadii.soft,
      padding: calmSpacing.cozy,
      marginTop: calmSpacing.tight,
      marginHorizontal: calmSpacing.comfortable,
    },
    row: {
      flexDirection: "row",
      justifyContent: "space-between",
      marginVertical: 2,
    },
    label: {
      ...calmType.caption,
      color: colors.text.muted,
    },
    value: {
      ...calmType.caption,
      color: colors.text.secondary,
      fontWeight: "500",
    },
    toolsContainer: {
      marginTop: calmSpacing.tight,
      paddingTop: calmSpacing.tight,
      borderTopWidth: 1,
      borderTopColor: colors.border.subtle,
    },
    toolChip: {
      ...calmType.tiny,
      color: colors.text.secondary,
      backgroundColor: colors.bg.card,
      borderRadius: calmRadii.pill,
      paddingHorizontal: calmSpacing.cozy,
      paddingVertical: 4,
      marginRight: calmSpacing.tight,
      marginVertical: 2,
    },
  });

  const formatLatency = (ms: number): string => {
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <Text style={styles.label}>{t("calm.model")}</Text>
        <Text style={styles.value}>{model}</Text>
      </View>
      {tokensPerSecond !== undefined && (
        <View style={styles.row}>
          <Text style={styles.label}>{t("calm.speed")}</Text>
          <Text style={styles.value}>{tokensPerSecond.toFixed(1)} tok/s</Text>
        </View>
      )}
      {latencyMs !== undefined && (
        <View style={styles.row}>
          <Text style={styles.label}>{t("calm.time")}</Text>
          <Text style={styles.value}>{formatLatency(latencyMs)}</Text>
        </View>
      )}
      {policyDecisions !== undefined && policyDecisions > 0 && (
        <View style={styles.row}>
          <Text style={styles.label}>{t("calm.policyChecks")}</Text>
          <Text style={styles.value}>{policyDecisions} passed</Text>
        </View>
      )}
      {toolsUsed && toolsUsed.length > 0 && (
        <View style={styles.toolsContainer}>
          <Text style={[styles.label, { marginBottom: 4 }]}>{t("calm.toolsUsed")}</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
            {toolsUsed.map((tool, i) => (
              <Text key={i} style={styles.toolChip}>
                {tool}
              </Text>
            ))}
          </View>
        </View>
      )}
    </View>
  );
}
