/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

// Auditoría 0.1.93: un pack verificado pero renombrado con el nombre de
// un pack del catálogo no puede ocupar su sitio en disco.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "crypto";

vi.mock("ram-monitor", () => ({
  getDeviceTotalRamBytes: () => 8 * 1024 ** 3,
  getMemoryInfo: () => ({ rssBytes: 0 }),
}));

const h = vi.hoisted(() => {
  const files = new Map<string, Uint8Array>();
  const metas = new Map<string, Record<string, string>>();
  const state = { picker: null as null | { canceled: boolean; assets: Array<{ uri: string; name: string; size?: number }> }, moves: 0 };
  return { files, metas, state, catalog: [] as unknown[] };
});

vi.mock("expo-file-system/legacy", () => ({
  documentDirectory: "file:///docs/",
  cacheDirectory: "file:///cache/",
  EncodingType: { Base64: "base64", UTF8: "utf8" },
  getInfoAsync: async (uri: string) => {
    const f = h.files.get(uri);
    return f ? { exists: true, isDirectory: false, size: f.length } : { exists: false, isDirectory: false, size: 0 };
  },
  readAsStringAsync: async (uri: string, opts?: { encoding?: string; position?: number; length?: number }) => {
    const f = h.files.get(uri);
    if (!f) throw new Error(`ENOENT ${uri}`);
    if (opts?.encoding === "base64") {
      const start = opts.position ?? 0;
      const len = opts.length ?? f.length - start;
      return Buffer.from(f.subarray(start, start + len)).toString("base64");
    }
    return Buffer.from(f).toString("utf8");
  },
  writeAsStringAsync: async (uri: string, text: string) => {
    h.files.set(uri, new TextEncoder().encode(text));
  },
  deleteAsync: async (uri: string) => {
    h.files.delete(uri);
  },
  moveAsync: async ({ from, to }: { from: string; to: string }) => {
    const f = h.files.get(from);
    if (!f) throw new Error(`ENOENT ${from}`);
    h.files.set(to, f);
    h.files.delete(from);
    h.state.moves++;
  },
  makeDirectoryAsync: async () => {},
}));

vi.mock("expo-sqlite", () => ({
  openDatabaseAsync: async (name: string, _o: unknown, dir: string) => {
    const meta = h.metas.get(`file://${dir}/${name}`);
    if (!meta) throw new Error("file is not a database");
    return {
      getAllAsync: async (sql: string) => {
        if (/FROM meta/.test(sql)) return Object.entries(meta).map(([key, value]) => ({ key, value }));
        // M-35/m-91: the door also reads the internal schema (step 5).
        // This world's packs are format v1: meta + chunks, nothing else.
        const pragma = /PRAGMA table_info\((\w+)\)/.exec(sql);
        if (pragma) {
          const cols: Record<string, string[]> = {
            meta: ["key", "value"],
            chunks: ["id", "title", "body", "source", "scale", "vec"],
          };
          return (cols[pragma[1]] ?? []).map((n) => ({ name: n }));
        }
        const count = /SELECT COUNT\(\*\) AS n FROM (\w+)/.exec(sql);
        if (count) return [{ n: count[1] === "chunks" ? 4 : 0 }];
        return Object.entries(meta).map(([key, value]) => ({ key, value }));
      },
      closeAsync: async () => {},
    };
  },
}));
vi.mock("expo-document-picker", () => ({ getDocumentAsync: async () => h.state.picker }));
vi.mock("../rag/packs", () => ({ closePack: async () => {} }));
vi.mock("../rag/vectorIndex", () => ({ deletePackIndexes: async () => {} }));
vi.mock("../models/manifest", () => ({
  get CORPUS_CATALOG() {
    return h.catalog;
  },
}));

import { importPackFromFile } from "./packImporter";

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const A = new TextEncoder().encode("bytes del pack A del catálogo");
const B = new TextEncoder().encode("bytes del pack B del catálogo, otro contenido");
const META = { format: "nido-knowledge-pack", formatVersion: "1", name: "Pack", embeddingModelSha256: "e".repeat(64) };

function pick(name: string, bytes: Uint8Array) {
  const uri = `file:///cache/${name}`;
  const manifestUri = `${uri}.json`;
  h.files.set(uri, bytes);
  h.metas.set(uri, META);
  h.files.set(manifestUri, new TextEncoder().encode(JSON.stringify({ id: "x", sha256: sha(bytes) })));
  h.state.picker = { canceled: false, assets: [{ uri, name, size: bytes.length }, { uri: manifestUri, name: `${name}.json` }] };
}

beforeEach(() => {
  h.files.clear();
  h.metas.clear();
  h.state.moves = 0;
  h.catalog.length = 0;
  h.catalog.push(
    { id: "pack-a", kind: "corpus", format: "sqlite-pack", filename: "corpus/a.sqlite", sha256: sha(A) },
    { id: "pack-b", kind: "corpus", format: "sqlite-pack", filename: "corpus/b.sqlite", sha256: sha(B) }
  );
});

describe("importar un pack: el nombre de un pack del catálogo solo lo ocupa su propio archivo", () => {
  it("el pack A, renombrado como b.sqlite, se rechaza y no toca el pack B instalado", async () => {
    h.files.set("file:///docs/corpus/b.sqlite", B);
    pick("b.sqlite", A);
    const out = await importPackFromFile(async () => true);
    expect(out).toEqual({ status: "rejected", reason: "hash-mismatch" });
    expect(h.state.moves).toBe(0);
    expect(h.files.get("file:///docs/corpus/b.sqlite")).toBe(B);
  });

  it("el pack A con su propio nombre se importa como hasta ahora", async () => {
    pick("a.sqlite", A);
    const out = await importPackFromFile(async () => true);
    expect(out.status).toBe("imported");
    expect(h.files.get("file:///docs/corpus/a.sqlite")).toBe(A);
  });

  it("un pack del catálogo con un nombre que no es de catálogo se sigue importando (pack añadido)", async () => {
    pick("mi-copia.sqlite", A);
    const out = await importPackFromFile(async () => true);
    expect(out.status).toBe("imported");
  });
});
