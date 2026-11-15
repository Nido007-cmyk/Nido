/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * C-06 + H-11 + ADV2-06: el importador con memoria e identidad.
 *
 * - C-06: la identidad de un documento es la huella SHA-256 de su
 *   contenido extraído (normalización v1). Idéntico no entra dos veces
 *   (ni contra otra colección, ni renombrado, ni dos veces en el mismo
 *   lote); editado (≥ 90 % de trozos idénticos) entra como copia nueva
 *   con aviso; lo ya duplicado antes de la cura se registra de forma
 *   perezosa desde sus trozos, sin borrar nada.
 * - H-11: los avisos se persisten (tabla hermana) y se releen por la
 *   vía de lectura de la tarjeta, no del resultado de la importación.
 * - ADV2-06: los sumideros son por fichero, no por nombre: dos
 *   «informe.pdf» en un lote no heredan el uno la marca del otro, en
 *   ningún orden.
 *
 * Mundo stateful propio: la base simulada guarda colecciones, trozos,
 * huellas, avisos y metas, para poder «cerrar y reabrir» la Biblioteca
 * leyendo solo lo persistido.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { OcrError } from "./ocr";

interface ChunkRow {
  chunkId: string;
  docId: string;
  title: string;
  body: string;
  source: string;
  collectionId: string;
}
interface CollRow {
  id: string;
  name: string;
  sourceFilename: string | null;
  docCount: number;
  chunkCount: number;
  sizeBytes: number;
  active: boolean;
  createdAt: number;
  lastAccessed: number;
}
interface DocRow {
  collectionId: string;
  docId: string;
  fingerprint: string;
  fileName: string;
  kind: string;
}
interface WarnRow {
  collection_id: string;
  file_name: string;
  reason: string;
  ocr_code?: string;
  ocr_message?: string;
  detail?: string;
  previous_name?: string;
}
interface World {
  files: Map<string, string>;
  pdfTextByUri: Map<string, string>;
  pdfOcrByUri: Map<string, { text?: string; error?: Error }>;
  imageOcrByUri: Map<string, { text?: string; error?: Error }>;
  ocrAvailable: boolean;
  chunks: ChunkRow[];
  collections: Map<string, CollRow>;
  docRows: DocRow[];
  warningRows: WarnRow[];
  meta: Map<string, string>;
  clock: number;
}
const world = ((globalThis as Record<string, unknown>).__nidoDedupeWorld ??= {
  files: new Map(),
  pdfTextByUri: new Map(),
  pdfOcrByUri: new Map(),
  imageOcrByUri: new Map(),
  ocrAvailable: true,
  chunks: [],
  collections: new Map(),
  docRows: [],
  warningRows: [],
  meta: new Map(),
  clock: 1000,
}) as World;
const W = () => (globalThis as Record<string, unknown>).__nidoDedupeWorld as World;

