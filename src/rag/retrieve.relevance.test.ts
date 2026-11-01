/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, it, expect } from "vitest";
import {
  buildLexicalQuery,
  contextualizeQuery,
  filterByMinScore,
  filterByTermCoverage,
  fuseRetrievalResults,
  MIN_SEMANTIC_SIMILARITY,
} from "./pure";
import type { RetrievedChunk } from "./retrieve.types";

/**
 * Retrieval relevance tests. These exercise the FUSION/THRESHOLD MECHANICS
 * extracted into pure.ts — deterministic, native-module-free logic — using
 * synthetic scores, not real bge-small-en-v1.5 embeddings or FTS5 bm25
 * output. There's no on-device runtime available in this sandbox to
 * measure this corpus's actual score distribution for real queries like
 * "what is a black hole?" or "asdfghjkl qwerty", so these tests validate
 * that the CODE correctly implements the relevance policy it claims to
 * (raw-score floor before normalization; empty in -> empty out; a single
 * strong source isn't discarded) rather than asserting anything about real
 * embedding behavior. Hands-on verification of the specific example
 * queries in the request against the real model/corpus is a follow-up,
 * not something this sandbox can do.
 */

function chunk(id: string, score: number, matchType: RetrievedChunk["matchType"] = "lexical"): RetrievedChunk {
  return { chunkId: id, docId: id, title: `Doc ${id}`, body: `Body ${id}`, score, matchType };
}

describe("filterByMinScore", () => {
  it("excludes scores below the floor and keeps scores at or above it", () => {
    const chunks = [chunk("a", 0.9), chunk("b", 0.59), chunk("c", 0.60), chunk("d", 0.1)];
    const kept = filterByMinScore(chunks, MIN_SEMANTIC_SIMILARITY);
    expect(kept.map((c) => c.chunkId)).toEqual(["a", "c"]);
  });

  it("returns empty when every score is below the floor — the 'gibberish query' case", () => {
    // Simulates "asdfghjkl qwerty": semanticSearch's real cosine scores
    // against genuine gibberish should all land well below 0.60 (a
    // meaningful embedding needs some actual semantic content to match
    // against) — this test proves the floor mechanics themselves correctly
    // produce zero results when that's what upstream scoring reports,
    // regardless of what the real numbers turn out to be.
    // BUG-2-2026-10-06: device evidence showed irrelevant content scoring
    // 0.49-0.55, so the floor was raised from 0.45 to 0.60.
    const chunks = [chunk("a", 0.2), chunk("b", 0.1), chunk("c", 0.05)];
    expect(filterByMinScore(chunks, MIN_SEMANTIC_SIMILARITY)).toEqual([]);
  });

  it("does not discard a single weak-but-real match above the floor", () => {
    // "a legitimate query with weak/partial wording" — a chunk barely
    // above the floor must still survive, not be treated as noise just
    // because it's not a strong match.
    const chunks = [chunk("a", 0.61)];
    expect(filterByMinScore(chunks, MIN_SEMANTIC_SIMILARITY)).toEqual([chunk("a", 0.61)]);
  });
});

