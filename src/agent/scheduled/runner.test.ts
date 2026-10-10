/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runDueTasks, handlersForTask, __resetRunnerForTests, type RunnerDeps } from "./runner";
import {
  getNextRunTime,
  parseWeekdays,
  buildSchedule,
  describeSchedule,
  createTask,
  type ScheduledTask,
} from "./scheduledTasks";

function task(over: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id: "t1",
    name: "Resumen",
    schedule: "0 7 * * *",
    instruction: "resume mis notas",
    enabled: true,
    createdAt: 0,
    lastRunAt: null,
    nextRunAt: 1,
    allowedTools: ["list_notes", "nido_send_message", "no_existe"],
    notifyOnComplete: true,
    ...over,
  };
}

function deps(over: Partial<RunnerDeps> = {}): RunnerDeps {
  return {
    getDueTasks: vi.fn(async () => [task()]),
    recordTaskRun: vi.fn(async () => {}),
    updateTaskAfterRun: vi.fn(async () => {}),
    runInstruction: vi.fn(async () => ({ response: "listo", toolsUsed: ["list_notes"] })),
    allHandlers: {
      list_notes: async () => "notas",
      nido_send_message: async () => "enviado",
      save_note: async () => "guardada",
    },
    notify: vi.fn(async () => {}),
    scheduleNext: vi.fn(async () => {}),
    now: () => new Date(2026, 9, 10, 8, 0, 0).getTime(),
    ...over,
  };
}

beforeEach(() => __resetRunnerForTests());

describe("scheduled task runner", () => {
  it("gives the task only its allowed tools and never the forbidden ones", () => {
    const h = handlersForTask(task(), deps().allHandlers);
    expect(Object.keys(h)).toEqual(["list_notes"]);
  });

  it("runs a due task, records it and schedules the next day", async () => {
    const d = deps();
    const results = await runDueTasks(d);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ taskId: "t1", success: true, summary: "listo" });
    const [instruction, handlers] = (d.runInstruction as any).mock.calls[0];
    expect(instruction).toBe("resume mis notas");
    expect(Object.keys(handlers)).toEqual(["list_notes"]);
    expect(d.recordTaskRun).toHaveBeenCalledTimes(1);
    const [, lastRunAt, nextRunAt] = (d.updateTaskAfterRun as any).mock.calls[0];
    expect(nextRunAt).toBe(new Date(2026, 9, 11, 7, 0, 0).getTime());
    expect(nextRunAt).toBeGreaterThan(lastRunAt);
    expect(d.notify).toHaveBeenCalledTimes(1);
    expect(d.scheduleNext).toHaveBeenCalledTimes(1);
  });

  it("a failing task is recorded as failed, still advances, and does not stop the others", async () => {
    const d = deps({
      getDueTasks: vi.fn(async () => [task({ id: "a" }), task({ id: "b" })]),
      runInstruction: vi
        .fn()
        .mockRejectedValueOnce(new Error("modelo no cargado"))
        .mockResolvedValueOnce({ response: "ok", toolsUsed: [] }),
    });
    const results = await runDueTasks(d);
    expect(results.map((r) => r.success)).toEqual([false, true]);
    expect(results[0].error).toBe("modelo no cargado");
    expect(d.updateTaskAfterRun).toHaveBeenCalledTimes(2);
  });

  it("does not notify when the task opted out", async () => {
    const d = deps({ getDueTasks: vi.fn(async () => [task({ notifyOnComplete: false })]) });
    await runDueTasks(d);
    expect(d.notify).not.toHaveBeenCalled();
  });

  it("never runs two passes at once", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const d = deps({
      runInstruction: vi.fn(async () => {
        await gate;
        return { response: "ok", toolsUsed: [] };
      }),
    });
    const first = runDueTasks(d);
    await Promise.resolve();
    await Promise.resolve();
    expect(await runDueTasks(d)).toEqual([]);
    release();
    expect(await first).toHaveLength(1);
  });

  it("a storage failure while recording history does not make the task repeat", async () => {
    const d = deps({ recordTaskRun: vi.fn(async () => { throw new Error("db"); }) });
    await runDueTasks(d);
    expect(d.updateTaskAfterRun).toHaveBeenCalledTimes(1);
  });
});

describe("schedules", () => {
  const sat = new Date(2026, 9, 10, 8, 0, 0).getTime(); // sábado

  it("weekday lists and ranges", () => {
    expect([...parseWeekdays("1-5")!]).toEqual([1, 2, 3, 4, 5]);
    expect([...parseWeekdays("0,7")!]).toEqual([0]);
    expect(parseWeekdays("8")).toBeNull();
    expect(parseWeekdays("5-1")).toBeNull();
    expect(parseWeekdays("x")).toBeNull();
  });

  it("weekdays-only schedule skips the weekend", () => {
    const next = new Date(getNextRunTime("30 18 * * 1-5", sat)!);
    expect(next.getDay()).toBe(1);
    expect(next.getHours()).toBe(18);
    expect(next.getMinutes()).toBe(30);
  });

  it("rejects impossible times and unsupported fields", () => {
    expect(getNextRunTime("60 7 * * *")).toBeNull();
    expect(getNextRunTime("0 24 * * *")).toBeNull();
    expect(getNextRunTime("0 7 1 * *")).toBeNull();
    expect(getNextRunTime("*/5 * * * *")).toBeNull();
  });

  it("buildSchedule and describeSchedule round-trip", () => {
    expect(buildSchedule(7, 5)).toBe("5 7 * * *");
    expect(buildSchedule(7, 5, [5, 1, 1])).toBe("5 7 * * 1,5");
    expect(buildSchedule(7, 5, [0, 1, 2, 3, 4, 5, 6])).toBe("5 7 * * *");
    expect(describeSchedule("5 7 * * 1,5")).toEqual({ hour: 7, minute: 5, weekdays: [1, 5] });
    expect(describeSchedule("nope")).toBeNull();
  });

  it("a task cannot be created with a tool that needs a person present", () => {
    for (const tool of ["open_app", "create_calendar_event", "read_picked_file", "nido_send_message"]) {
      const { task: t, errors } = createTask({
        name: "x",
        schedule: "0 7 * * *",
        instruction: "y",
        enabled: true,
        allowedTools: [tool],
        notifyOnComplete: true,
      });
      expect(t).toBeNull();
      expect(errors.join(" ")).toContain(tool);
    }
  });
});
