/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * runScheduled.ts — conecta el motor de tareas (runner.ts) con la app real:
 * la base cifrada, el bucle del agente, el modelo cargado y los avisos.
 *
 * Lo llama el chat cuando el modelo está listo y no hay una respuesta en
 * curso. Todo es local.
 */

import { runDueTasks, type TaskToolHandler } from "./runner";
import type { ScheduledTask, TaskRunResult } from "./scheduledTasks";
import { getDueTasks, recordTaskRun, updateTaskAfterRun } from "./taskStore";
import type { AgentEngine } from "../loop/agentLoop";

export interface ScheduledRunContext {
  engine: AgentEngine;
  nCtx?: number;
  lang: "es" | "en";
  /** Textos ya traducidos para los avisos. */
  strings: {
    doneTitle(name: string): string;
    failedTitle(name: string): string;
    failedBody: string;
    dueTitle(name: string): string;
    dueBody: string;
  };
}

/** (Re)programa el aviso de la próxima ejecución de una tarea. */
export async function scheduleTaskReminder(
  task: Pick<ScheduledTask, "id" | "name" | "enabled">,
  nextRunAt: number | null,
  strings: Pick<ScheduledRunContext["strings"], "dueTitle" | "dueBody">,
): Promise<void> {
  const { scheduleTaskNotification } = await import("../../notify/notifications");
  await scheduleTaskNotification(
    task.id,
    strings.dueTitle(task.name),
    strings.dueBody,
    task.enabled && nextRunAt ? new Date(nextRunAt) : null,
  );
}

export async function runScheduledTasksNow(ctx: ScheduledRunContext): Promise<TaskRunResult[]> {
  const [{ runAgentLoop }, { buildToolHandlers }, { snapshot }, { notifyNow }] = await Promise.all([
    import("../loop/agentLoop"),
    import("../tools/handlers"),
    import("../memory/memoryStore"),
    import("../../notify/notifications"),
  ]);
  // Sin canal de confirmación: cualquier acción que la pida se cancela.
  const allHandlers = buildToolHandlers({
    requestConfirm: async () => false,
  }) as Record<string, TaskToolHandler>;

  return runDueTasks({
    getDueTasks,
    recordTaskRun,
    updateTaskAfterRun,
    allHandlers,
    runInstruction: async (instruction, handlers) => {
      const out = await runAgentLoop(instruction, {
        engine: ctx.engine,
        handlers,
        restrictFastPathsToHandlers: true,
        loadMemory: () => snapshot().catch(() => null),
        maxSteps: 3,
        nPredict: 384,
        lang: ctx.lang,
        nCtx: ctx.nCtx,
      });
      return { response: out.response, toolsUsed: out.toolUses.map((u) => u.name) };
    },
    notify: async (task, result) => {
      await notifyNow(
        result.success ? ctx.strings.doneTitle(task.name) : ctx.strings.failedTitle(task.name),
        result.success ? result.summary : ctx.strings.failedBody,
      );
    },
    scheduleNext: (task, nextRunAt) => scheduleTaskReminder(task, nextRunAt, ctx.strings),
  });
}
