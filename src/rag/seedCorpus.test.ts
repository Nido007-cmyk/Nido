/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

// Auditoría completa 2026-10-31 (F6-09): de seedCorpus se prueba
// aquí su contrato propio, el que sostiene a sus dos llamantes
// (el asistente de instalación y la pantalla de chat): las
// llamadas concurrentes comparten UNA corrida (no se siembra dos
// veces) y, si la corrida falla, el hueco queda libre para
// reintentar en vez de quedarse con el fallo para siempre. La
// siembra en sí (SQL y embeddings) la cubren las pruebas de db y
// de planSeed; aquí la base falla a propósito a la primera.

import { describe, it, expect, vi, beforeEach } from "vitest";

const getDbMock = vi.hoisted(() => vi.fn(async () => { throw new Error("db no lista"); }));
vi.mock("expo-file-system/legacy", () => ({ documentDirectory: "file:///docs/" }));
vi.mock("./db", () => ({
  getDb: getDbMock,
  getDbEpoch: async () => 0,
  insertChunk: vi.fn(async () => {}),
  insertChunkWithoutEmbedding: vi.fn(async () => {}),
  deleteSeedChunks: vi.fn(async () => {}),
}));
vi.mock("./embed", () => ({
  embeddingEngine: { loadedModelSha256: null, profile: null, embed: vi.fn(async () => null) },
}));

import { seedKnowledgeBaseIfEmpty, onSeedProgress } from "./seedCorpus";

describe("seedCorpus: contrato de concurrencia (F6-09)", () => {
  beforeEach(() => {
    getDbMock.mockClear();
    (globalThis as { __nidoSeeding?: unknown }).__nidoSeeding = null;
  });

  it("dos llamadas a la vez comparten la misma corrida", async () => {
    const a = seedKnowledgeBaseIfEmpty();
    const b = seedKnowledgeBaseIfEmpty();
    expect(a).toBe(b);
    await expect(a).rejects.toThrow("db no lista");
    expect(getDbMock).toHaveBeenCalledTimes(1);
  });

  it("tras un fallo, la siguiente llamada reintenta con una corrida nueva", async () => {
    await expect(seedKnowledgeBaseIfEmpty()).rejects.toThrow("db no lista");
    const again = seedKnowledgeBaseIfEmpty();
    await expect(again).rejects.toThrow("db no lista");
    expect(getDbMock).toHaveBeenCalledTimes(2);
  });

  it("onSeedProgress devuelve una baja que funciona", () => {
    const off = onSeedProgress(() => {});
    expect(typeof off).toBe("function");
    expect(off()).toBe(true);
    expect(off()).toBe(false);
  });
});