describe("fuseRetrievalResults", () => {
  it("returns empty when both sources have nothing — never forces a top-K of near-random matches", () => {
    // Direct regression for the "no arbitrary corpus padding" requirement:
    // if lexicalSearch's exact-phrase gate and semanticSearch's
    // MIN_SEMANTIC_SIMILARITY floor both correctly report nothing, fusion
    // must not synthesize a result out of nothing to fill topK.
    expect(fuseRetrievalResults([], [], 6)).toEqual([]);
  });

  it("surfaces a single-source match rather than discarding it for lacking corroboration", () => {
    // "a legitimate query with weak/partial wording" — e.g. an exact
    // lexical phrase hit with no semantic corroboration (or vice versa)
    // must not be silently dropped just because only one source found it.
    const lexicalOnly = [chunk("a", 3.2, "lexical")];
    const result = fuseRetrievalResults(lexicalOnly, [], 6);
    expect(result).toHaveLength(1);
    expect(result[0].chunkId).toBe("a");
    expect(result[0].matchType).toBe("lexical");
  });

  it("promotes a chunk found by both sources to hybrid and ranks it above single-source matches", () => {
    const agreed = chunk("a", 3.0, "lexical");
    const agreedSemantic = { ...chunk("a", 0.8, "semantic") };
    const onlyLexical = chunk("b", 2.0, "lexical");
    const result = fuseRetrievalResults([agreed, onlyLexical], [agreedSemantic], 6);
    expect(result[0].chunkId).toBe("a");
    expect(result[0].matchType).toBe("hybrid");
    expect(result[0].score).toBeGreaterThan(result[1].score);
  });

  it("respects topK even when both sources contribute more results than that", () => {
    const lexical = Array.from({ length: 8 }, (_, i) => chunk(`l${i}`, 8 - i, "lexical"));
    const semantic = Array.from({ length: 8 }, (_, i) => chunk(`s${i}`, 0.9 - i * 0.01, "semantic"));
    expect(fuseRetrievalResults(lexical, semantic, 6)).toHaveLength(6);
  });

  it("weights lexical and semantic contributions as configured, not just 50/50 by default", () => {
    const lexicalOnly = [chunk("a", 3.2, "lexical")];
    const semanticOnly = [chunk("b", 0.9, "semantic")];
    const semanticFavored = fuseRetrievalResults(lexicalOnly, semanticOnly, 6, { lexical: 0.2, semantic: 0.8 });
    expect(semanticFavored.find((c) => c.chunkId === "b")!.score).toBeGreaterThan(
      semanticFavored.find((c) => c.chunkId === "a")!.score
    );
  });

  it("is deterministic: identical inputs always produce an identical ranking", () => {
    const lexical = [chunk("a", 2.5, "lexical"), chunk("b", 1.1, "lexical")];
    const semantic = [chunk("b", 0.7, "semantic"), chunk("c", 0.5, "semantic")];
    expect(fuseRetrievalResults(lexical, semantic, 6)).toEqual(fuseRetrievalResults(lexical, semantic, 6));
  });

  it("keeps at most two chunks per article, so a second topic isn't crowded out", () => {
    const c = (id: string, title: string, score: number) => ({ chunkId: id, docId: id, title, body: "", score, matchType: "lexical" as const });
    const lexical = [c("n1", "Napoleon", 9), c("n2", "Napoleon", 8), c("n3", "Napoleon", 7), c("f1", "French Revolution", 3)];
    expect(fuseRetrievalResults(lexical, [], 4).map((r) => r.chunkId)).toEqual(["n1", "n2", "f1"]);
  });
});

describe("fuseRetrievalResults rawScore honesty (2026-09-28)", () => {
  // Live-evidence regression: a lone semantic-only chunk used to display a
  // weight-scheme-constant "50%" because the UI rendered the fused relative
  // score. The UI now renders rawScore (the pre-fusion cosine), so a weak
  // match displays its weak absolute strength, never the constant.
  it("carries the raw cosine for a semantic-only chunk — not the fused 0.5", () => {
    const semanticOnly = [chunk("a", 0.66, "semantic")];
    const [result] = fuseRetrievalResults([], semanticOnly, 6);
    expect(result.rawScore).toBe(0.66);
    // The fused relative score (sorting only) still normalizes to the
    // weight constant — the contract is that the UI never renders it.
    expect(result.score).toBe(0.5);
  });

  it("hybrid chunks carry the absolute semantic cosine, not the fused rank", () => {
    const agreed = chunk("a", 3.0, "lexical");
    const agreedSemantic = { ...chunk("a", 0.8, "semantic") };
    const [result] = fuseRetrievalResults([agreed], [agreedSemantic], 6);
    expect(result.matchType).toBe("hybrid");
    expect(result.rawScore).toBe(0.8);
  });

  it("lexical-only chunks carry no percentage — BM25 has no honest scale", () => {
    const [result] = fuseRetrievalResults([chunk("a", 9.7, "lexical")], [], 6);
    expect(result.rawScore).toBeUndefined();
  });

  it("rawScore is monotonic with real match strength across a set", () => {
    const semantic = [chunk("a", 0.92, "semantic"), chunk("b", 0.65, "semantic")];
    const results = fuseRetrievalResults([], semantic, 6);
    const byId = new Map(results.map((r) => [r.chunkId, r]));
    expect(byId.get("a")!.rawScore).toBeGreaterThan(byId.get("b")!.rawScore!);
    // The displayed values are absolute, not re-normalized to the top of the set.
    expect(byId.get("a")!.rawScore).toBe(0.92);
    expect(byId.get("b")!.rawScore).toBe(0.65);
  });
});

