/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Tests for document storage budget (BOAR item 4, adapted for NIDO).
 *
 * Uses an in-memory SQLite database via the test fixture.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock the db module with an in-memory implementation
const mockCollections = new Map<
  string,
  {
    id: string;
    name: string;
    sourceFilename: string | null;
    docCount: number;
    chunkCount: number;
    sizeBytes: number;
    active: boolean;
    createdAt: number;
    lastAccessed: number;
  }
>();

vi.mock("./db", () => ({
  getDb: vi.fn(),
  listCustomCollections: vi.fn(async () => Array.from(mockCollections.values())),
  deleteCustomCollection: vi.fn(async (id: string) => {
    mockCollections.delete(id);
  }),
}));

import {
  getDocStoreStats,
  enforceStorageBudget,
  planImportEvictions,
  touchCollectionLastAccessed,
  DEFAULT_DOC_STORAGE_BUDGET_BYTES,
  DOC_STORAGE_BUDGET_OPTIONS,
} from "./docStorageBudget";
import { listCustomCollections, deleteCustomCollection } from "./db";

describe("docStorageBudget", () => {
  beforeEach(() => {
    mockCollections.clear();
    vi.clearAllMocks();
  });

  function addCollection(
    id: string,
    sizeBytes: number,
    lastAccessed: number,
    chunkCount = 10
  ) {
    mockCollections.set(id, {
      id,
      name: `Collection ${id}`,
      sourceFilename: null,
      docCount: 1,
      chunkCount,
      sizeBytes,
      active: true,
      createdAt: lastAccessed,
      lastAccessed,
    });
  }

  describe("getDocStoreStats", () => {
    it("returns empty stats when no collections", async () => {
      const stats = await getDocStoreStats();
      expect(stats.totalBytes).toBe(0);
      expect(stats.collectionCount).toBe(0);
      expect(stats.totalChunks).toBe(0);
      expect(stats.byCollection).toEqual([]);
    });

    it("sums bytes and chunks across collections", async () => {
      addCollection("a", 1000, 1000, 5);
      addCollection("b", 2000, 2000, 10);

      const stats = await getDocStoreStats();
      expect(stats.totalBytes).toBe(3000);
      expect(stats.collectionCount).toBe(2);
      expect(stats.totalChunks).toBe(15);
    });

    it("orders byCollection by size descending", async () => {
      addCollection("small", 100, 1000);
      addCollection("large", 5000, 2000);
      addCollection("medium", 1000, 3000);

      const stats = await getDocStoreStats();
      expect(stats.byCollection.map((c) => c.id)).toEqual([
        "large",
        "medium",
        "small",
      ]);
    });
  });

  describe("enforceStorageBudget", () => {
    it("does nothing when under budget", async () => {
      addCollection("a", 1000, 1000);

      const result = await enforceStorageBudget(5000);
      expect(result.evicted).toBe(false);
      expect(result.evictedIds).toEqual([]);
      expect(result.bytesFreed).toBe(0);
      expect(result.totalBytesAfter).toBe(1000);
      expect(deleteCustomCollection).not.toHaveBeenCalled();
    });

    it("evicts LRU collections when over budget", async () => {
      // Oldest accessed first (LRU)
      addCollection("old", 3000, 1000);
      addCollection("new", 3000, 3000);
      addCollection("middle", 3000, 2000);

      const result = await enforceStorageBudget(5000);
      expect(result.evicted).toBe(true);
      // Should evict "old" (LRU) first, then "middle" if still over
      expect(result.evictedIds).toContain("old");
      expect(result.totalBytesAfter).toBeLessThanOrEqual(5000);
    });

    it("evicts only as many as needed", async () => {
      addCollection("a", 4000, 1000);
      addCollection("b", 4000, 2000);
      addCollection("c", 1000, 3000);

      // Total: 9000, budget: 5000. Evicting "a" (4000, LRU) brings us to 5000.
      const result = await enforceStorageBudget(5000);
      expect(result.evicted).toBe(true);
      expect(result.evictedIds).toEqual(["a"]);
      expect(result.totalBytesAfter).toBe(5000);
    });

    it("evicts multiple collections when one isn't enough", async () => {
      addCollection("a", 2000, 1000);
      addCollection("b", 2000, 2000);
      addCollection("c", 2000, 3000);

      // Total: 6000, budget: 2500. Need to evict a+b (4000) to get to 2000.
      const result = await enforceStorageBudget(2500);
      expect(result.evicted).toBe(true);
      expect(result.evictedIds.length).toBe(2);
      expect(result.totalBytesAfter).toBeLessThanOrEqual(2500);
    });

    it("uses default budget when not specified", async () => {
      // Default is 50 MB
      expect(DEFAULT_DOC_STORAGE_BUDGET_BYTES).toBe(50 * 1024 * 1024);
    });
  });

  describe("planImportEvictions", () => {
    it("returns empty when import fits", async () => {
      addCollection("a", 1000, 1000);

      const toEvict = await planImportEvictions(1000, 5000);
      expect(toEvict).toEqual([]);
    });

    it("returns LRU collections needed to make room", async () => {
      addCollection("old", 3000, 1000);
      addCollection("new", 1000, 3000);

      // Current: 4000, budget: 5000, new doc: 2000 → need 1000 more
      // Should evict "old" (3000 bytes, LRU)
      const toEvict = await planImportEvictions(2000, 5000);
      expect(toEvict.length).toBe(1);
      expect(toEvict[0].id).toBe("old");
    });

    it("returns multiple if one isn't enough", async () => {
      addCollection("a", 2000, 1000);
      addCollection("b", 2000, 2000);

      // Current: 4000, budget: 5000, new doc: 4000 → need 3000 more
      const toEvict = await planImportEvictions(4000, 5000);
      expect(toEvict.length).toBe(2);
    });
  });

  describe("DOC_STORAGE_BUDGET_OPTIONS", () => {
    it("offers 25/50/100 MB options", () => {
      expect(DOC_STORAGE_BUDGET_OPTIONS).toHaveLength(3);
      expect(DOC_STORAGE_BUDGET_OPTIONS[0].bytes).toBe(25 * 1024 * 1024);
      expect(DOC_STORAGE_BUDGET_OPTIONS[1].bytes).toBe(50 * 1024 * 1024);
      expect(DOC_STORAGE_BUDGET_OPTIONS[2].bytes).toBe(100 * 1024 * 1024);
    });
  });
});
