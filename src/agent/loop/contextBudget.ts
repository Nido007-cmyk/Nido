/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * contextBudget.ts — central context-window budget manager (P2.3).
 *
 * Before: history turns were appended without limit (assembleChatMessages)
 * and the agent loop relied on a fail/degenerate fallback when the prompt
 * didn't fit (T-contexto-2026-10-06). Long conversations degraded silently
 * or crashed into "Context is full".
 *
 * Now: one place decides what fits. Priorities, in order:
 *   1. System prompt is PINNED — always included in full; exceeding its cap
 *      throws an actionable error (fail-closed, never silently truncated).
 *   2. Generation headroom is RESERVED — never given to history.
 *   3. History is recent-first — newest turns kept, oldest dropped.
 *   4. No orphaned assistant turns — a kept assistant message always keeps
 *      its user message.
 *
 * Token counting uses estimateTokens (chars/3, digits and non-Latin
 * characters at a full token, + ChatML overhead): the same conservative estimator assertPromptBudget uses. It OVERESTIMATES
 * on purpose — the fail-safe direction is to keep slightly less history,
 * never to overflow the native context.
 *
 * Pure, no dependencies (beyond the estimator), fully unit-tested.
 */

export interface BudgetMessage {
  role: string;
  content: string;
}

export interface ContextBudgetConfig {
  /** Total context window of the model. */
  nCtx: number;
  /** Tokens reserved for generation — never allocated to history. */
  reserveGeneration: number;
  /** Max tokens the system message may occupy; exceeding throws. */
  maxSystemTokens: number;
}

export interface BudgetedConversation {
  system: BudgetMessage;
  /** Oldest-first, newest turns kept; never contains an orphaned assistant turn. */
  history: BudgetMessage[];
  currentUser: BudgetMessage;
  /** How many history turns were dropped to fit. */
  droppedTurns: number;
  /** Estimated total including the reserved generation headroom. Invariant: <= nCtx. */
  estimatedTotalTokens: number;
}

/**
 * Estimación de tokens: la ÚNICA del proyecto (2026-11-11). La usan el
 * presupuesto de historial, el ajuste de fuentes (rag/pure.ts) y la
 * guarda del bucle del agente (estimatePromptTokens delega aquí).
 *
 * Defecto probado: la anterior, `ceil(longitud / 3) + 50`, NO era una
 * cota superior. Medida con el tokenizador real de Qwen2.5-0.5B y de
 * Qwen3-0.6B (los archivos exactos del catálogo) sobre 3.211 muestras
 * (guías de los packs en es/en/pt, los prompts del banco y textos con
 * cifras, tablas, emoji, código, hashes, mayúsculas), se quedaba corta
 * en 84, sobre todo con números: Qwen parte cada dígito en un token.
 * Un documento importado con una tabla (estado de cuenta, registro de
 * dosis) se estimaba en 717 tokens por fragmento y ocupaba 1.649. Con
 * n_ctx 2048 eso dejaba 143 de los 512 tokens reservados para la
 * respuesta; con n_ctx 4096 entraban los cuatro fragmentos y el motor
 * rechazaba el prompt con «Context is full».
 *
 * Ahora, sobre la misma base (un token cada 3 unidades UTF-16, como
 * String.length):
 *   - cada dígito cuesta un token entero, y cada número uno más;
 *   - cada carácter fuera del latín (emoji, otros alfabetos) cuesta uno
 *     entero;
 *   - más 50 de la plantilla ChatML, como antes.
 * En prosa de las guías estima un 3,7 % más que la anterior y en el
 * prompt de sistema con herramientas un 3 % más (52 tokens).
 * Tabla de la medición: docs/perf/ESTIMADOR_TOKENS_2026-11-11.md.
 *
 * m-30 (T-10, 0.1.99): quedaban por debajo del real el código fuente,
 * el texto entero en mayúsculas y las ristras de signos sueltos.
 * Cubrirlos a lo bruto inflaba un 10 % el presupuesto de todos los
 * turnos; la corrección es SELECTIVA POR CLASE: cada recargo solo
 * existe cuando la densidad de su clase domina el texto, así que la
 * prosa normal paga exactamente lo de 2026-11-11. Medido contra el
 * tokenizador real (Qwen2.5 BPE; la fixture guarda el máximo de
 * Qwen2.5 y Qwen3): código con densidad de signos ≈ 0,34 y déficit de
 * 0,23–0,31 por signo → 1/3 por signo con puerta de densidad > 0,30;
 * mayúsculas sostenidas con déficit de 0,04–0,07 por letra → 1/12 por
 * mayúscula con puerta de mayoría entre las letras (> 0,5). Las tres
 * clases quedan cubiertas en la fixture (estimateTokens.test.ts).
 */
