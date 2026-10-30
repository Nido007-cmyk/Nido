/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { extractText as extractPdfText } from "expo-pdf-text-extract";
import { embeddingEngine } from "../rag/embed";
import {
  getDbEpoch,
  insertChunk,
  insertChunkWithoutEmbedding,
  createCustomCollection,
  deleteCustomCollection,
  setCustomCollectionActive,
  listCustomCollections,
  getCollectionDocs,
  CustomCollection,
} from "../rag/db";

/**
 * User-supplied document import for the local knowledge base (Settings >
 * Knowledge Base > Import Documents). Formats:
 *
 * - .txt / .md: read as plain text.
 * - .csv: naive comma-split per line (no quoted-field escaping) - fine for
 *   simple exports, not a full CSV parser.
 * - .json: if it matches the same {title, source, body}[] shape used by the
 *   app's own downloadable corpus packs (assets/corpus/*.json), each entry
 *   is imported as its own doc; otherwise the whole file is chunked as text.
 * - .pdf: embedded/selectable text only, via expo-pdf-text-extract (Apache
 *   PDFBox-Android on-device, no network, no OCR). Scanned/image-only PDFs
 *   extract to empty text - there's no OCR step. Password-protected PDFs
 *   are rejected with a clear error rather than attempted.
 */

const CHARS_PER_TOKEN = 4; // rough English-text heuristic, no tokenizer on-device
const CHUNK_CHARS = 500 * CHARS_PER_TOKEN;
const OVERLAP_CHARS = 50 * CHARS_PER_TOKEN;

export const SUPPORTED_MIME_TYPES = [
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
  "application/pdf",
];

/**
 * Offensive audit (0.1.18): limits. A 300 MB log picked by mistake was read
 * whole into a JS string (the app could be killed for memory) and then
 * embedded chunk by chunk for hours. 25 MB of text is ~12,000 pages; PDFs are
 * measured by the text they give (MAX_IMPORT_CHUNKS).
 */
export const MAX_IMPORT_TEXT_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_IMPORT_PDF_FILE_BYTES = 100 * 1024 * 1024;
export const MAX_IMPORT_CHUNKS = 4000;

export type DocImportErrorCode = "tooLarge" | "tooManyChunks" | "pdfPassword" | "pdfUnreadable" | "noText";

/** Error with a code the screen shows in the app language (message: for logs). */
export class DocImportError extends Error {
  readonly code: DocImportErrorCode;
  readonly vars: Record<string, string>;
  constructor(code: DocImportErrorCode, message: string, vars: Record<string, string> = {}) {
    super(message);
    this.name = "DocImportError";
    this.code = code;
    this.vars = vars;
  }
}

export interface ImportProgress {
  stage: "reading" | "chunking" | "embedding";
  chunkIndex?: number;
  chunkCount?: number;
}

/**
 * Auditoría 2026-10-29: cuántos trozos daría un texto de esta longitud, sin
 * trocearlo. Sirve para rechazar un texto enorme ANTES de crear miles de
 * trozos en memoria (un PDF pequeño puede descomprimirse en cientos de MB de
 * texto). Coincide con chunkText: 1 trozo hasta CHUNK_CHARS y después uno
 * cada CHUNK_CHARS − OVERLAP_CHARS caracteres.
 */
export function estimateChunkCount(length: number): number {
  if (length <= 0) return 0;
  if (length <= CHUNK_CHARS) return 1;
  return 1 + Math.ceil((length - CHUNK_CHARS) / (CHUNK_CHARS - OVERLAP_CHARS));
}

function tooManyChunks(count: number): DocImportError {
  return new DocImportError("tooManyChunks", `Too much text: about ${count} chunks.`, {
    max: String(MAX_IMPORT_CHUNKS),
  });
}

function chunkText(text: string): string[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];
  if (trimmed.length <= CHUNK_CHARS) return [trimmed];

  const chunks: string[] = [];
  let start = 0;
  while (start < trimmed.length) {
    const end = Math.min(start + CHUNK_CHARS, trimmed.length);
    chunks.push(trimmed.slice(start, end));
    if (end >= trimmed.length) break;
    start = end - OVERLAP_CHARS;
  }
  return chunks;
}

function csvToText(raw: string): string {
  return raw
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => line.split(",").join(" | "))
    .join("\n");
}

type ParsedDoc = { title: string; source: string; body: string };