vi.mock("expo-document-picker", () => ({ getDocumentAsync: async () => ({ canceled: true }) }));
vi.mock("expo-sharing", () => ({ shareAsync: async () => {}, isAvailableAsync: async () => false }));
vi.mock("./pdfText", () => {
  class PdfTextError extends Error {
    constructor(
      readonly code: string,
      message: string,
    ) {
      super(message);
    }
  }
  return {
    PdfTextError,
    extractPdfTextCapped: async (uri: string) => W().pdfTextByUri.get(uri) ?? "",
  };
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
    OCR_PROVENANCE_NOTE: {
      es: "Texto reconocido con OCR (prueba).",
      en: "OCR-recognized text (test).",
      pt: "Texto reconhecido com OCR (teste).",
    },
    isOcrAvailable: async () => W().ocrAvailable,
    recognizeImageText: async (uri: string) => {
      const v = W().imageOcrByUri.get(uri);
      if (v?.error) throw v.error;
      return v?.text ?? "";
    },
    recognizeScannedPdfText: async (uri: string) => {
      const v = W().pdfOcrByUri.get(uri);
      if (v?.error) throw v.error;
      return v?.text ?? "";
    },
  };
});
vi.mock("../models/settings", () => ({ getLanguageId: async () => "es" }));
vi.mock("expo-file-system/legacy", () => ({
  readAsStringAsync: async (uri: string) => W().files.get(uri) ?? "",
  writeAsStringAsync: async () => {},
  deleteAsync: async () => {},
  cacheDirectory: "file:///cache/",
}));
vi.mock("../rag/embed", () => ({
  embeddingEngine: {
    embedPassageTagged: async () => ({ vector: [0.1], modelSha256: "x" }),
  },
}));
vi.mock("../rag/db", () => ({
  getDbEpoch: () => 1,
  insertChunk: async (c: ChunkRow) => {
    W().chunks.push({ ...c });
  },
  insertChunkWithoutEmbedding: async (c: ChunkRow) => {
    W().chunks.push({ ...c });
  },
  deleteOrphanCollectionChunks: async () => 0,
  createCustomCollection: async (c: Omit<CollRow, "active" | "createdAt" | "lastAccessed">) => {
    const w = W();
    w.collections.set(c.id, { ...c, active: true, createdAt: w.clock++, lastAccessed: 0 });
  },
  measureCollectionStoredBytes: async () => 0,
  deleteCustomCollection: async (id: string) => {
    const w = W();
    w.collections.delete(id);
    w.chunks = w.chunks.filter((ch) => ch.collectionId !== id);
    w.docRows = w.docRows.filter((r) => r.collectionId !== id);
    w.warningRows = w.warningRows.filter((r) => r.collection_id !== id);
  },
  setCustomCollectionActive: async () => {},
  listCustomCollections: async () =>
    [...W().collections.values()].sort((a, b) => b.createdAt - a.createdAt),
  getCollectionDocs: async () => [],
  getMetaValue: async (key: string) => W().meta.get(key) ?? null,
  setMetaValue: async (key: string, value: string) => {
    W().meta.set(key, value);
  },
  listAllCollectionDocFingerprints: async () =>
    W().docRows.map((r) => ({
      ...r,
      collectionName: W().collections.get(r.collectionId)?.name ?? "",
    })),
  recordCollectionDocFingerprints: async (
    collectionId: string,
    rows: Array<{ docId: string; fingerprint: string; fileName: string; kind: string }>,
  ) => {
    const w = W();
    for (const r of rows) {
      const next = { collectionId, ...r };
      const i = w.docRows.findIndex((x) => x.collectionId === collectionId && x.docId === r.docId);
      if (i >= 0) w.docRows[i] = next;
      else w.docRows.push(next);
    }
  },
  listCollectionChunks: async (collectionId: string) =>
    W()
      .chunks.filter((ch) => ch.collectionId === collectionId)
      .map((ch) => ({ docId: ch.docId, chunkId: ch.chunkId, title: ch.title, body: ch.body, source: ch.source })),
  recordImportWarnings: async (
    collectionId: string,
    fileNames: string[],
    warnings: Array<{
      name: string;
      reason: string;
      ocrCode?: string;
      ocrMessage?: string;
      detail?: string;
      previousName?: string;
    }>,
  ) => {
    const w = W();
    w.warningRows = w.warningRows.filter(
      (r) => !(r.collection_id === collectionId && fileNames.includes(r.file_name)),
    );
    for (const wn of warnings) {
      w.warningRows.push({
        collection_id: collectionId,
        file_name: wn.name,
        reason: wn.reason,
        ocr_code: wn.ocrCode,
        ocr_message: wn.ocrMessage,
        detail: wn.detail,
        previous_name: wn.previousName,
      });
    }
  },
  listImportWarnings: async (ids: string[]) => {
    const out: Record<string, unknown[]> = {};
    for (const r of W().warningRows) {
      if (!ids.includes(r.collection_id)) continue;
      (out[r.collection_id] ??= []).push({
        name: r.file_name,
        reason: r.reason,
        ...(r.ocr_code ? { ocrCode: r.ocr_code } : {}),
        ...(r.ocr_message ? { ocrMessage: r.ocr_message } : {}),
        ...(r.detail ? { detail: r.detail } : {}),
        ...(r.previous_name ? { previousName: r.previous_name } : {}),
      });
    }
    return out;
  },
  dismissImportWarnings: async (collectionId: string, reason: string) => {
    const w = W();
    w.warningRows = w.warningRows.filter((r) => !(r.collection_id === collectionId && r.reason === reason));
  },
}));

