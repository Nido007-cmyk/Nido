/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * NetworkAuditCard — vista de solo lectura del registro de red (auditoría
 * UI, U3).
 *
 * src/privacy/networkAudit.ts registra cada acceso a red que hace la app
 * (descargas de modelos y packs). El registro existía, pero ninguna
 * pantalla lo mostraba: el usuario no podía comprobar la promesa de
 * privacidad. Esta tarjeta lista las entradas más recientes tal como están
 * guardadas; nunca contienen contenido del usuario, solo host + ruta,
 * bytes, hora y resultado.
 */
import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "./theme";
import type { Colors } from "./theme/colors";
import type { Typography } from "./theme/typography";
import { calmSpacing, calmRadii, calmShadows } from "./theme/calm";
import { networkAudit, type NetworkAuditEntry } from "../privacy/networkAudit";

/** Entradas más recientes que se muestran. */
const MAX_ROWS = 30;

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function NetworkAuditCard() {
  const { colors, typography } = useTheme();
  const styles = useMemo(() => getStyles(colors, typography), [colors, typography]);
  const { t } = useTranslation();
  const [entries, setEntries] = useState<NetworkAuditEntry[]>(() => networkAudit.list());

  useEffect(() => {
    setEntries(networkAudit.list());
    return networkAudit.onEntry(() => setEntries(networkAudit.list()));
  }, []);

  const recent = entries.slice(-MAX_ROWS).reverse();

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{t("networkLog.title")}</Text>
      <Text style={styles.paragraph}>{t("networkLog.body")}</Text>
      {recent.length === 0 ? (
        <Text style={styles.paragraph}>{t("networkLog.empty")}</Text>
      ) : (
        <>
          <Text style={styles.count}>
            {t("networkLog.showing", { shown: recent.length, total: entries.length })}
          </Text>
          {recent.map((e, i) => (
            <View key={`${e.ts}-${i}`} style={styles.row}>
              <Text style={styles.rowKind}>
                {t(`networkLog.kind.${e.kind}`)} · {new Date(e.ts).toLocaleString()}
              </Text>
              <Text style={styles.rowEndpoint}>{e.endpoint}</Text>
              <Text style={styles.rowMeta}>
                {formatBytes(e.bytesReceived)}
                {e.bytesExpected > 0 ? ` / ${formatBytes(e.bytesExpected)}` : ""}
                {e.error ? ` · ${e.error}` : ""}
              </Text>
            </View>
          ))}
        </>
      )}
    </View>
  );
}

const getStyles = (colors: Colors, typography: Typography) =>
  StyleSheet.create({
    card: {
      backgroundColor: colors.bg.cardElevated,
      borderRadius: calmRadii.gentle,
      borderWidth: 1,
      borderColor: colors.border.default,
      padding: calmSpacing.comfortable,
      gap: calmSpacing.cozy,
      ...calmShadows.none,
    },
    cardTitle: {
      ...typography.mono.xs,
      color: colors.text.accentCyan,
      fontWeight: "800",
      letterSpacing: 0.5,
    },
    paragraph: {
      ...typography.ui.body,
      color: colors.text.secondary,
      lineHeight: 20,
    },
    count: {
      ...typography.ui.caption,
      color: colors.text.secondary,
    },
    row: {
      backgroundColor: colors.bg.terminal,
      borderRadius: calmRadii.subtle,
      borderWidth: 1,
      borderColor: colors.border.subtle,
      padding: calmSpacing.cozy,
      gap: 2,
    },
    rowKind: {
      ...typography.ui.caption,
      color: colors.text.primary,
      fontWeight: "600",
    },
    rowEndpoint: {
      ...typography.mono.xs,
      color: colors.text.secondary,
    },
    rowMeta: {
      ...typography.ui.caption,
      color: colors.text.secondary,
    },
  });
