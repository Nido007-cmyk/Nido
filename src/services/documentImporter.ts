/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { extractPdfTextCapped, PdfTextError } from "./pdfText";
import { isOcrAvailable, recognizeImageText, recognizeScannedPdfText, OCR_PROVENANCE_NOTE, OcrError, OcrLang } from "./ocr";
import { attachmentKind, KIND_SAMPLE_BYTES } from "./attachmentPolicy";
import { embeddingEngine } from "../rag/embed";
import {
  getDbEpoch,
  insertChunk,
  insertChunkWithoutEmbedding,
  createCustomCollection,
  deleteCustomCollection,
  deleteOrphanCollectionChunks,
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
 * - .pdf: embedded/selectable text via modules/nido-pdf-text (Apache
 *   PDFBox-Android on-device, no network). Scanned pages (the whole
 *   PDF, or loose pages inside a mixed one) go through OCR via
 *   modules/nido-ocr (src/services/ocr.ts; design in
 *   docs/OCR_DESIGN.md) and enter as their own doc, marked with
 *   its OCR provenance. In a build without the module, an
 *   all-scanned import says so (error code scannedNoOcr) instead
 *   of a generic "no text".
 * - images (jpg/png/webp/gif/bmp/heic/heif/avif, by extension or by
 *   their own bytes via attachmentPolicy): printed text read with
 *   the same on-device OCR, provenance marked the same way.
 *   Password-protected PDFs are rejected with a clear error rather
 *   than attempted.
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
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/bmp",
  "image/heic",
  "image/heif",
  "image/avif",
];

/** Extensiones que el selector puede dar a una imagen (el despacho final lo deciden los bytes, attachmentPolicy). */
const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "gif", "bmp", "heic", "heif", "avif"]);
/** Extensiones de texto ya despachadas por su rama: no hace falta clasificarlas por magia. */
const TEXT_DISPATCH_EXTENSIONS = new Set(["txt", "md", "markdown", "csv", "json", "html", "htm", "xml", "log"]);

/**
 * Offensive audit (0.1.18): limits. A 300 MB log picked by mistake was read
 * whole into a JS string (the app could be killed for memory) and then
 * embedded chunk by chunk for hours. 25 MB of text is ~12,000 pages; PDFs are
 * measured by the text they give (MAX_IMPORT_CHUNKS).
 */
export const MAX_IMPORT_TEXT_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_IMPORT_PDF_FILE_BYTES = 100 * 1024 * 1024;
export const MAX_IMPORT_CHUNKS = 4000;
/** Más páginas que esto no se leen (un libro largo tiene ~1000). */
export const MAX_IMPORT_PDF_PAGES = 3000;

export type DocImportErrorCode =
  | "tooLarge"
  | "tooManyChunks"
  | "pdfPassword"
  | "pdfUnreadable"
  | "noText"
  | "scannedNoOcr"
  | "imageNoOcr"
  | "ocrFailed";

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
  stage: "reading" | "ocr" | "chunking" | "embedding";
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

