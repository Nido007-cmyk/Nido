/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * AgentPermissionsCard — permisos del agente e historial de acciones.
 *
 * Arriba: lo que el agente hizo o intentó hacer en esta sesión (solo el
 * nombre de la herramienta y el desenlace, nunca el contenido).
 * Abajo: un interruptor por herramienta. Apagar una herramienta la bloquea
 * por completo; no hay modo «permitir sin preguntar».
 */
import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, Switch } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "./theme";
import type { Colors } from "./theme/colors";
import type { Typography } from "./theme/typography";
import { calmSpacing, calmRadii } from "./theme/calm";
import { makeSurfaces } from "./theme/surfaces";
import { LOCAL_TOOLS } from "../agent/tools/manifest";
import { actionLog, type ActionLogEntry } from "../agent/actionLog";
import { getDisabledTools, setToolDisabled } from "../agent/tools/toolPermissions";
import { setDisabledToolNames } from "../models/settings";

const MAX_LOG_ROWS = 20;

export function AgentPermissionsCard() {
  const { colors, typography } = useTheme();
  const styles = useMemo(() => getStyles(colors, typography), [colors, typography]);
  const { t } = useTranslation();
  const [entries, setEntries] = useState<ActionLogEntry[]>(() => actionLog.list());
  const [disabled, setDisabled] = useState<string[]>(() => getDisabledTools());

  useEffect(() => {
    setEntries(actionLog.list());
    return actionLog.onChange(() => setEntries(actionLog.list()));
  }, []);

  const toggle = (name: string, enabled: boolean) => {
    const next = setToolDisabled(name, !enabled);
    setDisabled(next);
    // Si no se puede guardar, el cambio sigue valiendo en esta sesión.
    setDisabledToolNames(next).catch(() => {});
  };

  const outcomeColor = (o: ActionLogEntry["outcome"]) =>
    o === "executed"
      ? colors.emerald[600]
      : o === "blocked" || o === "failed"
        ? colors.crimson[500]
        : colors.amber[600];

  const recent = entries.slice(0, MAX_LOG_ROWS);

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{t("agentPermissions.historyTitle")}</Text>
      <Text style={styles.paragraph}>{t("agentPermissions.historyBody")}</Text>
      {recent.length === 0 ? (
        <Text style={styles.paragraph}>{t("agentPermissions.historyEmpty")}</Text>
      ) : (
        recent.map((e, i) => (
          <View key={`${e.ts}-${i}`} style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.rowName}>{e.tool}</Text>
              <Text style={styles.rowDesc}>{new Date(e.ts).toLocaleTimeString()}</Text>
            </View>
            <Text style={[styles.rowState, { color: outcomeColor(e.outcome) }]}>
              {t(`agentPermissions.outcome.${e.outcome}`)}
              {e.confirmed ? ` · ${t("agentPermissions.confirmed")}` : ""}
            </Text>
          </View>
        ))
      )}

      <Text style={[styles.cardTitle, styles.sectionGap]}>{t("agentPermissions.toolsTitle")}</Text>
      <Text style={styles.paragraph}>{t("agentPermissions.toolsBody")}</Text>
      {LOCAL_TOOLS.map((tool) => {
        const enabled = !disabled.includes(tool.name);
        return (
          <View key={tool.name} style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.rowName}>{tool.name}</Text>
              <Text style={styles.rowDesc}>{tool.description}</Text>
            </View>
            <Switch
              value={enabled}
              onValueChange={(v) => toggle(tool.name, v)}
              accessibilityLabel={t("agentPermissions.toggleLabel", { tool: tool.name })}
              trackColor={{ false: colors.border.elevated, true: colors.emerald[400] }}
              thumbColor={colors.bg.card}
            />
          </View>
        );
      })}
    </View>
  );
}

const getStyles = (colors: Colors, typography: Typography) => {
  const ui = makeSurfaces(colors, typography);
  return StyleSheet.create({
    card: ui.card,
    cardTitle: ui.sectionLabel,
    sectionGap: { marginTop: calmSpacing.cozy },
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
    rowName: {
      ...typography.mono.xs,
      color: colors.text.primary,
      fontWeight: "700",
    },
    rowDesc: {
      ...typography.ui.caption,
      color: colors.text.secondary,
    },
    rowState: {
      ...typography.ui.caption,
      fontWeight: "700",
    },
  });
};
