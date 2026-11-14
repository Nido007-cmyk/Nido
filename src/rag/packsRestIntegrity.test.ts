/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * M-35 (auditoría 2026-11-13, carril 07) — integridad de los packs en
 * reposo, a nivel de packs.ts:
 *
 *  - F-03: un `.sqlite` suelto en corpus/ (sin pin de catálogo y sin
 *    registro de la puerta firmada) NO es un pack: no se lista, no se
 *    abre, no responde.
 *  - B3: las respuestas deterministas de emergencia (hechos) solo salen
 *    de packs del catálogo firmado; un pack importado por la puerta
 *    sirve guías y búsqueda, no números de emergencia.
 *  - P-39 (B7): un pack cuyas filas superan los topes no se abre.
 *
 * El mundo falso trae un FS en memoria con diario de instalación y
 * registro de importados, porque eso es lo que un pack instalado por un
 * flujo legítimo tiene de verdad: pin (catálogo o registro) y, tras la
 * primera verificación, asiento en el diario.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const sha256Hex = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

interface FakeFile {
  bytes: Uint8Array | null; // null: solo existe su tamaño (vía rápida por diario)
  size: number;
  mtimeSec: number;
}
interface FakeDb {
  meta: Record<string, string>;
  regions: Array<Record<string, string>>;
  facts: Array<Record<string, string>>;
  chunkCount: number;
}
interface World {
  files: Map<string, FakeFile>;
  dbs: Map<string, FakeDb>;
  openedDbs: string[];
}
const W = (): World => (globalThis as unknown as { __priW: World }).__priW;
(globalThis as unknown as { __priW: World }).__priW = { files: new Map(), dbs: new Map(), openedDbs: [] } as World;

const DOCS = "file:///docs/";
const CORPUS = `${DOCS}corpus/`;
const JOURNAL = `${DOCS}nido-install-state.json`;
const REGISTRY = `${CORPUS}imported-packs.json`;

vi.mock("expo-file-system/legacy", () => ({
  documentDirectory: DOCS,
  EncodingType: { Base64: "base64", UTF8: "utf8" },
  getInfoAsync: async (uri: string) => {
    const f = W().files.get(uri);
    return f
      ? { exists: true, isDirectory: false, size: f.size, modificationTime: f.mtimeSec }
      : { exists: false, isDirectory: false, size: 0 };
  },
  readDirectoryAsync: async (uri: string) =>
    [...W().files.keys()].filter((k) => k.startsWith(uri)).map((k) => k.slice(uri.length)),
  readAsStringAsync: async (uri: string, opts?: { encoding?: string; position?: number; length?: number }) => {
    const f = W().files.get(uri);
    if (!f || !f.bytes) throw new Error(`ENOENT ${uri}`);
    if (opts?.encoding === "base64") {
      const start = opts.position ?? 0;
      const len = opts.length ?? f.bytes.length - start;
      return Buffer.from(f.bytes.subarray(start, start + len)).toString("base64");
    }
    return Buffer.from(f.bytes).toString("utf8");
  },
  writeAsStringAsync: async (uri: string, text: string) => {
    const bytes = new TextEncoder().encode(text);
    W().files.set(uri, { bytes, size: bytes.length, mtimeSec: 9000 });
  },
  moveAsync: async ({ from, to }: { from: string; to: string }) => {
    const f = W().files.get(from);
    if (!f) throw new Error(`ENOENT ${from}`);
    W().files.set(to, f);
    W().files.delete(from);
  },
  deleteAsync: async (uri: string) => {
    W().files.delete(uri);
  },
  makeDirectoryAsync: async () => {},
}));