/**
 * PDFs are binary - reading them with readAsStringAsync (used for every
 * other format) would just return garbage, so extraction has its own path
 * via the native module rather than going through the raw-text branches
 * below. Password-protected PDFs surface a clear message instead of the
 * native module's raw PASSWORD_REQUIRED/INCORRECT_PASSWORD error code -
 * this importer has no password-prompt UI, so there's nothing useful to do
 * with an encrypted PDF beyond telling the user why it was skipped.
 */
async function extractPdf(uri: string, filename: string): Promise<string> {
  try {
    return await extractPdfText(uri);
  } catch (e: any) {
    if (e?.code === "PASSWORD_REQUIRED" || e?.code === "INCORRECT_PASSWORD") {
      throw new DocImportError("pdfPassword", `"${filename}" is password-protected - password-protected PDFs aren't supported.`, { name: filename });
    }
    throw new DocImportError("pdfUnreadable", `Couldn't read "${filename}": ${e?.message ?? e}`, { name: filename });
  }
}

async function parseFileContent(
  file: DocumentPicker.DocumentPickerAsset,
  fallbackTitle: string
): Promise<ParsedDoc[]> {
  const filename = file.name;
  const ext = filename.toLowerCase().split(".").pop();

  const limit = ext === "pdf" ? MAX_IMPORT_PDF_FILE_BYTES : MAX_IMPORT_TEXT_FILE_BYTES;
  if (file.size != null && file.size > limit) {
    throw new DocImportError("tooLarge", `"${filename}" is too large (${file.size} bytes).`, {
      name: filename,
      max: String(Math.round(limit / (1024 * 1024))),
    });
  }

  if (ext === "pdf") {
    const text = await extractPdf(file.uri, filename);
    // Auditoría 2026-10-29 (bomba de descompresión): el tamaño del archivo
    // no dice cuánto texto sale. Se mide aquí, antes de trocear nada.
    const estimated = estimateChunkCount(text.trim().length);
    if (estimated > MAX_IMPORT_CHUNKS) throw tooManyChunks(estimated);
    return [{ title: fallbackTitle, source: filename, body: text }];
  }

  const raw = await FileSystem.readAsStringAsync(file.uri);
  // The picker doesn't always know the size: check what was actually read.
  if (raw.length > MAX_IMPORT_TEXT_FILE_BYTES) {
    throw new DocImportError("tooLarge", `"${filename}" is too large (${raw.length} chars).`, {
      name: filename,
      max: String(Math.round(MAX_IMPORT_TEXT_FILE_BYTES / (1024 * 1024))),
    });
  }

  if (ext === "json") {
    try {
      const parsed = JSON.parse(raw);
      if (
        Array.isArray(parsed) &&
        parsed.every((d) => typeof d?.title === "string" && typeof d?.body === "string")
      ) {
        return parsed.map((d) => ({
          title: d.title,
          source: typeof d.source === "string" ? d.source : filename,
          body: d.body,
        }));
      }
    } catch {
      // not valid JSON, or not the corpus-pack shape - fall through to plain text
    }
    return [{ title: fallbackTitle, source: filename, body: raw }];
  }

  if (ext === "csv") {
    return [{ title: fallbackTitle, source: filename, body: csvToText(raw) }];
  }

  // .md / .txt / anything else we let through the picker filter
  return [{ title: fallbackTitle, source: filename, body: raw }];
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

export async function pickDocuments(): Promise<DocumentPicker.DocumentPickerAsset[] | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: SUPPORTED_MIME_TYPES,
    multiple: true,
    copyToCacheDirectory: true,
  });
  if (result.canceled) return null;
  return result.assets;
}

/**
 * Imports one or more already-picked files as a single named collection:
 * reads each file, splits into docs (see parseFileContent), chunks each doc,
 * embeds every chunk on-device (sequentially - the shared llama.cpp
 * embedding context can't run concurrent embeddings), and inserts into the
 * FTS5 + vector tables tagged with this collection's id so it can be
 * toggled or deleted as a unit later.
 */
