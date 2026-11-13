/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */
import { describe, expect, it, vi } from "vitest";

// embeddingSwitch arrastra los motores nativos; para el mapa de variantes
// (packIdForEmbedding, función pura) basta con apagar sus dependencias.
vi.mock("../models/settings", () => ({ getActiveModelId: async () => null, setActiveModelId: async () => {} }));
vi.mock("../rag/embed", () => ({ embeddingEngine: {} }));
vi.mock("../rag/db", () => ({ resetEmbeddingsForModel: async () => {} }));
vi.mock("../rag/packs", () => ({ closeAllPacks: async () => {}, prepareVectorIndexes: async () => {} }));
vi.mock("../rag/embeddingProfile", () => ({ embeddingProfileForSha: () => null }));
vi.mock("../rag/reembed", () => ({ reembedMissing: async () => {} }));
import { MODEL_CATALOG, type CatalogModel } from "./manifest";
import { BUNDLED_PACK_BASE_IDS, installBundledPacks } from "./firstRunPacks";
import { DEFAULT_EMBEDDING_ID, MULTILINGUAL_EMBEDDING_ID, packIdForEmbedding } from "../rag/embeddingSwitch";

function run(embeddingId: string, install: (a: CatalogModel) => Promise<void>, catalog = MODEL_CATALOG) {
  return installBundledPacks({ catalog, packIdFor: (id) => packIdForEmbedding(id, embeddingId), install });
}

describe("installBundledPacks (0.1.95: NIDO sirve sin red y sin modelo)", () => {
  it("con búsqueda en inglés instala NIDO Essentials y NIDO Local en su variante bge", async () => {
    const seen: string[] = [];
    const r = await run(DEFAULT_EMBEDDING_ID, async (a) => void seen.push(a.id));
    expect(seen).toEqual(["nido-esencial", "nido-local"]);
    expect(r).toEqual({ installed: ["nido-esencial", "nido-local"], failed: [] });
  });

  it("con búsqueda multilingüe instala la variante e5, no una copia que nadie pidió", async () => {
    const seen: string[] = [];
    await run(MULTILINGUAL_EMBEDDING_ID, async (a) => void seen.push(a.id));
    expect(seen).toEqual(["nido-esencial-e5", "nido-local-e5"]);
  });

  it("cada pack se verifica con su entrada del catálogo firmado (mismo sha256 y tamaño)", async () => {
    const assets: CatalogModel[] = [];
    await run(DEFAULT_EMBEDDING_ID, async (a) => void assets.push(a));
    for (const a of assets) {
      const entry = MODEL_CATALOG.find((m) => m.id === a.id)!;
      expect(a).toBe(entry);
      expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("un pack que falla no impide el otro y nunca lanza", async () => {
    const r = await run(DEFAULT_EMBEDDING_ID, async (a) => {
      if (a.id === "nido-esencial") throw new Error("SHA-256 verification failed");
    });
    expect(r.installed).toEqual(["nido-local"]);
    expect(r.failed).toEqual([{ id: "nido-esencial", error: "SHA-256 verification failed" }]);
  });

  it("un pack que no está en el catálogo se informa y no se instala", async () => {
    const catalog = MODEL_CATALOG.filter((m) => m.id !== "nido-local");
    const seen: string[] = [];
    const r = await run(DEFAULT_EMBEDDING_ID, async (a) => void seen.push(a.id), catalog);
    expect(seen).toEqual(["nido-esencial"]);
    expect(r.failed.map((f) => f.id)).toEqual(["nido-local"]);
  });

  it("los packs base son los dos de primer arranque", () => {
    expect([...BUNDLED_PACK_BASE_IDS]).toEqual(["nido-esencial", "nido-local"]);
  });
});
