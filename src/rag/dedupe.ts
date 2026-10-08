/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Cross-library retrieval dedupe - drops duplicate passages from retrieval results.
 *
 * Adapted from BOAR's dedupe.ts (MIT).
 *
 * When the same article exists in multiple libraries (e.g., a knowledge pack
 * and an imported document), retrieval can return near-identical passages.
 * This wastes context and slows time-to-first-token.
 *
 * A passage is dropped when an earlier (better-ranked) one has:
 * 1. The same title (case/space-insensitive), AND
 * 2. >= COPY_MIN_SHARE of its consecutive word-pairs contained in the earlier
 *    one (either direction)
 *
 * Word pairs, not vocabulary: a copied paragraph shares most pairs; a
 * different section of the same article shares vocabulary but few pairs.
 *
 * Pure function - no side effects, no network, testable without a device.
 */

import type { RetrievedChunk } from "./retrieve.types";

/**
 * Minimum share of consecutive word-pairs that must overlap for two
 * passages to be considered copies. 0.6 was tuned on Wikipedia-style text;
 * recalibrate on NIDO's corpus if needed.
 */
export const COPY_MIN_SHARE = 0.6;

/**
 * Normalize a title for comparison: lowercase, collapse whitespace.
 */
function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Extract consecutive word-pairs from text.
 * Example: "the quick brown" → ["the quick", "quick brown"]
 */
function wordPairs(text: string): Set<string> {
  const words = text.toLowerCase().split(/\s+/).filter((w) => w.length > 0);
  const pairs = new Set<string>();
  for (let i = 0; i < words.length - 1; i++) {
    pairs.add(`${words[i]} ${words[i + 1]}`);
  }
  return pairs;
}

/**
 * Calculate the share of pairs from `a` that are contained in `b`.
 */
function pairShare(a: Set<string>, b: Set<string>): number {
  if (a.size === 0) return 0;
  let shared = 0;
  for (const pair of a) {
    if (b.has(pair)) shared++;
  }
  return shared / a.size;
}

/**
 * Check if two passages are copies of each other.
 */
function areCopies(a: RetrievedChunk, b: RetrievedChunk): boolean {
  // Titles must match (case/space-insensitive)
  if (normalizeTitle(a.title) !== normalizeTitle(b.title)) {
    return false;
  }

  const pairsA = wordPairs(a.body);
  const pairsB = wordPairs(b.body);

  // Check either direction: a's pairs in b, or b's pairs in a
  const shareAB = pairShare(pairsA, pairsB);
  const shareBA = pairShare(pairsB, pairsA);

  return shareAB >= COPY_MIN_SHARE || shareBA >= COPY_MIN_SHARE;
}

/**
 * Deduplicate retrieval results, keeping the first (best-ranked) copy.
 *
 * @param chunks - Retrieved chunks in rank order (best first)
 * @returns Deduplicated chunks, order preserved
 */
export function dedupeArticleCopies(chunks: RetrievedChunk[]): RetrievedChunk[] {
  const kept: RetrievedChunk[] = [];

  for (const chunk of chunks) {
    let isDuplicate = false;
    for (const keptChunk of kept) {
      if (areCopies(chunk, keptChunk)) {
        isDuplicate = true;
        break;
      }
    }
    if (!isDuplicate) {
      kept.push(chunk);
    }
  }

  return kept;
}
