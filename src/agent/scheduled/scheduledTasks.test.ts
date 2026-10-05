/**
 * Tests for Scheduled Tasks (DR-3)
 */

import { describe, it, expect } from "vitest";
import {
  getNextRunTime,
  validateTask,
  createTask,
} from "./scheduledTasks";

describe("getNextRunTime", () => {
  it("parses daily schedule", () => {
    // 7am daily
    const from = new Date("2026-10-05T06:00:00").getTime();
    const next = getNextRunTime("0 7 * * *", from);
    expect(next).not.toBeNull();
    const d = new Date(next!);
    expect(d.getHours()).toBe(7);
    expect(d.getMinutes()).toBe(0);
    // Should be today at 7am (since it's 6am now)
    expect(d.getDate()).toBe(5);
  });

  it("rolls to next day if time passed", () => {
    // 7am daily, but it's already 8am
    const from = new Date("2026-10-05T08:00:00").getTime();
    const next = getNextRunTime("0 7 * * *", from);
    const d = new Date(next!);
    expect(d.getDate()).toBe(6); // Tomorrow
    expect(d.getHours()).toBe(7);
  });

  it("returns null for invalid format", () => {
    expect(getNextRunTime("invalid")).toBeNull();
    expect(getNextRunTime("0 7 *")).toBeNull();
  });
});

describe("validateTask", () => {
  it("accepts valid task", () => {
    const result = validateTask({
      name: "Morning briefing",
      schedule: "0 7 * * *",
      instruction: "Check my calendar and brief me on today's schedule.",
      enabled: true,
      allowedTools: ["calendar_read", "memory_read"],
      notifyOnComplete: true,
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects missing name", () => {
    const result = validateTask({
      name: "",
      schedule: "0 7 * * *",
      instruction: "Do something",
      enabled: true,
      allowedTools: ["calendar_read"],
      notifyOnComplete: true,
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Task name is required");
  });

  it("rejects invalid schedule", () => {
    const result = validateTask({
      name: "Test",
      schedule: "not a cron",
      instruction: "Do something",
      enabled: true,
      allowedTools: ["calendar_read"],
      notifyOnComplete: true,
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("Invalid schedule format");
  });

  it("blocks dangerous tools in scheduled tasks", () => {
    const result = validateTask({
      name: "Test",
      schedule: "0 7 * * *",
      instruction: "Do something",
      enabled: true,
      allowedTools: ["calendar_read", "send_sms"],
      notifyOnComplete: true,
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("irreversible tools");
    expect(result.errors[0]).toContain("send_sms");
  });

  it("requires at least one tool", () => {
    const result = validateTask({
      name: "Test",
      schedule: "0 7 * * *",
      instruction: "Do something",
      enabled: true,
      allowedTools: [],
      notifyOnComplete: true,
    });
    expect(result.valid).toBe(false);
  });
});

describe("createTask", () => {
  it("creates task with ID and timestamps", () => {
    const { task, errors } = createTask({
      name: "Morning briefing",
      schedule: "0 7 * * *",
      instruction: "Brief me",
      enabled: true,
      allowedTools: ["calendar_read"],
      notifyOnComplete: true,
    });
    expect(errors).toEqual([]);
    expect(task).not.toBeNull();
    expect(task!.id).toMatch(/^task_/);
    expect(task!.createdAt).toBeGreaterThan(0);
    expect(task!.lastRunAt).toBeNull();
    expect(task!.nextRunAt).not.toBeNull();
  });

  it("returns null for invalid config", () => {
    const { task, errors } = createTask({
      name: "",
      schedule: "0 7 * * *",
      instruction: "Brief me",
      enabled: true,
      allowedTools: ["calendar_read"],
      notifyOnComplete: true,
    });
    expect(task).toBeNull();
    expect(errors.length).toBeGreaterThan(0);
  });

  it("sets nextRunAt to null when disabled", () => {
    const { task } = createTask({
      name: "Test",
      schedule: "0 7 * * *",
      instruction: "Do something",
      enabled: false,
      allowedTools: ["calendar_read"],
      notifyOnComplete: true,
    });
    expect(task!.nextRunAt).toBeNull();
  });
});
