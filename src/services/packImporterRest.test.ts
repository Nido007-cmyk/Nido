/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * M-35 (auditoría 2026-11-13, carril 07: B2 y m-91/B5) — la puerta
 * firmada y su registro, en reposo:
 *
 *  - B2: la marca «verificado» de un pack importado (`verifiedImportedPacks`,
 *    la que alimenta la ruta literal de guías) exige que los bytes sigan
 *    verificando contra la huella del registro AHORA; un fichero
 *    manipulado tras la importación pierde la marca.
 *  - m-91: la puerta valida también el esquema interno del pack (las
 *    tablas y columnas que los lectores consultan, y los conteos), no
 *    solo su meta: un pack firmado con el esquema roto se rechaza como
 *    «not-a-pack» antes de copiar nada a corpus/.
 *  - La importación deja asiento en el diario de instalación, para que
 *    la apertura posterior tenga la misma vía rápida probada que un
 *    pack del catálogo.
 *
 * El origen (firma Ed25519 / pin de catálogo) tiene su propia batería
 * en models/packImport.test.ts y en las suites de bytes reales; aquí se
 * sustituye `verifyPackOrigin` por un origen válido para aislar lo que
 * esta ficha audita: el esquema y la marca en reposo.
 */
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sha256Hex = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

interface World {
  files: Map<string, Uint8Array>;
  mtimes: Map<string, number>;
  meta: Record<string, string>;
  /** table name -> column names; absent key = the table does not exist. */
  schema: Map<string, string[]>;
  counts: Map<string, number>;
  picker: unknown;
}
const W = (): World => (globalThis as unknown as { __pirW: World }).__pirW;
(globalThis as unknown as { __pirW: World }).__pirW = {
  files: new Map(),
  mtimes: new Map(),
  meta: {},
  schema: new Map(),
  counts: new Map(),
  picker: null,
} as World;

const DOCS = "file:///docs/";
const CACHE = "file:///cache/";
const CORPUS = `${DOCS}corpus/`;
// The mock factories are hoisted above the consts: they read the paths
// from here instead.
const PATHS = vi.hoisted(() => ({ DOCS: "file:///docs/", CACHE: "file:///cache/" }));

vi.mock("expo-file-system/legacy", () => ({
  documentDirectory: PATHS.DOCS,
  cacheDirectory: PATHS.CACHE,
  EncodingType: { Base64: "base64", UTF8: "utf8" },
  getInfoAsync: async (uri: string) => {
    const f = W().files.get(uri);
    return f
      ? { exists: true, isDirectory: false, size: f.length, modificationTime: W().mtimes.get(uri) ?? 1000 }
      : { exists: false, isDirectory: false, size: 0 };
  },
  readAsStringAsync: async (uri: string, opts?: { encoding?: string; position?: number; length?: number }) => {
    const f = W().files.get(uri);
    if (!f) throw new Error(`ENOENT ${uri}`);
    if (opts?.encoding === "base64") {
      const start = opts.position ?? 0;
      const len = opts.length ?? f.length - start;
      return Buffer.from(f.subarray(start, start + len)).toString("base64");
    }
    return Buffer.from(f).toString("utf8");
  },
  writeAsStringAsync: async (uri: string, text: string) => {
    W().files.set(uri, new TextEncoder().encode(text));
    W().mtimes.set(uri, 9000);
  },
  moveAsync: async ({ from, to }: { from: string; to: string }) => {
    const f = W().files.get(from);
    if (!f) throw new Error(`ENOENT ${from}`);
    W().files.set(to, f);
    W().mtimes.set(to, W().mtimes.get(from) ?? 1000);
    W().files.delete(from);
    W().mtimes.delete(from);
  },
  copyAsync: async ({ from, to }: { from: string; to: string }) => {
    const f = W().files.get(from);
    if (!f) throw new Error(`ENOENT ${from}`);
    W().files.set(to, f.slice());
    W().mtimes.set(to, W().mtimes.get(from) ?? 1000);
  },
  deleteAsync: async (uri: string, opts?: { idempotent?: boolean }) => {
    if (!W().files.delete(uri) && !opts?.idempotent) throw new Error(`ENOENT ${uri}`);
    W().mtimes.delete(uri);
  },
  makeDirectoryAsync: async () => {},
  readDirectoryAsync: async (uri: string) =>
    [...W().files.keys()].filter((k) => k.startsWith(uri)).map((k) => k.slice(uri.length)),
}));

vi.mock("expo-sqlite", () => ({
  openDatabaseAsync: async () => ({
    getAllAsync: async (sql: string) => {
      if (/FROM meta/.test(sql)) return Object.entries(W().meta).map(([key, value]) => ({ key, value }));
      const pragma = /PRAGMA table_info\((\w+)\)/.exec(sql);
      if (pragma) {
        const cols = W().schema.get(pragma[1]);
        return cols ? cols.map((name) => ({ name })) : [];
      }
      const count = /SELECT COUNT\(\*\) AS n FROM (\w+)/.exec(sql);
      if (count) return [{ n: W().counts.get(count[1]) ?? 0 }];
      throw new Error(`unexpected SQL ${sql}`);
    },
    closeAsync: async () => {},
  }),
}));

vi.mock("expo-document-picker", () => ({
  getDocumentAsync: async () => W().picker,
}));

vi.mock("../rag/packs", () => ({ closePack: async () => {} }));
vi.mock("../rag/vectorIndex", () => ({ deletePackIndexes: async () => {} }));
vi.mock("../models/packImport", async (importActual) => {
  const actual = await importActual<typeof import("../models/packImport")>();
  return { ...actual, verifyPackOrigin: () => ({ ok: true, origin: "salvora" as const }) };
});

