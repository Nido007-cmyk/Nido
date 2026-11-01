/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * P-01 paso 1: el sello de formato, la migración en sitio y el lector
 * dual, contra el db.ts REAL sobre node:sqlite (mismo arnés que
 * db.embeddingModel.test.ts). Lo que se prueba aquí no es la geometría
 * (eso es la sonda, vectorFormat.probe.test.ts) sino el almacenamiento:
 * qué bytes caen en disco en cada estado del sello, que la migración no
 * pierde ni un vector ni altera los ya convertidos, que interrumpida
 * reanuda, que un reset a mitad la termina sin error, y que retrieve()
 * sirve LO MISMO sobre la misma base en float32, mixta y migrada —
 * incluidas las literales R-03/R-04 (sala 214, la cita del martes, el
 * teléfono) servidas por el lector ya migrado, no heredadas.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { copyFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

(globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;

const FIX = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__");

type Fx = { DOC: string; activeEmbedding: string | null };
const g = globalThis as unknown as { __nidoVfFx?: Fx };
g.__nidoVfFx = g.__nidoVfFx ?? { DOC: "file:///docs/", activeEmbedding: null };
const fx = g.__nidoVfFx;

vi.mock("expo-sqlite", () => ({ deleteDatabaseAsync: async () => {} }));
vi.mock("expo-file-system/legacy", () => ({
  documentDirectory: "file:///docs/",
  getInfoAsync: async () => ({ exists: false }),
  moveAsync: async () => {
    throw new Error("move no usado");
  },
  deleteAsync: async () => {},
}));
vi.mock("../models/settings", () => ({
  getActiveModelId: async (kind: string) =>
    kind === "embedding" ? ((globalThis as unknown as { __nidoVfFx?: Fx }).__nidoVfFx?.activeEmbedding ?? null) : null,
}));
vi.mock("../privacy/keyManager", async () => {
  const { fakeKeyManagerModule } = await import("../security/secureDbTestHarness");
  return fakeKeyManagerModule();
});
// La consulta de retrieve() queda fijada: vector e1 (dim 384) y modelo
// bge — los vectores de estas fixtures se construyen a coseno exacto
// contra e1, así que lo servido es calculable a mano.
vi.mock("./embed", () => ({
  embeddingEngine: {
    embedQueryTagged: async () => {
      const vector = new Float32Array(384);
      vector[0] = 1;
      return {
        vector,
        modelSha256: "ec38e8da142596baa913124ae50550de284b6916bf59577ef2f0cb9660c2f514",
      };
    },
    loadedModelSha256: "ec38e8da142596baa913124ae50550de284b6916bf59577ef2f0cb9660c2f514",
  },
}));
vi.mock("./packs", () => ({ searchPacks: async () => ({ lexical: [], semantic: [] }) }));

import { setSecureDbTestDriver } from "../security/secureDatabase";
import { makeNodeSqliteHandle } from "../security/secureDbTestHarness";
import {
  countChunkVectors,
  countFloat32VectorRows,
  createCustomCollection,
  getDb,
  getEmbeddingStamp,
  getVectorStorageFormat,
  insertChunk,
  insertEmbeddingForModel,
  listFloat32VectorBatch,
  resetDatabase,
  resetEmbeddingsForModel,
  sealVectorStorageInt8,
  storeQuantizedVectorBatch,
} from "./db";
import { migrateVectorStorageFormat } from "./vectorFormatMigration";
import { retrieve } from "./retrieve";
import { quantizeVectorInt8 } from "./pure";
import { isNativeGateTaken, nativeGateBegin, nativeGateEnd } from "../inference/nativeGate";

const BGE = "ec38e8da142596baa913124ae50550de284b6916bf59577ef2f0cb9660c2f514";
const E5 = "802c868f57ccddd2e0c80645c3db1cb96a1aa50986a057cbaee2526f6e474cde";
const DIM = 384;

let tmpDirs: string[] = [];

function useFreshDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "nido-vf-"));
  tmpDirs.push(dir);
  const dbPath = join(dir, "k.db");
  copyFileSync(join(FIX, "knowledge.v1.db"), dbPath);
  setSecureDbTestDriver({
    dbDir: () => `${fx.DOC}SQLite/`,
    openDb: async () => makeNodeSqliteHandle(dbPath, { transactional: true }),
    exists: async (path: string) => !path.endsWith(".migtmp") && !path.endsWith(".sqlcipher"),
    remove: async () => {},
    rename: async () => {
      throw new Error("rename no usado");
    },
    writeFile: async () => {
      throw new Error("writeFile no usado");
    },
  });
  return dbPath;
}

