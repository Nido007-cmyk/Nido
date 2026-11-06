/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * RelayCard — «Llevar mensajes de mis contactos» (de amigo en amigo).
 *
 * Apagado por defecto. Encendido, este teléfono guarda sobres sellados de
 * sus contactos para otros contactos y los entrega al cruzarse con ellos:
 * no puede leerlos, solo de contactos, con topes (200 sobres, 2 MB) y
 * caducidad de 72 h. Recibir y mandar por amigos no depende de esto.
 * Ver docs/RELAY.md.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, Switch } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "./theme";
import type { Colors } from "./theme/colors";
import type { Typography } from "./theme/typography";
import { calmSpacing, calmRadii } from "./theme/calm";
import { makeSurfaces } from "./theme/surfaces";
import { relayUsage, setCarryEnabled, type RelayUsage } from "../p2p/relay/relayService";

export function RelayCard() {
  const { colors, typography } = useTheme();
  const styles = useMemo(() => getStyles(colors, typography), [colors, typography]);
  const { t } = useTranslation();
  const [usage, setUsage] = useState<RelayUsage | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      setUsage(await relayUsage());
    } catch {
      setUsage(null);
    }
  }, []);

  useEffect(() => {
    void reload();
    const timer = setInterval(() => void reload(), 30_000);
    return () => clearInterval(timer);
  }, [reload]);

  const toggle = useCallback(
    async (on: boolean) => {
      setBusy(true);
      try {
        await setCarryEnabled(on);
      } finally {
        setBusy(false);
        await reload();
      }
    },
    [reload],
  );

  const enabled = usage?.enabled ?? false;
  const kb = Math.ceil((usage?.bytes ?? 0) / 1024);
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{t("nido.relay.title")}</Text>
      <Text style={styles.paragraph}>{t("nido.relay.body")}</Text>
      <View style={styles.row}>
        <View style={styles.rowText}>
          <Text style={styles.rowName}>{t("nido.relay.toggle")}</Text>
          <Text style={styles.rowDesc}>
            {enabled ? t("nido.relay.usage", { count: usage?.envelopes ?? 0, kb }) : t("nido.relay.off")}
          </Text>
        </View>
        <Switch
          value={enabled}
          disabled={busy || usage === null}
          onValueChange={(v) => void toggle(v)}
          accessibilityLabel={t("nido.relay.toggle")}
          trackColor={{ false: colors.border.elevated, true: colors.emerald[400] }}
          thumbColor={colors.bg.card}
        />
      </View>
      <Text style={styles.rowDesc}>{t("nido.relay.privacy")}</Text>
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
      alignItems: "center",
      justifyContent: "space-between",
      gap: calmSpacing.cozy,
      backgroundColor: colors.bg.cardElevated,
      borderRadius: calmRadii.soft,
      padding: 12,
      minHeight: 48,
    },
    rowText: { flex: 1, gap: 2 },
    rowName: { ...typography.ui.body, color: colors.text.primary, fontWeight: "700" },
    rowDesc: { ...typography.ui.caption, color: colors.text.secondary },
  });
};