/** Caracteres que caben en `chunks` trozos (lo inverso de estimateChunkCount). */
export function maxCharsForChunks(chunks: number): number {
  if (chunks <= 0) return 0;
  return CHUNK_CHARS + (chunks - 1) * (CHUNK_CHARS - OVERLAP_CHARS);
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

type ParsedDoc = { title: string; source: string; body: string; ocr?: boolean };

/** Lo que una importación va anotando para nombrar su error si al final no entra nada. */
interface ImportSink {
  emptyPdfNames: string[];
  ocrFailedNames: string[];
  /**
   * R-06 P5: PDF sin capa de texto cuyo OCR SÍ corrió y devolvió
   * vacío (no rechazó: resolvió sin texto). Se anota aparte de
   * ocrFailedNames a propósito: el error de vacío total distingue
   * «resolvió vacío» (noText) de «la llamada rechazó» (ocrFailed)
   * — esa distinción es la que separa las ramas del fallo en el
   * aparato — y esta lista da el nombre a los avisos por fichero.
   */
  ocrEmptyNames: string[];
  noOcrImageNames: string[];
  /**
   * La huella de cada rechazo de OCR, por nombre de fichero: el
   * código del OcrError y su mensaje acotado. Antes de R-06 P5 el
   * catch del importador tiraba el error entero y ni el código ni
   * el mensaje sobrevivían a ninguna superficie.
   */
  ocrErrorByName: Map<string, { code: string; message: string }>;
}

/** Tope del mensaje de error de OCR que se conserva: el del módulo nativo, sin contenido del usuario. */
const OCR_ERROR_MESSAGE_MAX = 200;

/**
 * Anota un rechazo de OCR conservando su huella (código y mensaje
 * acotado del OcrError), en vez del catch desnudo que lo enterraba.
 */
function noteOcrFailure(sink: ImportSink | undefined, filename: string, e: unknown): void {
  if (!sink) return;
  sink.ocrFailedNames.push(filename);
  const code = e instanceof OcrError ? e.code : "OCR_FAILED";
  const message = (e instanceof Error ? e.message : String(e)).slice(0, OCR_ERROR_MESSAGE_MAX);
  sink.ocrErrorByName.set(filename, { code, message });
}

/**
 * Por qué un fichero no aportó texto a una importación con éxito
 * (R-06 P5): el aviso que la Biblioteca enseña en la colección.
 * `ocrFailed` lleva la huella del rechazo (código y mensaje del
 * nativo, acotado); `ocrEmpty` es un OCR que corrió y volvió sin
 * texto; `imageNoOcr`, una imagen en una versión sin el módulo.
 */
export type ImportWarningReason = "ocrFailed" | "ocrEmpty" | "imageNoOcr" | "noText";

export interface ImportWarning {
  name: string;
  reason: ImportWarningReason;
  ocrCode?: string;
  ocrMessage?: string;
}

/** La colección creada por una importación, con los avisos por fichero sin texto de esa importación. */
export interface ImportedCollection extends CustomCollection {
  importWarnings: ImportWarning[];
}

/** El aviso de un fichero, leído de los sumideros de su importación. */
function importWarningFor(name: string, sink: ImportSink): ImportWarning {
  if (sink.ocrFailedNames.includes(name)) {
    const detail = sink.ocrErrorByName.get(name);
    return {
      name,
      reason: "ocrFailed",
      ...(detail ? { ocrCode: detail.code, ocrMessage: detail.message } : {}),
    };
  }
  if (sink.ocrEmptyNames.includes(name)) return { name, reason: "ocrEmpty" };
  if (sink.noOcrImageNames.includes(name)) return { name, reason: "imageNoOcr" };
  return { name, reason: "noText" };
}

/** El entorno de reconocimiento de UNA importación: idioma de la app y si esta versión trae el módulo. */
interface ImportEnv {
  lang: OcrLang;
  ocrAvailable: boolean;
  onProgress?: (p: ImportProgress) => void;
}

const BASE64_SHAPE = /^[A-Za-z0-9+/=\s]+$/;

function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/=]/g, "");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i + 4 <= clean.length; i += 4) {
    const n =
      (BASE64_ALPHABET.indexOf(clean[i]) << 18) |
      (BASE64_ALPHABET.indexOf(clean[i + 1]) << 12) |
      (BASE64_ALPHABET.indexOf(clean[i + 2]) << 6) |
      BASE64_ALPHABET.indexOf(clean[i + 3]);
    out[o++] = (n >> 16) & 0xff;
    if (clean[i + 2] !== "=") out[o++] = (n >> 8) & 0xff;
    if (clean[i + 3] !== "=") out[o++] = n & 0xff;
  }
  return out.slice(0, o);
}

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * Los primeros bytes de un fichero, para clasificarlo por su magia
 * (attachmentPolicy) cuando la extensión no lo despacha. Un lector
 * que ignora las opciones de rango (el de las pruebas) devuelve el
 * texto tal cual: sus primeros bytes sirven igual.
 */
