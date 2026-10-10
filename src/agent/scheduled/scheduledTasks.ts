/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Scheduled Autonomous Tasks
 *
 * NIDO Scheduled Tasks (2026-10-05). From deep research DR-3.
 *
 * Timer-based agent runs with notification delivery.
 * Examples: "Every morning at 7am, check my calendar and brief me."
 *
 * Principles:
 * - Opt-in: user explicitly creates each scheduled task
 * - Policy-gated: each run goes through the policy engine
 * - Transparent: user sees what ran and what it did
 * - Local: all scheduling on-device, no cloud
 *
 * Pure logic module - testable without a device.
 * Actual timer implementation uses platform APIs (not in this file).
 */

export interface ScheduledTask {
  id: string;
  name: string;
  /** Cron-like schedule: "0 7 * * *" (7am daily) */
  schedule: string;
  /** The agent instruction to run */
  instruction: string;
  /** Whether the task is active */
  enabled: boolean;
  /** When the task was created */
  createdAt: number;
  /** When it last ran (null if never) */
  lastRunAt: number | null;
  /** When it should next run (null if disabled) */
  nextRunAt: number | null;
  /** Tools this task is allowed to use (policy restriction) */
  allowedTools: string[];
  /** Whether to send a notification when complete */
  notifyOnComplete: boolean;
}

export interface TaskRunResult {
  taskId: string;
  startedAt: number;
  completedAt: number;
  success: boolean;
  /** Summary for the notification */
  summary: string;
  /** Tools that were used */
  toolsUsed: string[];
  /** Policy decisions made */
  policyDecisions: number;
  error?: string;
}

/**
 * Días de la semana de un campo cron: "*", "1-5", "1,3,5", "0" (0 y 7 =
 * domingo). Devuelve null si el campo no es válido.
 */
export function parseWeekdays(field: string): Set<number> | null {
  if (field === "*") return new Set([0, 1, 2, 3, 4, 5, 6]);
  const days = new Set<number>();
  for (const part of field.split(",")) {
    const range = /^(\d)-(\d)$/.exec(part);
    if (range) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      if (from > 7 || to > 7 || from > to) return null;
      for (let d = from; d <= to; d++) days.add(d % 7);
      continue;
    }
    if (!/^\d$/.test(part) || Number(part) > 7) return null;
    days.add(Number(part) % 7);
  }
  return days.size > 0 ? days : null;
}

/**
 * Próxima ejecución de un horario cron "minuto hora * * días".
 * Admite una hora fija al día, todos los días o solo ciertos días de la
 * semana ("0 7 * * *", "30 18 * * 1-5", "0 9 * * 1,3"). Los campos de día
 * del mes y mes deben ser "*". Devuelve null para cualquier otro formato.
 */
export function getNextRunTime(
  cronExpr: string,
  fromTime: number = Date.now()
): number | null {
  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length !== 5) return null;

  const [minute, hour, dayOfMonth, month, weekday] = parts;
  if (!/^\d{1,2}$/.test(minute) || !/^\d{1,2}$/.test(hour)) return null;
  if (dayOfMonth !== "*" || month !== "*") return null;
  const m = parseInt(minute, 10);
  const h = parseInt(hour, 10);
  if (m > 59 || h > 23) return null;
  const days = parseWeekdays(weekday);
  if (!days) return null;

  const next = new Date(fromTime);
  next.setHours(h, m, 0, 0);
  if (next.getTime() <= fromTime) next.setDate(next.getDate() + 1);
  // Como mucho 7 saltos: siempre hay al menos un día permitido.
  for (let i = 0; i < 7 && !days.has(next.getDay()); i++) {
    next.setDate(next.getDate() + 1);
  }
  return next.getTime();
}

/** Construye el horario cron para una hora y, opcionalmente, ciertos días. */
export function buildSchedule(hour: number, minute: number, weekdays?: readonly number[]): string {
  const days =
    !weekdays || weekdays.length === 0 || weekdays.length === 7
      ? "*"
      : [...new Set(weekdays.map((d) => d % 7))].sort((a, b) => a - b).join(",");
  return `${minute} ${hour} * * ${days}`;
}

/** Hora y días de un horario válido, para mostrarlo en pantalla. */
export function describeSchedule(
  cronExpr: string
): { hour: number; minute: number; weekdays: number[] } | null {
  if (getNextRunTime(cronExpr) === null) return null;
  const [minute, hour, , , weekday] = cronExpr.trim().split(/\s+/);
  return {
    hour: parseInt(hour, 10),
    minute: parseInt(minute, 10),
    weekdays: [...(parseWeekdays(weekday) ?? [])].sort((a, b) => a - b),
  };
}

/**
 * Herramientas que una tarea programada nunca puede usar: son irreversibles
 * y piden confirmación humana, y una tarea corre sin nadie delante.
 * Los nombres coinciden con ../tools/manifest.ts.
 */
export const UNATTENDED_FORBIDDEN_TOOLS: readonly string[] = [
  "send_sms",
  "nido_send_message",
  "place_call",
  "nido_pair",
  "nido_approve_task",
  "nido_reject_task",
  "open_app",
  "read_picked_file",
  "create_calendar_event",
  "send_email",
  "purchase",
  "delete_file",
  "delete_memory",
  "factory_reset",
];

/** Herramientas que una tarea nueva puede usar si el usuario no elige otras. */
export const DEFAULT_TASK_TOOLS: readonly string[] = [
  "device_time",
  "list_notes",
  "read_note",
  "list_calendar_events",
  "nido_read_inbox",
  "calculate",
  "convert_units",
  "save_note",
];

/**
 * Validate a scheduled task configuration.
 */
export function validateTask(task: Omit<ScheduledTask, "id" | "createdAt" | "lastRunAt" | "nextRunAt">): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!task.name || task.name.trim().length === 0) {
    errors.push("Task name is required");
  }

  if (!task.instruction || task.instruction.trim().length === 0) {
    errors.push("Task instruction is required");
  }

  if (getNextRunTime(task.schedule) === null) {
    errors.push(`Invalid schedule format: ${task.schedule}. Use cron format (e.g., "0 7 * * *" for 7am daily).`);
  }

  if (!task.allowedTools || task.allowedTools.length === 0) {
    errors.push("At least one allowed tool is required (policy restriction)");
  }

  // Block dangerous tools from scheduled tasks.
  // Names must match the tool manifest in ../tools/manifest.ts.
  // Scheduled tasks run unattended, so irreversible actions that
  // require human confirmation can never be allowed here.
  const DANGEROUS = UNATTENDED_FORBIDDEN_TOOLS;
  const blocked = task.allowedTools.filter((t) => DANGEROUS.includes(t));
  if (blocked.length > 0) {
    errors.push(
      `Scheduled tasks cannot use irreversible tools: ${blocked.join(", ")}. ` +
      `These require human confirmation.`
    );
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Create a new scheduled task with validation.
 */
export function createTask(
  config: Omit<ScheduledTask, "id" | "createdAt" | "lastRunAt" | "nextRunAt">
): { task: ScheduledTask | null; errors: string[] } {
  const { valid, errors } = validateTask(config);
  if (!valid) {
    return { task: null, errors };
  }

  const now = Date.now();
  const task: ScheduledTask = {
    ...config,
    id: `task_${now}_${Math.random().toString(36).slice(2, 9)}`,
    createdAt: now,
    lastRunAt: null,
    nextRunAt: config.enabled ? getNextRunTime(config.schedule, now) : null,
  };

  return { task, errors: [] };
}
