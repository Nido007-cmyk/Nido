/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createMemorySecureBackend,
  setTestSecureBackend,
} from "../privacy/keyManager";

// Base en memoria que imita el subconjunto de expo-sqlite que usa p2p/store.ts.
const mem = vi.hoisted(() => ({
  contacts: [] as Array<{ pk_hex: string; name: string; verified: number; sig_pk: string | null }>,
  messages: [] as Array<{
    id: string; dir: string; peer_pk: string; type: string; text: string; status: string; ts: number;
  }>,
}));

vi.mock("../agent/memory/memoryStore", () => {
  const db = {
    execAsync: async (_sql: string) => undefined,
    getFirstAsync: async (sql: string, params: any[] = []) => {
      if (sql.includes("FROM p2p_messages")) {
        return mem.messages.find((m) => m.id === params[0]) ?? null;
      }
      if (sql.includes("FROM p2p_contacts") && sql.includes("pk_hex =")) {
        return mem.contacts.find((c) => c.pk_hex === params[0]) ?? null;
      }
      return null;
    },
    getAllAsync: async (sql: string) => {
      if (sql.includes("FROM p2p_messages") && sql.includes("type='agent_task'")) {
        return mem.messages
          .filter((m) => m.dir === "in" && m.type === "agent_task" && m.status === "queued")
          .sort((a, b) => a.ts - b.ts);
      }
      if (sql.includes("FROM p2p_contacts")) return [...mem.contacts];
      return [];
    },
    runAsync: async (sql: string, params: any[] = []) => {
      if (sql.includes("INTO p2p_messages")) {
        const [id, dir, peer_pk, type, text, status, ts] = params as Array<string | number>;
        if (!mem.messages.some((m) => m.id === id)) {
          mem.messages.push({ id, dir, peer_pk, type, text, status, ts } as (typeof mem.messages)[number]);
        }
        return { lastInsertRowId: 0, changes: 1 };
      }
      if (sql.includes("INTO p2p_contacts")) {
        const [pk, name, sig] = params as Array<string | null>;
        mem.contacts.push({ pk_hex: pk as string, name: name as string, verified: 1, sig_pk: sig ?? null });
        return { lastInsertRowId: 0, changes: 1 };
      }
      if (sql.startsWith("UPDATE p2p_messages SET status=")) {
        const [status, id] = params as string[];
        const m = mem.messages.find(
          (x) => x.id === id && x.dir === "in" && x.type === "agent_task" && x.status === "queued",
        );
        if (m) {
          m.status = status;
          return { lastInsertRowId: 0, changes: 1 };
        }
        return { lastInsertRowId: 0, changes: 0 };
      }
      return { lastInsertRowId: 0, changes: 0 };
    },
  };
  // R6: p2p/store.ts usa además el epoch guard y writeMemoryTransaction.
  // El mock mantiene la semántica "base en memoria inmediata": epoch fijo
  // y la transacción ejecuta el trabajo sobre la db simulada.
  return {
    getMemoryDb: async () => db,
    getMemoryDbEpoch: () => 0,
    writeMemoryTransaction: async (work: (d: typeof db) => Promise<void>) => {
      await work(db);
    },
  };
});

import { saveContact, saveMessage } from "./store";
import {
  approveAgentTask,
  getPendingAgentTask,
  listPendingAgentTasks,
  pendingAgentTaskCount,
  rejectAgentTask,
} from "./approvalInbox";

const PEER = "ab".repeat(32);

async function seedTask(id: string, peerPk = PEER, status = "queued") {
  await saveMessage({
    id,
    dir: "in",
    peerPk,
    type: "agent_task",
    text: "[Tarea de su NIDO · test] haz algo",
    status,
    ts: 1000,
  });
}

beforeEach(() => {
  mem.contacts = [];
  mem.messages = [];
  setTestSecureBackend(createMemorySecureBackend());
});

describe("M-6: bandeja de aprobación (store)", () => {
  it("M-6: la tarea pendiente muestra identidad del remitente, acción y contexto", async () => {
    await saveContact(PEER, "Beto");
    await seedTask("task-1");
    const pending = await listPendingAgentTasks();
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe("task-1");
    expect(pending[0].senderName).toBe("Beto");
    expect(pending[0].senderPkShort).toBe(PEER.slice(0, 8));
    expect(pending[0].actionText).toContain("haz algo");
    expect(pending[0].receivedAt).toBe(1000);
    expect(await pendingAgentTaskCount()).toBe(1);
  });

  it("M-6: remitente desconocido no oculta la tarea", async () => {
    await seedTask("task-1", "cd".repeat(32));
    const pending = await listPendingAgentTasks();
    expect(pending).toHaveLength(1);
    expect(pending[0].senderName).toMatch(/unknown/i);
  });

  it("M-6: approve registra la decisión; la tarea sale de pendientes y no se re-decide", async () => {
    await seedTask("task-1");
    expect(await approveAgentTask("task-1")).toBe(true);
    expect(await listPendingAgentTasks()).toHaveLength(0);
    expect(await pendingAgentTaskCount()).toBe(0);
    // Idempotente: ya decidida no vuelve a cambiar.
    expect(await approveAgentTask("task-1")).toBe(false);
    expect(await rejectAgentTask("task-1")).toBe(false);
    expect(await getPendingAgentTask("task-1")).toBeNull();
  });

  it("M-6: reject registra la decisión y la tarea sale de pendientes", async () => {
    await seedTask("task-1");
    expect(await rejectAgentTask("task-1")).toBe(true);
    expect(await listPendingAgentTasks()).toHaveLength(0);
    expect(await approveAgentTask("task-1")).toBe(false);
  });

  it("M-6: decidir un id inexistente devuelve false (no inventa decisiones)", async () => {
    expect(await approveAgentTask("no-existe")).toBe(false);
    expect(await rejectAgentTask("no-existe")).toBe(false);
  });

  it("M-6: el trabajo encolado no se vuelve ejecutable en silencio", async () => {
    await seedTask("task-1");
    // El único camino fuera de "queued" es la decisión explícita: tras
    // aprobar, el estado es "approved" y nada lo devuelve a "queued".
    await approveAgentTask("task-1");
    const row = mem.messages.find((m) => m.id === "task-1");
    expect(row?.status).toBe("approved");
    // Ni approve ni reject tocan una tarea ya decidida.
    await rejectAgentTask("task-1");
    expect(row?.status).toBe("approved");
  });
});