async function readKindSample(uri: string): Promise<Uint8Array | null> {
  try {
    const raw = await FileSystem.readAsStringAsync(uri, {
      encoding: "base64" as FileSystem.EncodingType,
      position: 0,
      length: KIND_SAMPLE_BYTES * 2,
    });
    if (!BASE64_SHAPE.test(raw.trim())) {
      return new TextEncoder().encode(raw.slice(0, KIND_SAMPLE_BYTES));
    }
    return base64ToBytes(raw).slice(0, KIND_SAMPLE_BYTES);
  } catch {
    return null;
  }
}

/**
 * PDFs are binary - reading them with readAsStringAsync (used for every
 * other format) would just return garbage, so extraction has its own path
 * via the native module rather than going through the raw-text branches
 * below. Password-protected PDFs surface a clear message instead of the
 * native module's raw PASSWORD_REQUIRED/INCORRECT_PASSWORD error code -
 * this importer has no password-prompt UI, so there's nothing useful to do
 * with an encrypted PDF beyond telling the user why it was skipped.
 */
async function extractPdf(uri: string, filename: string, maxChars: number): Promise<string> {
  try {
    // Auditoría 2026-10-29: el módulo nativo se para en `maxChars` (lo que
    // aún cabe en el tope de trozos) y rechaza PDFs con demasiadas páginas,
    // antes de que el texto llegue entero a la memoria.
    return await extractPdfTextCapped(uri, maxChars, MAX_IMPORT_PDF_PAGES);
  } catch (e) {
    const code = e instanceof PdfTextError ? e.code : "PDF_EXTRACTION_ERROR";
    if (code === "PASSWORD_REQUIRED") {
      throw new DocImportError("pdfPassword", `"${filename}" is password-protected - password-protected PDFs aren't supported.`, { name: filename });
    }
    if (code === "TEXT_TOO_LARGE" || code === "TOO_MANY_PAGES") {
      throw tooManyChunks(MAX_IMPORT_CHUNKS + 1);
    }
    throw new DocImportError("pdfUnreadable", `Couldn't read "${filename}": ${e instanceof Error ? e.message : String(e)}`, { name: filename });
  }
}

/**
 * El error de una importación que no dio ningún texto: si algún PDF
 * entró vacío (escaneado, sin capa de texto) y esta versión no trae
 * OCR, el error lo nombra (scannedNoOcr); si no, el genérico de
 * siempre. Pura, para probarla sin el importador entero.
 */
export function emptyImportErrorCode(emptyPdfNames: string[], ocrAvailable: boolean): DocImportErrorCode {
  return emptyPdfNames.length > 0 && !ocrAvailable ? "scannedNoOcr" : "noText";
}

