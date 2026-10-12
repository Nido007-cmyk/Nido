/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { requireNativeModule } from "expo-modules-core";

export interface VectorSearchResult {
  /** Pack chunk ids (chunks.id), best first. */
  ids: number[];
  /** Cosine similarity of each id, same order. */
  scores: number[];
  /** How many chunks scored >= floor (before the limit). */
  gatedCount: number;
  /** Lowest score that passed the floor, or null if none did. */
  gatedMin: number | null;
  /** Chunks in the index. */
  count: number;
}

export interface NidoVectorsNative {
  /** Copies a pack's vectors into a flat index file (absolute paths, no file://). Returns the chunk count. */
  buildIndex(sqlitePath: string, indexPath: string, dims: number): Promise<number>;
  search(indexPath: string, query: number[], floor: number, limit: number): Promise<VectorSearchResult>;
  /** Forgets a memory-mapped index (call before deleting its file). */
  release(indexPath: string): boolean;
}

const NidoVectors = requireNativeModule<NidoVectorsNative>("NidoVectors");
export default NidoVectors;
