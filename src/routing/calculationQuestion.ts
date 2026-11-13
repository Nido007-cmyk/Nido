/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * 0.1.92 (auditoría del paquete 0.1.91, familia 7) — ¿es una pregunta
 * de CUENTAS? («Tengo 3 cajas de 12 huevos y se rompen 7. ¿Cuántos me
 * quedan?», «¿a qué hora llega el tren?»).
 *
 * Por qué existe: medido con el Qwen3-0.6B real y el prompt exacto de
 * la ruta fija (docs/ESTUDIO_RESPUESTAS_0.1.92.md), responder directo
 * a una cuenta falla casi siempre, y dejarle razonar SOLO en ese turno
 * la acierta mucho más. Razonar en todos los turnos no es opción: sale
 * cuatro veces más caro y parte de las respuestas se van al inglés.
 * Así que el turno de cuentas es el único que razona, y decidir cuál
 * es vive aquí, puro y probado.
 *
 * Criterio, estrecho a propósito (un falso positivo cuesta tiempo; un
 * falso negativo deja el turno como estaba):
 *   - al menos DOS cantidades escritas con cifras (12, 7, 9:00, 15%), y
 *   - una pregunta de cantidad o de hora (cuánto/cuántos, a qué hora,
 *     how many/much, what time, quanto/quantos, que horas…).
 * Una sola cifra («¿cuántos días tiene 2026?») o ninguna pregunta de
 * cantidad («cambia la llanta en 5 pasos») no lo son.
 */

const NUMBER_RE = /\d+(?:[.,:]\d+)?\s?%?/g;

const QUANTITY_CUE_RE = new RegExp(
  [
    // español
    "cu[aá]nt[oa]s?\\b",
    "a\\s+qu[eé]\\s+hora",
    "qu[eé]\\s+hora",
    "qu[eé]\\s+porcentaje",
    // inglés
    "how\\s+(?:many|much|long|old|far)\\b",
    "what\\s+time\\b",
    "what\\s+(?:is|'s)\\s+\\d",
    "what\\s+percent",
    // portugués
    "quant[oa]s?\\b",
    "(?:a\\s+)?que\\s+horas",
    "qual\\s+(?:é|e)\\s+o\\s+(?:total|resultado)",
  ].join("|"),
  "i"
);

export function isCalculationQuestion(query: string): boolean {
  const text = query.trim();
  if (text.length === 0 || text.length > 400) return false;
  const numbers = text.match(NUMBER_RE) ?? [];
  if (numbers.length < 2) return false;
  return QUANTITY_CUE_RE.test(text);
}

/**
 * Presupuesto mínimo de generación para razonar: lo medido fue con 410
 * tokens (el de la ventana estrecha del aparato del dueño); por debajo
 * no hay medida, así que no se razona.
 */
export const REASONING_MIN_GEN_TOKENS = 384;

/**
 * Modelos que razonan en el turno de cuentas: SOLO aquellos donde se
 * midió que compensa, con el archivo exacto del catálogo y el prompt
 * exacto de la app. Qwen3-0.6B Q4_K_M: 16/60 → 41/60 cuentas correctas
 * (docs/ESTUDIO_RESPUESTAS_0.1.92.md). Vive aquí y no en el catálogo de
 * modelos porque el catálogo va firmado y esto es comportamiento de la
 * app, no un dato del archivo.
 */
export const REASON_ON_CALCULATION_MODEL_IDS: ReadonlySet<string> = new Set(["qwen3-0.6b-q4km"]);

/**
 * ¿Razona este turno de la ruta fija? Solo si el modelo cargado está
 * en la lista medida de arriba, va por su plantilla
 * de chat (el interruptor de razonar solo existe ahí), no hay fuentes
 * (con fuentes manda el régimen de evidencia, que no se toca), queda
 * presupuesto medido y la pregunta es de cuentas.
 */
export function shouldReasonThisTurn(input: {
  modelId: string | undefined;
  usesChatTemplate: boolean;
  sourceCount: number;
  genTokens: number;
  query: string;
}): boolean {
  return (
    input.modelId !== undefined &&
    REASON_ON_CALCULATION_MODEL_IDS.has(input.modelId) &&
    input.usesChatTemplate &&
    input.sourceCount === 0 &&
    input.genTokens >= REASONING_MIN_GEN_TOKENS &&
    isCalculationQuestion(input.query)
  );
}

