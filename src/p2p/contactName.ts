/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * contactName.ts — normalización de nombres de contacto P2P (M-4, UNIT B).
 *
 * Módulo deliberadamente libre de dependencias nativas: la comparación
 * de nombres debe ser idéntica en el store, el messenger y la ceremonia
 * de emparejamiento ("mismo nombre ≠ misma identidad" solo tiene sentido
 * con una sola normalización). Recorta espacios, pasa a minúsculas y
 * normaliza Unicode (NFC): " Beto " y "beto" son el mismo nombre;
 * "Bet" NO es "Beto" (sin subcadenas).
 */

/**
 * M-4: normalización para comparar nombres de contacto. Recorta espacios,
 * pasa a minúsculas y normaliza Unicode (NFC).
 */
export function normalizeContactName(name: string): string {
  // P5 (auditoría 2026-10-10): NFKC pliega formas de compatibilidad (ancho
  // completo, ligaduras) y se descartan los caracteres invisibles, para que
  // "Beto" + espacio de ancho cero colisione con "Beto". Los homoglifos
  // entre alfabetos (cirílico/latino) NO se pliegan aquí: la huella es la
  // identidad, el nombre solo es una etiqueta.
  return name
    .normalize("NFKC")
    .replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g, "")
    .trim()
    .toLowerCase()
    .normalize("NFC");
}
