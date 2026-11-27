/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * 0.1.117 (UI nueva): la franja «Comprobada con las fuentes» bajo una
 * respuesta del chat. Solo dice lo que src/rag/grounding.ts comprobó de
 * verdad:
 *
 * - `grounded`: todas las frases verificables tienen respaldo → franja verde.
 * - `partial`: se quitaron frases sin respaldo y el resto lo tiene → franja
 *   ámbar que lo dice.
 * - cualquier otro estado (abstención, otro idioma, sin fuentes) → nada: la
 *   caja de fuentes ya explica ese caso con su propio título.
 *
 * Una cifra que contradice a la fuente (sourceCheck) apaga la franja: no se
 * puede llamar «comprobada» a una respuesta con una cifra que la fuente
 * desmiente, aunque sus frases tengan respaldo.
 *
 * Pura, sin dependencias de React.
 */
import type { GroundingStatus } from "../../rag/grounding";

export type GroundingBadge = { tone: "verified" | "partial"; key: string };

export function groundingBadge(
  grounding: GroundingStatus | undefined,
  numberConflicts: readonly unknown[] | undefined,
  citationCount: number,
): GroundingBadge | null {
  if (citationCount <= 0) return null;
  if (numberConflicts && numberConflicts.length > 0) return null;
  if (grounding === "grounded") return { tone: "verified", key: "groundingBadge.verified" };
  if (grounding === "partial") return { tone: "partial", key: "groundingBadge.partial" };
  return null;
}
