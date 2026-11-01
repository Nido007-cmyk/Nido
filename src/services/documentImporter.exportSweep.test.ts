/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * SEC-04 (auditoría de seguridad 2026-11-01): el JSON de exportCollection
 * vive en cacheDirectory con el texto completo de la colección. El finally
 * lo borra tras compartir, pero si el proceso muere con la hoja de
 * compartir abierta el finally no corre y el JSON en claro queda huérfano
 * en caché. La cura: prefijo reservado `nido-export-`, registro de
 * exportaciones vivas en el módulo y un barrido al arrancar que borra los
 * *.json de nivel superior que ningún proceso vivo posee (los de un
 * proceso anterior son restos sin dueño por construcción), conservando
 * por nombre la telemetría y sin tocar directorios ni otros formatos.
 *
 * Mundo en memoria como el de ocrWarnings/limits, extendido con las
 * operaciones de directorio que el barrido necesita.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

interface World {
  /** path completo -> contenido */
  files: Map<string, string>;
  /** paths completos que son directorios */
  dirs: Set<string>;
  failReadDir: boolean;
  /** Si no es null, shareAsync espera a esta promesa (exportación en vuelo). */
  shareGate: Promise<void> | null;
  shareStarted: boolean;
  docs: { title: string; source: string; body: string }[];
}
const world = ((globalThis as Record<string, unknown>).__nidoExportSweepWorld ??= {
  files: new Map(),
  dirs: new Set(),
  failReadDir: false,
  shareGate: null,
  shareStarted: false,
  docs: [],
}) as World;
const W = () => (globalThis as Record<string, unknown>).__nidoExportSweepWorld as World;

const CACHE = "file:///cache/";

vi.mock("expo-document-picker", () => ({ getDocumentAsync: async () => ({ canceled: true }) }));
vi.mock("expo-sharing", () => ({
  isAvailableAsync: async () => true,
  shareAsync: async () => {
    const w = W();
    w.shareStarted = true;
    if (w.shareGate) await w.shareGate;
  },
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
vi.mock("./ocr", () => {
  class MockOcrError extends Error {
    constructor(
      readonly code: string,
      message: string,
    ) {
      super(message);
      this.name = "OcrError";
    }
  }
  return {
    OcrError: MockOcrError,
    OCR_PROVENANCE_NOTE: { es: "x", en: "x", pt: "x" },
    isOcrAvailable: async () => true,
    recognizeImageText: async () => "",
    recognizeScannedPdfText: async () => "",
  };
});
vi.mock("../models/settings", () => ({ getLanguageId: async () => "es" }));
vi.mock("expo-file-system/legacy", () => ({
  cacheDirectory: CACHE,
  readAsStringAsync: async (uri: string) => W().files.get(uri) ?? "",
  writeAsStringAsync: async (uri: string, content: string) => {
    W().files.set(uri, content);
  },
  readDirectoryAsync: async (dir: string) => {
    const w = W();
    if (w.failReadDir) throw new Error("cannot read cache dir");
    const names = new Set<string>();
    for (const p of [...w.files.keys(), ...w.dirs]) {
      if (!p.startsWith(dir)) continue;
      const rest = p.slice(dir.length);
      if (rest && !rest.includes("/")) names.add(rest);
    }
    return [...names];
  },
  getInfoAsync: async (uri: string) => ({
    exists: W().files.has(uri) || W().dirs.has(uri),
    isDirectory: W().dirs.has(uri),
  }),
  deleteAsync: async (uri: string) => {
    W().files.delete(uri);
    W().dirs.delete(uri);
  },
}));
vi.mock("../rag/embed", () => ({
  embeddingEngine: { embedPassageTagged: async () => ({ vector: [0.1], modelSha256: "x" }) },
}));
vi.mock("../rag/db", () => ({
  getDbEpoch: () => 1,
  insertChunk: async () => {},
  insertChunkWithoutEmbedding: async () => {},
  deleteOrphanCollectionChunks: async () => 0,
  createCustomCollection: async () => {},
  deleteCustomCollection: async () => {},
  setCustomCollectionActive: async () => {},
  listCustomCollections: async () => [],
  getCollectionDocs: async () => W().docs,
  getMetaValue: async () => "1",
  setMetaValue: async () => {},
  listAllCollectionDocFingerprints: async () => [],
  listCollectionChunks: async () => [],
  recordCollectionDocFingerprints: async () => {},
  recordImportWarnings: async () => {},
  listImportWarnings: async () => ({}),
  dismissImportWarnings: async () => {},
}));

type M = typeof import("./documentImporter");
let M: M;
beforeAll(async () => {
  M = await import("./documentImporter");
});
beforeEach(() => {
  world.files.clear();
  world.dirs.clear();
  world.failReadDir = false;
  world.shareGate = null;
  world.shareStarted = false;
  world.docs = [{ title: "T", source: "s", body: "cuerpo" }];
});

const seed = (name: string, content = "{}") => world.files.set(`${CACHE}${name}`, content);

describe("SEC-04: sweep of orphaned collection exports", () => {
  it("deletes exactly the orphaned and legacy top-level .json, keeps the rest", async () => {
    seed("nido-export-cocina.json");
    seed("recetas.json"); // legado: nombre de las builds anteriores al prefijo
    seed("execution_telemetry.json");
    seed("execution_telemetry.csv", "a,b");
    seed("foto.png", "png");
    world.dirs.add(`${CACHE}DocumentPicker`);

    const deleted = await M.sweepOrphanedCollectionExports();

    expect(deleted).toBe(2);
    expect(world.files.has(`${CACHE}nido-export-cocina.json`)).toBe(false);
    expect(world.files.has(`${CACHE}recetas.json`)).toBe(false);
    expect(world.files.has(`${CACHE}execution_telemetry.json`)).toBe(true);
    expect(world.files.has(`${CACHE}execution_telemetry.csv`)).toBe(true);
    expect(world.files.has(`${CACHE}foto.png`)).toBe(true);
    expect(world.dirs.has(`${CACHE}DocumentPicker`)).toBe(true);
  });

  it("respects a live export in flight and its reserved prefix; the finally still cleans up", async () => {
    let release!: () => void;
    world.shareGate = new Promise<void>((r) => (release = r));
    const exporting = M.exportCollection({ id: "c1", name: "Cocina" } as never);
    // Espera a que la exportación haya escrito y esté retenida en compartir.
    for (let i = 0; i < 50 && !world.shareStarted; i++) await new Promise((r) => setTimeout(r, 1));
    expect(world.shareStarted).toBe(true);
    const livePath = `${CACHE}nido-export-cocina.json`;
    expect(world.files.has(livePath)).toBe(true);

    const deleted = await M.sweepOrphanedCollectionExports();
    expect(deleted).toBe(0);
    expect(world.files.has(livePath)).toBe(true);

    release();
    await exporting;
    // El finally de la exportación borra el fichero y sale del registro:
    // un barrido posterior no encuentra nada que contar.
    expect(world.files.has(livePath)).toBe(false);
    expect(await M.sweepOrphanedCollectionExports()).toBe(0);
  });

  it("returns 0 and never throws on an empty cache or an unreadable directory", async () => {
    expect(await M.sweepOrphanedCollectionExports()).toBe(0);
    world.failReadDir = true;
    expect(await M.sweepOrphanedCollectionExports()).toBe(0);
  });
});
