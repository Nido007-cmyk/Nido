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
 * Parse a simple cron expression and get the next run time.
 * Supports: minute hour day month weekday (standard cron)
 * This is a simplified parser - full cron in production.
 */
export function getNextRunTime(
  cronExpr: string,
  fromTime: number = Date.now()
): number | null {
  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length !== 5) return null;

  const [minute, hour] = parts;
  const from = new Date(fromTime);

  // Simple case: daily at specific hour:minute
  if (
    /^\d+$/.test(minute) &&
    /^\d+$/.test(hour) &&
    parts[2] === "*" &&
    parts[3] === "*" &&
    parts[4] === "*"
  ) {
    const next = new Date(from);
    next.setHours(parseInt(hour, 10), parseInt(minute, 10), 0, 0);
    if (next.getTime() <= fromTime) {
      next.setDate(next.getDate() + 1);
    }
    return next.getTime();
  }

  // TODO: full cron parser for complex schedules
  return null;
}

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
  const DANGEROUS = [
    "send_sms",
    "nido_send_message",
    "place_call",
    "nido_pair",
    "nido_approve_task",
    "send_email",
    "purchase",
    "delete_file",
    "delete_memory",
    "factory_reset",
  ];
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
