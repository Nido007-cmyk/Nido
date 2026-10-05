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
  return name.trim().toLowerCase().normalize("NFC");
}
