/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * 0.1.60: interruptor del resumen diario de las 8:00. Apagado por defecto:
 * antes se programaba solo en cuanto había permiso de notificaciones, y la
 * constitución de NIDO (§9) dice que las notificaciones son las que la
 * persona pide.
 */
import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, Switch } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "./theme";
import type { Colors } from "./theme/colors";
import type { Typography } from "./theme/typography";
import { MIN_TOUCH } from "./theme/surfaces";
import { NidoIcon } from "./components/icons/NidoIcon";
import { getDailySummaryEnabled, setDailySummaryEnabled } from "../models/settings";

export function DailySummaryCard() {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
  const styles = useMemo(() => getStyles(colors, typography), [colors, typography]);
  const [enabled, setEnabled] = useState(false);
  const [noPermission, setNoPermission] = useState(false);

  useEffect(() => {
    getDailySummaryEnabled().then(setEnabled).catch(() => setEnabled(false));
  }, []);

  const toggle = async (value: boolean) => {
    const prev = enabled;
    setEnabled(value);
    try {
      await setDailySummaryEnabled(value);
      const { initNotifications } = await import("../notify/notifications");
      const ok = value ? await initNotifications() : true;
      setNoPermission(value && !ok);
      const { applyDailySummarySetting } = await import("../routines/startup");
      await applyDailySummarySetting();
    } catch {
      // No se pudo guardar: se vuelve a como estaba.
      setEnabled(prev);
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.titleRow}>
        <NidoIcon name="memory" size={18} />
        <Text style={styles.title}>{t("dailySummary.title")}</Text>
      </View>
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Text style={styles.rowLabel}>{t("dailySummary.label")}</Text>
          <Text style={styles.rowValue}>{t("dailySummary.value")}</Text>
        </View>
        <Switch
          value={enabled}
          onValueChange={toggle}
          trackColor={{ false: colors.border.elevated, true: colors.emerald[400] }}
          thumbColor={colors.bg.card}
          accessibilityLabel={t("dailySummary.label")}
        />
      </View>
      {noPermission && <Text style={styles.note}>{t("dailySummary.needsPermission")}</Text>}
    </View>
  );
}

const getStyles = (colors: Colors, typography: Typography) =>
  StyleSheet.create({
    card: { paddingHorizontal: 16, paddingVertical: 12, gap: 12 },
    titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    title: { ...typography.ui.body, color: colors.text.heading, fontWeight: "700" },
    row: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: MIN_TOUCH },
    rowLabel: { ...typography.ui.body, color: colors.text.primary, fontWeight: "600" },
    rowValue: { ...typography.ui.caption, color: colors.text.secondary, marginTop: 2 },
    note: { ...typography.ui.caption, color: colors.text.muted },
  });