function rawRows(
  dbPath: string,
  sql: string
): Array<{ chunk_id: string; embedding: Uint8Array; dim: number; len: number }> {
  const d = new DatabaseSync(dbPath);
  try {
    return d.prepare(sql).all() as Array<{
      chunk_id: string;
      embedding: Uint8Array;
      dim: number;
      len: number;
    }>;
  } finally {
    d.close();
  }
}

const allVectorRows = (dbPath: string) =>
  rawRows(
    dbPath,
    "SELECT chunk_id, embedding, dim, length(embedding) AS len FROM chunk_embeddings ORDER BY chunk_id"
  );

function rawScalar(dbPath: string, sql: string): number {
  const d = new DatabaseSync(dbPath);
  try {
    const row = d.prepare(sql).get() as { n: number };
    return row.n;
  } finally {
    d.close();
  }
}

/** Vector a coseno exacto t contra la consulta e1: [t, √(1−t²), 0, …]. */
function vecAtCos(t: number): Float32Array {
  const v = new Float32Array(DIM);
  v[0] = t;
  v[1] = Math.sqrt(Math.max(0, 1 - t * t));
  return v;
}

/** Vector pseudoaleatorio determinista (LCG) para las pruebas de volumen. */
function vecSeeded(seed: number): Float32Array {
  let a = seed | 0;
  const next = () => {
    a = (Math.imul(a, 1664525) + 1013904223) | 0;
    return ((a >>> 0) / 4294967296) * 2 - 1;
  };
  const v = new Float32Array(DIM);
  for (let i = 0; i < DIM; i++) v[i] = next();
  return v;
}

const chunk = (id: string, extra?: { collectionId?: string; title?: string; body?: string }) => ({
  chunkId: id,
  docId: `d-${id}`,
  title: extra?.title ?? `T ${id}`,
  body: extra?.body ?? `body ${id}`,
  ...(extra?.collectionId ? { collectionId: extra.collectionId } : {}),
});

/** Inserta `n` trozos con vectores float32 (sello ausente) y devuelve sus bytes esperados tras cuantizar. */
async function seedFloatCorpus(n: number): Promise<Map<string, Uint8Array>> {
  const expected = new Map<string, Uint8Array>();
  for (let i = 0; i < n; i++) {
    const v = vecSeeded(10_000 + i);
    await insertChunk(chunk(`c${i}`), v);
    expected.set(`c${i}`, quantizeVectorInt8(v));
  }
  return expected;
}

/** Convierte UN lote con las piezas exportadas: así se simula una migración que muere a mitad. */
async function convertOneBatch(limit: number): Promise<void> {
  const stamp = await getEmbeddingStamp();
  const batch = await listFloat32VectorBatch(limit);
  const updates = batch.map((row) => ({
    chunkId: row.chunkId,
    bytes: quantizeVectorInt8(
      new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.dim)
    ),
  }));
  expect(await storeQuantizedVectorBatch(updates, stamp)).toBe(true);
}

beforeEach(async () => {
  tmpDirs = [];
  fx.activeEmbedding = null;
  await resetDatabase();
});

afterEach(() => {
  if (isNativeGateTaken()) nativeGateEnd();
  setSecureDbTestDriver(null);
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
  tmpDirs = [];
});

