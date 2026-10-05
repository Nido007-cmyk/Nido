import { describe, it, expect, vi, beforeEach } from "vitest";

// __DEV__ es un global de React Native: se define para el entorno de test.
vi.hoisted(() => {
  (globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;
});

const mem = vi.hoisted(() => ({
  contacts: [] as Array<{ pk_hex: string; name: string; verified: number; sig_pk: string | null }>,
  messages: [] as Array<{
    id: string; dir: string; peer_pk: string; type: string; text: string; status: string; ts: number;
  }>,
}));

vi.mock("expo-calendar", () => ({}));
vi.mock("expo-contacts", () => ({}));
vi.mock("expo-document-picker", () => ({}));
vi.mock("expo-file-system", () => ({ File: class {} }));
vi.mock("expo-sqlite", () => ({}));
vi.mock("react-native", () => ({ Linking: { openURL: vi.fn() }, Platform: { OS: "android" } }));
vi.mock("../memory/memoryStore", () => {
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
  // R6: p2p/store.ts escribe vía writeMemoryTransaction con guard de epoch;
  // el mock mantiene la semántica "base en memoria inmediata" como en
  // src/p2p/messenger.test.ts.
  return {
    getMemoryDb: async () => db,
    getMemoryDbEpoch: () => 0,
    writeMemoryTransaction: async (work: (d: typeof db) => Promise<void>) => {
      await work(db);
    },
  };
});

import { saveContact, saveMessage } from "../../p2p/store";
import { buildToolHandlers } from "./handlers";
import { confirmBlockedMessage } from "./confirm";

const PEER = "ab".repeat(32);

async function seedTask(id = "task-1") {
  await saveContact(PEER, "Beto");
  await saveMessage({
    id,
    dir: "in",
    peerPk: PEER,
    type: "agent_task",
    text: "[Tarea de su NIDO · test] haz algo",
    status: "queued",
    ts: 1000,
  });
}

beforeEach(() => {
  mem.contacts = [];
  mem.messages = [];
});

describe("M-6: herramientas de aprobación (superficie de decisión)", () => {
  it("M-6: nido_review_tasks muestra remitente, acción y contexto", async () => {
    await seedTask();
    const h = buildToolHandlers({ requestConfirm: async () => true });
    const out = await h["nido_review_tasks"]({});
    expect(out).toContain("Beto");
    expect(out).toContain("haz algo");
    expect(out).toContain("task-1");
    expect(out).toContain("nido_approve_task");
  });

  it("M-6: nido_review_tasks sin pendientes lo dice", async () => {
    const h = buildToolHandlers({ requestConfirm: async () => true });
    const out = await h["nido_review_tasks"]({});
    expect(out).toMatch(/there are no NIDO tasks pending approval/i);
  });

  it("M-6: nido_approve_task sin canal de confirmación → bloqueado (M-3)", async () => {
    await seedTask();
    const h = buildToolHandlers(); // sin canal
    const out = await h["nido_approve_task"]({ id: "task-1" });
    expect(out).toBe(confirmBlockedMessage("nido_approve_task"));
    // La tarea sigue pendiente: nada se decidió.
    expect(mem.messages.find((m) => m.id === "task-1")?.status).toBe("queued");
  });

  it("M-6: nido_reject_task sin canal de confirmación → bloqueado (M-3)", async () => {
    await seedTask();
    const h = buildToolHandlers();
    const out = await h["nido_reject_task"]({ id: "task-1" });
    expect(out).toBe(confirmBlockedMessage("nido_reject_task"));
    expect(mem.messages.find((m) => m.id === "task-1")?.status).toBe("queued");
  });

  it("M-6: el diálogo de aprobación muestra identidad, acción y contexto antes de decidir", async () => {
    await seedTask();
    const seen: Array<{ title: string; message: string }> = [];
    const h = buildToolHandlers({
      requestConfirm: async (req) => {
        seen.push(req);
        return false; // cancelar: no se decide
      },
    });
    const out = await h["nido_approve_task"]({ id: "task-1" });
    expect(out).toMatch(/I did nothing/i);
    expect(seen).toHaveLength(1);
    expect(seen[0].message).toContain("Beto");
    expect(seen[0].message).toContain("haz algo");
    // Cancelado: la tarea sigue encolada.
    expect(mem.messages.find((m) => m.id === "task-1")?.status).toBe("queued");
  });

  it("M-6: aprobar con confirmación registra la decisión", async () => {
    await seedTask();
    const h = buildToolHandlers({ requestConfirm: async () => true });
    const out = await h["nido_approve_task"]({ id: "task-1" });
    expect(out).toMatch(/approved/i);
    expect(out).toMatch(/nothing was executed automatically/i);
    expect(mem.messages.find((m) => m.id === "task-1")?.status).toBe("approved");
    const review = await h["nido_review_tasks"]({});
    expect(review).toMatch(/there are no NIDO tasks pending approval/i);
  });

  it("M-6: rechazar con confirmación registra la decisión", async () => {
    await seedTask();
    const h = buildToolHandlers({ requestConfirm: async () => true });
    const out = await h["nido_reject_task"]({ id: "task-1" });
    expect(out).toMatch(/rejected/i);
    expect(mem.messages.find((m) => m.id === "task-1")?.status).toBe("rejected");
  });

  it("M-6: decidir un id inexistente avisa sin inventar nada", async () => {
    const seen: Array<{ title: string; message: string }> = [];
    const h = buildToolHandlers({
      requestConfirm: async (req) => {
        seen.push(req);
        return true;
      },
    });
    const out = await h["nido_approve_task"]({ id: "no-existe" });
    // El diálogo ya avisa que no hay tarea pendiente con ese id.
    expect(seen[0].message).toMatch(/no.*pending task|no hay ninguna tarea pendiente/i);
    expect(out).toMatch(/no pending task with id/i);
  });
});
