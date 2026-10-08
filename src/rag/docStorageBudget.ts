/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Document storage budget - caps the on-device storage used by imported
 * documents (extracted text + chunks), evicting least-recently-used
 * collections when over budget.
 *
 * Adapted from BOAR's docStore storage budget (MIT). NIDO's version works
 * with the custom_collections table and respects the encrypted DB.
 */

import {
  getDb,
  listCustomCollections,
  deleteCustomCollection,
  CustomCollection,
} from "./db";

/** Default budget: 50 MB for extracted document text. */
export const DEFAULT_DOC_STORAGE_BUDGET_BYTES = 50 * 1024 * 1024;

/** User-selectable budget options (bytes). */
export const DOC_STORAGE_BUDGET_OPTIONS = [
  { label: "25 MB", bytes: 25 * 1024 * 1024 },
  { label: "50 MB", bytes: 50 * 1024 * 1024 },
  { label: "100 MB", bytes: 100 * 1024 * 1024 },
] as const;

export interface DocStoreStats {
  /** Total bytes used by all custom collections. */
  totalBytes: number;
  /** Number of collections. */
  collectionCount: number;
  /** Total chunks across all collections. */
  totalChunks: number;
  /** Per-collection breakdown, ordered by size descending. */
  byCollection: Array<{
    id: string;
    name: string;
    bytes: number;
    chunks: number;
    lastAccessed: number;
  }>;
}

/**
 * Get current document storage statistics.
 * Pure read - no side effects, no network.
 */
export async function getDocStoreStats(): Promise<DocStoreStats> {
  const collections = await listCustomCollections();

  const byCollection = collections
    .map((c) => ({
      id: c.id,
      name: c.name,
      bytes: c.sizeBytes,
      chunks: c.chunkCount,
      lastAccessed: c.lastAccessed,
    }))
    .sort((a, b) => b.bytes - a.bytes);

  return {
    totalBytes: byCollection.reduce((sum, c) => sum + c.bytes, 0),
    collectionCount: collections.length,
    totalChunks: byCollection.reduce((sum, c) => sum + c.chunks, 0),
    byCollection,
  };
}

/**
 * Update a collection's last-accessed timestamp.
 * Call this when a collection's documents are retrieved or used.
 */
export async function touchCollectionLastAccessed(
  collectionId: string
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE custom_collections SET last_accessed = ? WHERE id = ?`,
    [Date.now(), collectionId]
  );
}

export interface EnforceBudgetResult {
  /** Whether any collections were evicted. */
  evicted: boolean;
  /** IDs of evicted collections (least-recently-used first). */
  evictedIds: string[];
  /** Bytes freed by eviction. */
  bytesFreed: number;
  /** Total bytes after enforcement. */
  totalBytesAfter: number;
}

/**
 * Enforce the storage budget by evicting least-recently-used collections
 * until total usage is within budget.
 *
 * Returns details of what was evicted. If nothing was over budget,
 * returns { evicted: false, ... } with no side effects.
 */
export async function enforceStorageBudget(
  budgetBytes: number = DEFAULT_DOC_STORAGE_BUDGET_BYTES
): Promise<EnforceBudgetResult> {
  const stats = await getDocStoreStats();

  if (stats.totalBytes <= budgetBytes) {
    return {
      evicted: false,
      evictedIds: [],
      bytesFreed: 0,
      totalBytesAfter: stats.totalBytes,
    };
  }

  // Sort by lastAccessed ascending (LRU first), then evict until under budget.
  const sorted = [...stats.byCollection].sort(
    (a, b) => a.lastAccessed - b.lastAccessed
  );

  const evictedIds: string[] = [];
  let bytesFreed = 0;
  let remainingBytes = stats.totalBytes;

  for (const coll of sorted) {
    if (remainingBytes <= budgetBytes) break;

    await deleteCustomCollection(coll.id);
    evictedIds.push(coll.id);
    bytesFreed += coll.bytes;
    remainingBytes -= coll.bytes;
  }

  return {
    evicted: evictedIds.length > 0,
    evictedIds,
    bytesFreed,
    totalBytesAfter: remainingBytes,
  };
}

/**
 * Check if importing a document of the given size would exceed the budget.
 * Returns the collections that would need to be evicted (LRU order) to
 * make room, or empty array if it fits.
 */
export async function planImportEvictions(
  newDocBytes: number,
  budgetBytes: number = DEFAULT_DOC_STORAGE_BUDGET_BYTES
): Promise<CustomCollection[]> {
  const collections = await listCustomCollections();
  const totalBytes = collections.reduce((sum, c) => sum + c.sizeBytes, 0);

  if (totalBytes + newDocBytes <= budgetBytes) {
    return [];
  }

  // LRU first
  const sorted = [...collections].sort((a, b) => a.lastAccessed - b.lastAccessed);
  const toEvict: CustomCollection[] = [];
  let freed = 0;
  const needed = totalBytes + newDocBytes - budgetBytes;

  for (const coll of sorted) {
    if (freed >= needed) break;
    toEvict.push(coll);
    freed += coll.sizeBytes;
  }

  return toEvict;
}
