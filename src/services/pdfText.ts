/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * pdfText.ts — texto de un PDF con topes duros (auditoría 2026-10-29).
 *
 * El módulo nativo (modules/nido-pdf-text) deja de extraer en cuanto el texto
 * pasa de `maxChars`, también a mitad de una página enorme, y rechaza un PDF
 * con más de `maxPages` páginas antes de leer nada. Así un PDF pequeño que se
 * descomprime en cientos de MB de texto ya no puede agotar la memoria dentro
 * de la librería (antes, expo-pdf-text-extract devolvía todo el texto de
 * golpe y NIDO solo podía medirlo después).
 */
interface NidoPdfTextNative {
  extractText(uri: string, maxChars: number, maxPages: number): Promise<string>;
}

export type PdfTextErrorCode =
  | "PASSWORD_REQUIRED"
  | "TOO_MANY_PAGES"
  | "TEXT_TOO_LARGE"
  | "PDF_LOAD_ERROR"
  | "PDF_EXTRACTION_ERROR"
  | "UNAVAILABLE";

export class PdfTextError extends Error {
  constructor(
    readonly code: PdfTextErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PdfTextError";
  }
}

const KNOWN: ReadonlySet<string> = new Set([
  "PASSWORD_REQUIRED",
  "TOO_MANY_PAGES",
  "TEXT_TOO_LARGE",
  "PDF_LOAD_ERROR",
  "PDF_EXTRACTION_ERROR",
]);

/** Traduce un error del módulo nativo a un código estable. */
export function toPdfTextError(e: unknown): PdfTextError {
  const code = (e as { code?: unknown })?.code;
  const message = e instanceof Error ? e.message : String(e);
  return new PdfTextError(
    typeof code === "string" && KNOWN.has(code) ? (code as PdfTextErrorCode) : "PDF_EXTRACTION_ERROR",
    message,
  );
}

let native: NidoPdfTextNative | null | undefined;
/** Import diferido: el módulo se puede probar sin el runtime nativo. */
async function getNative(): Promise<NidoPdfTextNative | null> {
  if (native === undefined) {
    try {
      const { requireOptionalNativeModule } = await import("expo-modules-core");
      native = requireOptionalNativeModule<NidoPdfTextNative>("NidoPdfText");
    } catch {
      native = null;
    }
  }
  return native;
}

/** Tests: sustituye el módulo nativo. */
export function _setPdfTextNativeForTests(n: NidoPdfTextNative | null | undefined): void {
  native = n;
}

export async function extractPdfTextCapped(uri: string, maxChars: number, maxPages: number): Promise<string> {
  const n = await getNative();
  if (!n) throw new PdfTextError("UNAVAILABLE", "PDF reader not available in this build.");
  try {
    return await n.extractText(uri, Math.max(0, Math.floor(maxChars)), Math.max(1, Math.floor(maxPages)));
  } catch (e) {
    throw toPdfTextError(e);
  }
}
