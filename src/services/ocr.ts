/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * ocr.ts — la costura del reconocimiento de texto (OCR) en el
 * aparato (programa «Lo mejor de la bounty», tanda 6; pieza 05 de
 * la colección: Field Atlas, Apache-2.0; diseño completo en
 * docs/OCR_DESIGN.md).
 *
 * El motor (Tesseract vía tesseract4android, como en Field Atlas)
 * vive en un módulo nativo propio, modules/nido-ocr, construido
 * por el carril OCR del 2026-10-31 (compilado y empaquetado en un
 * APK local inspeccionado; su prueba en un teléfono es la ronda
 * física del dueño). Esta costura sigue el patrón de pdfText.ts:
 * busca el módulo por su nombre y, si no está (una versión sin el
 * módulo), `isOcrAvailable()` dice que no y las funciones de
 * reconocimiento lanzan OcrError("UNAVAILABLE") — el importador
 * convierte eso en el mensaje honesto de «PDF escaneado sin OCR
 * en esta versión», en vez de importar un documento vacío en
 * silencio.
 *
 * Idiomas: los de la casa (es/en/pt) con los códigos de tessdata
 * (spa/eng/por) que el módulo nativo recibe.
 */

import { MAX_OCR_PAGES } from "./attachmentPolicy";

export type OcrLang = "es" | "en" | "pt";

/** Código de datos de idioma (tessdata) por idioma de la app. */
export const TESSDATA_LANG: Record<OcrLang, string> = { es: "spa", en: "eng", pt: "por" };

/**
 * La marca de procedencia que viaja DENTRO del texto reconocido
 * cuando entra en la base de conocimiento (como avisa Field
 * Atlas: el OCR puede equivocarse). Texto fijo trilingüe, como el
 * texto seguro de la puerta de salud (routing/emergencyGate.ts).
 */
export const OCR_PROVENANCE_NOTE: Record<OcrLang, string> = {
  es: "Texto reconocido con OCR en este aparato: puede contener errores; verifícalo antes de fiarte.",
  en: "Text recognized with OCR on this device: it can contain mistakes; check it before relying on it.",
  pt: "Texto reconhecido com OCR neste aparelho: pode conter erros; verifique-o antes de confiar.",
};

interface NidoOcrNative {
  recognize(uri: string, tessdataLang: string): Promise<string>;
  recognizePdfPages?: (uri: string, pages: number[], tessdataLang: string) => Promise<string>;
}

export type OcrErrorCode = "UNAVAILABLE" | "OCR_FAILED";

export class OcrError extends Error {
  constructor(
    readonly code: OcrErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "OcrError";
  }
}

let native: NidoOcrNative | null | undefined;
/** Import diferido, como en pdfText.ts: la costura se prueba sin runtime nativo. */
async function getNative(): Promise<NidoOcrNative | null> {
  if (native === undefined) {
    try {
      const { requireOptionalNativeModule } = await import("expo-modules-core");
      native = requireOptionalNativeModule<NidoOcrNative>("NidoOcr");
    } catch {
      native = null;
    }
  }
  return native;
}

/** Tests: sustituye el módulo nativo. */
export function _setOcrNativeForTests(n: NidoOcrNative | null | undefined): void {
  native = n;
}

/** ¿Trae esta versión de la app el módulo de OCR? */
export async function isOcrAvailable(): Promise<boolean> {
  return (await getNative()) !== null;
}

/**
 * Reconoce el texto impreso de una imagen (foto o página
 * escaneada) en el idioma dado. Lanza OcrError("UNAVAILABLE") si
 * la versión no trae el módulo (docs/OCR_DESIGN.md).
 */
export async function recognizeImageText(uri: string, lang: OcrLang): Promise<string> {
  const n = await getNative();
  if (!n) throw new OcrError("UNAVAILABLE", "Text recognition (OCR) is not available in this build.");
  try {
    return await n.recognize(uri, TESSDATA_LANG[lang]);
  } catch (e) {
    throw new OcrError("OCR_FAILED", e instanceof Error ? e.message : String(e));
  }
}

/** Sanea la lista de páginas para el módulo: índices 0-based, sin duplicados, en orden, con el tope de la política. */
export function sanitizeOcrPages(pages: number[]): number[] {
  const clean = [...new Set(pages.filter((p) => Number.isInteger(p) && p >= 0))].sort((a, b) => a - b);
  return clean.slice(0, MAX_OCR_PAGES);
}

/**
 * Reconoce el texto de las páginas escaneadas de un PDF. Con
 * `pages` vacío, el módulo encuentra él mismo las páginas cuya
 * capa de texto está vacía o casi (la costura no puede enumerarlas:
 * nido-pdf-text devuelve el texto entero del documento) y devuelve
 * solo el texto reconocido de esas páginas, con el tope
 * MAX_OCR_PAGES. Lanza OcrError("UNAVAILABLE") si la versión no
 * trae el módulo o le falta esta entrada.
 */
export async function recognizePdfPagesText(uri: string, pages: number[], lang: OcrLang): Promise<string> {
  const n = await getNative();
  if (!n || typeof n.recognizePdfPages !== "function") {
    throw new OcrError("UNAVAILABLE", "Text recognition (OCR) is not available in this build.");
  }
  try {
    return await n.recognizePdfPages(uri, sanitizeOcrPages(pages), TESSDATA_LANG[lang]);
  } catch (e) {
    throw new OcrError("OCR_FAILED", e instanceof Error ? e.message : String(e));
  }
}

/** Atajo del importador: el texto reconocido de las páginas escaneadas de un PDF, sin enumerarlas. */
export async function recognizeScannedPdfText(uri: string, lang: OcrLang): Promise<string> {
  return recognizePdfPagesText(uri, [], lang);
}