export function estimateTokens(text: string): number {
  let digits = 0;
  let numbers = 0;
  let nonLatin = 0;
  let uppers = 0;
  let letters = 0;
  let symbols = 0;
  let inNumber = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    const isDigit = c >= 0x30 && c <= 0x39;
    if (isDigit) {
      digits++;
      if (!inNumber) numbers++;
    } else if (c > 0x24f) {
      nonLatin++;
    }
    inNumber = isDigit;
    // m-30: clases de la corrección selectiva. Mayúsculas y letras del
    // latín (A–Z, a–z y Latin-1 sin × ni ÷) y signos: puntuación ASCII,
    // puntuación Latin-1 (¡¿«»§…) y puntuación general (— … ‘’ “”).
    // Las mitades surrogate de un emoji ya cuentan como nonLatin
    // arriba y NO como signos (caen fuera de estos rangos).
    const isUpper = (c >= 0x41 && c <= 0x5a) || (c >= 0xc0 && c <= 0xde && c !== 0xd7);
    if (isUpper) uppers++;
    if (isUpper || (c >= 0x61 && c <= 0x7a) || (c >= 0xdf && c <= 0xff && c !== 0xf7) || (c >= 0xe0 && c <= 0xfe)) letters++;
    if (
      (c >= 0x21 && c <= 0x2f) ||
      (c >= 0x3a && c <= 0x40) ||
      (c >= 0x5b && c <= 0x60) ||
      (c >= 0x7b && c <= 0x7e) ||
      (c >= 0xa1 && c <= 0xbf) ||
      (c >= 0x2010 && c <= 0x2027)
    ) {
      symbols++;
    }
  }
  // m-30: recargos solo cuando la clase domina el texto; con las
  // puertas cerradas la estimación es la de 2026-11-11, dígito a dígito.
  const symbolExtra = text.length > 0 && symbols / text.length > 0.3 ? symbols / 3 : 0;
  const capsExtra = letters > 0 && uppers / letters > 0.5 ? uppers / 12 : 0;
  return Math.ceil(text.length / 3 + (digits * 2) / 3 + numbers + (nonLatin * 2) / 3 + symbolExtra + capsExtra) + 50;
}

/** Default estimator: conservative (overestimates) — the fail-safe direction. */
export function defaultTokenCounter(text: string): number {
  return estimateTokens(text);
}

/** Sensible defaults for a 4k-window chat model. */
export function budgetConfigFor(nCtx: number, reserveGeneration: number): ContextBudgetConfig {
  return { nCtx, reserveGeneration, maxSystemTokens: Math.floor(nCtx * 0.5) };
}

/**
 * Applies the budget. Throws an actionable error when even
 * system + current message + reserved headroom don't fit (fail-closed).
 * Pure function.
 */
export function applyContextBudget(
  system: BudgetMessage,
  history: BudgetMessage[],
  currentUser: BudgetMessage,
  config: ContextBudgetConfig,
  countTokens: (text: string) => number = defaultTokenCounter
): BudgetedConversation {
  const systemTokens = countTokens(system.content);
  if (systemTokens > config.maxSystemTokens) {
    throw new Error(
      `NIDO: system prompt excede el presupuesto (${systemTokens} tokens estimados > ` +
        `máximo ${config.maxSystemTokens}). Reduce el system prompt o sube maxSystemTokens.`
    );
  }
  const currentTokens = countTokens(currentUser.content);
  const historyBudget = config.nCtx - config.reserveGeneration - systemTokens - currentTokens;
  if (historyBudget < 0) {
    throw new Error(
      `NIDO: system (${systemTokens}) + mensaje actual (${currentTokens}) + reserva ` +
        `(${config.reserveGeneration}) exceden nCtx ${config.nCtx} sin siquiera historial.`
    );
  }

  // Recent-first: walk from the newest turn backwards while it fits.
  const keptNewestFirst: BudgetMessage[] = [];
  let used = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const cost = countTokens(history[i].content);
    if (used + cost > historyBudget) break;
    keptNewestFirst.push(history[i]);
    used += cost;
  }

  // No orphaned assistant turns: if the oldest kept message is an assistant
  // message, its user turn was cut — drop it too.
  if (keptNewestFirst.length > 0) {
    const oldestKept = keptNewestFirst[keptNewestFirst.length - 1];
    if (oldestKept.role === "assistant") {
      used -= countTokens(oldestKept.content);
      keptNewestFirst.pop();
    }
  }

  const keptHistory = keptNewestFirst.reverse();
  const estimatedTotalTokens =
    systemTokens + currentTokens + used + config.reserveGeneration;

  return {
    system,
    history: keptHistory,
    currentUser,
    droppedTurns: history.length - keptHistory.length,
    estimatedTotalTokens,
  };
}
