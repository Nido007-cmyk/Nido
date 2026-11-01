/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * db.importWarnings.test.ts — H-11 + C-06 (capa de base): los avisos de
 * importación persisten en `custom_collection_warnings` y la identidad
 * de los documentos importados en `custom_collection_docs`, en la misma
 * base cifrada, como tablas aditivas (sin bump de schema_version).
 *
 * Corre el SQL real de db.ts sobre una copia del fixture v1
 * (node:sqlite), el arnés de db.embeddingModel.test.ts: el fixture no
 * trae las tablas nuevas, así que cada prueba ejercita también su
 * creación aditiva al abrir.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { copyFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

(globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;

const FIX = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__");

type Fx = { DOC: string };
const g = globalThis as unknown as { __nidoWarnFx?: Fx };
g.__nidoWarnFx = g.__nidoWarnFx ?? { DOC: "file:///docs/" };
const fx = g.__nidoWarnFx;

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
  getActiveModelId: async () => null,
}));
vi.mock("../privacy/keyManager", async () => {
  const { fakeKeyManagerModule } = await import("../security/secureDbTestHarness");
  return fakeKeyManagerModule();
});

import { setSecureDbTestDriver } from "../security/secureDatabase";
import { makeNodeSqliteHandle } from "../security/secureDbTestHarness";
import {
  createCustomCollection,
  deleteCustomCollection,
  dismissImportWarnings,
  getDb,
  listAllCollectionDocFingerprints,
  listImportWarnings,
  recordCollectionDocFingerprints,
  recordImportWarnings,
  resetDatabase,
} from "./db";

let tmpDirs: string[] = [];


function useFreshDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "nido-warn-"));
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

const coll = (id: string, name: string) => ({
  id,
  name,
  sourceFilename: "f.pdf",
  docCount: 1,
  chunkCount: 1,
  sizeBytes: 10,
});

beforeEach(async () => {
  useFreshDb();
  await getDb(); // abre y crea el esquema (con las tablas aditivas nuevas)
});

afterEach(async () => {
  await resetDatabase().catch(() => {});
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
  tmpDirs = [];
});

describe("H-11: persistencia de avisos de importación", () => {
  it("escritura y relectura: nombre, razón, huella OCR y detail vuelven intactos", async () => {
    await createCustomCollection(coll("c1", "Clínica"));
    await recordImportWarnings("c1", ["mixto.pdf"], [
      { name: "mixto.pdf", reason: "ocrFailed", ocrCode: "OCR_FAILED", ocrMessage: "engine died" },
      { name: "nota.txt", reason: "alreadyImported", detail: "Otra", previousName: "nota-vieja.txt" },
    ]);
    const byId = await listImportWarnings(["c1"]);
    expect(byId.c1).toEqual([
      { name: "mixto.pdf", reason: "ocrFailed", ocrCode: "OCR_FAILED", ocrMessage: "engine died" },
      { name: "nota.txt", reason: "alreadyImported", detail: "Otra", previousName: "nota-vieja.txt" },
    ]);
  });

  it("reemplazo por fichero: re-registrado con otra razón sustituye; re-registrado limpio borra sus filas", async () => {
    await createCustomCollection(coll("c1", "Clínica"));
    await recordImportWarnings("c1", ["mixto.pdf"], [
      { name: "mixto.pdf", reason: "ocrFailed", ocrCode: "OCR_FAILED", ocrMessage: "engine died" },
    ]);
    await recordImportWarnings("c1", ["mixto.pdf"], [{ name: "mixto.pdf", reason: "ocrEmpty" }]);
    expect((await listImportWarnings(["c1"])).c1).toEqual([{ name: "mixto.pdf", reason: "ocrEmpty" }]);
    await recordImportWarnings("c1", ["mixto.pdf"], []);
    expect((await listImportWarnings(["c1"])).c1 ?? []).toEqual([]);
  });

  it("cascada: borrar la colección se lleva sus avisos y sus huellas, y no toca los de otra", async () => {
    await createCustomCollection(coll("c1", "Una"));
    await createCustomCollection(coll("c2", "Otra"));
    await recordImportWarnings("c1", ["a.pdf"], [{ name: "a.pdf", reason: "ocrEmpty" }]);
    await recordImportWarnings("c2", ["b.pdf"], [{ name: "b.pdf", reason: "noText" }]);
    await recordCollectionDocFingerprints("c1", [
      { docId: "c1-doc0-a", fingerprint: "f".repeat(64), fileName: "a.pdf", kind: "import" },
    ]);
    await recordCollectionDocFingerprints("c2", [
      { docId: "c2-doc0-b", fingerprint: "e".repeat(64), fileName: "b.pdf", kind: "import" },
    ]);
    await deleteCustomCollection("c1");
    const byId = await listImportWarnings(["c1", "c2"]);
    expect(byId.c1 ?? []).toEqual([]);
    expect(byId.c2).toEqual([{ name: "b.pdf", reason: "noText" }]);
    const fps = await listAllCollectionDocFingerprints();
    expect(fps.map((r) => r.collectionId)).toEqual(["c2"]);
  });

  it("huérfano imposible: la clave foránea rechaza una fila contra una colección inexistente", async () => {
    // La tabla declara REFERENCES custom_collections(id): en el
    // arnés (y con las FK activas) ni siquiera se puede INSERTAR el
    // huérfano. Y por la vía de la app nunca nace uno: los avisos se
    // escriben solo contra colecciones creadas en la misma tanda y
    // mueren con ella en su transacción.
    await createCustomCollection(coll("c1", "Real"));
    const db = await getDb();
    await expect(
      db.runAsync(
        `INSERT INTO custom_collection_warnings (collection_id, file_name, reason, created_at) VALUES ('fantasma', 'x.pdf', 'ocrEmpty', 1)`
      )
    ).rejects.toThrow();
    const byId = await listImportWarnings(["c1"]);
    expect(byId.c1 ?? []).toEqual([]);
  });

  it("descarte: dismissImportWarnings borra solo el grupo (colección, razón) pedido", async () => {
    await createCustomCollection(coll("c1", "Clínica"));
    await recordImportWarnings("c1", ["a.pdf", "b.pdf"], [
      { name: "a.pdf", reason: "ocrFailed", ocrCode: "OCR_FAILED", ocrMessage: "engine died" },
      { name: "b.pdf", reason: "ocrEmpty" },
    ]);
    await dismissImportWarnings("c1", "ocrFailed");
    expect((await listImportWarnings(["c1"])).c1).toEqual([{ name: "b.pdf", reason: "ocrEmpty" }]);
  });
});

describe("C-06: registro de huellas de documentos", () => {
  it("escritura y lectura global: la fila vuelve con su colección nombrada y su clase", async () => {
    await createCustomCollection(coll("c1", "Clínica"));
    await recordCollectionDocFingerprints("c1", [
      { docId: "c1-doc0-nota", fingerprint: "a".repeat(64), fileName: "nota.txt", kind: "import" },
      { docId: "c1-doc1-foto", fingerprint: "b".repeat(64), fileName: "foto.png", kind: "forced" },
    ]);
    const rows = await listAllCollectionDocFingerprints();
    expect(rows).toEqual([
      {
        collectionId: "c1",
        collectionName: "Clínica",
        docId: "c1-doc0-nota",
        fingerprint: "a".repeat(64),
        fileName: "nota.txt",
        kind: "import",
      },
      {
        collectionId: "c1",
        collectionName: "Clínica",
        docId: "c1-doc1-foto",
        fingerprint: "b".repeat(64),
        fileName: "foto.png",
        kind: "forced",
      },
    ]);
  });
});