describe("P-01 · el sello y las escrituras", () => {
  it("sin sello, ambos productores almacenan float32 (1.536 B) y el formato lee float32", async () => {
    const dbPath = useFreshDb();
    await getDb();
    expect(await getVectorStorageFormat()).toBe("float32");
    await insertChunk(chunk("a"), vecAtCos(0.9));
    await insertChunk(chunk("b"), vecAtCos(0.8));
    expect(await insertEmbeddingForModel("b", vecAtCos(0.85), BGE)).toBe(true);
    const rows = allVectorRows(dbPath);
    expect(rows.map((r) => r.len)).toEqual([DIM * 4, DIM * 4]);
    expect(await countFloat32VectorRows()).toBe(2);
  });

  it("con el sello en int8, ambos productores almacenan 384 B y los bytes son la cuantización exacta", async () => {
    const dbPath = useFreshDb();
    await getDb();
    // Base vacía de vectores: el sellado es legal (conteo 0) y fija la escritura.
    expect(await sealVectorStorageInt8(await getEmbeddingStamp())).toBe(true);
    expect(await getVectorStorageFormat()).toBe("int8");
    const v = vecAtCos(0.9);
    await insertChunk(chunk("a"), v);
    await insertChunk(chunk("b"), vecAtCos(0.8));
    const v2 = vecAtCos(0.85);
    expect(await insertEmbeddingForModel("b", v2, BGE)).toBe(true);
    const rows = allVectorRows(dbPath);
    expect(rows.map((r) => r.len)).toEqual([DIM, DIM]);
    expect(rows.find((r) => r.chunk_id === "a")!.embedding).toEqual(quantizeVectorInt8(v));
    expect(rows.find((r) => r.chunk_id === "b")!.embedding).toEqual(quantizeVectorInt8(v2));
    expect(await countFloat32VectorRows()).toBe(0);
  });

  it("el sellado se niega si queda alguna fila float32 (y no toca el sello)", async () => {
    useFreshDb();
    await getDb();
    await insertChunk(chunk("a"), vecAtCos(0.9));
    expect(await sealVectorStorageInt8(await getEmbeddingStamp())).toBe(false);
    expect(await getVectorStorageFormat()).toBe("float32");
  });
});