describe("pruneByScoreMargin", () => {
  it("descarta candidatos muy por debajo del top", async () => {
    const { pruneByScoreMargin } = await import("./pure");
    const chunks = [chunk("a", 0.85), chunk("b", 0.82), chunk("c", 0.55), chunk("d", 0.52)];
    const kept = pruneByScoreMargin(chunks, 0.4, 1);
    expect(kept.map((c) => c.chunkId)).toEqual(["a", "b"]);
  });

  it("conserva el cluster cuando todo está cerca", async () => {
    const { pruneByScoreMargin } = await import("./pure");
    const chunks = [chunk("a", 0.68), chunk("b", 0.66), chunk("c", 0.64), chunk("d", 0.62)];
    const kept = pruneByScoreMargin(chunks, 0.4, 1);
    // Rango = 0.06, cutoff = 0.68 - 0.4*0.06 = 0.656 → a, b sobreviven.
    // c (0.64) y d (0.62) caen fuera: el gap es real aunque los valores
    // absolutos estén todos sobre el piso.
    expect(kept.map((c) => c.chunkId)).toEqual(["a", "b"]);
  });

  it("respeta minKeep aunque todo caiga fuera del margen", async () => {
    const { pruneByScoreMargin } = await import("./pure");
    const chunks = [chunk("a", 0.9), chunk("b", 0.1)];
    const kept = pruneByScoreMargin(chunks, 0.4, 1);
    expect(kept.map((c) => c.chunkId)).toEqual(["a"]);
  });

  it("no toca listas pequeñas o uniformes", async () => {
    const { pruneByScoreMargin } = await import("./pure");
    expect(pruneByScoreMargin([], 0.4, 1)).toEqual([]);
    expect(pruneByScoreMargin([chunk("a", 0.7)], 0.4, 1)).toEqual([chunk("a", 0.7)]);
    // Todos iguales: sin señal de gap, conservar todo.
    const uniform = [chunk("a", 0.7), chunk("b", 0.7), chunk("c", 0.7)];
    expect(pruneByScoreMargin(uniform, 0.4, 1)).toHaveLength(3);
  });
});

describe("fuseRetrievalResults: reserva del corpus personal (R-03)", () => {
  const k = (
    id: string,
    score: number,
    sourceKind: RetrievedChunk["sourceKind"],
    matchType: RetrievedChunk["matchType"] = "lexical"
  ): RetrievedChunk => ({ chunkId: id, docId: id, title: `Doc ${id}`, body: `Body ${id}`, score, matchType, sourceKind });

  it("el mejor chunk del usuario desplaza al no-usuario más débil dentro del factor ×1,25", () => {
    // Puntuaciones BM25 sintéticas; tras normalizar: p1 .5, p2 .475,
    // p3 .45, u1 .4. Sin reserva, u1 (0,8× el mejor) queda fuera del top 3.
    const lexical = [k("p1", 10, "pack"), k("p2", 9.5, "pack"), k("p3", 9, "pack"), k("u1", 8, "user")];
    const result = fuseRetrievalResults(lexical, [], 3);
    expect(result.map((c) => c.chunkId)).toEqual(["p1", "p2", "u1"]);
    expect(result[2].sourceKind).toBe("user");
  });

  it("no empuja un chunk del usuario muy por debajo del que desplazaría", () => {
    // u1 normaliza a .15; el último del top 3 (.45) supera .15 × 1,25.
    const lexical = [k("p1", 10, "pack"), k("p2", 9.5, "pack"), k("p3", 9, "pack"), k("u1", 3, "user")];
    expect(fuseRetrievalResults(lexical, [], 3).map((c) => c.chunkId)).toEqual(["p1", "p2", "p3"]);
  });

  it("si un chunk del usuario ya está en el topK, no desplaza a nadie", () => {
    const lexical = [k("u1", 10, "user"), k("p1", 9, "pack"), k("p2", 8, "pack")];
    const result = fuseRetrievalResults(lexical, [], 2);
    expect(result.map((c) => c.chunkId)).toEqual(["u1", "p1"]);
    expect(result[0].sourceKind).toBe("user");
  });

  it("rellena un hueco libre cuando el tope por artículo dejó la lista corta", () => {
    const same = (id: string, score: number): RetrievedChunk => ({
      chunkId: id, docId: id, title: "Guía repetida", body: `Body ${id}`, score, matchType: "lexical", sourceKind: "pack",
    });
    // Tres trozos del mismo artículo de pack: el tope de 2 por título
    // deja la lista en 2 de 4 huecos; la reserva mete el del usuario.
    const lexical = [same("t1", 10), same("t2", 9.5), same("t3", 9), k("u1", 5, "user")];
    expect(fuseRetrievalResults(lexical, [], 4).map((c) => c.chunkId)).toEqual(["t1", "t2", "u1"]);
  });

  it("la reserva no resucita un chunk que la puerta absoluta de rawScore rechaza", () => {
    // El chunk del usuario entra por la reserva (su .39 fusionado está
    // dentro del ×1,25 del .45 que desplaza), pero su coseno crudo
    // (0,55) está bajo el piso absoluto (0,60): la puerta post-fusión
    // manda y el chunk no se sirve. «Pasó sus puertas» incluye esta.
    const lexical = [k("p1", 10, "pack"), k("p2", 9, "pack")];
    const semantic = [k("s1", 0.7, "pack", "semantic"), k("u1", 0.55, "user", "semantic")];
    const result = fuseRetrievalResults(lexical, semantic, 3);
    expect(result.map((c) => c.chunkId)).toEqual(["p1", "s1"]);
    expect(result.some((c) => c.chunkId === "u1")).toBe(false);
  });
});

