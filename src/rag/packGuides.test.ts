/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Lector de documentos de las guías (pieza 2026-11-08): listPackGuides y
 * readPackGuide leen las guías de un pack instalado SIN cargar ningún
 * motor. El mundo falso sigue el patrón de packs.multilingual.test.ts:
 * expo-sqlite y expo-file-system mockeados, y el pack pasa la puerta de
 * confianza real (packFileState) con la instalación verificada que una
 * descarga deja: asiento en el diario y mtime del fichero atado a él
 * (M-35: la presencia sola ya no abre ningún pack).
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

type GuideRow = { id: number; key: string; lang: string; title: string; category: string; region: string; sources: string; verified: string };
type ChunkRow = { id: number; title: string; body: string; source: string; guide: number | null };
type World = {
  installed: { filename: string; size: number };
  /** M-35: the install journal's JSON, as a verified install leaves it. */
  journal: string;
  meta: Record<string, string>;
  guides: GuideRow[];
  chunks: ChunkRow[];
};
const W = (): World => (globalThis as unknown as { __pgW: World }).__pgW;
(globalThis as unknown as { __pgW: World }).__pgW = {} as World;

const llamaLoad = vi.fn();
const embeddingLoad = vi.fn();
vi.mock("../inference/LlamaEngine", () => ({ llamaEngine: { load: llamaLoad } }));
vi.mock("./embed", () => ({ embeddingEngine: { load: embeddingLoad } }));

vi.mock("expo-file-system/legacy", () => ({
  documentDirectory: "file:///docs/",
  EncodingType: { Base64: "base64", UTF8: "utf8" },
  getInfoAsync: async (uri: string) => {
    const w = W();
    if (uri.endsWith("nido-install-state.json")) return { exists: true, size: w.journal.length, modificationTime: 1 };
    return uri.endsWith(w.installed.filename)
      ? { exists: true, size: w.installed.size, modificationTime: 4242 }
      : { exists: false };
  },
  readAsStringAsync: async (uri: string) => {
    if (uri.endsWith("nido-install-state.json")) return W().journal;
    throw new Error(`ENOENT ${uri}`);
  },
  readDirectoryAsync: async () => [],
}));
vi.mock("expo-sqlite", () => ({
  openDatabaseAsync: async () => ({
    getAllAsync: async (sql: string, params: unknown[] = []) => {
      const w = W();
      if (/FROM meta/.test(sql)) return Object.entries(w.meta).map(([key, value]) => ({ key, value }));
      if (/FROM guides ORDER BY id/.test(sql)) return [...w.guides].sort((a, b) => a.id - b.id);
      if (/FROM chunks WHERE guide = \?/.test(sql))
        return w.chunks.filter((c) => c.guide === params[0]).sort((a, b) => a.id - b.id);
      if (/FROM chunks WHERE title = \?/.test(sql)) {
        const like = String(params[1]).replace(/%/g, "");
        return w.chunks
          .filter((c) => c.title === params[0] || c.title.startsWith(like))
          .sort((a, b) => a.id - b.id);
      }
      throw new Error(`unexpected SQL ${sql}`);
    },
    getFirstAsync: async (sql: string, params: unknown[] = []) => {
      const w = W();
      if (/FROM guides WHERE id = \?/.test(sql)) return w.guides.find((g) => g.id === params[0]) ?? null;
      // P-39: openPack counts rows before opening.
      if (/COUNT\(\*\) AS n FROM chunks/.test(sql)) return { n: w.chunks.length };
      if (/COUNT\(\*\) AS n FROM guides/.test(sql)) return { n: w.guides.length };
      if (/COUNT\(\*\) AS n FROM (regions|facts)/.test(sql)) return { n: 0 };
      throw new Error(`unexpected SQL ${sql}`);
    },
    closeAsync: async () => {},
  }),
}));
vi.mock("./vectorIndex", () => ({
  releaseAllIndexes: () => {},
  packIndexIfReady: async () => null,
  searchPackIndex: async () => ({ ids: [], scores: [], gatedCount: 0, gatedMin: null }),
}));

let packs: typeof import("./packs");
let catalog: typeof import("../models/manifest");
beforeAll(async () => {
  packs = await import("./packs");
  catalog = await import("../models/manifest");
});

