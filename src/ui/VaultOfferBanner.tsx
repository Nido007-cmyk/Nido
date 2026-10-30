/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * VaultOfferBanner — 0.1.51: ofrece la protección por hardware en la
 * pantalla principal, en vez de esperar a que alguien la encuentre en
 * Ajustes → Seguridad.
 *
 * No se activa sola, y es a propósito: exige un bloqueo de pantalla y pide
 * la huella o el PIN. Si un día se quita el bloqueo de pantalla, Android borra
 * la llave y los datos solo vuelven con un respaldo. Esa decisión es del
 * dueño, así que aquí se explica y se pide una confirmación en dos pasos
 * (sin diálogos del sistema).
 *
 * Se muestra solo si el teléfono lo soporta, la bóveda no está activa y el
 * dueño no dijo "no volver a preguntar". "Ahora no" la esconde 7 días.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "./theme";
import type { Colors } from "./theme/colors";
import type { Typography } from "./theme/typography";
import { calmSpacing } from "./theme/calm";
import { makeSurfaces } from "./theme/surfaces";
import { activateVault } from "../security/keyVault";
import { neverOfferVault, snoozeVaultOffer } from "../models/settings";
import { shouldOfferVault, VAULT_OFFER_SNOOZE_MS } from "../security/vaultOffer";

export function VaultOfferBanner() {
  const { colors, typography } = useTheme();
  const styles = useMemo(() => getStyles(colors, typography), [colors, typography]);
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void shouldOfferVault().then((show) => {
      if (!cancelled) setVisible(show);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const activate = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    try {
      // D9 (29-10-2026): sin un respaldo reciente no se activa.
      const { assertRecentBackup } = await import("../security/vaultBackupGate");
      await assertRecentBackup();
      await activateVault(
        { title: t("vault.promptTitle"), subtitle: t("vault.promptSubtitle") },
        { title: t("vault.promptTitle"), subtitle: t("vault.promptVerify") },
      );
      setMessage(t("vault.activated"));
      setConfirming(false);
      setTimeout(() => setVisible(false), 2500);
    } catch (e) {
      const code = (e as { code?: string } | null)?.code;
      setMessage(
        code === "E_NO_RECENT_BACKUP"
          ? t("vault.errNeedBackup")
          : code === "E_NO_SECURE_LOCK"
          ? t("vault.errNoLock")
          : code === "E_CANCELLED"
            ? t("lockScreen.cancelled")
            : code === "E_VERIFY_MISMATCH"
              ? t("vault.errVerify")
              : t("vault.errGeneric"),
      );
    } finally {
      setBusy(false);
    }
  }, [t]);

  if (!visible) return null;

  return (
    <View style={styles.card} accessibilityRole="summary">
      <Text style={styles.title}>{t("vault.offerTitle")}</Text>
      <Text style={styles.body}>{confirming ? t("vault.offerConfirmHint") : t("vault.offerBody")}</Text>
      {message ? <Text style={styles.status}>{message}</Text> : null}
      <View style={styles.row}>
        {confirming ? (
          <Pressable
            style={styles.primary}
            disabled={busy}
            onPress={() => void activate()}
            accessibilityRole="button"
            accessibilityLabel={t("vault.offerConfirm")}
          >
            <Text style={styles.primaryText}>{t("vault.offerConfirm")}</Text>
          </Pressable>
        ) : (
          <Pressable
            style={styles.primary}
            onPress={() => setConfirming(true)}
            accessibilityRole="button"
            accessibilityLabel={t("vault.offerActivate")}
          >
            <Text style={styles.primaryText}>{t("vault.offerActivate")}</Text>
          </Pressable>
        )}
        <Pressable
          style={styles.secondary}
          disabled={busy}
          onPress={() => {
            setVisible(false);
            void snoozeVaultOffer(Date.now() + VAULT_OFFER_SNOOZE_MS).catch(() => {});
          }}
          accessibilityRole="button"
          accessibilityLabel={t("vault.offerLater")}
        >
          <Text style={styles.secondaryText}>{t("vault.offerLater")}</Text>
        </Pressable>
        <Pressable
          style={styles.secondary}
          disabled={busy}
          onPress={() => {
            setVisible(false);
            void neverOfferVault().catch(() => {});
          }}
          accessibilityRole="button"
          accessibilityLabel={t("vault.offerNever")}
        >
          <Text style={styles.secondaryText}>{t("vault.offerNever")}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const getStyles = (colors: Colors, typography: Typography) => {
  const ui = makeSurfaces(colors, typography);
  return StyleSheet.create({
    card: { ...ui.card, marginHorizontal: calmSpacing.cozy, marginTop: calmSpacing.cozy },
    title: ui.sectionLabel,
    body: ui.body,
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
    primary: ui.primaryButton,
    primaryText: ui.primaryButtonText,
    secondary: {
      ...ui.primaryButton,
      backgroundColor: "transparent",
      borderWidth: 1,
      borderColor: colors.text.secondary,
    },
    secondaryText: {
      ...ui.primaryButtonText,
      color: colors.text.secondary,
    },
  });
};
