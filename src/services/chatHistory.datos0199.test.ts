/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Tanda T-03 de la 0.1.99 (auditoría de la app 2026-11-14, carril 06,
 * asiento P-29): borrar una sesión de chat no forzaba checkpoint del
 * WAL tras el DELETE, y el contenido borrado podía permanecer en el
 * `-wal` hasta el próximo cierre limpio. La vía de expiración P2P sí
 * lo hace (store.ts, checkpointAfterDelete). Simetría: tras borrar
 * sesiones (una o todas), checkpoint TRUNCATE best-effort sobre la
 * base de conocimiento.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const W = vi.hoisted(() => ({
  execSql: [] as string[],
  runSql: [] as string[],
  checkpointFails: false,
}));

vi.mock("../rag/db", () => ({
  getDb: async () => ({
    execAsync: async (sql: string) => {
      W.execSql.push(sql);
      if (W.checkpointFails && sql.includes("wal_checkpoint")) throw new Error("checkpoint boom");
    },
    getAllAsync: async () => [],
    getFirstAsync: async () => null,
    runAsync: async () => ({ lastInsertRowId: 0, changes: 0 }),
    closeAsync: async () => {},
    withTransactionAsync: async (task: () => Promise<void>) => task(),
  }),
  writeTransaction: async (work: (txn: unknown) => Promise<void>) => {
    await work({
      runAsync: async (sql: string) => {
        W.runSql.push(sql);
        return { lastInsertRowId: 0, changes: 1 };
      },
      getAllAsync: async () => [],
      getFirstAsync: async () => null,
      execAsync: async () => {},
    });
  },
}));

vi.mock("../p2p/crypto", () => ({
  randomNonce: (n: number) => new Uint8Array(n).fill(7),
  toHex: (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join(""),
}));

import { deleteSession, clearAllHistory } from "./chatHistory";

beforeEach(() => {
  W.execSql.length = 0;
  W.runSql.length = 0;
  W.checkpointFails = false;
});

describe("P-29: tras borrar un chat, el WAL se vuelca y se trunca", () => {
  it("deleteSession borra y después fuerza wal_checkpoint(TRUNCATE)", async () => {
    await deleteSession("sesion-1");
    expect(W.runSql.some((s) => s.includes("DELETE FROM chat_messages"))).toBe(true);
    expect(W.execSql).toContain("PRAGMA wal_checkpoint(TRUNCATE);");
  });

  it("clearAllHistory también fuerza el checkpoint tras el borrado total", async () => {
    await clearAllHistory();
    expect(W.runSql.some((s) => s.includes("DELETE FROM chat_sessions"))).toBe(true);
    expect(W.execSql).toContain("PRAGMA wal_checkpoint(TRUNCATE);");
  });

  it("si el checkpoint falla, el borrado no se cae (best-effort, como la vía P2P)", async () => {
    W.checkpointFails = true;
    await expect(deleteSession("sesion-1")).resolves.toBeUndefined();
  });
});
