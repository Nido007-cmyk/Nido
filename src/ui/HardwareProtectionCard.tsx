/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * HardwareProtectionCard — "Protección por hardware" en Acerca de.
 * Diseño: docs/design/BLOQUEO_BIOMETRICO_REAL.md (nivel A).
 *
 * Activa/desactiva la bóveda: la llave de la base queda envuelta por una
 * llave del chip seguro de la tablet que solo se abre con el PIN o la
 * huella del dueño. Antes de activar se avisa (en un diálogo) qué pasa si
 * un día se quita el bloqueo de pantalla y se recomienda un respaldo.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, View, Text, StyleSheet, Pressable } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "./theme";
import type { Colors } from "./theme/colors";
import type { Typography } from "./theme/typography";
import { calmSpacing } from "./theme/calm";
import { makeSurfaces } from "./theme/surfaces";
import {
  activateVault,
  deactivateVault,
  isVaultActive,
  vaultStatus,
  type VaultStatus,
} from "../security/keyVault";

export function HardwareProtectionCard() {
  const { colors, typography } = useTheme();
  const styles = useMemo(() => getStyles(colors, typography), [colors, typography]);
  const { t } = useTranslation();
  const [status, setStatus] = useState<VaultStatus | null>(null);
  const [active, setActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setStatus(await vaultStatus());
      setActive(await isVaultActive());
    } catch {
      setStatus(null);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const prompt = useMemo(
    () => ({ title: t("vault.promptTitle"), subtitle: t("vault.promptSubtitle") }),
    [t],
  );
  const verifyPrompt = useMemo(
    () => ({ title: t("vault.promptTitle"), subtitle: t("vault.promptVerify") }),
    [t],
  );

  const describeError = useCallback(
    (e: unknown): string => {
      const code = (e as { code?: string } | null)?.code;
      if (code === "E_NO_SECURE_LOCK") return t("vault.errNoLock");
      if (code === "E_UNSUPPORTED") return t("vault.errUnsupported");
      if (code === "E_CANCELLED") return t("lockScreen.cancelled");
      if (code === "E_VERIFY_MISMATCH") return t("vault.errVerify");
      return t("vault.errGeneric");
    },
    [t],
  );

  const doActivate = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    try {
      await activateVault(prompt, verifyPrompt);
      setMessage(t("vault.activated"));
    } catch (e) {
      setMessage(describeError(e));
    } finally {
      setBusy(false);
      await refresh();
    }
  }, [describeError, prompt, verifyPrompt, refresh, t]);

  const confirmActivate = useCallback(() => {
    Alert.alert(t("vault.confirmTitle"), t("vault.confirmBody"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("vault.confirmActivate"), onPress: () => void doActivate() },
    ]);
  }, [doActivate, t]);

  const confirmDeactivate = useCallback(() => {
    Alert.alert(t("vault.deactivateTitle"), t("vault.deactivateBody"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("vault.deactivate"),
        style: "destructive",
        onPress: async () => {
          setBusy(true);
          setMessage(null);
          try {
            await deactivateVault(prompt);
            setMessage(t("vault.deactivated"));
          } catch (e) {
            setMessage(describeError(e));
          } finally {
            setBusy(false);
            await refresh();
          }
        },
      },
    ]);
  }, [describeError, prompt, refresh, t]);

  if (!loaded || !status) return null; // build sin el módulo nativo

  const levelLabel =
    status.securityLevel === "strongbox"
      ? "StrongBox"
      : status.securityLevel === "tee"
        ? "TEE"
        : status.securityLevel === "software"
          ? t("vault.levelSoftware")
          : "—";

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{t("vault.title")}</Text>
      <Text style={styles.paragraph}>{t("vault.body")}</Text>
      <Text style={styles.status}>
        {active
          ? t("vault.statusActive", { level: levelLabel })
          : status.supported
            ? t("vault.statusInactive")
            : status.apiLevel < 30
              ? t("vault.errUnsupported")
              : t("vault.errNoLock")}
      </Text>
      {message && <Text style={styles.status}>{message}</Text>}
      <View style={styles.row}>
        {active ? (
          <Pressable
            style={styles.secondaryBtn}
            onPress={confirmDeactivate}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={t("vault.deactivate")}
          >
            <Text style={styles.secondaryBtnText}>{t("vault.deactivate")}</Text>
          </Pressable>
        ) : (
          <Pressable
            style={[styles.actionBtn, (!status.supported || busy) && { opacity: 0.5 }]}
            onPress={confirmActivate}
            disabled={!status.supported || busy}
            accessibilityRole="button"
            accessibilityLabel={t("vault.activate")}
          >
            <Text style={styles.actionBtnText}>{busy ? t("lockScreen.unlocking") : t("vault.activate")}</Text>
          </Pressable>
        )}
      </View>
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
