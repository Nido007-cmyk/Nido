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
 *
 * 0.1.99 (T-14): la tarjeta guarda además el interruptor de ENVIAR los
 * mensajes propios por relevo (m-51, la bandera `p2p.relaySend`), enseña
 * el aviso cuando un sobre propio no se selló por almacén lleno (m-49),
 * barre lo caducado al abrirse (m-52) y solo sondea en primer plano
 * (P-21).
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, Switch, AppState } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "./theme";
import type { Colors } from "./theme/colors";
import type { Typography } from "./theme/typography";
import { calmSpacing, calmRadii } from "./theme/calm";
import { makeSurfaces } from "./theme/surfaces";
import { relayUsage, setCarryEnabled, sweepRelay, type RelayUsage } from "../p2p/relay/relayService";
import { isFeatureEnabled, setFeatureEnabled } from "../config/featureFlags";

export function RelayCard() {
  const { colors, typography } = useTheme();
  const styles = useMemo(() => getStyles(colors, typography), [colors, typography]);
  const { t } = useTranslation();
  const [usage, setUsage] = useState<RelayUsage | null>(null);
  const [busy, setBusy] = useState(false);
  // T-14 (m-51): el interruptor de enviar los míos por relevo vive en una
  // bandera (como los de Ajustes): lectura síncrona, guardado asíncrono.
  const [sendOn, setSendOn] = useState<boolean>(() => isFeatureEnabled("p2p.relaySend"));
  const [sendBusy, setSendBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      setUsage(await relayUsage());
    } catch {
      setUsage(null);
    }
  }, []);

  useEffect(() => {
    // T-14 (m-52): al abrirse la tarjeta se barre lo caducado, para que
    // las cifras que enseña no cuenten sobres ya muertos.
    void (async () => {
      try {
        await sweepRelay(Date.now());
      } catch {
        /* best-effort: la recarga enseña el estado que haya */
      }
      await reload();
    })();
    // T-14 (P-21): el sondeo de 30 s solo corre con la app en primer
    // plano (antes despertaba la lectura del estado también en segundo
    // plano, sin nadie mirando); al volver a primer plano se recarga.
    const timer = setInterval(() => {
      if (AppState.currentState === "active") void reload();
    }, 30_000);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void reload();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [reload]);

  const toggle = useCallback(
    async (on: boolean) => {
      setBusy(true);
      try {
        await setCarryEnabled(on);
      } catch {
        /* no se pudo guardar: la recarga muestra el estado real */
      } finally {
        setBusy(false);
        await reload();
      }
    },
    [reload],
  );

  const toggleSend = useCallback(async (on: boolean) => {
    setSendBusy(true);
    setSendOn(on);
    try {
      await setFeatureEnabled("p2p.relaySend", on);
    } catch {
      setSendOn(isFeatureEnabled("p2p.relaySend"));
    } finally {
      setSendBusy(false);
    }
  }, []);

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
      <View style={[styles.row, styles.rowSpaced]}>
        <View style={styles.rowText}>
          <Text style={styles.rowName}>{t("nido.relay.sendToggle")}</Text>
          <Text style={styles.rowDesc}>{t("nido.relay.sendDesc")}</Text>
        </View>
        <Switch
          value={sendOn}
          disabled={sendBusy}
          onValueChange={(v) => void toggleSend(v)}
          accessibilityLabel={t("nido.relay.sendToggle")}
          trackColor={{ false: colors.border.elevated, true: colors.emerald[400] }}
          thumbColor={colors.bg.card}
        />
      </View>
      {usage?.sealMiss === "store_full" ? <Text style={styles.rowDesc}>{t("nido.relay.storeFull")}</Text> : null}
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
    rowSpaced: { marginTop: calmSpacing.cozy },
    rowName: { ...typography.ui.body, color: colors.text.primary, fontWeight: "700" },
    rowDesc: { ...typography.ui.caption, color: colors.text.secondary },
  });
};
