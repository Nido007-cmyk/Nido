/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * T-20 (0.1.99, núcleo del juez): el contexto semántico del juez.
 *
 * El juez (verifyGroundedAnswer, grounding.ts) es síncrono y puro: no
 * puede cargar el motor de embeddings ni esperar a la inferencia. Este
 * módulo es el dueño de todo lo asíncrono: precomputa, con el motor ya
 * residente que la recuperación usa en el turno, los vectores que las
 * puertas semánticas (T-21) van a leer — cláusulas de los chunks,
 * cláusulas de la respuesta y similitud pregunta→chunk — y se los
 * entrega al juez como un parámetro opcional. Sin motor residente o
 * sin perfil multilingüe activo, devuelve null y el juez juzga como
 * siempre: sin regresión y sin cobertura nueva.
 *
 * La alineación cláusula↔vector es el punto frágil del diseño: el
 * constructor trocea con LAS MISMAS funciones que el juez
 * (splitSentences sobre el cuerpo con la misma limpieza por frase, y
 * splitClausesWithSep para las cláusulas), en el mismo orden, y el
 * juez valida la coherencia entera del contexto antes de aceptarlo:
 * un contexto desalineado se ignora entero, nunca se juzga a medias.
 */

import { embeddingEngine } from "./embed";
import { MULTILINGUAL_E5_SMALL_PROFILE, type EmbeddingProfile } from "./embeddingProfile";
import { splitClausesWithSep, splitSentences, type GroundingChunk } from "./grounding";
import { cosineSimilarity } from "./pure";

/** El id del perfil que produjo los vectores (unión de embeddingProfile). */
export type EmbeddingProfileId = EmbeddingProfile["id"];

export interface JudgeSemanticContext {
  /**
   * Vectores de las cláusulas de cada chunk, en el orden de los chunks
   * que recibe verifyGroundedAnswer y, dentro de cada chunk, en el
   * orden de splitClausesWithSep sobre las frases del cuerpo (el
   * mismo troceo que el juez reconstruye para validar).
   */
  chunkClauseVectors: Float32Array[][];
  /**
   * Vectores de las cláusulas de la respuesta, por frase y cláusula,
   * alineados con splitSentences + splitClausesWithSep del juez.
   * (El paquete escribía Float32Array[][][]: un nivel de más contra
   * su propia descripción «por frase y cláusula»; la forma real es
   * frase → cláusula → vector, simétrica a chunkClauseVectors.)
   */
  answerClauseVectors: Float32Array[][];
  /**
   * Similitud coseno pregunta→chunk, un valor por chunk, con el
   * vector de pregunta del lado query del perfil activo contra el
   * vector del chunk entero del lado passage.
   */
  questionChunkSims: Float32Array;
  /**
   * Solo vectores precomputados con ESTE perfil pueden alimentar las
   * puertas: el contexto lleva el id del perfil que lo produjo.
   */
  profileId: EmbeddingProfileId;
}

/** Las cláusulas de un cuerpo de chunk, como las reconstruye el juez. */
function chunkClauseTexts(body: string): string[] {
  return splitSentences(body.trim())
    .map((x) => x.replace(/^[-•*\d.)\s]+/, "").trim())
    .filter(Boolean)
    .flatMap((s) => splitClausesWithSep(s).map((c) => c.text));
}

/** Las cláusulas de cada frase de la respuesta, por frase. */
function answerClauseTexts(answer: string): string[][] {
  return splitSentences(answer).map((s) => splitClausesWithSep(s).map((c) => c.text));
}

/**
 * Construye el contexto semántico del turno, o null cuando no hay
 * contexto posible (motor no residente, perfil no multilingüe, o el
 * motor falla a mitad: el llamador nunca pierde un turno por esto).
 *
 * El vector de pregunta sale de embedQuery (lado query del perfil).
 * Las similitudes pregunta→chunk se calculan contra el vector del
 * chunk entero (title + ". " + body, el mismo texto que la
 * recuperación embebe para el chunk) del lado passage: la interfaz
 * recibe los chunks tal y como llegan al juez, sin vectores previos,
 * así que el constructor los embebe aquí.
 */
export async function buildJudgeSemanticContext(args: {
  answer: string;
  chunks: readonly GroundingChunk[];
  query: string;
}): Promise<JudgeSemanticContext | null> {
  const { answer, chunks, query } = args;
  if (chunks.length === 0) return null;
  // Sin motor residente no hay contexto: cargarlo desde aquí
  // convertiría cada juicio en una carga de modelo (residencia bajo
  // demanda de la fase 4: quien lo necesita en el turno es la
  // recuperación, que ya lo cargó si pudo).
  if (!embeddingEngine.isLoaded) return null;
  const profile = embeddingEngine.profile;
  // Las puertas semánticas solo están medidas con el perfil
  // multilingüe; con cualquier otro perfil no hay contexto.
  if (profile.id !== MULTILINGUAL_E5_SMALL_PROFILE.id) return null;
  try {
    const questionVec = await embeddingEngine.embedQuery(query);
    const chunkClauseVectors: Float32Array[][] = [];
    const questionChunkSims = new Float32Array(chunks.length);
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]!;
      const wholeVec = await embeddingEngine.embedPassage(`${chunk.title}. ${chunk.body}`);
      questionChunkSims[i] = cosineSimilarity(questionVec, wholeVec);
      const vectors: Float32Array[] = [];
      for (const clause of chunkClauseTexts(chunk.body)) {
        vectors.push(await embeddingEngine.embedPassage(clause));
      }
      chunkClauseVectors.push(vectors);
    }
    const answerClauseVectors: Float32Array[][] = [];
    for (const clauses of answerClauseTexts(answer)) {
      const vectors: Float32Array[] = [];
      for (const clause of clauses) {
        vectors.push(await embeddingEngine.embedPassage(clause));
      }
      answerClauseVectors.push(vectors);
    }
    return { chunkClauseVectors, answerClauseVectors, questionChunkSims, profileId: profile.id };
  } catch {
    // El motor falló a mitad de la construcción: contexto ninguno,
    // el juez queda como hoy (la degradación sellada de la casa).
    return null;
  }
}
