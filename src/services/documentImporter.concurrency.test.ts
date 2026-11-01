/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * documentImporter.concurrency.test.ts — la sospecha de la revisión
 * adversaria de la 0.1.67 sobre F3-17, resuelta con evidencia
 * (carril F-REV, cargo 3).
 *
 * La barrida de huérfanos de F3-17 corre al inicio de importDocuments,
 * pero la importación inserta sus trozos uno a uno y crea la fila de
 * la colección SOLO AL FINAL: durante todo el vuelo, los trozos de
 * una importación viva son indistinguibles de los huérfanos de una
 * muerta. El único llamante en la UI (PersonalDocumentsManager) no
 * tenía guarda de reentrada, así que dos importDocuments concurrentes
 * dejaban que la barrida de la segunda se comiera los trozos en vuelo
 * de la primera: la colección nacía declarando N trozos con N−k
 * filas reales, en silencio.
 *
 * Esta prueba corre el importador REAL contra la base REAL (fixture
 * v1 sobre node:sqlite, el arnés de db.embeddingModel.test.ts) con el
 * embedding detenido por una puerta en el segundo trozo de la
 * importación A: A queda aparcada a mitad de vuelo, con un trozo ya
 * insertado y sin fila de colección, mientras B importa entera. Al
 * final, los trozos almacenados de cada colección deben ser
 * exactamente los que su fila declara, y un huérfano de verdad
 * (sembrado a mano, de nadie en vuelo) debe seguir cayendo en la
 * barrida: curar la carrera no puede castrar F3-17.
 *
 * Antes de la cura esta prueba era roja con la cifra exacta de la
 * sospecha (A declaraba 6 trozos y guardaba 5: la barrida de B se
 * había comido el que estaba en vuelo); con la serialización de
 * importaciones y la exclusión de colecciones en vuelo en la propia
 * barrida, es verde.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { copyFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

(globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;

const FIX = join(dirname(fileURLToPath(import.meta.url)), "..", "rag", "__fixtures__");

// Estado compartido con las factorías de mocks (patrón de la casa:
// globalThis, porque las factorías corren antes que el cuerpo).
interface World {
  files: Map<string, string>;
  gateHit: boolean;
  releaseGate: (() => void) | null;
}
const g = globalThis as unknown as { __nidoImportRace?: World };
g.__nidoImportRace = g.__nidoImportRace ?? { files: new Map(), gateHit: false, releaseGate: null };
const W = () => g.__nidoImportRace!;

const embedResult = () => ({
  vector: new Float32Array([0.1, 0.2, 0.3, 0.4]),
  modelSha256: "test-sha",
});

vi.mock("expo-sqlite", () => ({ deleteDatabaseAsync: async () => {} }));
vi.mock("expo-file-system/legacy", () => ({
  documentDirectory: "file:///docs/",
  cacheDirectory: "file:///cache/",
  getInfoAsync: async () => ({ exists: false }),
  readAsStringAsync: async (uri: string) => W().files.get(uri) ?? "",
  writeAsStringAsync: async () => {},
  deleteAsync: async () => {},
  moveAsync: async () => {
    throw new Error("move no usado");
  },
}));
vi.mock("expo-document-picker", () => ({
  getDocumentAsync: async () => ({ canceled: true }),
}));
vi.mock("expo-sharing", () => ({
  isAvailableAsync: async () => false,
  shareAsync: async () => {},
}));
vi.mock("./pdfText", () => {
  class PdfTextError extends Error {
    constructor(
      readonly code: string,
      message: string,
    ) {
      super(message);
    }
  }
  return { PdfTextError, extractPdfTextCapped: async () => "" };
});
vi.mock("./ocr", () => ({ isOcrAvailable: async () => false }));
vi.mock("../models/settings", () => ({
  getActiveModelId: async () => null,
}));
vi.mock("../privacy/keyManager", () => ({
  registerKeyLossProbe: () => {},
  getDatabaseKeyHex: async () => "ab".repeat(32),
  applyDatabaseKey: async (
    db: { execAsync(s: string): Promise<void>; getFirstAsync(s: string): Promise<unknown> },
    keyHex: string | null,
  ) => {
    if (!keyHex) return;
    await db.execAsync(`PRAGMA key = "x'${keyHex}'";`);
    await db.getFirstAsync("SELECT count(*) AS n FROM sqlite_master;");
  },
}));
vi.mock("../rag/embed", () => ({
  embeddingEngine: {
    embedPassageTagged: async (text: string) => {
      const w = W();
      // La puerta: el segundo trozo de la importación «alfa» se queda
      // esperando a que la prueba lo suelte. Todo lo demás pasa.
      if (!w.gateHit && text.includes("alfa (part 2/")) {
        w.gateHit = true;
        return new Promise<ReturnType<typeof embedResult>>((resolve) => {
          w.releaseGate = () => resolve(embedResult());
        });
      }
      return embedResult();
    },
  },
}));

import { setSecureDbTestDriver } from "../security/secureDatabase";
import { getDb, insertChunk, resetDatabase } from "../rag/db";
import { importDocuments } from "./documentImporter";

// ---------------------------------------------------------------------------
// Arnés de base real (copia del patrón de db.embeddingModel.test.ts)
// ---------------------------------------------------------------------------

let tmpDirs: string[] = [];

function makeHandle(dbPath: string) {
  const sqlite = new DatabaseSync(dbPath);
  // Paridad con producción: la columna collection_id declara REFERENCES
  // custom_collections, pero la app nunca ejecuta PRAGMA foreign_keys =
  // ON y SQLite no lo impone por defecto en el teléfono; node:sqlite sí
  // lo activa al abrir, y sin esto el arnés rechazaría el diseño real
  // del importador (trozos primero, fila de colección al final).
  sqlite.exec("PRAGMA foreign_keys = OFF;");
  let keyApplied = false;
  const bind = (params?: unknown[]) => (params ?? []) as never[];
  return {
    execAsync: async (sql: string) => {
      if (/^\s*PRAGMA\s+key/i.test(sql)) {
        keyApplied = true;
        return;
      }
      sqlite.exec(sql);
    },
    getAllAsync: async <T>(sql: string, params?: unknown[]): Promise<T[]> => {
      if (/cipher_version/i.test(sql)) return [{ cipher_version: "4.9.0-fake" }] as T[];
      return sqlite.prepare(sql).all(...bind(params)) as T[];
    },
    getFirstAsync: async <T>(sql: string, params?: unknown[]): Promise<T | null> => {
      if (/cipher_version/i.test(sql)) return { cipher_version: "4.9.0-fake" } as T;
      if (/FROM\s+sqlite_master/i.test(sql) && !keyApplied)
        throw new Error("file is not a database (sin clave)");
      return (sqlite.prepare(sql).get(...bind(params)) ?? null) as T | null;
    },
    runAsync: async (sql: string, params?: unknown[]) => {
      if (params && params.length > 0) {
        const info = sqlite.prepare(sql).run(...bind(params));
        return { lastInsertRowId: Number(info.lastInsertRowid), changes: Number(info.changes) };
      }
      sqlite.exec(sql);
      return { lastInsertRowId: 0, changes: 0 };
    },
    withTransactionAsync: async (fn: () => Promise<void>) => {
      sqlite.exec("BEGIN");
      try {
        await fn();
        sqlite.exec("COMMIT");
      } catch (e) {
        sqlite.exec("ROLLBACK");
        throw e;
      }
    },
    closeAsync: async () => {
      sqlite.close();
    },
  };
}

function useFreshDb(): void {
  const dir = mkdtempSync(join(tmpdir(), "nido-race-"));
  tmpDirs.push(dir);
  const dbPath = join(dir, "k.db");
  copyFileSync(join(FIX, "knowledge.v1.db"), dbPath);
  setSecureDbTestDriver({
    dbDir: () => "file:///docs/SQLite/",
    openDb: async () => makeHandle(dbPath),
    exists: async (path: string) => !path.endsWith(".migtmp") && !path.endsWith(".sqlcipher"),
    remove: async () => {},
    rename: async () => {
      throw new Error("rename no usado");
    },
    writeFile: async () => {
      throw new Error("writeFile no usado");
    },
  });
}

// ---------------------------------------------------------------------------
// Utilidades de la carrera
// ---------------------------------------------------------------------------

async function countChunks(collectionId: string): Promise<number> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM chunks WHERE collection_id = ?",
    [collectionId],
  );
  return rows[0]?.n ?? 0;
}

