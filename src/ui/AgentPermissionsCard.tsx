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
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, Switch, Pressable, Alert } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "./theme";
import type { Colors } from "./theme/colors";
import type { Typography } from "./theme/typography";
import { calmSpacing, calmRadii } from "./theme/calm";
import { makeSurfaces } from "./theme/surfaces";
import { LOCAL_TOOLS } from "../agent/tools/manifest";
import { actionLog, type ActionLogEntry } from "../agent/actionLog";
import {
  canUndo,
  clearActions,
  listActions,
  undoAction,
  type StoredAction,
} from "../agent/actionLogStore";
import { getDisabledTools, setToolDisabled } from "../agent/tools/toolPermissions";
import { setDisabledToolNames } from "../models/settings";

const MAX_LOG_ROWS = 20;

export function AgentPermissionsCard() {
  const { colors, typography } = useTheme();
  const styles = useMemo(() => getStyles(colors, typography), [colors, typography]);
  const { t } = useTranslation();
  // Fuente principal: la base cifrada (sobrevive al cierre de la app). Si no
  // se puede leer, se muestra lo de esta sesión, que vive en memoria.
  const [stored, setStored] = useState<StoredAction[] | null>(null);
  const [session, setSession] = useState<ActionLogEntry[]>(() => actionLog.list());
  const [disabled, setDisabled] = useState<string[]>(() => getDisabledTools());

  const reload = useCallback(async () => {
    setSession(actionLog.list());
    try {
      setStored(await listActions(MAX_LOG_ROWS));
    } catch {
      setStored(null);
    }
  }, []);

  useEffect(() => {
    void reload();
    // La escritura en la base es asíncrona: releer un momento después.
    let timer: ReturnType<typeof setTimeout> | null = null;
    const off = actionLog.onChange(() => {
      setSession(actionLog.list());
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void reload(), 400);
    });
    return () => {
      off();
      if (timer) clearTimeout(timer);
    };
  }, [reload]);

  const handleUndo = (a: StoredAction) => {
    Alert.alert(
      t("agentPermissions.undoTitle"),
      t(a.undo?.kind === "note" ? "agentPermissions.undoNoteBody" : "agentPermissions.undoReminderBody"),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("agentPermissions.undo"),
          style: "destructive",
          onPress: async () => {
            try {
              await undoAction(a);
            } catch {
              Alert.alert(t("agentPermissions.undoTitle"), t("agentPermissions.undoFailed"));
            } finally {
              await reload();
            }
          },
        },
      ],
    );
  };

  const handleClear = () => {
    Alert.alert(t("agentPermissions.clearTitle"), t("agentPermissions.clearBody"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.delete"),
        style: "destructive",
        onPress: async () => {
          try {
            await clearActions();
            actionLog.clear();
          } finally {
            await reload();
          }
        },
      },
    ]);
  };

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

  const recent: (ActionLogEntry & Partial<Pick<StoredAction, "id" | "undone">>)[] =
    stored ?? session.slice(0, MAX_LOG_ROWS);

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{t("agentPermissions.historyTitle")}</Text>
      <Text style={styles.paragraph}>{t("agentPermissions.historyBody")}</Text>
      {recent.length === 0 ? (
        <Text style={styles.paragraph}>{t("agentPermissions.historyEmpty")}</Text>
      ) : (
        recent.map((e, i) => {
          const storedEntry = stored ? (e as StoredAction) : null;
          return (
            <View key={`${e.ts}-${i}`} style={styles.logRow}>
              <View style={styles.logHead}>
                <View style={styles.rowText}>
                  <Text style={styles.rowName}>{e.tool}</Text>
                  <Text style={styles.rowDesc}>{new Date(e.ts).toLocaleString()}</Text>
                </View>
                <Text style={[styles.rowState, { color: outcomeColor(e.outcome) }]}>
                  {e.undone
                    ? t("agentPermissions.undone")
                    : t(`agentPermissions.outcome.${e.outcome}`)}
                  {e.confirmed ? ` · ${t("agentPermissions.confirmed")}` : ""}
                </Text>
              </View>
              {storedEntry && canUndo(storedEntry) ? (
                <Pressable
                  style={styles.undoBtn}
                  onPress={() => handleUndo(storedEntry)}
                  accessibilityRole="button"
                  accessibilityLabel={t("agentPermissions.undoLabel", { tool: e.tool })}
                >
                  <Text style={styles.undoBtnText}>{t("agentPermissions.undo")}</Text>
                </Pressable>
              ) : null}
            </View>
          );
        })
      )}
      {stored && stored.length > 0 ? (
        <Pressable
          style={styles.undoBtn}
          onPress={handleClear}
          accessibilityRole="button"
          accessibilityLabel={t("agentPermissions.clearTitle")}
        >
          <Text style={styles.clearBtnText}>{t("agentPermissions.clearTitle")}</Text>
        </Pressable>
      ) : null}

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
    logRow: { ...ui.inset, gap: 4 },
    logHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
    undoBtn: { alignSelf: "flex-start", minHeight: 44, justifyContent: "center", paddingRight: 12 },
    undoBtnText: { ...typography.ui.caption, color: colors.emerald[600], fontWeight: "700" },
    clearBtnText: { ...typography.ui.caption, color: colors.crimson[500], fontWeight: "700" },
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
