/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * SecurityStatusCard — estado de seguridad comprobado en este teléfono (U7).
 *
 * src/diagnostics/security.ts ya sabía comprobar el cifrado de la base, el
 * almacén de claves y el bloqueo biométrico, pero ninguna pantalla mostraba
 * el resultado. Esta tarjeta lo ejecuta a petición del usuario y muestra
 * solo estados (nunca claves): lo que no se puede comprobar se dice tal cual.
 */
import React, { useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "./theme";
import type { Colors } from "./theme/colors";
import type { Typography } from "./theme/typography";
import { calmSpacing, calmRadii } from "./theme/calm";
import { makeSurfaces } from "./theme/surfaces";
import {
  collectSecurityDiagnostics,
  type SecurityDiagnostics,
  type VerifyState,
} from "../diagnostics/security";

async function runDiagnostics(): Promise<SecurityDiagnostics> {
  const [SecureStore, LocalAuth, dbManager] = await Promise.all([
    import("expo-secure-store"),
    import("expo-local-authentication"),
    import("../security/databaseManager"),
  ]);
  let db: { getAllAsync(sql: string): Promise<Array<{ cipher_version?: string }>> } | undefined;
  try {
    const handle = await dbManager.getDatabase();
    db = {
      getAllAsync: (sql: string) => handle.getAllAsync<{ cipher_version?: string }>(sql),
    };
  } catch {
    // Sin base abierta el diagnóstico lo reporta como «no se pudo comprobar».
    db = undefined;
  }
  return collectSecurityDiagnostics({
    db,
    secureStore: {
      setItemAsync: (k, v) => SecureStore.setItemAsync(k, v),
      getItemAsync: (k) => SecureStore.getItemAsync(k),
      deleteItemAsync: (k) => SecureStore.deleteItemAsync(k),
    },
    localAuth: {
      hasHardwareAsync: () => LocalAuth.hasHardwareAsync(),
      isEnrolledAsync: () => LocalAuth.isEnrolledAsync(),
      supportedAuthenticationTypesAsync: () => LocalAuth.supportedAuthenticationTypesAsync(),
    },
  });
}

export function SecurityStatusCard() {
  const { colors, typography } = useTheme();
  const styles = useMemo(() => getStyles(colors, typography), [colors, typography]);
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SecurityDiagnostics | null>(null);
  const [failed, setFailed] = useState(false);

  const handleRun = async () => {
    setBusy(true);
    setFailed(false);
    try {
      setResult(await runDiagnostics());
    } catch {
      setResult(null);
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const stateColor = (s: VerifyState) =>
    s === "verified" ? colors.emerald[600] : s === "failed" ? colors.crimson[500] : colors.amber[600];

  const rows: { label: string; state: VerifyState; detail?: string }[] = result
    ? [
        {
          label: t("securityStatus.database"),
          state: result.sqlcipher.state,
          detail: result.sqlcipher.cipherVersion ?? undefined,
        },
        { label: t("securityStatus.keystore"), state: result.keystore.state },
        {
          label: t("securityStatus.biometric"),
          state:
            result.biometric.state === "verified" &&
            !(result.biometric.hasHardware && result.biometric.enrolled)
              ? "unavailable"
              : result.biometric.state,
        },
        { label: t("securityStatus.hardwareBacked"), state: result.hardwareBacked.state },
      ]
    : [];

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{t("securityStatus.title")}</Text>
      <Text style={styles.paragraph}>{t("securityStatus.body")}</Text>
      {rows.map((r) => (
        <View key={r.label} style={styles.row}>
          <Text style={styles.rowLabel}>{r.label}</Text>
          <Text style={[styles.rowState, { color: stateColor(r.state) }]}>
            {t(`securityStatus.state.${r.state}`)}
            {r.detail ? ` · ${r.detail}` : ""}
          </Text>
        </View>
      ))}
      {failed && <Text style={styles.paragraph}>{t("securityStatus.runFailed")}</Text>}
      <Pressable
        style={styles.button}
        onPress={handleRun}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={t("securityStatus.run")}
      >
        {busy ? (
          <ActivityIndicator color={colors.text.accentEmerald} />
        ) : (
          <Text style={styles.buttonText}>{t("securityStatus.run")}</Text>
        )}
      </Pressable>
    </View>
  );
}

const getStyles = (colors: Colors, typography: Typography) => {
  const ui = makeSurfaces(colors, typography);
  return StyleSheet.create({
    card: ui.card,
    cardTitle: ui.sectionLabel,
    paragraph: ui.body,
    row: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      gap: calmSpacing.cozy,
      backgroundColor: colors.bg.cardElevated,
      borderRadius: calmRadii.soft,
      padding: 12,
    },
    rowLabel: {
      ...typography.ui.caption,
      color: colors.text.primary,
      fontWeight: "600",
      flexShrink: 1,
    },
    rowState: {
      ...typography.ui.caption,
      fontWeight: "700",
    },
    button: ui.secondaryButton,
    buttonText: ui.secondaryButtonText,
  });
};
