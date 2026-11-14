/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Auditoría de la 0.1.97 (main @ 983c0db3), la recuperación. Falla sobre
 * la 0.1.97 publicada.
 */
import { describe, expect, it } from "vitest";
import { buildLexicalQuery, countMatchedTerms, filterByTermCoverage, fuseRetrievalResults } from "./pure";
import type { RetrievedChunk } from "./retrieve.types";

// ------------------------------------------------------------ AUD97-3

describe("AUD97-3: la puerta de cobertura post-fusión respeta el documento propio", () => {
  const q = "¿Cuál es el número de póliza del seguro del coche?";
  const lq = buildLexicalQuery(q)!;
  const body = "Seguro Mapfre. Póliza 12345678, vencimiento 3 de marzo de 2027.";
  const cov = countMatchedTerms(`seguros.pdf ${body}`, lq.terms) / lq.terms.length;
  const mk = (sourceKind: "user" | "builtin"): RetrievedChunk =>
    ({ chunkId: `${sourceKind}:1`, docId: "d", title: "seguros.pdf", body, score: 3, matchType: "lexical", sourceKind, termCoverage: cov }) as RetrievedChunk;

  it("la nota propia que pasó la puerta de entrada llega al prompt", () => {
    expect(filterByTermCoverage([{ title: "seguros.pdf", body }], lq.terms, lq.lang)).toHaveLength(1);
    expect(cov).toBe(0.5);
    expect(fuseRetrievalResults([mk("user")], [], 5)).toHaveLength(1);
  });

  it("el corpus de la casa con media cobertura sigue fuera (CL-12 intacta)", () => {
    expect(fuseRetrievalResults([mk("builtin")], [], 5)).toHaveLength(0);
  });
});