type M = typeof import("./documentImporter");
let M: M;
beforeAll(async () => {
  M = await import("./documentImporter");
});
beforeEach(() => {
  const w = W();
  w.files.clear();
  w.pdfTextByUri.clear();
  w.pdfOcrByUri.clear();
  w.imageOcrByUri.clear();
  w.ocrAvailable = true;
  w.chunks = [];
  w.collections.clear();
  w.docRows = [];
  w.warningRows = [];
  w.meta.clear();
  w.clock = 1000;
});

const asset = (name: string, uri = `file:///${name}`) => ({ uri, name, size: 1000 }) as never;

/** Texto largo de frase periódica: cada trozo de 2000 cae en la misma fase. */
const longBody = (phrase: string, reps: number) => phrase.repeat(reps);
const CLINIC_NOTE =
  "Nota de la clínica: la cita es el martes 10 de noviembre de 2026 a las 9:30 en la sala 214 del segundo piso. " +
  "El jarabe se toma 5 ml dos veces al día después de comer. Para cambiar la cita llame al 520-555-0147.";

describe("la huella de contenido (normalización v1)", () => {
  it("es el SHA-256 del cuerpo normalizado (trim + blancos colapsados); vacío no huella", () => {
    // Vector conocido: SHA-256("abc").
    expect(M.docContentFingerprint("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(M.docContentFingerprint("  abc \n\n")).toBe(M.docContentFingerprint("abc"));
    expect(M.docContentFingerprint("a   b\tc")).toBe(M.docContentFingerprint("a b c"));
    expect(M.docContentFingerprint("   \n ")).toBeNull();
    expect(M.normalizeContentText("  uno\n\n dos   tres ")).toBe("uno dos tres");
  });
});

describe("C-06: el idéntico no entra dos veces", () => {
  it("reimportar el mismo fichero: no nace colección, devuelve la existente y el aviso persiste en ella", async () => {
    W().files.set("file:///nota.txt", "Receta de la abuela: sopa de pollo con arroz.");
    const first = await M.importDocuments([asset("nota.txt")], "Notas");
    expect(first.importWarnings).toEqual([]);
    const chunksAfterFirst = W().chunks.length;

    const second = await M.importDocuments([asset("nota.txt")], "Otra");
    expect(second.duplicateImport).toBe(true);
    expect(second.id).toBe(first.id);
    expect(W().collections.size).toBe(1);
    expect(W().chunks).toHaveLength(chunksAfterFirst);
    expect(second.importWarnings).toEqual([
      { name: "nota.txt", reason: "alreadyImported", previousName: "nota.txt" },
    ]);
    // H-11: el aviso vive en la base, no en el resultado — se relee.
    const persisted = await M.listImportWarnings([first.id]);
    expect(persisted[first.id]).toEqual([
      { name: "nota.txt", reason: "alreadyImported", previousName: "nota.txt" },
    ]);
  });

  it("lote parcial: entra lo nuevo y el aviso nombra lo repetido y dónde vive", async () => {
    W().files.set("file:///nota.txt", "Receta de la abuela: sopa de pollo con arroz.");
    W().files.set("file:///nuevo.txt", "Teléfonos del barrio: ferretería 555-0100.");
    await M.importDocuments([asset("nota.txt")], "Notas");
    const chunksBefore = W().chunks.length;

    const result = await M.importDocuments([asset("nota.txt"), asset("nuevo.txt")], "Mezcla");
    expect(result.duplicateImport).toBeFalsy();
    expect(W().collections.size).toBe(2);
    expect(W().chunks.length).toBe(chunksBefore + 1); // solo entró nuevo.txt
    expect(result.importWarnings).toEqual([
      { name: "nota.txt", reason: "alreadyImported", detail: "Notas", previousName: "nota.txt" },
    ]);
    const persisted = await M.listImportWarnings([result.id]);
    expect(persisted[result.id]).toEqual([
      { name: "nota.txt", reason: "alreadyImported", detail: "Notas", previousName: "nota.txt" },
    ]);
  });

  it("renombrado: el mismo contenido con otro nombre cae en idéntico y el aviso lee ambos nombres", async () => {
    const body = "Horario del consultorio: lunes a viernes de 9 a 14.";
    W().files.set("file:///nota.txt", body);
    await M.importDocuments([asset("nota.txt")], "Notas");
    W().files.set("file:///nota-copia.md", body);
    const second = await M.importDocuments([asset("nota-copia.md")], "Copia");
    expect(second.duplicateImport).toBe(true);
    expect(W().collections.size).toBe(1);
    expect(second.importWarnings).toEqual([
      { name: "nota-copia.md", reason: "alreadyImported", previousName: "nota.txt" },
    ]);
  });

  it("el mismo fichero dos veces en un lote: una sola copia dentro de la colección", async () => {
    W().files.set("file:///nota.txt", "Receta de la abuela: sopa de pollo con arroz.");
    const result = await M.importDocuments([asset("nota.txt"), asset("nota.txt")], "Doble");
    expect(W().collections.size).toBe(1);
    expect(W().chunks).toHaveLength(1);
    expect(result.importWarnings).toEqual([
      { name: "nota.txt", reason: "alreadyImported", previousName: "nota.txt" },
    ]);
  });

  it("«importar de todos modos»: la copia nace, queda marcada como forzada y no lleva aviso", async () => {
    W().files.set("file:///nota.txt", "Receta de la abuela: sopa de pollo con arroz.");
    await M.importDocuments([asset("nota.txt")], "Notas");
    const forced = await M.importDocuments([asset("nota.txt")], "Forzada", undefined, {
      forceDuplicates: true,
    });
    expect(forced.duplicateImport).toBeFalsy();
    expect(W().collections.size).toBe(2);
    expect(forced.importWarnings).toEqual([]);
    const rows = W().docRows.filter((r) => r.collectionId === forced.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("forced");
  });
});

describe("C-06: el editado entra como copia nueva, avisada", () => {
  const PHRASE = "El paciente debe tomar el jarabe con las comidas. ";
  it("un trozo distinto de doce: entra entero con aviso similarImported nombrando la colección del parecido", async () => {
    const v1 = longBody(PHRASE, 400);
    // Un carácter distinto en el interior de un solo trozo (fuera del
    // solape de 200 con los vecinos): 11 trozos, 10 compartidos.
    const at = 1800 * 5 + 900;
    const v2 = v1.slice(0, at) + "X" + v1.slice(at + 1);
    W().files.set("file:///v1.txt", v1);
    W().files.set("file:///v2.txt", v2);
    await M.importDocuments([asset("v1.txt")], "Original");
    const chunksV1 = W().chunks.length;
    expect(chunksV1).toBeGreaterThan(8);

    const result = await M.importDocuments([asset("v2.txt")], "Copia");
    expect(result.duplicateImport).toBeFalsy();
    expect(W().collections.size).toBe(2);
    expect(W().chunks.length).toBe(chunksV1 * 2); // la copia entró entera
    expect(result.importWarnings).toEqual([
      { name: "v2.txt", reason: "similarImported", detail: "Original", previousName: "v1.txt" },
    ]);
  });

  it("un texto sin parentesco entra sin aviso de parecido", async () => {
    W().files.set("file:///v1.txt", longBody(PHRASE, 400));
    W().files.set("file:///otro.txt", longBody("La cosecha de maíz empieza en agosto. ", 400));
    await M.importDocuments([asset("v1.txt")], "Original");
    const result = await M.importDocuments([asset("otro.txt")], "Otro");
    expect(result.importWarnings).toEqual([]);
  });

  it("borde declarado: la nota de un solo trozo, editada, entra como copia sin aviso de parecido", async () => {
    // La detección de parecidos vive en la fracción de trozos: con un
    // solo trozo, cualquier edición es 0 trozos compartidos y la red
    // no la ve. Es el límite declarado de la tanda (el idéntico, que
    // es el daño medido, sí queda cazado siempre).
    W().pdfTextByUri.set("file:///documento-prueba-ocr.pdf", CLINIC_NOTE);
    W().pdfOcrByUri.set("file:///documento-prueba-ocr.pdf", { text: " " });
    await M.importDocuments([asset("documento-prueba-ocr.pdf")], "Nota");
    W().pdfTextByUri.set("file:///documento-prueba-ocr.pdf", CLINIC_NOTE.replace("520-555-0147", "520-555-0199"));
    const result = await M.importDocuments([asset("documento-prueba-ocr.pdf")], "Nota editada");
    expect(result.duplicateImport).toBeFalsy();
    expect(W().collections.size).toBe(2);
    expect(result.importWarnings.filter((w) => w.reason === "similarImported")).toEqual([]);
  });
});

describe("C-06: los formatos reales de la ronda", () => {
  it("el PDF de la nota importado dos veces: el segundo intento es caso 1", async () => {
    W().pdfTextByUri.set("file:///documento-prueba-ocr.pdf", CLINIC_NOTE);
    W().pdfOcrByUri.set("file:///documento-prueba-ocr.pdf", { text: "" });
    const first = await M.importDocuments([asset("documento-prueba-ocr.pdf")], "Nota");
    expect(first.importWarnings).toEqual([{ name: "documento-prueba-ocr.pdf", reason: "ocrEmpty" }]);
    const chunksAfterFirst = W().chunks.length;

    const second = await M.importDocuments([asset("documento-prueba-ocr.pdf")], "Nota otra vez");
    expect(second.duplicateImport).toBe(true);
    expect(second.id).toBe(first.id);
    expect(W().chunks).toHaveLength(chunksAfterFirst);
    expect(second.importWarnings.map((w) => w.reason).sort()).toEqual(["alreadyImported", "ocrEmpty"]);
    const persisted = await M.listImportWarnings([first.id]);
    expect(persisted[first.id].map((w) => w.reason).sort()).toEqual(["alreadyImported", "ocrEmpty"]);
  });

  it("la imagen de la nota importada dos veces: caso 1 por la huella del texto reconocido", async () => {
    W().imageOcrByUri.set("file:///documento-prueba-ocr.png", { text: CLINIC_NOTE });
    const first = await M.importDocuments([asset("documento-prueba-ocr.png")], "Foto");
    expect(first.importWarnings).toEqual([]);
    const second = await M.importDocuments([asset("documento-prueba-ocr.png")], "Foto otra vez");
    expect(second.duplicateImport).toBe(true);
    expect(second.id).toBe(first.id);
    expect(W().collections.size).toBe(1);
  });
});

describe("ADV2-06: gemelos del mismo nombre, sin herencia cruzada", () => {
  const BAD = { error: new OcrError("OCR_FAILED", "engine died") };
  const setupTwins = (badFirst: boolean) => {
    const badUri = "file:///mal/informe.pdf";
    const goodUri = "file:///bien/informe.pdf";
    W().pdfTextByUri.set(badUri, "");
    W().pdfOcrByUri.set(badUri, BAD);
    W().pdfTextByUri.set(goodUri, "Informe anual completo con su capa de texto entera.");
    W().pdfOcrByUri.set(goodUri, { text: "" });
    const bad = { uri: badUri, name: "informe.pdf", size: 1000 } as never;
    const good = { uri: goodUri, name: "informe.pdf", size: 1000 } as never;
    return badFirst ? [bad, good] : [good, bad];
  };

  it("el malo primero: el sano NO queda marcado ocrFailed con el código del otro", async () => {
    const result = await M.importDocuments(setupTwins(true), "Informes");
    expect(W().chunks.length).toBeGreaterThan(0);
    const failed = result.importWarnings.filter((w) => w.reason === "ocrFailed");
    const empty = result.importWarnings.filter((w) => w.reason === "ocrEmpty");
    expect(failed).toEqual([
      { name: "informe.pdf", reason: "ocrFailed", ocrCode: "OCR_FAILED", ocrMessage: "engine died" },
    ]);
    // El sano lleva solo su propio ruido de costura (ocrEmpty), no la marca ajena.
    expect(empty).toEqual([{ name: "informe.pdf", reason: "ocrEmpty" }]);
    expect(result.importWarnings).toHaveLength(2);
  });

  it("el sano primero: el mismo desenlace, sin depender del orden", async () => {
    const result = await M.importDocuments(setupTwins(false), "Informes");
    const failed = result.importWarnings.filter((w) => w.reason === "ocrFailed");
    const empty = result.importWarnings.filter((w) => w.reason === "ocrEmpty");
    expect(failed).toEqual([
      { name: "informe.pdf", reason: "ocrFailed", ocrCode: "OCR_FAILED", ocrMessage: "engine died" },
    ]);
    expect(empty).toEqual([{ name: "informe.pdf", reason: "ocrEmpty" }]);
    expect(result.importWarnings).toHaveLength(2);
  });
});

describe("H-11: los avisos sobreviven a la pantalla", () => {
  it("la fixture literal: mixto con OCR rechazando — el aviso se lee de la base, no del resultado", async () => {
    W().files.set("file:///foto.txt", "Texto bueno de compañía.");
    W().pdfTextByUri.set("file:///mixto.pdf", "Portada del informe anual. Ejercicio 2026.");
    W().pdfOcrByUri.set("file:///mixto.pdf", { error: new OcrError("OCR_FAILED", "native boom") });
    const result = await M.importDocuments([asset("foto.txt"), asset("mixto.pdf")], "Mixta");
    // «Cerrar y reabrir»: se lee SOLO lo persistido.
    const persisted = await M.listImportWarnings([result.id]);
    expect(persisted[result.id]).toEqual([
      { name: "mixto.pdf", reason: "ocrFailed", ocrCode: "OCR_FAILED", ocrMessage: "native boom" },
    ]);
  });

  it("gemela ocrEmpty y una noText: las dos quedan persistidas con su razón propia", async () => {
    W().files.set("file:///bueno.txt", "Texto bueno de compañía.");
    W().files.set("file:///vacio.txt", "   ");
    W().pdfTextByUri.set("file:///mixto.pdf", "Portada del informe anual. Ejercicio 2026.");
    W().pdfOcrByUri.set("file:///mixto.pdf", { text: "" });
    const result = await M.importDocuments(
      [asset("bueno.txt"), asset("vacio.txt"), asset("mixto.pdf")],
      "Mixta",
    );
    const persisted = await M.listImportWarnings([result.id]);
    expect(persisted[result.id]).toEqual([
      { name: "vacio.txt", reason: "noText" },
      { name: "mixto.pdf", reason: "ocrEmpty" },
    ]);
  });

  it("importación que fracasa entera: no se escribe ningún aviso (no hay colección donde colgarlo)", async () => {
    W().pdfTextByUri.set("file:///malo.pdf", "");
    W().pdfOcrByUri.set("file:///malo.pdf", { error: new OcrError("OCR_FAILED", "native boom") });
    await expect(M.importDocuments([asset("malo.pdf")], "x")).rejects.toMatchObject({ code: "ocrFailed" });
    expect(W().warningRows).toEqual([]);
    expect(W().collections.size).toBe(0);
  });
});

describe("C-06: registro perezoso de lo ya importado antes de la cura", () => {
  it("una colección precura (trozos sin huellas) se registra cosiendo sus trozos y el reimport cae en caso 1", async () => {
    const body = longBody("La receta de la sopa lleva pollo, arroz y cilantro. ", 60); // ~3.060 chars → 2 trozos
    const collId = "custom-900-precura";
    W().collections.set(collId, {
      id: collId,
      name: "Precura",
      sourceFilename: "sopa.txt",
      docCount: 1,
      chunkCount: 2,
      sizeBytes: 10,
      active: true,
      createdAt: 5,
      lastAccessed: 0,
    });
    const docId = `${collId}-doc0-sopa`;
    const trimmed = body.trim();
    W().chunks.push(
      { chunkId: `${docId}-c0`, docId, title: "sopa", body: trimmed.slice(0, 2000), source: "sopa.txt", collectionId: collId },
      { chunkId: `${docId}-c1`, docId, title: "sopa", body: trimmed.slice(1800), source: "sopa.txt", collectionId: collId },
    );
    expect(W().docRows).toEqual([]);

    W().files.set("file:///sopa.txt", body);
    const result = await M.importDocuments([asset("sopa.txt")], "Sopa otra vez");
    // El registro corrió (la huella cosida coincide con la directa) y cazó el duplicado.
    const reg = W().docRows.filter((r) => r.collectionId === collId);
    expect(reg).toHaveLength(1);
    expect(reg[0].kind).toBe("registry");
    expect(reg[0].fingerprint).toBe(M.docContentFingerprint(body));
    expect(result.duplicateImport).toBe(true);
    expect(result.id).toBe(collId);
    expect(W().collections.size).toBe(1);
  });
});
