/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * ScheduledTasksCard — crear, ver, pausar y borrar tareas programadas (U8).
 *
 * Una tarea es una instrucción que el agente ejecuta solo a una hora fija,
 * todos los días o ciertos días de la semana. Corre dentro de NIDO, con las
 * herramientas seguras por defecto y sin poder confirmar nada por el
 * usuario; el resultado queda aquí y, si se pide, en un aviso.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, TextInput, Switch, Alert } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "./theme";
import type { Colors } from "./theme/colors";
import type { Typography } from "./theme/typography";
import { makeSurfaces } from "./theme/surfaces";
import {
  buildSchedule,
  createTask,
  describeSchedule,
  getNextRunTime,
  DEFAULT_TASK_TOOLS,
  type ScheduledTask,
  type TaskRunResult,
} from "../agent/scheduled/scheduledTasks";
import { deleteTask, getTaskRuns, listTasks, saveTask } from "../agent/scheduled/taskStore";
import { scheduleTaskReminder } from "../agent/scheduled/runScheduled";
import { cancelTaskNotification } from "../notify/notifications";

/** Lunes primero; el valor es el día de la semana de JavaScript (0 = domingo). */
const WEEK: readonly number[] = [1, 2, 3, 4, 5, 6, 0];
const MAX_TASKS = 10;