describe("P-01 · la migración en sitio", () => {
  it("convierte todas las filas a 384 B sin perder ni una, con los bytes exactos y la contabilidad medida", async () => {
    const dbPath = useFreshDb();
    await getDb();
    // 130 filas: dos lotes completos de 64 y un resto de 2.
    const expected = await seedFloatCorpus(130);
    expect(await countChunkVectors()).toEqual({ chunks: 130, withVector: 130 });
    expect(rawScalar(dbPath, "SELECT SUM(length(embedding)) AS n FROM chunk_embeddings")).toBe(
      130 * DIM * 4
    );
    const progress = await migrateVectorStorageFormat();
    expect(progress).toEqual({ remaining: 0, running: false });
    expect(await countFloat32VectorRows()).toBe(0);
    expect(await getVectorStorageFormat()).toBe("int8");
    const rows = allVectorRows(dbPath);
    expect(rows.length).toBe(130);
    // Ni un vector perdido ni alterado: cada fila es la cuantización
    // exacta de su float32 original, cuarto de tamaño (199.680 → 49.920 B).
    for (const r of rows) {
      expect(r.len).toBe(DIM);
      expect(r.embedding).toEqual(expected.get(r.chunk_id)!);
    }
    expect(rawScalar(dbPath, "SELECT SUM(length(embedding)) AS n FROM chunk_embeddings")).toBe(
      130 * DIM
    );
  });

  it("interrumpida a mitad (un lote aplicado, sello sin voltear), la siguiente apertura reanuda y termina", async () => {
    const dbPath = useFreshDb();
    await getDb();
    const expected = await seedFloatCorpus(130);
    await convertOneBatch(64); // la "muerte" llega tras el primer lote
    expect(await countFloat32VectorRows()).toBe(66);
    expect(await getVectorStorageFormat()).toBe("float32"); // el sello NO se volteó
    const afterDeath = new Map(allVectorRows(dbPath).map((r) => [r.chunk_id, r.embedding]));
    await migrateVectorStorageFormat();
    expect(await countFloat32VectorRows()).toBe(0);
    expect(await getVectorStorageFormat()).toBe("int8");
    for (const r of allVectorRows(dbPath)) {
      expect(r.embedding).toEqual(expected.get(r.chunk_id)!);
      // Lo convertido antes de la muerte no se re-convirtió: byte a byte igual.
      if (afterDeath.get(r.chunk_id)!.length === DIM) {
        expect(r.embedding).toEqual(afterDeath.get(r.chunk_id)!);
      }
    }
  });

  it("segunda corrida sobre lo migrado: idempotente, las filas quedan byte a byte iguales", async () => {
    const dbPath = useFreshDb();
    await getDb();
    await seedFloatCorpus(20);
    await migrateVectorStorageFormat();
    const once = allVectorRows(dbPath).map((r) => [r.chunk_id, r.embedding] as const);
    await migrateVectorStorageFormat();
    const twice = allVectorRows(dbPath).map((r) => [r.chunk_id, r.embedding] as const);
    expect(twice).toEqual(once);
    expect(await getVectorStorageFormat()).toBe("int8");
  });

  it("un reset de modelo a mitad de migración: la migración termina sin filas y sin error", async () => {
    const dbPath = useFreshDb();
    await getDb();
    await seedFloatCorpus(130);
    await convertOneBatch(64);
    await resetEmbeddingsForModel(E5); // el cambio de modelo borra TODOS los vectores
    expect(rawScalar(dbPath, "SELECT COUNT(*) AS n FROM chunk_embeddings")).toBe(0);
    await expect(migrateVectorStorageFormat()).resolves.toEqual({ remaining: 0, running: false });
    expect(rawScalar(dbPath, "SELECT COUNT(*) AS n FROM chunk_embeddings")).toBe(0);
    expect(await countChunkVectors()).toEqual({ chunks: 130, withVector: 0 });
  });

  it("un lote capturado antes del reset no escribe nada después (la guarda del sello de modelo)", async () => {
    const dbPath = useFreshDb();
    await getDb();
    await seedFloatCorpus(3);
    const oldStamp = await getEmbeddingStamp();
    const batch = await listFloat32VectorBatch(3);
    await resetEmbeddingsForModel(E5);
    const updates = batch.map((row) => ({
      chunkId: row.chunkId,
      bytes: quantizeVectorInt8(
        new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.dim)
      ),
    }));
    expect(await storeQuantizedVectorBatch(updates, oldStamp)).toBe(false);
    expect(rawScalar(dbPath, "SELECT COUNT(*) AS n FROM chunk_embeddings")).toBe(0);
  });

  it("con la puerta nativa tomada no convierte nada; al liberarse, drena", async () => {
    useFreshDb();
    await getDb();
    await seedFloatCorpus(10);
    nativeGateBegin();
    const pending = migrateVectorStorageFormat();
    // Deja que la migración arranque y llegue a la puerta.
    await new Promise((r) => setTimeout(r, 50));
    expect(await countFloat32VectorRows()).toBe(10);
    nativeGateEnd();
    await expect(pending).resolves.toEqual({ remaining: 0, running: false });
    expect(await countFloat32VectorRows()).toBe(0);
  });
});

