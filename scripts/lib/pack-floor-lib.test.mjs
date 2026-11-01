/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { candidateCountsFromFacts, floorViolations, localFloorFromLedger } from "./pack-floor-lib.mjs";

const ledgerFile = fileURLToPath(new URL("../../knowledge-packs/release-ledger.json", import.meta.url));
const ledger = JSON.parse(readFileSync(ledgerFile, "utf8"));
const factsFile = fileURLToPath(new URL("../../knowledge-packs/nido-local/facts.json", import.meta.url));

describe("el suelo publicado de NIDO Local (corrección 0.1.68)", () => {
  it("el suelo sale del registro y pertenece a un set publicado entero", () => {
    // v9 is the newest published Local set; its measured tables are the
    // floor every candidate is compared against.
    expect(localFloorFromLedger(ledger, ledgerFile)).toEqual({ tag: "knowledge-packs-v9", regions: 69, facts: 155 });
  });

  it("un suelo sin registro, sin conteos o de un set no publicado no vale", () => {
    expect(() => localFloorFromLedger({ files: ledger.files })).toThrow(/localPublishedFloor/);
    expect(() =>
      localFloorFromLedger({ ...ledger, localPublishedFloor: { tag: "knowledge-packs-v8", regions: 0, facts: 155 } }),
    ).toThrow(/regions/);
    // A tag with no lines in `files` is not a published set.
    expect(() =>
      localFloorFromLedger({ ...ledger, localPublishedFloor: { tag: "knowledge-packs-v99", regions: 69, facts: 155 } }),
    ).toThrow(/no line/);
  });

  it("el candidato construido desde la fuente no baja del suelo", () => {
    // The builder writes validateFacts' output 1:1 into the pack's
    // regions/facts tables, so the source candidate IS the built
    // candidate for these two measures. The built bytes themselves are
    // gated separately by scripts/check-pack-floor.mjs in the workflow.
    const counts = candidateCountsFromFacts(JSON.parse(readFileSync(factsFile, "utf8")), factsFile);
    expect(counts).toEqual({ regions: 69, facts: 155 });
    expect(floorViolations(counts, localFloorFromLedger(ledger, ledgerFile))).toEqual([]);
  });

  it("la tabla vieja de 32/71 — la del borrador parado — cae contra el suelo", () => {
    // The exact counts the stopped v9 draft carried in its meta.
    const floor = localFloorFromLedger(ledger, ledgerFile);
    expect(floorViolations({ regions: 32, facts: 71 }, floor)).toEqual([
      "regions 32 < 69 (published floor: knowledge-packs-v9)",
      "facts 71 < 155 (published floor: knowledge-packs-v9)",
    ]);
    // At the floor or above it, there is nothing to report.
    expect(floorViolations({ regions: 69, facts: 155 }, floor)).toEqual([]);
    expect(floorViolations({ regions: 70, facts: 160 }, floor)).toEqual([]);
  });
});