describe("la ronda R-03: «¿En qué sala?» contra la fixture del documento importado", () => {
  // La mecánica real de retrieve() sin base de datos: puerta de
  // cobertura (filterByTermCoverage) sobre candidatos BM25 sintéticos y
  // fusión. Las puntuaciones imitan lo que vio la tablet: los artículos
  // «de sala» puntúan más alto que el papel del usuario en BM25 crudo.
  interface Row {
    chunkId: string;
    title: string;
    body: string;
    bm25: number;
    sourceKind: RetrievedChunk["sourceKind"];
  }
  const ROWS: Row[] = [
    {
      chunkId: "doc-cita",
      title: "documento-prueba-ocr",
      body: "CLINICA SAN RAFAEL. Recordatorio de cita. Su cita es el martes 10 de noviembre de 2026 a las 9:30 de la mañana, en la sala 214, segundo piso. Traiga su tarjeta y la lista de medicamentos.",
      bm25: 5,
      sourceKind: "user",
    },
    {
      chunkId: "wiki-bosworth",
      title: "Sala Bosworth",
      body: "La Sala Bosworth es una sala de exposiciones dedicada a Bosworth, pintor de Ohio. La sala alberga su obra y la sala abre a diario.",
      bm25: 10,
      sourceKind: "pack",
    },
    {
      chunkId: "wiki-scala",
      title: "La Scala",
      body: "La Scala es un teatro de ópera de Milán, la sala más famosa del mundo; su sala principal acoge dos mil espectadores.",
      bm25: 9,
      sourceKind: "pack",
    },
    {
      chunkId: "doc-receta",
      title: "Mi receta de pan",
      body: "Harina, agua, sal y levadura. Amasar bien y hornear cuarenta minutos.",
      bm25: 7,
      sourceKind: "user",
    },
  ];

  function searchLexically(query: string): RetrievedChunk[] {
    const lq = buildLexicalQuery(query)!;
    const gated = filterByTermCoverage(ROWS, lq.terms)
      .map((r) => ({
        chunkId: r.chunkId,
        docId: r.chunkId,
        title: r.title,
        body: r.body,
        score: r.bm25,
        matchType: "lexical" as const,
        sourceKind: r.sourceKind,
      }))
      .sort((a, b) => b.score - a.score);
    return fuseRetrievalResults(gated, [], 4);
  }

  it("ANTES: la pregunta cruda corona a «Sala Bosworth» y el documento queda último", () => {
    const result = searchLexically("¿En qué sala?");
    expect(result[0].title).toBe("Sala Bosworth");
    expect(result[result.length - 1].chunkId).toBe("doc-cita");
  });

  it("DESPUÉS: la consulta contextualizada trae el documento, primero y sin los señuelos", () => {
    const history = {
      turns: [
        { role: "user" as const, text: "¿Qué día y a qué horas es la cita?" },
        { role: "assistant" as const, text: "Su cita es el martes 10 de noviembre de 2026 a las 9:30 de la mañana." },
      ],
    };
    const result = searchLexically(contextualizeQuery("¿En qué sala?", history));
    expect(result.map((c) => c.chunkId)).toEqual(["doc-cita"]);
    expect(result[0].body).toContain("sala 214");
    // La reserva no empuja documentos del usuario que no casan con la
    // pregunta: la receta ni siquiera supera la puerta de cobertura.
    expect(result.some((c) => c.chunkId === "doc-receta")).toBe(false);
  });

  it("el seguimiento con contexto explícito no cambia: ya era autosuficiente", () => {
    const history = {
      turns: [
        { role: "user" as const, text: "¿Qué día y a qué horas es la cita?" },
        { role: "assistant" as const, text: "Su cita es el martes 10 de noviembre de 2026 a las 9:30 de la mañana." },
      ],
    };
    // La pregunta de la ronda que sí acertó en la tablet: trae sus
    // propios términos (sala, cita, documento) y recupera igual con o
    // sin contextualizar.
    const q = "¿En qué sala es la cita del documento?";
    expect(contextualizeQuery(q, history)).toBe(q);
    expect(searchLexically(q).map((c) => c.chunkId)).toEqual(["doc-cita"]);
  });
});