import { importPackFromFile, verifiedImportedPacks } from "./packImporter";
import { getInstallRecord } from "../models/installState";

const FULL_SCHEMA: Record<string, string[]> = {
  meta: ["key", "value"],
  chunks: ["id", "title", "body", "source", "scale", "vec", "guide", "keys"],
  guides: ["id", "key", "lang", "title", "category", "region", "sources", "verified"],
  regions: ["code", "names", "aliases", "phrases"],
  facts: ["id", "region", "key", "value", "label", "note", "source_title", "source_url", "quote", "checked"],
};
const META_V2 = {
  format: "nido-knowledge-pack",
  formatVersion: "2",
  dims: "384",
  embeddingModelSha256: "802c868f57ccddd2e0c80645c3db1cb96a1aa50986a057cbaee2526f6e474cde",
  name: "Tienda de prueba",
};

const PACK_BYTES = new Uint8Array(1500);
for (let i = 0; i < PACK_BYTES.length; i++) PACK_BYTES[i] = (i * 3 + 11) & 0xff;

function seed(schema: Record<string, string[]>, counts: Record<string, number>) {
  const w = W();
  w.files.clear();
  w.mtimes.clear();
  w.meta = { ...META_V2 };
  w.schema = new Map(Object.entries(schema));
  w.counts = new Map(Object.entries(counts));
  w.picker = null;
}

function stagePick(filename: string, bytes: Uint8Array) {
  const w = W();
  const sqliteUri = `${CACHE}picked/${filename}`;
  w.files.set(sqliteUri, bytes);
  w.mtimes.set(sqliteUri, 1000);
  const manifest = {
    format: "salvora-pack-manifest",
    version: 1,
    id: "tienda-prueba",
    file: filename,
    sha256: sha256Hex(bytes),
    sizeBytes: bytes.length,
    name: "Tienda de prueba",
  };
  const manifestUri = `${sqliteUri}.json`;
  const manifestText = JSON.stringify(manifest);
  w.files.set(manifestUri, new TextEncoder().encode(manifestText));
  w.picker = {
    canceled: false,
    assets: [
      { uri: sqliteUri, name: filename, size: bytes.length },
      { uri: manifestUri, name: `${filename}.json`, size: manifestText.length },
    ],
  };
}

beforeEach(() => {
  seed(FULL_SCHEMA, { chunks: 12, guides: 3, regions: 2, facts: 9 });
});

describe("M-35/m-91: la puerta valida el esquema interno, no solo la meta", () => {
  it("un pack firmado sin la tabla de guías se rechaza y no entra en corpus/", async () => {
    const broken = { ...FULL_SCHEMA };
    delete broken.guides;
    seed(broken, { chunks: 12, regions: 2, facts: 9 });
    stagePick("roto.sqlite", PACK_BYTES);
    const outcome = await importPackFromFile(async () => true);
    expect(outcome).toEqual({ status: "rejected", reason: "not-a-pack" });
    expect(W().files.has(`${CORPUS}roto.sqlite`)).toBe(false);
  });

  it("un pack firmado sin trozos se rechaza como no-pack", async () => {
    seed(FULL_SCHEMA, { chunks: 0, guides: 0, regions: 0, facts: 0 });
    stagePick("vacio.sqlite", PACK_BYTES);
    const outcome = await importPackFromFile(async () => true);
    expect(outcome).toEqual({ status: "rejected", reason: "not-a-pack" });
    expect(W().files.has(`${CORPUS}vacio.sqlite`)).toBe(false);
  });

  it("un pack firmado con el esquema completo entra y deja asiento en el diario", async () => {
    stagePick("tienda.sqlite", PACK_BYTES);
    const outcome = await importPackFromFile(async () => true);
    expect(outcome.status).toBe("imported");
    expect(W().files.has(`${CORPUS}tienda.sqlite`)).toBe(true);
    const record = await getInstallRecord("local-tienda");
    expect(record?.status).toBe("installed");
    expect(record?.sha256).toBe(sha256Hex(PACK_BYTES));
  });
});

describe("M-35/B2: la marca de verificado exige los bytes verificados ahora", () => {
  function seedImported() {
    seed(FULL_SCHEMA, { chunks: 12, guides: 3, regions: 2, facts: 9 });
    const w = W();
    w.files.set(`${CORPUS}tienda.sqlite`, PACK_BYTES.slice());
    w.mtimes.set(`${CORPUS}tienda.sqlite`, 1000);
    const registry = {
      version: 1,
      packs: {
        "tienda.sqlite": {
          origin: "salvora",
          sha256: sha256Hex(PACK_BYTES),
          sizeBytes: PACK_BYTES.length,
          name: "Tienda de prueba",
          importedAt: "2026-11-01T00:00:00.000Z",
        },
      },
    };
    w.files.set(`${CORPUS}imported-packs.json`, new TextEncoder().encode(JSON.stringify(registry)));
  }

  it("con los bytes intactos, la marca está", async () => {
    seedImported();
    const marks = await verifiedImportedPacks();
    expect(marks.get("local-tienda")).toEqual({ name: "Tienda de prueba", origin: "salvora" });
  });

  it("con los bytes manipulados tras la importación, la marca cae", async () => {
    seedImported();
    const tampered = PACK_BYTES.slice();
    tampered[7] ^= 0xff; // same size, different bytes
    W().files.set(`${CORPUS}tienda.sqlite`, tampered);
    W().mtimes.set(`${CORPUS}tienda.sqlite`, 2000);
    const marks = await verifiedImportedPacks();
    expect(marks.has("local-tienda")).toBe(false);
  });
});
