/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * La parte pura de la elección de modelo de búsqueda: los dos modelos, qué
 * variante de cada pack corresponde a cada uno y el modelo por defecto de
 * una instalación nueva según el idioma. Sin motores ni bases de datos.
 *
 * 0.1.95: separada de embeddingSwitch.ts (que la reexporta tal cual) para
 * que el arranque pueda elegir la variante de los packs del APK sin cargar
 * los motores ni la base de conocimiento.
 */
import { MODEL_CATALOG, type CatalogModel } from "../models/manifest";

export const DEFAULT_EMBEDDING_ID = "bge-small-en-v1.5-q8";
export const MULTILINGUAL_EMBEDDING_ID = "multilingual-e5-small-q8";

/** Packs whose vectors are built per embedding model: base id → model id → pack id. */
const PACK_VARIANTS: Record<string, Record<string, string>> = {
  "wiki-vital5": {
    [DEFAULT_EMBEDDING_ID]: "wiki-vital5",
    [MULTILINGUAL_EMBEDDING_ID]: "wiki-vital5-e5",
  },
  "nido-esencial": {
    [DEFAULT_EMBEDDING_ID]: "nido-esencial",
    [MULTILINGUAL_EMBEDDING_ID]: "nido-esencial-e5",
  },
  "nido-local": {
    [DEFAULT_EMBEDDING_ID]: "nido-local",
    [MULTILINGUAL_EMBEDDING_ID]: "nido-local-e5",
  },
  // The seven guide packs of the 2026-10-30 programme: without an entry
  // here the resolver maps each pack to itself for every model, so with
  // multilingual search on, the app would query their bge vectors with
  // e5 vectors and their -e5 twin would never be the chosen download.
  "nido-ninos": {
    [DEFAULT_EMBEDDING_ID]: "nido-ninos",
    [MULTILINGUAL_EMBEDDING_ID]: "nido-ninos-e5",
  },
  "nido-crisis": {
    [DEFAULT_EMBEDDING_ID]: "nido-crisis",
    [MULTILINGUAL_EMBEDDING_ID]: "nido-crisis-e5",
  },
  "nido-desastres": {
    [DEFAULT_EMBEDDING_ID]: "nido-desastres",
    [MULTILINGUAL_EMBEDDING_ID]: "nido-desastres-e5",
  },
  "nido-sin-servicios": {
    [DEFAULT_EMBEDDING_ID]: "nido-sin-servicios",
    [MULTILINGUAL_EMBEDDING_ID]: "nido-sin-servicios-e5",
  },
  "nido-campo": {
    [DEFAULT_EMBEDDING_ID]: "nido-campo",
    [MULTILINGUAL_EMBEDDING_ID]: "nido-campo-e5",
  },
  "nido-viaje": {
    [DEFAULT_EMBEDDING_ID]: "nido-viaje",
    [MULTILINGUAL_EMBEDDING_ID]: "nido-viaje-e5",
  },
  "nido-hogar": {
    [DEFAULT_EMBEDDING_ID]: "nido-hogar",
    [MULTILINGUAL_EMBEDDING_ID]: "nido-hogar-e5",
  },
};

export function embeddingModelById(id: string): CatalogModel | undefined {
  return MODEL_CATALOG.find((m) => m.kind === "embedding" && m.id === id);
}

export function defaultEmbeddingModel(): CatalogModel {
  return MODEL_CATALOG.find((m) => m.kind === "embedding" && m.required)!;
}

/** New installs: multilingual search when the app language is Spanish or Portuguese. */
export function defaultEmbeddingIdForLanguage(language: string | null | undefined): string {
  const lang = (language ?? "").toLowerCase().slice(0, 2);
  return (lang === "es" || lang === "pt") && embeddingModelById(MULTILINGUAL_EMBEDDING_ID)
    ? MULTILINGUAL_EMBEDDING_ID
    : DEFAULT_EMBEDDING_ID;
}

export function isMultilingualEmbedding(model: CatalogModel | null | undefined): boolean {
  return model?.id === MULTILINGUAL_EMBEDDING_ID;
}

/**
 * The catalog pack to use for `packId` with this embedding model (e.g.
 * "wiki-vital5" → "wiki-vital5-e5" for multilingual search). Packs with a
 * single variant map to themselves.
 */
export function packIdForEmbedding(packId: string, embeddingId: string): string {
  for (const variants of Object.values(PACK_VARIANTS)) {
    if (Object.values(variants).includes(packId)) return variants[embeddingId] ?? packId;
  }
  return packId;
}

/** Embedding model a pack's vectors were made with, or null when the pack has one variant only. */
export function embeddingIdForPack(packId: string): string | null {
  for (const variants of Object.values(PACK_VARIANTS)) {
    for (const [embeddingId, id] of Object.entries(variants)) if (id === packId) return embeddingId;
  }
  return null;
}
