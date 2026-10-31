/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * 2026-10-30 (prueba física del dueño, Tab A9+): la respuesta que quedaba
 * a medias al morir el proceso en segundo plano no dejaba ni el texto
 * parcial ni el aviso — la fila del asistente solo se persistía al
 * terminar, y solo si tenía texto. El ciclo de vida nuevo de la fila:
 * nace marcada (addAssistantDraft), puede guardar el parcial sin perder
 * la marca (updateAssistantDraft), termina sin marca
 * (finishAssistantMessage) o desaparece (deleteMessage). La base real es
 * expo-sqlite (nativo, fuera de vitest): aquí se sustituye ../rag/db por
 * un registro de las sentencias emitidas y filas prefabricadas para
 * getMessages, y se comprueba el SQL y el mapeo, no el motor.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const dbx = vi.hoisted(() => {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const selectRows: Array<Record<string, unknown>> = [];
  return { calls, selectRows };
});

vi.mock("../rag/db", () => ({
  writeTransaction: async (fn: (txn: { runAsync: (sql: string, params?: unknown[]) => Promise<void> }) => Promise<void>) => {
    await fn({
      runAsync: async (sql: string, params: unknown[] = []) => {
        dbx.calls.push({ sql, params });
      },
    });
  },
  getDb: async () => ({
    getAllAsync: async () => dbx.selectRows,
  }),
}));

import {
  addAssistantDraft,
  updateAssistantDraft,
  finishAssistantMessage,
  deleteMessage,
  getMessages,
} from "./chatHistory";

beforeEach(() => {
  dbx.calls.length = 0;
  dbx.selectRows.length = 0;
});

describe("ciclo de vida de la respuesta interrumpida", () => {
  it("la fila nace vacía, como asistente y marcada", async () => {
    await addAssistantDraft("s1", "m1");
    const insert = dbx.calls.find((c) => c.sql.includes("INSERT INTO chat_messages"));
    expect(insert).toBeDefined();
    expect(insert!.sql).toContain("'assistant'");
    expect(insert!.sql).toContain("interrupted");
    expect(insert!.params).toEqual(["m1", "s1", expect.any(Number)]);
  });

  it("el parcial se guarda sin quitar la marca", async () => {
    await updateAssistantDraft("m1", "Había una vez un zorro…");
    const upd = dbx.calls.find((c) => c.sql.includes("UPDATE chat_messages"));
    expect(upd).toBeDefined();
    expect(upd!.sql).toContain("SET text = ?");
    expect(upd!.sql).not.toContain("interrupted");
    expect(upd!.params).toEqual(["Había una vez un zorro…", "m1"]);
  });

  it("al terminar, el texto final entra y la marca se quita (upsert)", async () => {
    await finishAssistantMessage("s1", "m1", "Había una vez un zorro que vivía en un faro.");
    const up = dbx.calls.find((c) => c.sql.includes("INSERT INTO chat_messages"));
    expect(up).toBeDefined();
    expect(up!.sql).toContain("ON CONFLICT(id) DO UPDATE");
    expect(up!.sql).toContain("interrupted = 0");
    expect(up!.params).toEqual(["m1", "s1", "Había una vez un zorro que vivía en un faro.", expect.any(Number)]);
  });

  it("sin respuesta que guardar, la fila borrador se borra", async () => {
    await deleteMessage("m1");
    const del = dbx.calls.find((c) => c.sql.includes("DELETE FROM chat_messages"));
    expect(del).toBeDefined();
    expect(del!.params).toEqual(["m1"]);
  });

  it("getMessages expone la marca como booleano", async () => {
    dbx.selectRows.push(
      { id: "m1", session_id: "s1", role: "assistant", text: "", created_at: 1, rating: null, interrupted: 1 },
      { id: "m2", session_id: "s1", role: "assistant", text: "Respuesta completa.", created_at: 2, rating: "up", interrupted: 0 },
    );
    const msgs = await getMessages("s1");
    expect(msgs).toHaveLength(2);
    expect(msgs[0].interrupted).toBe(true);
    expect(msgs[1].interrupted).toBe(false);
    expect(msgs[1].feedback).toBe("up");
  });
});
