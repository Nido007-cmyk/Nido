/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * T-21 (0.1.99, núcleo del juez): el contexto semántico de la caza
 * 0197, para que la batería ejerza las puertas semánticas en el
 * régimen en el que producción las sirve (perfil multilingüe activo).
 *
 * El fixture (`__fixtures__/caza0197-contexto.json`) guarda los
 * vectores e5 del GGUF servido (el mismo fichero que la app descarga,
 * verificado por sha256 en la tanda T-20) de cada texto de la caza
 * — preguntas, chunks enteros y cláusulas de fuentes y respuestas —
 * incrustados con llama.cpp y la receta del perfil (prefijos
 * «query: »/«passage: »), segmentados con las funciones del propio
 * juez (splitSentences tras stripInvalidCitations y
 * splitClausesWithSep): la alineación que usableSemanticContext
 * valida en cada llamada. Los vectores van cuantizados a int16 por
 * vector (escala = máximo/32767; el error de coseno resultante,
 * ~1e-5, queda muy por debajo de los márgenes más finos de las
 * puertas) y las similitudes pregunta→chunk van en float32 exacto.
 *
 * Sin entrada en el fixture (los casos sin fuentes, de contrato),
 * devuelve undefined y la batería juzga como sin contexto.
 */
import { readFileSync } from "node:fs";
import type { JudgeSemanticContext } from "./semanticContext";

interface FixtureCaso {
  sims: number[];
  chunks: number[][];
  respuestas: number[][];
}

interface Fixture {
  dim: number;
  escalas: number[];
  vectoresB64: string;
  casos: Record<string, FixtureCaso>;
}

let cache: { fixture: Fixture; vectores: Float32Array[] } | null = null;

function carga(): { fixture: Fixture; vectores: Float32Array[] } {
  if (cache) return cache;
  const ruta = new URL("./__fixtures__/caza0197-contexto.json", import.meta.url);
  const fixture = JSON.parse(readFileSync(ruta, "utf8")) as Fixture;
  const bytes = new Uint8Array(Buffer.from(fixture.vectoresB64, "base64"));
  const enteros = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
  const dim = fixture.dim;
  const vectores: Float32Array[] = fixture.escalas.map((escala, v) => {
    const out = new Float32Array(dim);
    for (let d = 0; d < dim; d++) out[d] = enteros[v * dim + d]! * escala;
    return out;
  });
  cache = { fixture, vectores };
  return cache;
}

/** El contexto semántico de un caso de la caza, o undefined si no tiene. */
export function contextoCaza0197(id: string): JudgeSemanticContext | undefined {
  const { fixture, vectores } = carga();
  const caso = fixture.casos[id];
  if (!caso) return undefined;
  return {
    chunkClauseVectors: caso.chunks.map((cls) => cls.map((v) => vectores[v]!)),
    answerClauseVectors: caso.respuestas.map((cls) => cls.map((v) => vectores[v]!)),
    questionChunkSims: Float32Array.from(caso.sims),
    profileId: "multilingual-e5-small",
  };
}
