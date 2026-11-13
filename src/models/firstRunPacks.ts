/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * 0.1.95: packs que viajan dentro del APK para que NIDO sirva desde el
 * primer arranque, sin internet y sin modelo.
 *
 * Hasta la 0.1.94, una instalación nueva no tenía nada útil hasta
 * descargar el modelo (0,4 a 1,1 GB) y los packs: la pestaña de
 * Emergencia pedía bajar NIDO Local y la biblioteca de guías estaba vacía.
 * Ahora la app instala desde el propio APK:
 *   - NIDO Essentials: 174 guías de primeros auxilios, salud, desastres y
 *     supervivencia (58 en cada idioma);
 *   - NIDO Local: los números de emergencia comprobados de 69 países, con
 *     su fuente y su fecha.
 *
 * Integridad: no hay camino de confianza nuevo. Cada archivo se copia con
 * ModelManager.installBundled, que comprueba tamaño y SHA-256 contra la
 * entrada del catálogo firmado (la misma que una descarga) antes de
 * marcarlo instalado. Un archivo que no coincide se borra y no se usa.
 *
 * Variante: cada pack existe para dos modelos de búsqueda (bge en inglés y
 * multilingual-e5). Se instala la del modelo activo, para no dejar en el
 * teléfono una copia que la persona no pidió.
 */
import type { CatalogModel } from "./manifest";

/** Packs base que viajan en el APK (sus dos variantes, en assets/bundled-packs/). */
export const BUNDLED_PACK_BASE_IDS = ["nido-esencial", "nido-local"] as const;

/** Carpeta dentro de los assets del APK (la llena plugins/withBundledPacks.js). */
export const BUNDLED_PACK_ASSET_DIR = "packs";

export interface BundledPacksDeps {
  /** El catálogo ya verificado contra su firma. */
  catalog: CatalogModel[];
  /** Id del pack para el modelo de búsqueda activo (packIdForEmbedding). */
  packIdFor: (baseId: string) => string;
  /** Copia y verifica un asset del APK (ModelManager.installBundled). */
  install: (asset: CatalogModel) => Promise<void>;
}

export interface BundledPacksResult {
  installed: string[];
  failed: Array<{ id: string; error: string }>;
}

/**
 * Instala los packs del APK que falten. Idempotente: installBundled no
 * copia lo que ya está con su tamaño. Nunca lanza: un pack que falla queda
 * en `failed` y los demás siguen (el resto de la app no depende de ellos).
 */
export async function installBundledPacks(deps: BundledPacksDeps): Promise<BundledPacksResult> {
  const result: BundledPacksResult = { installed: [], failed: [] };
  for (const baseId of BUNDLED_PACK_BASE_IDS) {
    const id = deps.packIdFor(baseId);
    const asset = deps.catalog.find((m) => m.id === id);
    if (!asset) {
      result.failed.push({ id, error: "no está en el catálogo" });
      continue;
    }
    try {
      await deps.install(asset);
      result.installed.push(id);
    } catch (e) {
      result.failed.push({ id, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return result;
}
