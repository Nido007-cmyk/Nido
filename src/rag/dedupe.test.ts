/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Tests for cross-library retrieval dedupe (BOAR item 20, adapted for NIDO).
 */

import { describe, it, expect } from "vitest";
import { dedupeArticleCopies, COPY_MIN_SHARE } from "./dedupe";
import type { RetrievedChunk } from "./retrieve.types";

function chunk(
  id: string,
  title: string,
  body: string,
  score = 1.0
): RetrievedChunk {
  return {
    chunkId: id,
    docId: `doc-${id}`,
    title,
    body,
    score,
    matchType: "semantic",
  };
}

describe("dedupeArticleCopies", () => {
  it("keeps unique passages", () => {
    const chunks = [
      chunk("a", "Article One", "This is the first article about cats."),
      chunk("b", "Article Two", "This is the second article about dogs."),
    ];

    const result = dedupeArticleCopies(chunks);
    expect(result).toHaveLength(2);
  });

  it("drops exact copies (same title, same body)", () => {
    const chunks = [
      chunk("a", "My Article", "The quick brown fox jumps over the lazy dog."),
      chunk("b", "My Article", "The quick brown fox jumps over the lazy dog."),
    ];

    const result = dedupeArticleCopies(chunks);
    expect(result).toHaveLength(1);
    expect(result[0].chunkId).toBe("a"); // First wins
  });

  it("drops near-copies (>=60% word pairs shared)", () => {
    const original =
      "The quick brown fox jumps over the lazy dog. This is a test sentence for deduplication.";
    // Slightly modified but shares most word pairs
    const copy =
      "The quick brown fox jumps over the lazy dog. This is a test sentence for deduplication purposes.";

    const chunks = [chunk("a", "Test", original), chunk("b", "Test", copy)];

    const result = dedupeArticleCopies(chunks);
    expect(result).toHaveLength(1);
  });

  it("keeps different sections of same article", () => {
    // Same title but different content (different sections)
    const section1 =
      "Introduction to machine learning. This section covers the basics of supervised learning algorithms.";
    const section2 =
      "Advanced topics in machine learning. This section explores deep neural networks and transformers.";

    const chunks = [chunk("a", "ML Guide", section1), chunk("b", "ML Guide", section2)];

    const result = dedupeArticleCopies(chunks);
    // Different sections share vocabulary but few consecutive pairs
    expect(result).toHaveLength(2);
  });

  it("is case-insensitive for titles", () => {
    const chunks = [
      chunk("a", "My Article", "The quick brown fox jumps over the lazy dog."),
      chunk("b", "MY ARTICLE", "The quick brown fox jumps over the lazy dog."),
    ];

    const result = dedupeArticleCopies(chunks);
    expect(result).toHaveLength(1);
  });

  it("handles whitespace differences in titles", () => {
    const chunks = [
      chunk("a", "My  Article", "The quick brown fox jumps over the lazy dog."),
      chunk("b", "My Article", "The quick brown fox jumps over the lazy dog."),
    ];

    const result = dedupeArticleCopies(chunks);
    expect(result).toHaveLength(1);
  });

  it("preserves order (first/best-ranked wins)", () => {
    const chunks = [
      chunk("a", "Title", "Content here for testing.", 0.9),
      chunk("b", "Title", "Content here for testing.", 0.8),
      chunk("c", "Other", "Different content entirely.", 0.7),
    ];

    const result = dedupeArticleCopies(chunks);
    expect(result).toHaveLength(2);
    expect(result[0].chunkId).toBe("a");
    expect(result[1].chunkId).toBe("c");
  });

  it("handles empty input", () => {
    expect(dedupeArticleCopies([])).toEqual([]);
  });

  it("handles single chunk", () => {
    const chunks = [chunk("a", "Title", "Body")];
    expect(dedupeArticleCopies(chunks)).toHaveLength(1);
  });

  it("COPY_MIN_SHARE is 0.6", () => {
    expect(COPY_MIN_SHARE).toBe(0.6);
  });
});
