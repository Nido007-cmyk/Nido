/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * telemetryWipe.test.ts — auditoría completa 2026-10-31 (F3-13).
 *
 * INVARIANTE: ningún evento de telemetría del mundo anterior a un
 * borrado total puede acabar escrito en la base nueva. persistEvent
 * es fire-and-forget y su escritura puede completarse después del
 * wipe; la guarda (espejo de la de networkAudit) la descarta si el
 * borrado empezó antes del registro o durante la espera, y el
 * anillo en memoria se vacía al empezar el borrado.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const dbx = vi.hoisted(() => {
  let resolveDb: ((db: unknown) => void) | null = null;
  return {
    inserts: [] as unknown[][],
    gate: null as Promise<unknown> | null,
    arm() {
      this.inserts.length = 0;
      this.gate = new Promise((res) => {
        resolveDb = res;
      });
      return () => {
        resolveDb?.({
          execAsync: async () => {},
          runAsync: async (_sql: string, params: unknown[]) => {
            dbx.inserts.push(params);
          },
        });
      };
    },
  };
});

vi.mock("../security/databaseManager", () => ({
  getDatabase: () => dbx.gate,
  closeDatabase: async () => {},
}));

import {
  beginTelemetryWipe,
  clearTelemetry,
  endTelemetryWipe,
  getRecentTelemetry,
  recordInferenceEvent,
  type InferenceTelemetryEvent,
} from "./telemetry";

const base: InferenceTelemetryEvent = {
  ts: 1234567890,
  modelId: "models/qwen2.5-0.5b-instruct-q4km.gguf",
  taskType: "test",
  promptChars: 100,
  promptTokensEst: 34,
  completionTokens: 10,
  ttftMs: 50,
  totalMs: 200,
  tokensPerSec: 50,
  stopReason: "completed",
  nPredict: 512,
};

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
}

describe("telemetry: guarda de borrado (F3-13)", () => {
  beforeEach(() => {
    endTelemetryWipe();
    clearTelemetry();
  });

  it("sin borrado, el evento se persiste", async () => {
    const release = dbx.arm();
    recordInferenceEvent(base);
    release();
    await flush();
    expect(dbx.inserts).toHaveLength(1);
  });

  it("un evento en vuelo cuando empieza el borrado no entra en la base nueva", async () => {
    const release = dbx.arm();
    recordInferenceEvent(base);
    beginTelemetryWipe();
    release();
    await flush();
    expect(dbx.inserts).toHaveLength(0);
    // Y el anillo en memoria también quedó vacío.
    expect(getRecentTelemetry(10)).toHaveLength(0);
  });

  it("tras el borrado, el ciclo nuevo vuelve a persistir", async () => {
    const release = dbx.arm();
    beginTelemetryWipe();
    endTelemetryWipe();
    recordInferenceEvent(base);
    release();
    await flush();
    expect(dbx.inserts).toHaveLength(1);
  });
});