describe("P-01 · retrieve() sobre la misma base en los tres estados", () => {
  const NOTA_BODY =
    "La cita es el martes 10 de noviembre de 2026 a las 9:30 en la sala 214. Tel. 520-555-0147.";
  const QUERY = "¿En qué sala es la cita del martes?";

  async function seedSalaScenario(): Promise<void> {
    await getDb();
    await createCustomCollection({
      id: "col-nota",
      name: "Notas",
      sourceFilename: "nota.txt",
      docCount: 1,
      chunkCount: 1,
      sizeBytes: 64,
    });
    // La nota del usuario (R-03/R-04) a coseno 0,80; señuelos a 0,78 y
    // 0,75 que ensanchan el rango para que la poda por margen no se coma
    // a la guía (con solo [0,80 · 0,75] el cutoff sería 0,78); uno a
    // 0,62 que la poda sí retira; ocho rellenos bajo el piso bge (0,60).
    await insertChunk(
      chunk("nota", { collectionId: "col-nota", title: "Cita del martes", body: NOTA_BODY }),
      vecAtCos(0.8)
    );
    await insertChunk(
      chunk("guia", {
        title: "Emergencias",
        body: "Para una emergencia llama al número de emergencias de tu país y pide una ambulancia.",
      }),
      vecAtCos(0.75)
    );
    await insertChunk(
      chunk("senal", {
        title: "Señales de alarma",
        body: "Reconoce las señales de alarma de un infarto y actúa sin demora.",
      }),
      vecAtCos(0.78)
    );
    await insertChunk(
      chunk("bajo", {
        title: "Primeros auxilios",
        body: "Nociones básicas de primeros auxilios para el hogar.",
      }),
      vecAtCos(0.62)
    );
    for (let i = 0; i < 8; i++) {
      await insertChunk(
        chunk(`relleno${i}`, {
          title: `Tema ${i}`,
          body: `Contenido de relleno número ${i} sobre jardinería y cocina.`,
        }),
        vecAtCos(0.3 + i * 0.03)
      );
    }
  }

  it("sirve lo mismo en float32, mixta y migrada — y la nota va primera con su texto entero", async () => {
    const dbPath = useFreshDb();
    await seedSalaScenario();
    const ids = (rs: Awaited<ReturnType<typeof retrieve>>) => rs.map((c) => c.chunkId);

    const inFloat = await retrieve(QUERY);
    expect(ids(inFloat)).toContain("nota");
    expect(ids(inFloat)).toContain("guia");
    expect(ids(inFloat)).toContain("senal");
    expect(ids(inFloat)).not.toContain("bajo"); // la poda lo retira en los tres estados
    expect(inFloat[0].chunkId).toBe("nota");

    // Estado mixto: el primer lote (nota, guía, señal — los tres
    // servidos) ya es int8 y el sello sigue en float32: un estado
    // válido y permanente.
    await convertOneBatch(3);
    expect(allVectorRows(dbPath).find((r) => r.chunk_id === "nota")!.len).toBe(DIM);
    expect(await getVectorStorageFormat()).toBe("float32");
    const inMixed = await retrieve(QUERY);
    expect(ids(inMixed)).toEqual(ids(inFloat));

    // Estado migrado: todo int8 y el sello volteado.
    await migrateVectorStorageFormat();
    expect(await getVectorStorageFormat()).toBe("int8");
    const inInt8 = await retrieve(QUERY);
    expect(ids(inInt8)).toEqual(ids(inFloat));

    // Las literales R-03/R-04, servidas por el lector YA migrado (no
    // heredadas de antes de la migración): sala, día, hora y teléfono.
    expect(inInt8[0].chunkId).toBe("nota");
    expect(inInt8[0].body).toContain("sala 214");
    expect(inInt8[0].body).toContain("martes 10 de noviembre de 2026");
    expect(inInt8[0].body).toContain("9:30");
    expect(inInt8[0].body).toContain("520-555-0147");
  });

  it("una fila corrupta (dim*2 B) nunca se sirve con puntuación fantasma; las vecinas no se enteran", async () => {
    const dbPath = useFreshDb();
    await seedSalaScenario();
    const d = new DatabaseSync(dbPath);
    try {
      d.prepare(
        "INSERT INTO chunks (chunk_id, doc_id, title, body, source) VALUES ('corrupta', 'd-corrupta', 'Fila corrupta', 'Texto de la fila corrupta', NULL)"
      ).run();
      d.prepare(
        "INSERT INTO chunks_fts (chunk_id, doc_id, title, body) VALUES ('corrupta', 'd-corrupta', 'Fila corrupta', 'Texto de la fila corrupta')"
      ).run();
      d.prepare(
        "INSERT INTO chunk_embeddings (chunk_id, embedding, dim) VALUES ('corrupta', ?, 384)"
      ).run(new Uint8Array(DIM * 2));
    } finally {
      d.close();
    }
    // La corrupta no cuenta como float32 para la migración (768 ≠ 1.536).
    expect(await countFloat32VectorRows()).toBe(12);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const results = await retrieve(QUERY);
      expect(results.map((c) => c.chunkId)).not.toContain("corrupta");
      expect(results.map((c) => c.chunkId)).toContain("nota");
      // Su destino es visible: el aviso la nombra.
      expect(warn.mock.calls.some((args) => String(args[0]).includes("corrupta"))).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });
});
