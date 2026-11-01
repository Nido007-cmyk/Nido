/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * P-06 (auditoría de rendimiento 2026-11-01): la poda de
 * execution_telemetry, probada contra SQLite REAL (node:sqlite) con
 * el DDL verdadero de rag/db.ts — no contra un doble que repita la
 * forma esperada. La costura de ../rag/db se apuntala con un handle
 * que ejecuta el SQL de producción tal cual: la inserción de
 * recordExecution, la poda en la misma transacción y las lecturas
 * de listRecentExecutions/exportExecutionTelemetry corren sin tocar.
 *
 * La propiedad juzgada: tras 1.005 inserciones quedan exactamente
 * las últimas 1.000 (la ventana mayor que la casa lee, la de la
 * exportación); las 5 primeras ya no están; una más no hace crecer
 * la tabla; y por debajo del tope no se poda nada.
 */
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// El DDL verdadero (rag/db.ts, CREATE de execution_telemetry).
const DDL = `
CREATE TABLE IF NOT EXISTS execution_telemetry (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  model_id TEXT,
  task_type TEXT,
  adaptive_routing_used INTEGER NOT NULL DEFAULT 0,
  reason_codes TEXT,
  retrieval_used INTEGER,
  model_switches INTEGER,
  cross_message_model_switch INTEGER,
  model_residency TEXT,
  model_load_ms REAL,
  ttft_ms REAL,
  generation_latency_ms REAL,
  total_latency_ms REAL,
  tokens_generated INTEGER,
  tok_per_sec REAL,
  peak_rss_bytes INTEGER,
  outcome TEXT,
  error_message TEXT
);
CREATE INDEX IF NOT EXISTS idx_execution_telemetry_created
  ON execution_telemetry(created_at DESC);
`;

class SqliteHandle {
  readonly sqlite = new DatabaseSync(":memory:");
  constructor() {
    this.sqlite.exec(DDL);
  }
  async runAsync(sql: string, params: unknown[] = []) {
    this.sqlite.prepare(sql).run(...(params as never[]));
  }
  async getAllAsync(sql: string, params: unknown[] = []) {
    return this.sqlite.prepare(sql).all(...(params as never[]));
  }
  async execAsync(sql: string) {
    this.sqlite.exec(sql);
  }
}

interface World {
  handle: SqliteHandle;
  written: Map<string, string>;
}
const world = ((globalThis as Record<string, unknown>).__nidoTelemetryPruneWorld ??= {
  handle: null,
  written: new Map(),
}) as unknown as World;
const W = () => (globalThis as Record<string, unknown>).__nidoTelemetryPruneWorld as unknown as World;

vi.mock("../rag/db", () => ({
  getDb: async () => W().handle,
  writeTransaction: async (work: (txn: SqliteHandle) => Promise<void>) => {
    const h = W().handle;
    h.sqlite.exec("BEGIN IMMEDIATE");
    try {
      await work(h);
      h.sqlite.exec("COMMIT");
    } catch (e) {
      h.sqlite.exec("ROLLBACK");
      throw e;
    }
  },
}));
vi.mock("expo-file-system/legacy", () => ({
  cacheDirectory: "file:///cache/",
  writeAsStringAsync: async (path: string, content: string) => {
    W().written.set(path, content);
  },
}));
vi.mock("expo-sharing", () => ({
  isAvailableAsync: async () => true,
  shareAsync: async () => {},
}));

type M = typeof import("./executionTelemetry");
let M: M;

// Date.now estrictamente creciente: created_at lleva el orden y el
// desempate no depende del azar del reloj de la máquina de CI.
const BASE = 1_700_000_000_000;
let tick = BASE;
const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => ++tick);

beforeAll(async () => {
  M = await import("./executionTelemetry");
});
beforeEach(() => {
  world.handle = new SqliteHandle();
  world.written.clear();
  tick = BASE;
});
afterAll(() => {
  nowSpy.mockRestore();
});

const insert = () => M.recordExecution({ adaptiveRoutingUsed: false, taskType: "chat" });

describe("P-06 · la poda rodante de execution_telemetry", () => {
  it("1.005 inserciones dejan exactamente las últimas 1.000; las 5 primeras ya no están", async () => {
    for (let i = 0; i < 1005; i++) await insert();
    // Date.now se llama dos veces por inserción (id y createdAt en
    // la implementación) — lo que ordena es created_at, y la ventana
    // superviviente es la de las 1.000 inserciones más recientes.
    const all = await M.listRecentExecutions(2000);
    expect(all).toHaveLength(1000);
    const window = await M.listRecentExecutions(1000);
    expect(window).toHaveLength(1000);
    const kept = new Set(all.map((r) => r.createdAt));
    // Los createdAt supervivientes son un sufijo contiguo del tiempo:
    // el mínimo superviviente deja fuera exactamente 5 inserciones.
    const minKept = Math.min(...kept);
    const maxKept = Math.max(...kept);
    expect(maxKept - minKept).toBe(999 * 2);
    expect(minKept).toBe(BASE + 2 * 6);
  }, 30000);

  it("la exportación (la ventana mayor) sale con 1.000 registros parseables", async () => {
    for (let i = 0; i < 1005; i++) await insert();
    await M.exportExecutionTelemetry("json");
    const content = W().written.get("file:///cache/execution_telemetry.json");
    expect(content).toBeTypeOf("string");
    const parsed = JSON.parse(content as string) as unknown[];
    expect(parsed).toHaveLength(1000);
  }, 30000);

  it("una inserción más no hace crecer la tabla: la ventana ruede en uno", async () => {
    for (let i = 0; i < 1005; i++) await insert();
    const before = await M.listRecentExecutions(2000);
    const minBefore = Math.min(...before.map((r) => r.createdAt));
    await insert();
    const after = await M.listRecentExecutions(2000);
    expect(after).toHaveLength(1000);
    const minAfter = Math.min(...after.map((r) => r.createdAt));
    expect(minAfter).toBe(minBefore + 2);
  }, 30000);

  it("por debajo del tope no se poda nada", async () => {
    await insert();
    await insert();
    await insert();
    const all = await M.listRecentExecutions(2000);
    expect(all).toHaveLength(3);
  });
});