async function inFlightCollectionId(exclude: string): Promise<string | null> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ collection_id: string }>(
    "SELECT DISTINCT collection_id FROM chunks WHERE collection_id IS NOT NULL AND collection_id != ?",
    [exclude],
  );
  return rows[0]?.collection_id ?? null;
}

async function until(cond: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await cond()) return true;
    await new Promise((r) => setTimeout(r, 10));
  }
  return false;
}

/** Texto largo y regular: varios trozos con cualquier tamaño de corte. */
function longText(tag: string): string {
  const parts: string[] = [];
  for (let i = 0; i < 120; i++) {
    parts.push(`${tag} segmento ${i} con contenido suficiente para llenar la ventana de troceo del importador.`);
  }
  return parts.join("\n");
}

const asset = (uri: string, name: string, size: number) =>
  ({ uri, name, size, mimeType: "text/plain" }) as never;

beforeEach(async () => {
  tmpDirs = [];
  W().files.clear();
  W().gateHit = false;
  W().releaseGate = null;
  await resetDatabase();
});

afterEach(() => {
  setSecureDbTestDriver(null);
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

describe("importaciones concurrentes contra la barrida de huérfanos (F3-17)", () => {
  it(
    "la barrida de una segunda importación no se come los trozos en vuelo de la primera",
    async () => {
      useFreshDb();
      await getDb();

      const textA = longText("alfa");
      const textB = longText("bravo");
      W().files.set("file:///docs/alfa.txt", textA);
      W().files.set("file:///docs/bravo.txt", textB);

      // A arranca y queda aparcada en la puerta: un trozo insertado,
      // todavía sin fila de colección (eso es «en vuelo»).
      const pA = importDocuments([asset("file:///docs/alfa.txt", "alfa.txt", textA.length)], "Coleccion Alfa");
      expect(await until(async () => W().gateHit, 5000), "A debe llegar a la puerta").toBe(true);
      const idA = await inFlightCollectionId("custom-dead-orphan");
      expect(idA, "A debe tener un trozo en vuelo").not.toBeNull();
      expect(await countChunks(idA!)).toBe(1);

      // Un huérfano de verdad: trozo de una importación muerta, de
      // nadie en vuelo. La barrida SÍ debe recogerlo.
      await insertChunk(
        { chunkId: "dead-1", docId: "dead", title: "Muerto", body: "trozo de una importación muerta", collectionId: "custom-dead-orphan" },
        new Float32Array([1, 2, 3, 4]),
      );
      expect(await countChunks("custom-dead-orphan")).toBe(1);

      // B importa entera mientras A sigue aparcada. Antes de la cura,
      // su barrida inicial borraba el trozo en vuelo de A (y el
      // huérfano, bien); tras la cura, B espera a A o la excluye.
      let bSettled = false;
      const pB = importDocuments([asset("file:///docs/bravo.txt", "bravo.txt", textB.length)], "Coleccion Bravo")
        .then((c) => {
          bSettled = true;
          return c;
        });
      await until(async () => bSettled || (await countChunks(idA!)) === 0, 800);

      W().releaseGate?.();
      const colA = await pA;
      const colB = await pB;

      expect(colA.chunkCount, "A debe declarar varios trozos").toBeGreaterThanOrEqual(3);
      expect(await countChunks(colA.id), "los trozos guardados de A deben ser los declarados").toBe(colA.chunkCount);
      expect(await countChunks(colB.id), "los trozos guardados de B deben ser los declarados").toBe(colB.chunkCount);
      expect(await countChunks("custom-dead-orphan"), "el huérfano de verdad debe caer en la barrida").toBe(0);
    },
    30000,
  );
});
