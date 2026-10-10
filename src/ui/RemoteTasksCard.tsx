/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * RemoteTasksCard — bandeja visible de tareas remotas (auditoría UI, U2).
 *
 * Las tareas que envía un contacto NIDO quedan en cola a la espera de una
 * decisión explícita. Antes solo se veían si el usuario le pedía al agente
 * "revisa las tareas pendientes"; no había ninguna pantalla que las listara.
 *
 * Esta tarjeta las muestra y permite aprobar o rechazar. Aprobar NO ejecuta
 * nada: solo registra la decisión (mismo contrato que nido_approve_task).
 * No se renderiza nada cuando no hay tareas pendientes.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "./theme";
import type { Colors } from "./theme/colors";
import type { Typography } from "./theme/typography";
import { calmSpacing, calmRadii } from "./theme/calm";
import { ApprovalCard } from "./components/calm/ApprovalCard";
import {
  approveAgentTask,
  listPendingAgentTasks,
  rejectAgentTask,
  type AgentTaskRequest,
} from "../p2p/approvalInbox";

/** Cada cuánto se vuelve a consultar la cola mientras la pantalla está abierta. */
const REFRESH_MS = 5000;

export function RemoteTasksCard({ onNotice }: { onNotice?: (message: string) => void }) {
  const { colors, typography } = useTheme();
  const styles = useMemo(() => getStyles(colors, typography), [colors, typography]);
  const { t } = useTranslation();
  const [tasks, setTasks] = useState<AgentTaskRequest[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setTasks(await listPendingAgentTasks());
    } catch {
      // La cola vive en la base cifrada; si aún no está lista se reintenta
      // en el siguiente ciclo. Nunca se muestra una tarea a medias.
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const decide = useCallback(
    async (task: AgentTaskRequest, approve: boolean) => {
      setBusyId(task.id);
      try {
        const ok = approve ? await approveAgentTask(task.id) : await rejectAgentTask(task.id);
        if (ok) {
          onNotice?.(
            t(approve ? "remoteTasks.approved" : "remoteTasks.rejected", { sender: task.senderName }),
          );
        } else {
          onNotice?.(t("remoteTasks.alreadyDecided"));
        }
      } catch (e) {
        onNotice?.(e instanceof Error ? e.message : t("remoteTasks.failed"));
      } finally {
        setBusyId(null);
        void refresh();
      }
    },
    [onNotice, refresh, t],
  );

  if (tasks.length === 0) return null;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t("remoteTasks.title", { count: tasks.length })}</Text>
      <Text style={styles.hint}>{t("remoteTasks.hint")}</Text>
      {tasks.map((task) => (
        <ApprovalCard
          key={task.id}
          request={{
            actionTitle: t("remoteTasks.actionTitle", { sender: task.senderName }),
            reason: task.actionText,
            details: [
              { label: t("remoteTasks.from"), value: `${task.senderName} (${task.senderPkShort}…)` },
              { label: t("remoteTasks.received"), value: new Date(task.receivedAt).toLocaleString() },
            ],
            dataLeaving: [],
            riskLevel: "high",
          }}
          approving={busyId === task.id}
          onApprove={() => void decide(task, true)}
          onDeny={() => void decide(task, false)}
        />
      ))}
    </View>
  );
}

const getStyles = (colors: Colors, typography: Typography) =>
  StyleSheet.create({
    container: {
      marginHorizontal: calmSpacing.comfortable,
      marginTop: calmSpacing.cozy,
      padding: calmSpacing.comfortable,
      gap: calmSpacing.cozy,
      borderRadius: calmRadii.gentle,
      borderWidth: 1,
      borderColor: colors.border.default,
      backgroundColor: colors.bg.cardElevated,
    },
    title: {
      ...typography.mono.xs,
      color: colors.text.accentCyan,
      fontWeight: "800",
      letterSpacing: 0.5,
    },
    hint: {
      ...typography.ui.body,
      color: colors.text.secondary,
      lineHeight: 20,
    },
  });
