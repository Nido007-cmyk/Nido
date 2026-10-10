/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * runner.ts — ejecuta las tareas programadas que ya vencieron.
 *
 * Hasta el 2026-10-10 las tareas se podían validar y guardar, pero nada las
 * ejecutaba. Este módulo es el motor: toma las tareas vencidas, corre cada
 * una por el mismo bucle del agente que usa el chat y registra el resultado.
 *
 * Reglas de seguridad (una tarea corre sin nadie delante):
 * - Solo recibe los handlers de las herramientas que el usuario permitió
 *   para esa tarea, y nunca los de UNATTENDED_FORBIDDEN_TOOLS.
 * - No hay canal de confirmación: toda acción que pida confirmar se cancela.
 * - Una tarea que falla no detiene a las demás y no se reintenta en bucle:
 *   su próxima ejecución es la siguiente hora programada.
 *
 * Límite conocido: corre mientras NIDO está abierto. Si la app está cerrada
 * a la hora programada, el teléfono muestra un aviso y la tarea se ejecuta
 * al abrir la app (una sola vez, aunque se hayan saltado varias horas).
 *
 * Todas las dependencias se inyectan para poder probarlo sin dispositivo.
 */

import {
  getNextRunTime,
  UNATTENDED_FORBIDDEN_TOOLS,
  type ScheduledTask,
  type TaskRunResult,
} from "./scheduledTasks";

export type TaskToolHandler = (args: Record<string, unknown>) => Promise<string>;

export interface RunnerDeps {
  /** Tareas habilitadas cuya hora ya pasó. */
  getDueTasks(now: number): Promise<ScheduledTask[]>;
  recordTaskRun(result: TaskRunResult): Promise<void>;
  updateTaskAfterRun(taskId: string, lastRunAt: number, nextRunAt: number | null): Promise<void>;
  /** Corre la instrucción con SOLO estos handlers. Devuelve el texto final. */
  runInstruction(
    instruction: string,
    handlers: Record<string, TaskToolHandler>,
  ): Promise<{ response: string; toolsUsed: string[] }>;
  /** Todos los handlers disponibles; el runner los filtra por tarea. */
  allHandlers: Record<string, TaskToolHandler>;
  /** Aviso al terminar (si la tarea lo pide). Nunca debe lanzar. */
  notify?(task: ScheduledTask, result: TaskRunResult): Promise<void>;
  /** Reprograma el aviso de la próxima ejecución. Nunca debe lanzar. */
  scheduleNext?(task: ScheduledTask, nextRunAt: number | null): Promise<void>;
  now?(): number;
}

/** Handlers que una tarea puede usar: los permitidos menos los prohibidos. */
export function handlersForTask(
  task: Pick<ScheduledTask, "allowedTools">,
  all: Record<string, TaskToolHandler>,
): Record<string, TaskToolHandler> {
  const out: Record<string, TaskToolHandler> = {};
  for (const name of task.allowedTools) {
    if (UNATTENDED_FORBIDDEN_TOOLS.includes(name)) continue;
    const handler = all[name];
    if (typeof handler === "function") out[name] = handler;
  }
  return out;
}

const MAX_SUMMARY_CHARS = 600;

let running = false;

/** Solo para tests. */
export function __resetRunnerForTests(): void {
  running = false;
}

/**
 * Ejecuta las tareas vencidas, una tras otra. Si ya hay una pasada en
 * curso, devuelve [] sin hacer nada (nunca dos generaciones a la vez).
 */
export async function runDueTasks(deps: RunnerDeps): Promise<TaskRunResult[]> {
  if (running) return [];
  running = true;
  const results: TaskRunResult[] = [];
  try {
    const clock = deps.now ?? Date.now;
    const due = await deps.getDueTasks(clock());
    for (const task of due) {
      const startedAt = clock();
      let result: TaskRunResult;
      try {
        const out = await deps.runInstruction(
          task.instruction,
          handlersForTask(task, deps.allHandlers),
        );
        result = {
          taskId: task.id,
          startedAt,
          completedAt: clock(),
          success: true,
          summary: (out.response ?? "").trim().slice(0, MAX_SUMMARY_CHARS),
          toolsUsed: out.toolsUsed,
          policyDecisions: out.toolsUsed.length,
        };
      } catch (e) {
        result = {
          taskId: task.id,
          startedAt,
          completedAt: clock(),
          success: false,
          summary: "",
          toolsUsed: [],
          policyDecisions: 0,
          error: e instanceof Error ? e.message : String(e),
        };
      }
      // La próxima hora se calcula desde AHORA: si se saltaron varias
      // ejecuciones con la app cerrada, se corre una sola vez.
      const nextRunAt = getNextRunTime(task.schedule, result.completedAt);
      try {
        await deps.recordTaskRun(result);
      } catch {
        // Sin historial la tarea igual avanza: lo importante es no repetirla.
      }
      await deps.updateTaskAfterRun(task.id, result.completedAt, nextRunAt);
      if (deps.scheduleNext) await deps.scheduleNext(task, nextRunAt).catch(() => {});
      if (task.notifyOnComplete && deps.notify) await deps.notify(task, result).catch(() => {});
      results.push(result);
    }
  } finally {
    running = false;
  }
  return results;
}
