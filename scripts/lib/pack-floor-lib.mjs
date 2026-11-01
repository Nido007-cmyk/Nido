/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

// The Local floor: a candidate NIDO Local must never carry FEWER regions
// or verified facts than the newest published set.
//
// Why this exists (2026-10-31, the 0.1.68 near-miss): the packs live in
// two trees — the app tree and the packs line — and only the packs line
// had the grown facts table (69 regions / 155 facts, published in
// knowledge-packs-v8). The v9 draft was built from the app tree, whose
// facts.json was still the old copy (32 / 71). Every measurement the
// integration and the verifier ran was internally consistent (the pins
// matched the draft byte for byte, retrieval measured the GUIDES), so
// the regression was invisible until the publication executor compared
// the draft's tables against v8 by hand and stopped the release.
// Shipping it would have taken 37 countries and 84 checked numbers away
// from every user who updated.
//
// The floor lives in knowledge-packs/release-ledger.json
// (localPublishedFloor), tied to the published set's own lines in
// `files`, and is enforced in two places that share this lib:
//   - scripts/lib/pack-floor-lib.test.mjs builds the candidate from the
//     source with the builder's own validateFacts (which is exactly
//     what build-knowledge-pack.mjs writes, 1:1, into the regions and
//     facts tables) and fails the unit battery on a shrink.
//   - scripts/check-pack-floor.mjs reads the tables of the BUILT sqlite
//     files and is run by .github/workflows/knowledge-pack.yml after
//     building nido-local, before anything is uploaded.

import { validateFacts } from "./knowledge-pack-lib.mjs";

const RELEASE_BASE = "https://github.com/Nido007-cmyk/Nido/releases/download/";
const LOCAL_FILES = ["nido-local.sqlite", "nido-local-e5.sqlite"];

/**
 * The floor recorded in the ledger, proven to belong to a published set:
 * the tag must be a knowledge-packs-vN tag and BOTH of its Local files
 * must have lines in `files` (a floor that names an unpublished or
 * half-published set is a bookkeeping error, not a floor).
 * Returns { tag, regions, facts }. Throws on anything malformed.
 */
export function localFloorFromLedger(ledger, file = "release-ledger.json") {
  const floor = ledger?.localPublishedFloor;
  if (!floor || typeof floor !== "object") {
    throw new Error(`${file}: missing localPublishedFloor — the published Local floor is not recorded`);
  }
  const { tag, regions, facts } = floor;
  if (typeof tag !== "string" || !/^knowledge-packs-v\d+$/.test(tag)) {
    throw new Error(`${file}: localPublishedFloor.tag must be a knowledge-packs-vN tag, got ${JSON.stringify(tag)}`);
  }
  for (const [k, v] of [["regions", regions], ["facts", facts]]) {
    if (!Number.isInteger(v) || v <= 0) throw new Error(`${file}: localPublishedFloor.${k} must be a positive integer, got ${JSON.stringify(v)}`);
  }
  for (const name of LOCAL_FILES) {
    if (!ledger?.files?.[`${RELEASE_BASE}${tag}/${name}`]) {
      throw new Error(`${file}: localPublishedFloor names ${tag} but files has no line for ${name} under it — the floor must belong to a published set`);
    }
  }
  return { tag, regions, facts };
}

/**
 * The candidate's counts, from its facts document, validated with the
 * builder's own rules: what validateFacts returns is what the builder
 * writes into the pack's regions and facts tables.
 * Returns { regions, facts }.
 */
export function candidateCountsFromFacts(doc, file = "facts.json") {
  const { regions, facts } = validateFacts(doc, file);
  return { regions: Object.keys(regions).length, facts: facts.length };
}

/**
 * One human-readable violation per measure that fell below the floor;
 * an empty list means the candidate is at or above the published floor.
 */
export function floorViolations(counts, floor) {
  const violations = [];
  if (counts.regions < floor.regions) {
    violations.push(`regions ${counts.regions} < ${floor.regions} (published floor: ${floor.tag})`);
  }
  if (counts.facts < floor.facts) {
    violations.push(`facts ${counts.facts} < ${floor.facts} (published floor: ${floor.tag})`);
  }
  return violations;
}