vi.mock("expo-sqlite", () => ({
  openDatabaseAsync: async (name: string) => {
    W().openedDbs.push(name);
    const db = W().dbs.get(name);
    if (!db) throw new Error(`no such database ${name}`);
    return {
      getAllAsync: async (sql: string) => {
        if (/FROM meta/.test(sql)) return Object.entries(db.meta).map(([key, value]) => ({ key, value }));
        if (/FROM regions/.test(sql)) return db.regions;
        if (/FROM facts/.test(sql)) return db.facts;
        if (/FROM guides/.test(sql)) return [];
        if (/chunks_fts MATCH/.test(sql)) return [];
        if (/FROM chunks/.test(sql)) return [];
        throw new Error(`unexpected SQL ${sql}`);
      },
      getFirstAsync: async (sql: string) => {
        if (/COUNT\(\*\) AS n FROM chunks/.test(sql)) return { n: db.chunkCount };
        if (/COUNT\(\*\) AS n FROM guides/.test(sql)) return { n: 0 };
        if (/COUNT\(\*\) AS n FROM regions/.test(sql)) return { n: db.regions.length };
        if (/COUNT\(\*\) AS n FROM facts/.test(sql)) return { n: db.facts.length };
        return null;
      },
      closeAsync: async () => {},
    };
  },
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

// The real NIDO Local facts for Chile, in the pack tables' row shape.
const factsDoc = JSON.parse(
  readFileSync(new URL("../../knowledge-packs/nido-local/facts.json", import.meta.url), "utf8")
);
const clRegionRow = {
  code: "CL",
  names: JSON.stringify(factsDoc.regions.CL.names),
  aliases: JSON.stringify(factsDoc.regions.CL.aliases),
  phrases: JSON.stringify(factsDoc.regions.CL.in ?? {}),
};
const clFactRows = (factsDoc.facts as Array<Record<string, any>>)
  .filter((f) => f.region === "CL")
  .map((f) => ({
    region: f.region,
    key: f.key,
    value: f.value,
    label: JSON.stringify(f.label),
    note: JSON.stringify(f.note ?? {}),
    source_title: f.source.title,
    source_url: f.source.url,
    quote: f.source.quote,
    checked: f.source.checked,
  }));

const META_V2 = { format: "nido-knowledge-pack", formatVersion: "2", dims: "384", embeddingModelSha256: "x" };
const TIENDA_BYTES = new Uint8Array(2048);
for (let i = 0; i < TIENDA_BYTES.length; i++) TIENDA_BYTES[i] = (i * 11 + 7) & 0xff;
const SUELTO_BYTES = new Uint8Array(1024).fill(65);

function seedWorld() {
  const w = W();
  w.files.clear();
  w.dbs.clear();
  w.openedDbs.length = 0;
  const local = catalog.CORPUS_CATALOG.find((c) => c.id === "nido-local")!;
  // Catalog pack: installed by the manager — journal proof, mtime-bound.
  w.files.set(`${CORPUS}nido-local.sqlite`, { bytes: null, size: local.sizeBytes, mtimeSec: 4242 });
  const journal = {
    version: 1,
    records: {
      "nido-local": {
        assetId: "nido-local",
        status: "installed",
        sizeBytes: local.sizeBytes,
        sha256: local.sha256,
        mtimeMs: 4242 * 1000,
        updatedAt: 1,
      },
    },
  };
  const journalBytes = new TextEncoder().encode(JSON.stringify(journal));
  w.files.set(JOURNAL, { bytes: journalBytes, size: journalBytes.length, mtimeSec: 1 });
  // Imported pack: the door's registry is its pin (no journal seat yet —
  // pre-0.1.99 imports are adopted on first open by re-hash).
  w.files.set(`${CORPUS}tienda.sqlite`, { bytes: TIENDA_BYTES, size: TIENDA_BYTES.length, mtimeSec: 777 });
  const registry = {
    version: 1,
    packs: {
      "tienda.sqlite": {
        origin: "salvora",
        sha256: sha256Hex(TIENDA_BYTES),
        sizeBytes: TIENDA_BYTES.length,
        name: "Tienda",
        importedAt: "2026-11-01T00:00:00.000Z",
      },
    },
  };
  const registryBytes = new TextEncoder().encode(JSON.stringify(registry));
  w.files.set(REGISTRY, { bytes: registryBytes, size: registryBytes.length, mtimeSec: 2 });
  // Stray file: no catalog pin, no registry record.
  w.files.set(`${CORPUS}suelto.sqlite`, { bytes: SUELTO_BYTES, size: SUELTO_BYTES.length, mtimeSec: 555 });
  const empty: FakeDb = { meta: { ...META_V2 }, regions: [], facts: [], chunkCount: 10 };
  w.dbs.set("nido-local.sqlite", { ...empty, regions: [], facts: [] });
  w.dbs.set("tienda.sqlite", { ...empty, regions: [], facts: [] });
  w.dbs.set("suelto.sqlite", { ...empty, regions: [], facts: [] });
}

beforeEach(async () => {
  seedWorld();
  await packs.closeAllPacks();
});

const CL_QUESTION = "¿a qué número llamo para una ambulancia en Chile?";

describe("M-35/F-03: un fichero suelto en corpus/ no es un pack", () => {
  it("knowledgePacks no lo lista; el importado con registro sí aparece, con su pin", async () => {
    const list = await packs.knowledgePacks();
    const ids = list.map((p) => p.id);
    expect(ids).toContain("nido-local");
    expect(ids).not.toContain("local-suelto");
    const tienda = list.find((p) => p.id === "local-tienda");
    expect(tienda).toBeDefined();
    expect(tienda!.sha256).toBe(sha256Hex(TIENDA_BYTES));
    expect(tienda!.sizeBytes).toBe(TIENDA_BYTES.length);
  });

  it("un hecho que solo vive en el fichero suelto no responde como emergencia", async () => {
    W().dbs.get("suelto.sqlite")!.regions = [clRegionRow];
    W().dbs.get("suelto.sqlite")!.facts = clFactRows;
    const answer = await packs.answerFromPackFacts(CL_QUESTION, "es");
    expect(answer).toBeNull();
    expect(W().openedDbs).not.toContain("suelto.sqlite");
  });
});

describe("M-35/B3: autoridad de emergencia solo del catálogo firmado", () => {
  it("un pack importado no responde números de emergencia aunque cubra el país", async () => {
    W().dbs.get("tienda.sqlite")!.regions = [clRegionRow];
    W().dbs.get("tienda.sqlite")!.facts = clFactRows;
    const answer = await packs.answerFromPackFacts(CL_QUESTION, "es");
    expect(answer).toBeNull();
  });

  it("el pack del catálogo sí responde (control)", async () => {
    W().dbs.get("nido-local.sqlite")!.regions = [clRegionRow];
    W().dbs.get("nido-local.sqlite")!.facts = clFactRows;
    const answer = await packs.answerFromPackFacts(CL_QUESTION, "es");
    expect(answer).not.toBeNull();
    expect(answer!.text).toContain("131");
  });

  it("loadAllPackFacts tampoco trae hechos de un importado", async () => {
    W().dbs.get("tienda.sqlite")!.regions = [clRegionRow];
    W().dbs.get("tienda.sqlite")!.facts = clFactRows;
    const all = await packs.loadAllPackFacts();
    expect(all.facts).toEqual([]);
    expect(all.regions).toEqual([]);
  });
});

describe("M-35/P-39: topes de filas al abrir", () => {
  it("un pack del catálogo con más trozos que el tope no se abre ni responde", async () => {
    const db = W().dbs.get("nido-local.sqlite")!;
    db.regions = [clRegionRow];
    db.facts = clFactRows;
    db.chunkCount = 2_000_000;
    const answer = await packs.answerFromPackFacts(CL_QUESTION, "es");
    expect(answer).toBeNull();
  });
});
