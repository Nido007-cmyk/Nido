/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * seedPlan.ts — qué hay que indexar y qué sobra en la base de conocimiento.
 *
 * Evidencia física (Tab A9+, v0.1.6, 2026-10-11): "Preparing your
 * knowledge… 1,710 / 5,305" volvía a salir aunque el índice ya se había
 * completado, y Ajustes decía "✓ In your knowledge base" a la vez.
 *
 * Causas raíz en seedCorpus.ts (antes de este fix):
 *  1. El atajo "no hay nada nuevo" exigía COUNT(*) === nº de documentos
 *     esperados. Cualquier fila de más lo rompía para siempre. Por ejemplo,
 *     al borrar un paquete con el icono de papelera, ModelManager.deleteModel
 *     borra el archivo pero NO sus filas indexadas. Desde entonces, en cada
 *     arranque y cada vuelta desde Ajustes se recorrían los 5,305 documentos
 *     uno por uno (5,305 SELECT), con el aviso de progreso contando desde 1.
 *  2. El contador incluía los documentos ya indexados, así que parecía
 *     empezar de cero aunque no se re-indexara nada.
 *  3. Ajustes mostraba "en tu base de conocimiento" con solo tener el
 *     archivo descargado, aunque el indexado no hubiera terminado.
 *
 * Este módulo es la parte pura: compara (una sola consulta) los ids
 * esperados con los existentes y decide qué falta, qué sobra y cuánto lleva
 * cada paquete. Sin dependencias: testeable en Node.
 */

export interface ExpectedDoc {
  id: string;
  /** Paquete descargable al que pertenece (undefined = incluido en la app). */
  packId?: string;
}

export interface SeedPlan {
  /** Ids que hay que indexar (en el orden esperado). */
  missing: string[];
  /** Ids indexados de paquetes que ya no están en el teléfono: se borran. */
  stale: string[];
  /** Progreso por paquete descargado: indexados / total. */
  packs: Record<string, { indexed: number; total: number }>;
}

/** Prefijo de los ids de un paquete descargable (mismo formato que seedCorpus). */
export function packIdPrefix(packId: string): string {
  return `wiki-${packId}-`;
}

/**
 * @param expected    documentos que deberían estar indexados
 * @param existingIds ids ya presentes (filas sin collection_id)
 * @param removedPackIds paquetes cuyo archivo NO está en el teléfono: sus
 *   filas sobran. Un paquete presente pero ilegible NO va aquí: se conserva
 *   su índice (re-indexar es caro y el archivo puede leerse en el próximo
 *   arranque).
 */
export function planSeed(
  expected: readonly ExpectedDoc[],
  existingIds: Iterable<string>,
  removedPackIds: readonly string[],
): SeedPlan {
  const existing = new Set(existingIds);
  const expectedSet = new Set(expected.map((d) => d.id));
  const missing = expected.filter((d) => !existing.has(d.id)).map((d) => d.id);

  const prefixes = removedPackIds.map(packIdPrefix);
  const stale: string[] = [];
  for (const id of existing) {
    if (expectedSet.has(id)) continue;
    // Solo se borra lo que es claramente de un paquete quitado; cualquier
    // otra fila desconocida se deja (fail-safe: nunca perder datos).
    if (prefixes.some((p) => id.startsWith(p))) stale.push(id);
  }

  const packs: SeedPlan["packs"] = {};
  for (const d of expected) {
    if (!d.packId) continue;
    const p = (packs[d.packId] ??= { indexed: 0, total: 0 });
    p.total++;
    if (existing.has(d.id)) p.indexed++;
  }
  return { missing, stale, packs };
}
