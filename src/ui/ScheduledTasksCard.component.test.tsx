/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

// Paso 9-bis (mitad móvil de E-EST-13): la tarjeta de tareas
// programadas gana el trío de estados de las listas — durante la
// primera carga no se pinta el vacío (se pinta su palabra de
// carga), el vacío verdadero solo llega tras la primera carga
// buena, y el fallo pinta su palabra y no el vacío — y la fila de
// la tarea en ejecución se pinta como tal. La pierna del dato se
// ejerce entera: el módulo del runner NO va mockeado, la tarea
// corre de verdad con dependencias inyectadas y la tarjeta lee la
// identidad asentada por el propio runner.
import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import React from "react";
import { render, screen } from "@testing-library/react-native";
import type { ScheduledTask } from "../agent/scheduled/scheduledTasks";

const mockState = {
  tasks: [] as ScheduledTask[],
  failList: false,
  listPromise: null as Promise<ScheduledTask[]> | null,
};

jest.mock("../agent/scheduled/taskStore", () => ({
  listTasks: async () => {
    if (mockState.failList) throw new Error("almacén de tareas caído (simulado)");
    if (mockState.listPromise) return mockState.listPromise;
    return mockState.tasks;
  },
  getTaskRuns: async () => [],
  deleteTask: async () => {},
  saveTask: async () => {},
}));
jest.mock("../agent/scheduled/runScheduled", () => ({
  scheduleTaskReminder: async () => {},
}));
jest.mock("../notify/notifications", () => ({
  cancelTaskNotification: async () => {},
}));
jest.mock("./components/PrivateTextInput", () => ({
  PrivateTextInput: require("react-native").TextInput,
}));
jest.mock("./theme", () => ({
  useTheme: () => ({
    colors: {
      bg: { card: "#111", cardElevated: "#181818" },
      text: { primary: "#eee", secondary: "#bbb", inverse: "#000", muted: "#777" },
      border: { elevated: "#333" },
      emerald: { 400: "#0f0", 500: "#0d0", 600: "#0a0" },
      crimson: { 500: "#f00" },
    },
    typography: { ui: { body: {}, caption: {} } },
  }),
}));
jest.mock("./theme/surfaces", () => ({
  makeSurfaces: () => ({
    card: {},
    sectionLabel: {},
    body: {},
    inset: {},
    input: {},
    primaryButton: {},
    primaryButtonText: {},
    secondaryButton: {},
    secondaryButtonText: {},
  }),
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    i18n: { language: "es" },
  }),
}));
jest.mock("../utils/safeFormat", () => ({
  displayLang: () => "es",
  formatDateTime: () => "01/01 08:00",
}));

function task(over: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id: "t1",
    name: "Resumen",
    schedule: "0 7 * * *",
    instruction: "resume mis notas",
    enabled: true,
    createdAt: 0,
    lastRunAt: null,
    nextRunAt: null,
    allowedTools: [],
    notifyOnComplete: false,
    ...over,
  };
}

describe("ScheduledTasksCard · estados de lista (paso 9-bis)", () => {
  beforeEach(() => {
    mockState.tasks = [];
    mockState.failList = false;
    mockState.listPromise = null;
    const { __resetRunnerForTests } = require("../agent/scheduled/runner");
    __resetRunnerForTests();
  });

  it("durante la primera carga no pinta el vacío: pinta su palabra de carga", async () => {
    let resolveList: (tasks: ScheduledTask[]) => void = () => {};
    mockState.listPromise = new Promise((res) => {
      resolveList = res;
    });
    const { ScheduledTasksCard } = require("./ScheduledTasksCard");
    await render(<ScheduledTasksCard />);
    expect(screen.getByText("scheduledTasks.loading")).toBeTruthy();
    expect(screen.queryByText("scheduledTasks.empty")).toBeNull();
    resolveList([]);
    expect(await screen.findByText("scheduledTasks.empty")).toBeTruthy();
  });

  it("el vacío verdadero se pinta tras la primera carga buena, ya sin la palabra de carga", async () => {
    const { ScheduledTasksCard } = require("./ScheduledTasksCard");
    await render(<ScheduledTasksCard />);
    expect(await screen.findByText("scheduledTasks.empty")).toBeTruthy();
    expect(screen.queryByText("scheduledTasks.loading")).toBeNull();
  });

  it("el fallo de la carga pinta su palabra y no el vacío", async () => {
    mockState.failList = true;
    const { ScheduledTasksCard } = require("./ScheduledTasksCard");
    await render(<ScheduledTasksCard />);
    expect(await screen.findByText("scheduledTasks.loadFailed")).toBeTruthy();
    expect(screen.queryByText("scheduledTasks.empty")).toBeNull();
  });

  it("la tarea en ejecución se pinta como tal en su fila, y solo en la suya", async () => {
    const running = task({ id: "t-run", name: "En curso" });
    const idle = task({ id: "t-idle", name: "En espera" });
    mockState.tasks = [running, idle];
    const { runDueTasks, currentRunningTaskId, __resetRunnerForTests } = require("../agent/scheduled/runner");
    let release: () => void = () => {};
    const gate = new Promise<void>((res) => {
      release = res;
    });
    const run = runDueTasks({
      getDueTasks: async () => [running],
      recordTaskRun: async () => {},
      updateTaskAfterRun: async () => {},
      runInstruction: async () => {
        await gate;
        return { response: "listo", toolsUsed: [] };
      },
      allHandlers: {},
      now: () => new Date(2026, 9, 10, 8, 0, 0).getTime(),
    });
    // La identidad de la tarea en curso queda asentada por el
    // runner antes de que la tarjeta pinte: eso es lo que se lee.
    for (let i = 0; i < 50 && currentRunningTaskId() !== "t-run"; i++) {
      await new Promise((r) => setTimeout(r, 0));
    }
    expect(currentRunningTaskId()).toBe("t-run");
    const { ScheduledTasksCard } = require("./ScheduledTasksCard");
    await render(<ScheduledTasksCard />);
    expect(await screen.findByText("scheduledTasks.running")).toBeTruthy();
    expect(screen.getAllByText("scheduledTasks.running")).toHaveLength(1);
    release();
    await run;
    __resetRunnerForTests();
  });
});
