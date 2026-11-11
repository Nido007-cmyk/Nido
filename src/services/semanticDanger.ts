/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * 0.1.93 — la capa por significado de la puerta de salud y emergencia,
 * con el motor de búsqueda del teléfono (routing/semanticGate.ts tiene
 * la regla y las medidas).
 *
 * Nunca lanza y nunca abre la puerta: ante cualquier fallo (motor sin
 * cargar, modelo sin pesos, paridad que no cuadra) responde «no lo sé»
 * (false) y la decisión queda en la lista de palabras, como antes.
 */
import { embeddingEngine } from "../rag/embed";
import { hasSemanticGate, semanticDangerScore, semanticGateParity } from "../routing/semanticGate";
import { SEMANTIC_GATE_PROBE_TEXT } from "../routing/semanticGateWeights";

export interface SemanticEmbedder {
  embedQueryTagged(text: string): Promise<{ vector: ArrayLike<number>; modelSha256: string | null }>;
}

export interface SemanticDangerChecker {
  /** ¿La pregunta es de salud o emergencia, por significado? */
  check(query: string): Promise<boolean>;
}

export function createSemanticDangerChecker(embedder: SemanticEmbedder): SemanticDangerChecker {
  // Paridad comprobada una vez por modelo cargado.
  const parity = new Map<string, boolean>();
  // La misma pregunta se consulta dos veces en un turno (antes y después
  // de generar): la segunda no vuelve al motor.
  let last: { query: string; verdict: boolean } | null = null;

  return {
    async check(query: string): Promise<boolean> {
      const q = query.trim();
      if (q.length === 0) return false;
      if (last && last.query === q) return last.verdict;
      try {
        const { vector, modelSha256 } = await embedder.embedQueryTagged(q);
        if (!modelSha256 || !hasSemanticGate(modelSha256)) return false;
        let ok = parity.get(modelSha256);
        if (ok === undefined) {
          const probe = await embedder.embedQueryTagged(SEMANTIC_GATE_PROBE_TEXT);
          // Un cambio de modelo entre las dos llamadas: no se decide nada.
          if (probe.modelSha256 !== modelSha256) return false;
          ok = semanticGateParity(probe.vector, modelSha256);
          parity.set(modelSha256, ok);
        }
        if (!ok) return false;
        const score = semanticDangerScore(vector, modelSha256);
        const verdict = score !== null && score >= 0;
        last = { query: q, verdict };
        return verdict;
      } catch {
        return false;
      }
    },
  };
}

let shared: SemanticDangerChecker | null = null;

/** La de la app, sobre el motor de búsqueda cargado. */
export function semanticDanger(query: string): Promise<boolean> {
  if (!shared) shared = createSemanticDangerChecker(embeddingEngine);
  return shared.check(query);
}
