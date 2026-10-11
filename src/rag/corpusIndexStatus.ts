/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * corpusIndexStatus.ts — estado de indexado por paquete de conocimiento.
 * Módulo sin dependencias nativas: Ajustes (CatalogItemCard) lo lee sin
 * arrastrar la base de datos ni el motor de embeddings.
 */

/** Indexado por paquete descargable: { "corpus-full": { indexed, total } }. */
export type CorpusIndexStatus = Record<string, { indexed: number; total: number }>;

const statusState = globalThis as {
  __nidoCorpusStatus?: CorpusIndexStatus | null;
  __nidoCorpusStatusListeners?: Set<(s: CorpusIndexStatus) => void>;
};
const statusListeners = (statusState.__nidoCorpusStatusListeners ??= new Set());

/** Último estado conocido (null = aún no se ha comprobado en esta sesión). */
export function getCorpusIndexStatus(): CorpusIndexStatus | null {
  return statusState.__nidoCorpusStatus ?? null;
}

/** Ajustes se suscribe para mostrar "indexando x / y" o "en tu base". */
export function onCorpusIndexStatus(listener: (s: CorpusIndexStatus) => void): () => void {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

export function publishStatus(s: CorpusIndexStatus): void {
  statusState.__nidoCorpusStatus = s;
  statusListeners.forEach((l) => l(s));
}