const GUIDE_1: GuideRow = {
  id: 1, key: "cpr", lang: "en", title: "CPR for adults", category: "first-aid",
  region: "", sources: "IFRC 2025", verified: "2026-11-07",
};
const GUIDE_2: GuideRow = {
  id: 2, key: "burns", lang: "en", title: "Burns", category: "first-aid",
  region: "", sources: "IFRC 2025", verified: "2026-11-07",
};

beforeEach(async () => {
  const vital = catalog.CORPUS_CATALOG.find((c) => c.id === "wiki-vital5")!;
  Object.assign(W(), {
    installed: { filename: vital.filename, size: vital.sizeBytes },
    journal: JSON.stringify({
      version: 1,
      records: {
        [vital.id]: {
          assetId: vital.id,
          status: "installed",
          sizeBytes: vital.sizeBytes,
          sha256: vital.sha256,
          mtimeMs: 4242 * 1000,
          updatedAt: 1,
        },
      },
    }),
    meta: { format: "nido-knowledge-pack", formatVersion: "2", dims: "2", embeddingModelSha256: "802c868f" },
    guides: [GUIDE_2, GUIDE_1],
    chunks: [
      { id: 10, title: "CPR for adults — Push hard", body: "Push in the center.", source: "NIDO — CPR for adults", guide: 1 },
      { id: 9, title: "CPR for adults", body: "Check response first.", source: "NIDO — CPR for adults", guide: 1 },
      { id: 11, title: "Burns", body: "Cool with water.", source: "NIDO — Burns", guide: 2 },
    ],
  });
  llamaLoad.mockClear();
  embeddingLoad.mockClear();
  await packs.closeAllPacks();
});

describe("guide document reader (no model)", () => {
  it("lists the pack guides in their order", async () => {
    const guides = await packs.listPackGuides("wiki-vital5");
    expect(guides.map((g) => g.title)).toEqual(["CPR for adults", "Burns"]);
    expect(guides[0]).toMatchObject({ key: "cpr", lang: "en", sources: "IFRC 2025" });
  });

  it("reads a whole guide as one document, bare chunk first", async () => {
    const doc = await packs.readPackGuide("wiki-vital5", 1);
    expect(doc).not.toBeNull();
    expect(doc!.title).toBe("CPR for adults");
    expect(doc!.source).toBe("NIDO — CPR for adults");
    expect(doc!.body).toBe("Check response first.\n\nPush in the center.");
  });

  it("falls back to title matching when chunks carry no guide link", async () => {
    W().chunks = W().chunks.map((c) => ({ ...c, guide: null }));
    const doc = await packs.readPackGuide("wiki-vital5", 2);
    expect(doc).not.toBeNull();
    expect(doc!.body).toBe("Cool with water.");
  });

  it("returns empty and null for a pack that is not installed", async () => {
    W().installed = { filename: "corpus/none.sqlite", size: 0 };
    await packs.closeAllPacks();
    expect(await packs.listPackGuides("wiki-vital5")).toEqual([]);
    expect(await packs.readPackGuide("wiki-vital5", 1)).toBeNull();
    expect(await packs.listPackGuides("no-such-pack")).toEqual([]);
  });

  it("returns empty and null for a v1 pack (no guides table)", async () => {
    W().meta = { format: "nido-knowledge-pack", formatVersion: "1", dims: "2", embeddingModelSha256: "802c868f" };
    await packs.closeAllPacks();
    expect(await packs.listPackGuides("wiki-vital5")).toEqual([]);
    expect(await packs.readPackGuide("wiki-vital5", 1)).toBeNull();
  });

  it("returns null for a guide id that does not exist", async () => {
    expect(await packs.readPackGuide("wiki-vital5", 99)).toBeNull();
  });

  it("never loads a model engine while listing or reading", async () => {
    await packs.listPackGuides("wiki-vital5");
    await packs.readPackGuide("wiki-vital5", 1);
    await packs.readPackGuide("wiki-vital5", 2);
    expect(llamaLoad).not.toHaveBeenCalled();
    expect(embeddingLoad).not.toHaveBeenCalled();
  });
});
