/**
 * taskStore.ts - NIDO: persistencia de tareas programadas en SQLCipher.
 *
 * Usa el DatabaseManager centralizado (`src/security/databaseManager.ts`):
 * - Una sola conexión a `nido_memory.db` (no 4 handles independientes)
 * - Escrituras serializadas globales
 * - Wipe gate y epoch centralizados
 * - Schema version unificada
 *
 * La lógica pura (validación, cálculo de próxima ejecución) vive en
 * `scheduledTasks.ts`; aquí solo la persistencia.
 */

import type { ScheduledTask, TaskRunResult } from "./scheduledTasks";
import {
  getDatabase,
  safeJsonParse,
  writeTransaction,
} from "../../security/databaseManager";

function rowToTask(row: any): ScheduledTask {
  return {
    id: row.id,
    name: row.name,
    schedule: row.schedule,
    instruction: row.instruction,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    lastRunAt: row.last_run_at,
    nextRunAt: row.next_run_at,
    allowedTools: safeJsonParse<string[]>(row.allowed_tools, []),
    notifyOnComplete: row.notify_on_complete === 1,
  };
}

/** Guarda o actualiza una tarea. */
export async function saveTask(task: ScheduledTask): Promise<void> {
  await writeTransaction(async (database) => {
    await database.runAsync(
      `INSERT INTO scheduled_tasks
        (id, name, schedule, instruction, enabled, created_at, last_run_at,
         next_run_at, allowed_tools, notify_on_complete)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
        name=excluded.name, schedule=excluded.schedule,
        instruction=excluded.instruction, enabled=excluded.enabled,
        last_run_at=excluded.last_run_at, next_run_at=excluded.next_run_at,
        allowed_tools=excluded.allowed_tools,
        notify_on_complete=excluded.notify_on_complete`,
      [
        task.id,
        task.name,
        task.schedule,
        task.instruction,
        task.enabled ? 1 : 0,
        task.createdAt,
        task.lastRunAt,
        task.nextRunAt,
        JSON.stringify(task.allowedTools),
        task.notifyOnComplete ? 1 : 0,
      ]
    );
  });
}

/** Obtiene una tarea por ID. */
export async function getTask(id: string): Promise<ScheduledTask | null> {
  const database = await getDatabase();
  const row = await database.getFirstAsync<any>(
    "SELECT * FROM scheduled_tasks WHERE id = ?",
    [id]
  );
  return row ? rowToTask(row) : null;
}

/** Lista todas las tareas, ordenadas por próxima ejecución. */
export async function listTasks(): Promise<ScheduledTask[]> {
  const database = await getDatabase();
  const rows = await database.getAllAsync<any>(
    "SELECT * FROM scheduled_tasks ORDER BY next_run_at ASC NULLS LAST"
  );
  return rows.map(rowToTask);
}

/** Lista solo las tareas habilitadas que deben ejecutarse ahora o antes. */
export async function getDueTasks(now: number = Date.now()): Promise<ScheduledTask[]> {
  const database = await getDatabase();
  const rows = await database.getAllAsync<any>(
    `SELECT * FROM scheduled_tasks
     WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ?
     ORDER BY next_run_at ASC`,
    [now]
  );
  return rows.map(rowToTask);
}

/** Elimina una tarea y su historial de ejecuciones. */
export async function deleteTask(id: string): Promise<void> {
  await writeTransaction(async (database) => {
    await database.runAsync("DELETE FROM scheduled_task_runs WHERE task_id = ?", [id]);
    await database.runAsync("DELETE FROM scheduled_tasks WHERE id = ?", [id]);
  });
}

/** Registra el resultado de una ejecución. */
export async function recordTaskRun(result: TaskRunResult): Promise<void> {
  await writeTransaction(async (database) => {
    await database.runAsync(
      `INSERT INTO scheduled_task_runs
        (task_id, started_at, completed_at, success, summary, tools_used,
         policy_decisions, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        result.taskId,
        result.startedAt,
        result.completedAt,
        result.success ? 1 : 0,
        result.summary,
        JSON.stringify(result.toolsUsed),
        result.policyDecisions,
        result.error ?? null,
      ]
    );
  });
}

/** Historial de ejecuciones de una tarea (más recientes primero). */
export async function getTaskRuns(
  taskId: string,
  limit: number = 20
): Promise<TaskRunResult[]> {
  const database = await getDatabase();
  const rows = await database.getAllAsync<any>(
    `SELECT * FROM scheduled_task_runs
     WHERE task_id = ? ORDER BY started_at DESC LIMIT ?`,
    [taskId, limit]
  );
  return rows.map((r) => ({
    taskId: r.task_id,
    startedAt: r.started_at,
    completedAt: r.completed_at,
    success: r.success === 1,
    summary: r.summary,
    toolsUsed: safeJsonParse<string[]>(r.tools_used, []),
    policyDecisions: r.policy_decisions,
    error: r.error ?? undefined,
  }));
}

/** Actualiza lastRunAt y nextRunAt después de una ejecución. */
export async function updateTaskAfterRun(
  taskId: string,
  lastRunAt: number,
  nextRunAt: number | null
): Promise<void> {
  await writeTransaction(async (database) => {
    await database.runAsync(
      "UPDATE scheduled_tasks SET last_run_at = ?, next_run_at = ? WHERE id = ?",
      [lastRunAt, nextRunAt, taskId]
    );
  });
}

/**
 * @deprecated Usar closeDatabase() del DatabaseManager.
 * Mantenido para compatibilidad; ahora es no-op.
 */
export async function closeTaskStore(): Promise<void> {
  // El DatabaseManager centraliza el cierre. Esta función es no-op
  // para no romper callers existentes.
}