async function parseFileContent(
  file: DocumentPicker.DocumentPickerAsset,
  fallbackTitle: string,
  chunksLeft: number = MAX_IMPORT_CHUNKS,
  sink?: ImportSink,
  env?: ImportEnv
): Promise<ParsedDoc[]> {
  const filename = file.name;
  const ext = filename.toLowerCase().split(".").pop() ?? "";

  // El despacho lo decide la extensión conocida o, si no, los
  // propios bytes del fichero (attachmentPolicy): una imagen
  // llamada .bin o un PDF llamado .data van por su camino.
  let kind: "pdf" | "image" | "text" | "unsupported" | null = null;
  if (ext === "pdf") kind = "pdf";
  else if (IMAGE_EXTENSIONS.has(ext)) kind = "image";
  else if (TEXT_DISPATCH_EXTENSIONS.has(ext)) kind = "text";
  else {
    const sample = await readKindSample(file.uri);
    if (sample) kind = attachmentKind(filename, sample).kind;
  }

  if (kind === "image") {
    if (file.size != null && file.size > MAX_IMPORT_TEXT_FILE_BYTES) {
      throw new DocImportError("tooLarge", `"${filename}" is too large (${file.size} bytes).`, {
        name: filename,
        max: String(Math.round(MAX_IMPORT_TEXT_FILE_BYTES / (1024 * 1024))),
      });
    }
    // Una imagen entra por su texto impreso, leído en el aparato.
    // Sin el módulo en esta versión, se anota para nombrarla si la
    // importación entera queda vacía (error imageNoOcr).
    if (!env?.ocrAvailable) {
      sink?.noOcrImageNames.push(filename);
      return [{ title: fallbackTitle, source: filename, body: "" }];
    }
    env.onProgress?.({ stage: "ocr" });
    try {
      const text = await recognizeImageText(file.uri, env.lang);
      return [{ title: fallbackTitle, source: filename, body: text, ocr: true }];
    } catch (e) {
      noteOcrFailure(sink, filename, e);
      return [{ title: fallbackTitle, source: filename, body: "" }];
    }
  }

  const limit = kind === "pdf" ? MAX_IMPORT_PDF_FILE_BYTES : MAX_IMPORT_TEXT_FILE_BYTES;
  if (file.size != null && file.size > limit) {
    throw new DocImportError("tooLarge", `"${filename}" is too large (${file.size} bytes).`, {
      name: filename,
      max: String(Math.round(limit / (1024 * 1024))),
    });
  }

  if (kind === "pdf") {
    const text = await extractPdf(file.uri, filename, maxCharsForChunks(chunksLeft) + OVERLAP_CHARS);
    // Un PDF sin capa de texto (escaneado) extrae vacío: se anota
    // para que una importación sin nada importable lo nombre
    // (emptyImportErrorCode), no para fallar aquí — en una
    // importación mixta los demás ficheros siguen entrando.
    if (text.trim().length === 0) sink?.emptyPdfNames.push(filename);
    // Auditoría 2026-10-29 (bomba de descompresión): el tamaño del archivo
    // no dice cuánto texto sale. Se mide aquí, antes de trocear nada.
    const estimated = estimateChunkCount(text.trim().length);
    if (estimated > MAX_IMPORT_CHUNKS) throw tooManyChunks(estimated);
    const docs: ParsedDoc[] = [{ title: fallbackTitle, source: filename, body: text }];
    // Las páginas escaneadas del PDF (todas si no hay capa de
    // texto; las sueltas si es mixto) pasan por OCR cuando la
    // versión trae el módulo, y el texto reconocido entra como
    // documento propio, con su procedencia marcada al trocear.
    if (env?.ocrAvailable) {
      env.onProgress?.({ stage: "ocr" });
      try {
        const ocrText = await recognizeScannedPdfText(file.uri, env.lang);
        if (ocrText.trim().length > 0) {
          docs.push({ title: fallbackTitle, source: filename, body: ocrText, ocr: true });
        } else if (text.trim().length === 0) {
          // R-06 P5: sin capa de texto y el OCR volvió vacío — el
          // fichero se anota para que los avisos lo nombren (antes
          // este caso no anotaba nada y el PDF entraba como
          // documento sin haber aportado ni un chunk, en silencio).
          sink?.ocrEmptyNames.push(filename);
        }
      } catch (e) {
        // El texto de la capa (si lo hay) sigue valiendo; si no lo
        // hay, el nombre y la huella del rechazo quedan anotados
        // para el error de vacío y para los avisos.
        noteOcrFailure(sink, filename, e);
      }
    }
    return docs;
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
 * Colecciones cuya importación está en vuelo en este proceso (carril
 * F-REV): la importación inserta sus trozos antes de crear la fila de
 * la colección, así que durante el vuelo esos trozos parecen huérfanos
 * a la barrida de F3-17. El registro se pasa a la barrida como
 * exclusión para que sea segura en sí misma, llame quien la llame.
 */
const inFlightCollectionIds = new Set<string>();

/** Cadena que serializa las importaciones (ver importDocuments). */
let importChain: Promise<unknown> = Promise.resolve();

/**
 * Imports one or more already-picked files as a single named collection:
 * reads each file, splits into docs (see parseFileContent), chunks each doc,
 * embeds every chunk on-device (sequentially - the shared llama.cpp
 * embedding context can't run concurrent embeddings), and inserts into the
 * FTS5 + vector tables tagged with this collection's id so it can be
 * toggled or deleted as a unit later.
 *
 * Las importaciones van EN SERIE, una tras otra (sonda del carril
 * F-REV): el llamante de la UI no tenía guarda de reentrada y dos
 * importaciones concurrentes dejaban que la barrida inicial de la
 * segunda borrara los trozos en vuelo de la primera, que nacía
 * declarando trozos que no tenía. El epoch de ciclo de vida se
 * captura cuando la importación arranca de verdad, tras la espera.
 */
export function importDocuments(
  files: DocumentPicker.DocumentPickerAsset[],
  collectionName: string,
  onProgress?: (p: ImportProgress) => void
): Promise<ImportedCollection> {
  const run = importChain.then(() => importDocumentsSerial(files, collectionName, onProgress));
  // La cadena nunca muere: el fallo lo recibe el llamante en `run`,
  // no la cadena que ordena a las importaciones siguientes.
  importChain = run.catch(() => {});
  return run;
}

async function importDocumentsSerial(
  files: DocumentPicker.DocumentPickerAsset[],
  collectionName: string,
  onProgress?: (p: ImportProgress) => void
): Promise<ImportedCollection> {
  const collectionId = `custom-${Date.now()}-${slug(collectionName)}`;
  // Token de ciclo de vida de ESTA importación (ver seedCorpus.seedNow): si
  // Clear All Data avanza el ciclo a mitad, los inserts pendientes y la
  // creación de la colección fallan con DbLifecycleEndedError en vez de
  // repoblar la base nueva con documentos del ciclo anterior.
  const runEpoch = getDbEpoch();

  onProgress?.({ stage: "reading" });
  const allDocs: ParsedDoc[] = [];
  const sink: ImportSink = {
    emptyPdfNames: [],
    ocrFailedNames: [],
    ocrEmptyNames: [],
    noOcrImageNames: [],
    ocrErrorByName: new Map(),
  };
  const importWarnings: ImportWarning[] = [];
  // El reconocimiento se prepara una vez por importación: si esta
  // versión no trae el módulo, el idioma ni se lee (el camino sin
  // OCR es exactamente el de siempre). models/settings se importa
  // aquí dentro a propósito: cargarlo arriba arrastraría su
  // superficie de ficheros a los mundos de prueba del importador.
  const ocrAvailable = await isOcrAvailable();
  let lang: OcrLang = "en";
  if (ocrAvailable) {
    lang = (await (await import("../models/settings")).getLanguageId()) as OcrLang;
  }
  const env: ImportEnv = { lang, ocrAvailable, onProgress };
  let totalSizeBytes = 0;
  let estimatedChunks = 0;
  for (const file of files) {
    totalSizeBytes += file.size ?? 0;
    const fallbackTitle = file.name.replace(/\.[^.]+$/, "");
    const docs = await parseFileContent(file, fallbackTitle, MAX_IMPORT_CHUNKS - estimatedChunks, sink, env);
    // Se corta en cuanto la suma pasa del tope, sin leer los archivos que
    // quedan ni trocear lo leído.
    for (const d of docs) estimatedChunks += estimateChunkCount(d.body.trim().length);
    if (estimatedChunks > MAX_IMPORT_CHUNKS) throw tooManyChunks(estimatedChunks);
    // R-06 P5: un fichero cuyos documentos no dan ni un trozo queda
    // nombrado como aviso de ESTA importación aunque tenga éxito —
    // antes, con un solo fichero bueno al lado, su fracaso no se
    // nombraba en ninguna parte.
    if (docs.every((d) => d.body.trim().length === 0)) {
      importWarnings.push(importWarningFor(file.name, sink));
    }
    allDocs.push(...docs);
  }

  onProgress?.({ stage: "chunking" });
  const chunks: { chunkId: string; docId: string; title: string; body: string; source: string }[] = [];
  allDocs.forEach((doc, docIndex) => {
    const docId = `${collectionId}-doc${docIndex}-${slug(doc.title)}`;
    // El texto reconocido lleva su procedencia DENTRO del cuerpo:
    // viaja con cada trozo y con sus citas (el OCR puede
    // equivocarse; quien lo lea, que lo sepa).
    const body =
      doc.ocr && doc.body.trim().length > 0 ? `${OCR_PROVENANCE_NOTE[env.lang]}\n\n${doc.body}` : doc.body;
    const pieces = chunkText(body);
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
  // of creating an empty collection that looks imported. The error
  // names the cause: an image in a build without OCR, a recognition
  // that failed, a scanned PDF in a build without OCR, or plain
  // no text — in that order.
  if (chunks.length === 0) {
    if (sink.noOcrImageNames.length > 0) {
      throw new DocImportError(
        "imageNoOcr",
        `"${sink.noOcrImageNames[0]}" is an image and this build has no OCR.`,
        { name: sink.noOcrImageNames[0] }
      );
    }
    if (sink.ocrFailedNames.length > 0) {
      const name = sink.ocrFailedNames[0];
      // R-06 P5: el error nombrado conserva la huella del rechazo
      // (código y mensaje acotado del nativo) en sus vars y en su
      // mensaje de registro — es lo que separa «la llamada rechazó»
      // de «resolvió vacía» fuera del aparato.
      const detail = sink.ocrErrorByName.get(name);
      throw new DocImportError(
        "ocrFailed",
        `"${name}" couldn't be read even with OCR${detail ? ` (${detail.code}: ${detail.message})` : ""}.`,
        detail ? { name, ocrCode: detail.code, ocrMessage: detail.message } : { name }
      );
    }
    const code = emptyImportErrorCode(sink.emptyPdfNames, ocrAvailable);
    throw new DocImportError(
      code,
      code === "scannedNoOcr"
        ? `"${sink.emptyPdfNames[0]}" looks like a scanned PDF and this build has no OCR.`
        : "No text found in the selected files.",
      code === "scannedNoOcr" ? { name: sink.emptyPdfNames[0] } : {}
    );
  }
  if (chunks.length > MAX_IMPORT_CHUNKS) {
    throw new DocImportError("tooManyChunks", `Too much text: ${chunks.length} chunks.`, {
      max: String(MAX_IMPORT_CHUNKS),
    });
  }

  // Desde aquí hay trozos en vuelo sin fila de colección: este id
  // queda registrado para que ninguna barrida lo tome por huérfano
  // (carril F-REV), y se desregistra al salir, nazca o muera la
  // importación — si muere, el catch de abajo ya limpió sus trozos.
  inFlightCollectionIds.add(collectionId);
  try {
    // F3-17: antes de insertar, barrer los trozos huérfanos de una
    // importación anterior muerta a mitad. Best-effort: si la barrida
    // falla, la importación sigue y la próxima lo reintenta.
    await deleteOrphanCollectionChunks({
      lifecycleEpoch: runEpoch,
      excludeCollectionIds: [...inFlightCollectionIds],
    }).catch(() => {});
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
  } finally {
    inFlightCollectionIds.delete(collectionId);
  }

  const [created] = (await listCustomCollections()).filter((c) => c.id === collectionId);
  return { ...created, importWarnings };
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
