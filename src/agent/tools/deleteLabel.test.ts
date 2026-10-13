/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * 0.1.29 (auditoría 2026-10-13): un borrado solo ocurre si lo que el
 * usuario vio en la confirmación (title/text de los args) es lo guardado.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  (globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;
  return {
    notes: new Map<string, { id: string; title: string; body: string }>(),
    reminders: new Map<string, { id: string; text: string; due_at: string | null }>(),
    cancelled: [] as string[],
  };
});

vi.mock("expo-calendar", () => ({}));
vi.mock("expo-contacts", () => ({}));
vi.mock("expo-document-picker", () => ({}));
vi.mock("expo-file-system", () => ({ File: class {} }));
vi.mock("expo-sqlite", () => ({}));
vi.mock("react-native", () => ({ Linking: { openURL: vi.fn() }, Platform: { OS: "android" } }));
vi.mock("../../notify/notifications", () => ({
  cancelReminderNotification: async (id: string) => {
    state.cancelled.push(id);
  },
}));
vi.mock("../memory/memoryStore", () => ({
  saveNote: vi.fn(),
  listNotes: async () => [...state.notes.values()],
  getNote: async (id: string) => state.notes.get(id) ?? null,
  deleteNote: async (id: string) => {
    state.notes.delete(id);
  },
  saveReminder: vi.fn(),
  listReminders: async () => [...state.reminders.values()],
  deleteReminder: async (id: string) => {
    state.reminders.delete(id);
  },
  saveFact: vi.fn(),
  savePerson: vi.fn(),
  snapshot: async () => null,
}));

import { buildToolHandlers } from "./handlers";

beforeEach(() => {
  state.notes.clear();
  state.reminders.clear();
  state.cancelled.length = 0;
  state.notes.set("n1", { id: "n1", title: "Claves del banco", body: "…" });
  state.reminders.set("r1", { id: "r1", text: "Pagar la renta", due_at: null });
});

describe("delete_note / delete_reminder — la etiqueta confirmada debe ser la guardada", () => {
  const h = () => buildToolHandlers() as Record<string, (a: Record<string, unknown>) => Promise<string>>;

  it("borra cuando el título coincide (ruta del router)", async () => {
    await expect(h().delete_note({ id: "n1", title: "Claves del banco" })).resolves.toContain("Claves del banco");
    expect(state.notes.has("n1")).toBe(false);
  });

  it("título falso: no borra nada", async () => {
    await expect(h().delete_note({ id: "n1", title: "nota vieja de prueba" })).rejects.toThrow(/no se borró nada/);
    expect(state.notes.has("n1")).toBe(true);
  });

  it("sin título: no borra a ciegas", async () => {
    await expect(h().delete_note({ id: "n1" })).rejects.toThrow(/no se borró nada/);
    expect(state.notes.has("n1")).toBe(true);
  });

  it("mayúsculas y espacios no cuentan como diferencia", async () => {
    await h().delete_note({ id: "n1", title: "  claves   DEL banco " });
    expect(state.notes.has("n1")).toBe(false);
  });

  it("recordatorio: texto falso no borra ni cancela el aviso", async () => {
    await expect(h().delete_reminder({ id: "r1", text: "algo sin importancia" })).rejects.toThrow(/no se borró nada/);
    expect(state.reminders.has("r1")).toBe(true);
    expect(state.cancelled).toEqual([]);
  });

  it("recordatorio: texto correcto borra y cancela el aviso", async () => {
    await h().delete_reminder({ id: "r1", text: "Pagar la renta" });
    expect(state.reminders.has("r1")).toBe(false);
    expect(state.cancelled).toEqual(["r1"]);
  });
});
