/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../security/databaseManager", () => ({
  getDatabase: vi.fn(),
  writeTransaction: vi.fn(),
}));

import { actionLog, setActionLogSink, type ActionLogEntry } from "./actionLog";
import { canUndo, undoActionWith, type StoredAction, type UndoDeps } from "./actionLogStore";

afterEach(() => {
  setActionLogSink(null);
  actionLog.clear();
});

function stored(over: Partial<StoredAction> = {}): StoredAction {
  return {
    id: 7,
    ts: "2026-10-10T00:00:00.000Z",
    tool: "save_note",
    outcome: "executed",
    confirmed: false,
    undone: false,
    undo: { kind: "note", id: "n1" },
    ...over,
  };
}

function deps(): UndoDeps {
  return {
    deleteNote: vi.fn(async () => {}),
    deleteReminder: vi.fn(async () => {}),
    cancelReminderNotification: vi.fn(async () => {}),
    markUndone: vi.fn(async () => {}),
  };
}

describe("action log undo", () => {
  it("a handler's created id is attached to the next executed entry of that tool only", () => {
    actionLog.noteUndo("save_note", { kind: "note", id: "n1" });
    actionLog.record("device_time", "executed");
    actionLog.record("save_note", "executed");
    actionLog.record("save_note", "executed");
    const [third, second, first] = actionLog.list();
    expect(first.undo).toBeUndefined();
    expect(second.undo).toEqual({ kind: "note", id: "n1" });
    expect(third.undo).toBeUndefined();
  });

  it("a failed or cancelled action never carries an undo reference", () => {
    actionLog.noteUndo("save_note", { kind: "note", id: "n1" });
    actionLog.record("save_note", "failed");
    actionLog.record("save_note", "executed");
    expect(actionLog.list().every((e) => e.undo === undefined)).toBe(true);
  });

  it("the sink receives each entry and a throwing sink does not break recording", () => {
    const seen: ActionLogEntry[] = [];
    setActionLogSink((e) => {
      seen.push(e);
      throw new Error("db down");
    });
    actionLog.record("device_time", "executed");
    expect(seen).toHaveLength(1);
    expect(actionLog.list()).toHaveLength(1);
  });

  it("only executed, not-yet-undone entries with a reference can be undone", () => {
    expect(canUndo(stored())).toBe(true);
    expect(canUndo(stored({ undone: true }))).toBe(false);
    expect(canUndo(stored({ outcome: "cancelled" }))).toBe(false);
    expect(canUndo(stored({ undo: undefined }))).toBe(false);
  });

  it("undoing a note deletes that note and marks the entry", async () => {
    const d = deps();
    expect(await undoActionWith(stored(), d)).toBe(true);
    expect(d.deleteNote).toHaveBeenCalledWith("n1");
    expect(d.deleteReminder).not.toHaveBeenCalled();
    expect(d.markUndone).toHaveBeenCalledWith(7);
  });

  it("undoing a reminder cancels its notification before deleting it", async () => {
    const d = deps();
    const order: string[] = [];
    (d.cancelReminderNotification as any).mockImplementation(async () => void order.push("cancel"));
    (d.deleteReminder as any).mockImplementation(async () => void order.push("delete"));
    await undoActionWith(stored({ tool: "create_reminder", undo: { kind: "reminder", id: "r1" } }), d);
    expect(order).toEqual(["cancel", "delete"]);
    expect(d.deleteNote).not.toHaveBeenCalled();
  });

  it("an entry that cannot be undone touches nothing", async () => {
    const d = deps();
    expect(await undoActionWith(stored({ undone: true }), d)).toBe(false);
    expect(d.deleteNote).not.toHaveBeenCalled();
    expect(d.markUndone).not.toHaveBeenCalled();
  });

  it("if deleting fails the entry is not marked as undone", async () => {
    const d = deps();
    (d.deleteNote as any).mockRejectedValue(new Error("db"));
    await expect(undoActionWith(stored(), d)).rejects.toThrow("db");
    expect(d.markUndone).not.toHaveBeenCalled();
  });
});
