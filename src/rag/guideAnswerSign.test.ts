/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * 0.1.89 — la capa del signo perceptible en la elección por
 * palabras (dirimen del empate de la 0.1.88:
 * research_notes/nido-gas-0.1.88-dirimen-2026-11-09.md). Con el
 * BM25 real del pack del dueño, el fragmento del monóxido (127)
 * empata en cobertura con el de la fuga (131) y le gana en
 * rango: la elección de la 0.1.88 servía la guía equivocada a
 * quien huele gas. La señal que los distingue está en los
 * textos: la pregunta afirma un sentido («huele») y la propia
 * guía del monóxido declara que su gas no se huele («sin olor»,
 * «no se puede ver ni oler»). Estas pruebas fijan la capa con
 * los fragmentos reales y su control causal: contra una vecina
 * que NO niega el sentido (la de cortar los servicios, 142,
 * también 3/3 y con más rango), el rango sigue mandando.
 */
import { describe, it, expect } from "vitest";
import type { RetrievedChunk } from "./retrieve.types";
import { MULTILINGUAL_E5_SMALL_PROFILE } from "./embeddingProfile";
import { SALVORA_GAS_CLUSTER_REAL } from "./__fixtures__/salvoraGasClusterReal";
import { pickGuideChunk, questionPerceptionSenses, textDeniesSense, type LiteralRouteContext } from "./guideAnswer";
import { normalizeCorpusScores } from "./pure";
import { SALVORA_GAS_CLUSTER_REAL_EN } from "./__fixtures__/salvoraGasClusterRealEn";

const SALVORA = "local-salvora-emergencias-casa";
const ROUTE: LiteralRouteContext = {
  importedVerifiedPackIds: new Set([SALVORA]),
  importedPackNames: new Map([[SALVORA, "SALVORA Home Emergencies"]]),
};
const QUESTION = "Que hago si huele a gas en mi casa?";

function realChunk(id: number, score: number): RetrievedChunk {
  const c = SALVORA_GAS_CLUSTER_REAL.find((x) => x.id === id)!;
  return {
    chunkId: `pack:${SALVORA}:${c.id}`,
    docId: `pack:${SALVORA}:${c.title}`,
    title: c.title,
    body: c.body,
    keys: c.keys,
    sourceKind: "pack",
    score,
    matchType: "lexical",
  } as RetrievedChunk;
}

function pick(chunks: RetrievedChunk[], query: string) {
  return pickGuideChunk(chunks, "es", ROUTE, { profile: MULTILINGUAL_E5_SMALL_PROFILE, query });
}

describe("0.1.89 — el signo perceptible en la elección por palabras", () => {
  it("los sentidos de la pregunta se leen en los tres idiomas", () => {
    expect([...questionPerceptionSenses(QUESTION)]).toContain("smell");
    expect([...questionPerceptionSenses("What do I do if I smell gas at home?")]).toContain("smell");
    expect([...questionPerceptionSenses("O que faço se sinto cheiro de gás em casa?")]).toContain("smell");
    expect(questionPerceptionSenses("¿Qué es el monóxido de carbono?").size).toBe(0);
    expect(questionPerceptionSenses("¿Cómo hago la RCP a un adulto?").size).toBe(0);
  });

  it("la negación del sentido se lee en el texto de la guía, en los tres idiomas", () => {
    const co127 = realChunk(127, 0.79);
    expect(textDeniesSense(`${co127.title} ${co127.body} ${co127.keys ?? ""}`, "smell")).toBe(true);
    expect(textDeniesSense("Carbon monoxide is odorless and cannot be smelled.", "smell")).toBe(true);
    expect(textDeniesSense("O monóxido de carbono não tem cheiro: é um gás sem cheiro nem cor.", "smell")).toBe(true);
    const leak131 = realChunk(131, 0.72);
    expect(textDeniesSense(`${leak131.title} ${leak131.body} ${leak131.keys ?? ""}`, "smell")).toBe(false);
  });

  it("a igual cobertura y con el monóxido por delante en rango, gana la guía del signo", () => {
    // Los scores son los rangos reales medidos (normalización
    // del pack, limit 8): el 127 va POR DELANTE del 131.
    const picked = pick([realChunk(127, 0.7934), realChunk(131, 0.7176)], QUESTION);
    expect(picked?.chunkId).toBe(`pack:${SALVORA}:131`);
  });

  it("control causal: contra una vecina que no niega el sentido, el rango sigue mandando", () => {
    // La guía de cortar los servicios (142) también cubre 3/3 y
    // no declara nada imperceptible: con más rango que la fuga,
    // gana ella, como hasta la 0.1.88. La capa solo actúa
    // contra la guía que niega el sentido de la pregunta.
    const cortar142 = realChunk(142, 0.9);
    const picked = pick([cortar142, realChunk(131, 0.7176)], QUESTION);
    expect(picked?.chunkId).toBe(`pack:${SALVORA}:142`);
  });

  it("sin signo en la pregunta, la guía del monóxido se elige por su tema como siempre", () => {
    const picked = pick([realChunk(127, 0.7934), realChunk(131, 0.7176)], "¿Qué es el monóxido de carbono y por qué es peligroso en casa?");
    expect(picked?.chunkId).toBe(`pack:${SALVORA}:127`);
  });

  it("en inglés el campo real no se invierte y la capa no lo rompe: gana la fuga por rango y por signo", () => {
    // El clúster inglés real (fixture En): la fuga (45) ya va
    // primera en el BM25 y el monóxido (41) segundo, ambos a
    // 2/3. Con los scores normalizados reales de ese campo,
    // la elección da la fuga antes y después de la capa.
    const rawEn = SALVORA_GAS_CLUSTER_REAL_EN.slice(0, 8).map(
      (c) =>
        ({
          chunkId: `pack:${SALVORA}:${c.id}`,
          docId: `pack:${SALVORA}:${c.title}`,
          title: c.title,
          body: c.body,
          keys: c.keys,
          sourceKind: "pack",
          score: -c.bm25Rank,
          matchType: "lexical",
        }) as RetrievedChunk,
    );
    const normalized = normalizeCorpusScores(rawEn);
    const pair = normalized.filter((c) => c.chunkId.endsWith(":41") || c.chunkId.endsWith(":45"));
    expect(pair).toHaveLength(2);
    const picked = pickGuideChunk(pair, "en", ROUTE, {
      profile: MULTILINGUAL_E5_SMALL_PROFILE,
      query: "What do I do if I smell gas in my house?",
    });
    expect(picked?.chunkId).toBe(`pack:${SALVORA}:45`);
  });
});