export async function importDocuments(
  files: DocumentPicker.DocumentPickerAsset[],
  collectionName: string,
  onProgress?: (p: ImportProgress) => void
): Promise<CustomCollection> {
  const collectionId = `custom-${Date.now()}-${slug(collectionName)}`;
  // Token de ciclo de vida de ESTA importación (ver seedCorpus.seedNow): si
  // Clear All Data avanza el ciclo a mitad, los inserts pendientes y la
  // creación de la colección fallan con DbLifecycleEndedError en vez de
  // repoblar la base nueva con documentos del ciclo anterior.
  const runEpoch = getDbEpoch();

  onProgress?.({ stage: "reading" });
  const allDocs: ParsedDoc[] = [];
  let totalSizeBytes = 0;
  let estimatedChunks = 0;
  for (const file of files) {
    totalSizeBytes += file.size ?? 0;
    const fallbackTitle = file.name.replace(/\.[^.]+$/, "");
    const docs = await parseFileContent(file, fallbackTitle);
    // Se corta en cuanto la suma pasa del tope, sin leer los archivos que
    // quedan ni trocear lo leído.
    for (const d of docs) estimatedChunks += estimateChunkCount(d.body.trim().length);
    if (estimatedChunks > MAX_IMPORT_CHUNKS) throw tooManyChunks(estimatedChunks);
    allDocs.push(...docs);
  }

  onProgress?.({ stage: "chunking" });
  const chunks: { chunkId: string; docId: string; title: string; body: string; source: string }[] = [];
  allDocs.forEach((doc, docIndex) => {
    const docId = `${collectionId}-doc${docIndex}-${slug(doc.title)}`;
    const pieces = chunkText(doc.body);
    pieces.forEach((body, i) => {
      chunks.push({
        chunkId: `${docId}-c${i}`,
        docId,
        title: pieces.length > 1 ? `${doc.title} (part ${i + 1}/${pieces.length})` : doc.title,
        body,
        source: doc.source,
      });
    });
  });

  // Nothing to import (scanned PDF without text, empty file): say so instead
  // of creating an empty collection that looks imported.
  if (chunks.length === 0) {
    throw new DocImportError("noText", "No text found in the selected files.");
  }
  if (chunks.length > MAX_IMPORT_CHUNKS) {
    throw new DocImportError("tooManyChunks", `Too much text: ${chunks.length} chunks.`, {
      max: String(MAX_IMPORT_CHUNKS),
    });
  }

  try {
    for (let i = 0; i < chunks.length; i++) {
      onProgress?.({ stage: "embedding", chunkIndex: i, chunkCount: chunks.length });
      const chunk = chunks[i];
      // F4-2026-10-06: si el JSI de embedding no está disponible, insertar
      // sin embedding (FTS-only) en vez de fallar en duro.
      try {
        const embedding = await embeddingEngine.embedPassageTagged(`${chunk.title}\n${chunk.body}`);
        await insertChunk({ ...chunk, collectionId }, embedding.vector, {
          lifecycleEpoch: runEpoch,
          modelSha256: embedding.modelSha256,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!/native embedding unavailable/i.test(msg)) throw err;
        await insertChunkWithoutEmbedding({ ...chunk, collectionId }, { lifecycleEpoch: runEpoch });
      }
    }

    const collection: Omit<CustomCollection, "active" | "createdAt" | "lastAccessed"> = {
      id: collectionId,
      name: collectionName,
      sourceFilename: files.map((f) => f.name).join(", "),
      docCount: allDocs.length,
      chunkCount: chunks.length,
      sizeBytes: totalSizeBytes,
    };
    await createCustomCollection(collection, { lifecycleEpoch: runEpoch });
  } catch (e) {
    // Half-imported chunks had no collection row: invisible in search but
    // taking space forever. Remove them (best-effort) and report the error.
    await deleteCustomCollection(collectionId).catch(() => {});
    throw e;
  }

  const [created] = (await listCustomCollections()).filter((c) => c.id === collectionId);
  return created;
}

export { listCustomCollections, setCustomCollectionActive, deleteCustomCollection };

/**
 * Exports a collection back out as JSON in the same {title, source, body}[]
 * shape as the app's own downloadable corpus packs - portable, small, and
 * re-embeddable by any instance of the app regardless of embedding model
 * version. Not a raw .sqlite/.db export: that would bake in this device's
 * specific embedding vectors, which are meaningless (or wrong-dimension) on
 * a phone running a different embedding model. Hands off to the OS share
 * sheet so the user picks the transport (Bluetooth, Nearby Share, a file
 * manager, etc.) themselves.
 */
export async function exportCollection(collection: CustomCollection): Promise<void> {
  const docs = await getCollectionDocs(collection.id);
  const json = JSON.stringify(docs, null, 2);
  const path = `${FileSystem.cacheDirectory}${slug(collection.name)}.json`;
  await FileSystem.writeAsStringAsync(path, json);

  try {
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(path, {
        mimeType: "application/json",
        dialogTitle: `Share "${collection.name}" knowledge base`,
      });
    } else {
      throw new Error("Sharing isn't available on this device");
    }
  } finally {
    // El JSON exportado puede contener documentos del usuario: no dejarlo
    // en caché tras compartir (el usuario ya eligió el destino).
    await FileSystem.deleteAsync(path, { idempotent: true }).catch(() => {});
  }
}
