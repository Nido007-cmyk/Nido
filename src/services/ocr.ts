/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * ocr.ts — la costura del reconocimiento de texto (OCR) en el
 * aparato (programa «Lo mejor de la bounty», tanda 6; pieza 05 de
 * la colección: Field Atlas, Apache-2.0; diseño completo y el
 * bloqueo de su parte nativa en docs/OCR_DESIGN.md).
 *
 * El motor (Tesseract vía tesseract4android, como en Field Atlas)
 * vive en un módulo nativo propio, modules/nido-ocr, que NO está
 * construido: este entorno no tiene JDK ni NDK ni dispositivo para
 * compilarlo y probarlo, así que ninguna versión actual de la app
 * lo trae. Esta costura sigue el patrón de pdfText.ts: busca el
 * módulo por su nombre y, si no está, `isOcrAvailable()` dice que
 * no y `recognizeImageText()` lanza OcrError("UNAVAILABLE") — el
 * importador convierte eso en el mensaje honesto de «PDF escaneado
 * sin OCR en esta versión», en vez de importar un documento vacío
 * en silencio. El día que el módulo exista, esta misma costura lo
 * encuentra sin tocar a sus llamadores.
 *
 * Idiomas: los de la casa (es/en/pt) con los códigos de tessdata
 * (spa/eng/por) que el módulo nativo recibirá.
 */

export type OcrLang = "es" | "en" | "pt";

/** Código de datos de idioma (tessdata) por idioma de la app. */
export const TESSDATA_LANG: Record<OcrLang, string> = { es: "spa", en: "eng", pt: "por" };

interface NidoOcrNative {
  recognize(uri: string, tessdataLang: string): Promise<string>;
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
 * la versión no trae el módulo — el estado de todas las versiones
 * hasta que modules/nido-ocr se construya y se pruebe en un
 * teléfono (docs/OCR_DESIGN.md).
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
