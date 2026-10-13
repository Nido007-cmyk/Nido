/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * scheduledComposition.test.ts — 0.1.24 (auditoría de alcanzabilidad,
 * H-9/H-10): la composición REAL de las tareas programadas.
 *
 * Hasta hoy la familia solo tenía tests de pieza (runner con
 * runInstruction inyectada a mano, validación, cron): nadie corría
 * runScheduledTasksNow → runDueTasks → handlersForTask →
 * runAgentLoop(restrictFastPathsToHandlers) con las herramientas de
 * una tarea por defecto. La auditoría encontró así dos degradaciones
 * silenciosas: «busca en mis notas» respondía «no hay notas»
 * habiéndolas (runInstruction no pasaba los proveedores de notas al
 * loop) y el portugués colapsaba a español en el llamador.
 *
 * Aquí el store, los handlers y las notificaciones son dobles en
 * memoria; el runner, el programador y el loop son los reales.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { DEFAULT_TASK_TOOLS, type ScheduledTask } from "./scheduledTasks";

const NOTES = [
  { id: "n1", title: "cumpleaños de Ana", body: "ideas para el cumpleaños de Ana: flores y pastel" },
  { id: "n2", title: "compras", body: "leche, pan y huevos" },
];

const state = vi.hoisted(() => ({
  due: [] as ScheduledTask[],
  deleted: [] as string[],
  notified: [] as string[],
}));

vi.mock("../memory/memoryStore", () => ({
  snapshot: vi.fn(async () => ({ facts: [], preferences: [], people: [], recentLog: [] })),
  listNotes: vi.fn(async () => NOTES.map((n) => ({ ...n }))),
  listReminders: vi.fn(async () => []),
  saveFact: vi.fn(async (f: unknown) => f),
  savePerson: vi.fn(async (p: unknown) => p),
  saveReminder: vi.fn(async (r: { text: string }) => ({ id: "r1", ...r })),
}));

vi.mock("./taskStore", () => ({
  getDueTasks: vi.fn(async () => state.due),
  recordTaskRun: vi.fn(async () => {}),
  updateTaskAfterRun: vi.fn(async () => {}),
}));

vi.mock("../tools/handlers", () => ({
  buildToolHandlers: vi.fn(() => ({
    device_time: async () => "martes, 13 de octubre de 2026, 9:00",
    list_notes: async () => NOTES.map((n) => `• ${n.title}`).join("\n"),
    read_note: async (args: Record<string, unknown>) =>
      NOTES.find((n) => n.id === args.id)?.body ?? "Nota no encontrada",
    list_calendar_events: async () => "No hay eventos.",
    nido_read_inbox: async () => "Sin mensajes nuevos.",
    calculate: async () => "42",
    convert_units: async () => "ok",
    save_note: async () => "Nota guardada.",
    delete_note: async (args: Record<string, unknown>) => {
      state.deleted.push(String(args.id));
      return "Nota borrada.";
    },
  })),
}));

vi.mock("../../notify/notifications", () => ({
  notifyNow: vi.fn(async (title: string) => {
    state.notified.push(title);
  }),
  scheduleTaskNotification: vi.fn(async () => {}),
  scheduleReminderNotification: vi.fn(async () => {}),
}));

import { runScheduledTasksNow } from "./runScheduled";
import type { AgentEngine } from "../loop/agentLoop";

function fakeEngine(): AgentEngine & { calls: number } {
  const engine = {
    calls: 0,
    generate: vi.fn(async () => {
      engine.calls += 1;
      return "RESPUESTA DEL MODELO";
    }),
  };
  return engine as AgentEngine & { calls: number };
}

const strings = {
  doneTitle: (name: string) => `Hecho: ${name}`,
  failedTitle: (name: string) => `Falló: ${name}`,
  failedBody: "La tarea no se pudo completar.",
  dueTitle: (name: string) => `Tarea: ${name}`,
  dueBody: "Es hora de tu tarea programada.",
};

function dueTask(instruction: string, allowedTools: readonly string[] = DEFAULT_TASK_TOOLS): ScheduledTask {
  return {
    id: "t1",
    name: "Tarea de prueba",
    schedule: "0 9 * * *",
    instruction,
    enabled: true,
    createdAt: 0,
    lastRunAt: null,
    nextRunAt: 0,
    allowedTools: [...allowedTools],
    notifyOnComplete: true,
  };
}

beforeEach(() => {
  state.due = [];
  state.deleted = [];
  state.notified = [];
  vi.clearAllMocks();
});

describe("composición de tareas programadas (runScheduledTasksNow real)", () => {
  it("«busca flores en mis notas» encuentra la nota (antes: «no hay notas» falso)", async () => {
    state.due = [dueTask("busca flores en mis notas")];
    const engine = fakeEngine();
    const results = await runScheduledTasksNow({ engine, lang: "es", strings });
    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(true);
    expect(results[0].summary).toContain("cumpleaños de Ana");
    expect(results[0].summary).not.toContain("No hay notas");
    expect(results[0].toolsUsed).toContain("list_notes");
    expect(engine.calls).toBe(0);
  });

  it("«lee la nota del cumpleaños» devuelve el cuerpo de la nota", async () => {
    state.due = [dueTask("lee la nota del cumpleaños")];
    const results = await runScheduledTasksNow({ engine: fakeEngine(), lang: "es", strings });
    expect(results[0].success).toBe(true);
    expect(results[0].summary).toContain("flores y pastel");
    expect(results[0].toolsUsed).toContain("read_note");
  });

  it("PT: la tarea responde en portugués con lang «pt»", async () => {
    state.due = [dueTask("procura flores nas minhas notas")];
    const results = await runScheduledTasksNow({ engine: fakeEngine(), lang: "pt", strings });
    expect(results[0].success).toBe(true);
    expect(results[0].summary).toContain("cumpleaños de Ana");
    expect(results[0].summary).toContain("encontrei nas suas notas");
  });

  it("una herramienta fuera de la lista de la tarea no se ejecuta", async () => {
    // La tarea solo permite device_time: «busca en mis notas» no
    // puede usar el atajo de notas aunque los proveedores existan.
    // El turno cae a la ruta del modelo y, como este no emite ninguna
    // llamada válida, el guard anti-alucinación del loop responde el
    // fallback honesto — nunca la búsqueda prohibida.
    state.due = [dueTask("busca flores en mis notas", ["device_time"])];
    const engine = fakeEngine();
    const results = await runScheduledTasksNow({ engine, lang: "es", strings });
    expect(results[0].success).toBe(true);
    expect(results[0].summary).toContain("No supe qué acción");
    expect(results[0].summary).not.toContain("cumpleaños de Ana");
    expect(results[0].toolsUsed).not.toContain("list_notes");
  });

  it("el borrado sigue siendo imposible sin nadie delante, ni pidiéndolo la tarea", async () => {
    // Ni siquiera con delete_note en allowedTools (una tarea así no
    // pasaría validateTask, pero el runner filtra igualmente):
    // handlersForTask lo excluye por UNATTENDED_FORBIDDEN_TOOLS.
    state.due = [dueTask("borra la nota de flores", [...DEFAULT_TASK_TOOLS, "delete_note"])];
    const engine = fakeEngine();
    const results = await runScheduledTasksNow({ engine, lang: "es", strings });
    expect(state.deleted).toEqual([]);
    expect(results[0].toolsUsed).not.toContain("delete_note");
  });
});