/** "7:05", "07:05", "7" o "705" → hora y minuto, o null. */
export function parseClock(input: string): { hour: number; minute: number } | null {
  const m = /^\s*(\d{1,2})(?:[:.h ]?(\d{2}))?\s*$/.exec(input);
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = m[2] ? Number(m[2]) : 0;
  return hour <= 23 && minute <= 59 ? { hour, minute } : null;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function ScheduledTasksCard() {
  const { colors, typography } = useTheme();
  const styles = useMemo(() => getStyles(colors, typography), [colors, typography]);
  const { t } = useTranslation();
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [lastRuns, setLastRuns] = useState<Record<string, TaskRunResult | undefined>>({});
  const [loadFailed, setLoadFailed] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [instruction, setInstruction] = useState("");
  const [clock, setClock] = useState("08:00");
  const [days, setDays] = useState<number[]>([...WEEK]);
  const [busy, setBusy] = useState(false);

  const reminderStrings = useMemo(
    () => ({
      dueTitle: (taskName: string) => t("scheduledTasks.notifyDue", { name: taskName }),
      dueBody: t("scheduledTasks.notifyDueBody"),
    }),
    [t],
  );

  const reload = useCallback(async () => {
    try {
      const all = await listTasks();
      const runs: Record<string, TaskRunResult | undefined> = {};
      for (const task of all) {
        runs[task.id] = (await getTaskRuns(task.id, 1))[0];
      }
      setTasks(all);
      setLastRuns(runs);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    void reload();
    // Las tareas corren mientras la app está abierta: refrescar el resultado.
    const id = setInterval(() => void reload(), 30_000);
    return () => clearInterval(id);
  }, [reload]);

  const scheduleLabel = (task: ScheduledTask): string => {
    const d = describeSchedule(task.schedule);
    if (!d) return task.schedule;
    const time = `${pad(d.hour)}:${pad(d.minute)}`;
    if (d.weekdays.length === 7) return t("scheduledTasks.everyDayAt", { time });
    const names = WEEK.filter((w) => d.weekdays.includes(w))
      .map((w) => t(`scheduledTasks.dayShort.${w}`))
      .join(", ");
    return t("scheduledTasks.daysAt", { days: names, time });
  };

  const handleCreate = async () => {
    const time = parseClock(clock);
    if (!time) {
      Alert.alert(t("scheduledTasks.errorTitle"), t("scheduledTasks.badTime"));
      return;
    }
    if (!name.trim() || !instruction.trim()) {
      Alert.alert(t("scheduledTasks.errorTitle"), t("scheduledTasks.missingFields"));
      return;
    }
    if (days.length === 0) {
      Alert.alert(t("scheduledTasks.errorTitle"), t("scheduledTasks.noDays"));
      return;
    }
    const { task } = createTask({
      name: name.trim().slice(0, 60),
      instruction: instruction.trim().slice(0, 500),
      schedule: buildSchedule(time.hour, time.minute, days),
      enabled: true,
      allowedTools: [...DEFAULT_TASK_TOOLS],
      notifyOnComplete: true,
    });
    if (!task) {
      Alert.alert(t("scheduledTasks.errorTitle"), t("scheduledTasks.createFailed"));
      return;
    }
    setBusy(true);
    try {
      await saveTask(task);
      await scheduleTaskReminder(task, task.nextRunAt, reminderStrings).catch(() => {});
      setCreating(false);
      setName("");
      setInstruction("");
      await reload();
    } catch {
      Alert.alert(t("scheduledTasks.errorTitle"), t("scheduledTasks.createFailed"));
    } finally {
      setBusy(false);
    }
  };

  const handleToggle = async (task: ScheduledTask, enabled: boolean) => {
    const next: ScheduledTask = {
      ...task,
      enabled,
      nextRunAt: enabled ? getNextRunTime(task.schedule) : null,
    };
    setTasks((prev) => prev.map((x) => (x.id === task.id ? next : x)));
    try {
      await saveTask(next);
      await scheduleTaskReminder(next, next.nextRunAt, reminderStrings).catch(() => {});
    } catch {
      await reload();
    }
  };

  const handleDelete = (task: ScheduledTask) => {
    Alert.alert(t("scheduledTasks.deleteTitle"), t("scheduledTasks.deleteBody", { name: task.name }), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.delete"),
        style: "destructive",
        onPress: async () => {
          try {
            await deleteTask(task.id);
            await cancelTaskNotification(task.id);
          } finally {
            await reload();
          }
        },
      },
    ]);
  };

  const toggleDay = (d: number) =>
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{t("scheduledTasks.title")}</Text>
      <Text style={styles.paragraph}>{t("scheduledTasks.body")}</Text>
      {loadFailed && <Text style={styles.paragraph}>{t("scheduledTasks.loadFailed")}</Text>}
      {!loadFailed && tasks.length === 0 && !creating && (
        <Text style={styles.paragraph}>{t("scheduledTasks.empty")}</Text>
      )}

      {tasks.map((task) => {
        const run = lastRuns[task.id];
        return (
          <View key={task.id} style={styles.row}>
            <View style={styles.rowHeader}>
              <View style={styles.rowText}>
                <Text style={styles.rowName}>{task.name}</Text>
                <Text style={styles.rowMeta}>{scheduleLabel(task)}</Text>
              </View>
              <Switch
                value={task.enabled}
                onValueChange={(v) => void handleToggle(task, v)}
                accessibilityLabel={t("scheduledTasks.toggleLabel", { name: task.name })}
                trackColor={{ false: colors.border.elevated, true: colors.emerald[400] }}
                thumbColor={colors.bg.card}
              />
            </View>
            <Text style={styles.rowInstruction}>{task.instruction}</Text>
            {task.enabled && task.nextRunAt ? (
              <Text style={styles.rowMeta}>
                {t("scheduledTasks.nextRun", { when: new Date(task.nextRunAt).toLocaleString() })}
              </Text>
            ) : null}
            {run ? (
              <View style={styles.result}>
                <Text style={[styles.resultState, { color: run.success ? colors.emerald[600] : colors.crimson[500] }]}>
                  {run.success ? t("scheduledTasks.lastOk") : t("scheduledTasks.lastFailed")}
                  {" · "}
                  {new Date(run.completedAt).toLocaleString()}
                </Text>
                {run.success && run.summary ? <Text style={styles.resultText}>{run.summary}</Text> : null}
              </View>
            ) : (
              <Text style={styles.rowMeta}>{t("scheduledTasks.neverRan")}</Text>
            )}
            <Pressable
              style={styles.deleteBtn}
              onPress={() => handleDelete(task)}
              accessibilityRole="button"
              accessibilityLabel={t("scheduledTasks.deleteLabel", { name: task.name })}
            >
              <Text style={styles.deleteBtnText}>{t("common.delete")}</Text>
            </Pressable>
          </View>
        );
      })}

      {creating ? (
        <View style={styles.form}>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder={t("scheduledTasks.namePlaceholder")}
            placeholderTextColor={colors.text.muted}
            maxLength={60}
            accessibilityLabel={t("scheduledTasks.namePlaceholder")}
          />
          <TextInput
            style={[styles.input, styles.inputMultiline]}
            value={instruction}
            onChangeText={setInstruction}
            placeholder={t("scheduledTasks.instructionPlaceholder")}
            placeholderTextColor={colors.text.muted}
            maxLength={500}
            multiline
            accessibilityLabel={t("scheduledTasks.instructionPlaceholder")}
          />
          <Text style={styles.cardTitle}>{t("scheduledTasks.timeLabel")}</Text>
          <TextInput
            style={styles.input}
            value={clock}
            onChangeText={setClock}
            placeholder="08:00"
            placeholderTextColor={colors.text.muted}
            keyboardType="numbers-and-punctuation"
            maxLength={5}
            accessibilityLabel={t("scheduledTasks.timeLabel")}
          />
          <Text style={styles.cardTitle}>{t("scheduledTasks.daysLabel")}</Text>
          <View style={styles.dayRow}>
            {WEEK.map((d) => {
              const on = days.includes(d);
              return (
                <Pressable
                  key={d}
                  style={[styles.day, on && styles.dayOn]}
                  onPress={() => toggleDay(d)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={t(`scheduledTasks.dayLong.${d}`)}
                >
                  <Text style={[styles.dayText, on && styles.dayTextOn]}>
                    {t(`scheduledTasks.dayShort.${d}`)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Pressable
            style={[styles.primary, busy && styles.disabled]}
            onPress={() => void handleCreate()}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={t("scheduledTasks.save")}
          >
            <Text style={styles.primaryText}>{t("scheduledTasks.save")}</Text>
          </Pressable>
          <Pressable
            style={styles.secondary}
            onPress={() => setCreating(false)}
            accessibilityRole="button"
            accessibilityLabel={t("common.cancel")}
          >
            <Text style={styles.secondaryText}>{t("common.cancel")}</Text>
          </Pressable>
        </View>
      ) : tasks.length < MAX_TASKS ? (
        <Pressable
          style={styles.secondary}
          onPress={() => setCreating(true)}
          accessibilityRole="button"
          accessibilityLabel={t("scheduledTasks.add")}
        >
          <Text style={styles.secondaryText}>{t("scheduledTasks.add")}</Text>
        </Pressable>
      ) : (
        <Text style={styles.paragraph}>{t("scheduledTasks.limit", { max: MAX_TASKS })}</Text>
      )}
    </View>
  );
}

const getStyles = (colors: Colors, typography: Typography) => {
  const ui = makeSurfaces(colors, typography);
  return StyleSheet.create({
    card: ui.card,
    cardTitle: ui.sectionLabel,
    paragraph: ui.body,
    row: { ...ui.inset, gap: 6 },
    rowHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
    rowText: { flex: 1, gap: 2 },
    rowName: { ...typography.ui.body, color: colors.text.primary, fontWeight: "700" },
    rowMeta: { ...typography.ui.caption, color: colors.text.secondary },
    rowInstruction: { ...typography.ui.caption, color: colors.text.primary },
    result: { backgroundColor: colors.bg.card, borderRadius: 10, padding: 10, gap: 4 },
    resultState: { ...typography.ui.caption, fontWeight: "700" },
    resultText: { ...typography.ui.caption, color: colors.text.primary },
    deleteBtn: { alignSelf: "flex-start", minHeight: 44, justifyContent: "center", paddingRight: 12 },
    deleteBtnText: { ...typography.ui.caption, color: colors.crimson[500], fontWeight: "700" },
    form: { gap: 10 },
    input: ui.input,
    inputMultiline: { minHeight: 80, textAlignVertical: "top" },
    dayRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
    day: {
      minWidth: 44,
      minHeight: 44,
      borderRadius: 9999,
      paddingHorizontal: 10,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.bg.cardElevated,
    },
    dayOn: { backgroundColor: colors.emerald[500] },
    dayText: { ...typography.ui.caption, color: colors.text.secondary, fontWeight: "600" },
    dayTextOn: { color: colors.text.inverse },
    primary: ui.primaryButton,
    primaryText: ui.primaryButtonText,
    secondary: ui.secondaryButton,
    secondaryText: ui.secondaryButtonText,
    disabled: { opacity: 0.5 },
  });
};
