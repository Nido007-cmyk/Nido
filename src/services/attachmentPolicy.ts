/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Política de adjuntos e importados (programa «Lo mejor de la
 * bounty», tanda 6; pieza 05 de la colección: el AttachmentPolicy
 * de Field Atlas, Apache-2.0 — ver ATTRIBUTION.md y
 * docs/OCR_DESIGN.md).
 *
 * La lección que viaja de Field Atlas: el tipo de un fichero se
 * decide POR SUS PROPIOS BYTES, no por el MIME que declara el
 * proveedor ni solo por su nombre — un «documento.pdf» que en
 * realidad es una foto o un ZIP se despacha por lo que es. Esta
 * política es el suelo del OCR: clasifica lo que entra (PDF,
 * imagen, texto, o no soportado con su razón) y fija los topes del
 * reconocimiento. El importador actual sigue filtrando por el
 * selector (txt/md/csv/json/pdf); la política queda lista para el
 * día en que el selector se abra a imágenes con el módulo nativo
 * de OCR construido (docs/OCR_DESIGN.md), sin cambiar una línea de
 * esta clasificación.
 *
 * Puro y sin dependencias: se prueba entero en Node.
 */

/** Páginas de un PDF sin capa de texto que pasan por OCR (Field Atlas: 30; el OCR es lento en el teléfono). */
export const MAX_OCR_PAGES = 30;

/** Bytes de cabecera que bastan para clasificar por magia. */
export const KIND_SAMPLE_BYTES = 16;

export type AttachmentKind = "pdf" | "image" | "text" | "unsupported";

export type UnsupportedReason =
  | "archive" // ZIP y familia que no es un documento abierto soportado
  | "spreadsheet" // xlsx/ods: que lo exporten a CSV (como dice Field Atlas)
  | "old-office" // .doc/.xls/.ppt binarios: guardar como formato nuevo
  | "unknown"; // ni magia conocida ni texto limpio

export interface AttachmentDecision {
  kind: AttachmentKind;
  reason?: UnsupportedReason;
}

const HEIF_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1", "avif"]);
const TEXT_EXTENSIONS = new Set(["txt", "md", "markdown", "csv", "json", "html", "htm", "xml", "log"]);

function extension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

function ascii(bytes: Uint8Array, from: number, to: number): string {
  let out = "";
  for (let i = from; i < Math.min(to, bytes.length); i++) out += String.fromCharCode(bytes[i]);
  return out;
}

function startsWith(bytes: Uint8Array, ...magic: number[]): boolean {
  return bytes.length >= magic.length && magic.every((b, i) => bytes[i] === b);
}

/**
 * ¿La muestra es texto limpio? UTF-8 válido (o ASCII) sin más
 * controles que el tabulador y los saltos de línea habituales. Es
 * la puerta de los ficheros sin extensión o con extensión rara.
 */
export function looksLikeText(sample: Uint8Array): boolean {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(sample);
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if (c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Clasifica un fichero por su cabecera (los primeros
 * KIND_SAMPLE_BYTES bastan; una muestra mayor también vale) y, en
 * empates, por su nombre. Portado de la lógica de
 * AttachmentPolicy.kind de Field Atlas a los formatos de NIDO.
 */
export function attachmentKind(name: string, sample: Uint8Array): AttachmentDecision {
  const ext = extension(name);
  if (ascii(sample, 0, 5) === "%PDF-") return { kind: "pdf" };
  if (
    startsWith(sample, 0xff, 0xd8, 0xff) || // JPEG
    startsWith(sample, 137, 80, 78, 71, 13, 10, 26, 10) || // PNG
    (ascii(sample, 0, 4) === "RIFF" && ascii(sample, 8, 12) === "WEBP") ||
    ascii(sample, 0, 6) === "GIF87a" ||
    ascii(sample, 0, 6) === "GIF89a" ||
    (ascii(sample, 0, 2) === "BM" && ext === "bmp") ||
    (sample.length >= 12 && ascii(sample, 4, 8) === "ftyp" && HEIF_BRANDS.has(ascii(sample, 8, 12)))
  ) {
    return { kind: "image" };
  }
  if (startsWith(sample, 0x50, 0x4b, 0x03, 0x04)) {
    // ZIP: un docx/pptx/odt/epub es un ZIP con documentos dentro;
    // hoy el importador no los abre (el selector no los ofrece).
    if (["xlsx", "xlsm", "ods"].includes(ext)) return { kind: "unsupported", reason: "spreadsheet" };
    if (["docx", "pptx", "odt", "odp", "epub"].includes(ext)) return { kind: "unsupported", reason: "archive" };
    return { kind: "unsupported", reason: "archive" };
  }
  if (startsWith(sample, 0xd0, 0xcf, 0x11, 0xe0)) return { kind: "unsupported", reason: "old-office" };
  if (TEXT_EXTENSIONS.has(ext)) return { kind: "text" };
  if (sample.length > 0 && looksLikeText(sample)) return { kind: "text" };
  return { kind: "unsupported", reason: "unknown" };
}
