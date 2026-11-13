/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * fallbackText.ts — NIDO: textos de respaldo honestos (es / en / pt).
 *
 * NEVER-SILENT 2026-10-11: el usuario nunca debe quedarse sin respuesta,
 * ni recibir una respuesta engañosa. Antes:
 *  - si el modelo no producía nada usable, el agente decía "Listo." aunque
 *    no hubiera hecho nada;
 *  - si no generaba la acción, decía "No pude guardar eso…" incluso cuando
 *    se le había pedido llamar o buscar algo;
 *  - en el chat, una generación vacía dejaba la burbuja en blanco.
 *
 * Puro, sin dependencias.
 */

export type FallbackLang = "es" | "en" | "pt";

export type FallbackKind =
  | "notUnderstood"
  | "actionFailed"
  | "memoryFailed"
  | "emptyAnswer"
  | "spaceShortened"
  | "answerCut";

const TEXTS: Record<FallbackKind, Record<FallbackLang, string>> = {
  notUnderstood: {
    es: "No entendí bien. ¿Puedes decirlo de otra forma?",
    en: "I didn't quite get that. Could you say it another way?",
    pt: "Não entendi bem. Pode dizer de outra forma?",
  },
  actionFailed: {
    es:
      "No supe qué acción hacer con eso. Prueba, por ejemplo: «llama a Ana», " +
      "«busca el contacto Ana», «recuérdame comprar pan mañana a las 9» o «cuánto es 12*7».",
    en:
      "I couldn't tell which action to take. Try, for example: “call Ana”, " +
      "“find contact Ana”, “remind me to buy bread tomorrow at 9” or “what is 12*7”.",
    pt:
      "Não entendi qual ação fazer. Tente, por exemplo: “liga para a Ana”, " +
      "“procura o contato Ana”, “lembre-me de comprar pão amanhã às 9” ou “quanto é 12*7”.",
  },
  memoryFailed: {
    es:
      "No pude guardar eso automáticamente. Inténtalo de nuevo, por ejemplo: " +
      "«recuerda que mi color favorito es el azul», o usa la pantalla de memoria.",
    en:
      "I couldn't save that automatically. Try again, for example: " +
      "“remember that my favorite color is blue”, or use the memory screen.",
    pt:
      "Não consegui salvar isso automaticamente. Tente de novo, por exemplo: " +
      "“lembre que minha cor favorita é azul”, ou use a tela de memória.",
  },
  emptyAnswer: {
    es: "No pude generar una respuesta esta vez. ¿Puedes intentarlo de nuevo o decirlo de otra forma?",
    en: "I couldn't generate an answer this time. Could you try again or rephrase it?",
    pt: "Não consegui gerar uma resposta desta vez. Pode tentar de novo ou dizer de outra forma?",
  },
  // Adversaria H-12: la ruta fija degrada el suelo de generación cuando
  // el prompt llena la ventana (512 → 64). La respuesta sale, pero
  // acortada POR ESPACIO — y la vara de la casa es decir lo que hizo,
  // no acortar en silencio. Nota corta que se añade a la respuesta
  // servida solo cuando el espacio obligó al recorte.
  spaceShortened: {
    es: "Nota: tuve que acortar esta respuesta porque en este turno quedó poco espacio para escribir.",
    en: "Note: I had to shorten this answer because this turn ran low on space.",
    pt: "Nota: tive de encurtar esta resposta porque neste turno ficou pouco espaço para escrever.",
  },
  // 0.1.90 (familia 5): la generación consumió todo su presupuesto de
  // tokens (lastGenerationWasCut) sin que el espacio obligara a
  // degradarlo — el tope de salida del turno mandó. La respuesta ya se
  // cierra en su última frase completa (trimToCompleteSentences), y
  // esta nota dice la verdad que spaceShortened no puede decir aquí:
  // no faltó espacio, llegó el límite de un turno. Ofrece continuar,
  // que es lo que el usuario puede pedir de verdad.
  answerCut: {
    es: "Nota: esta respuesta llegó al límite de lo que puedo escribir en un turno y la cerré en la última frase completa. Si quieres, pídeme que continúe.",
    en: "Note: this answer reached the limit of what I can write in one turn, so I closed it at the last complete sentence. If you want, ask me to continue.",
    pt: "Nota: esta resposta chegou ao limite do que posso escrever em um turno e a fechei na última frase completa. Se quiser, peça para eu continuar.",
  },
};

export function agentFallbackText(kind: FallbackKind, lang: FallbackLang = "es"): string {
  return TEXTS[kind][lang] ?? TEXTS[kind].es;
}

/**
 * 0.1.91 (familia 6): ¿lleva nota de corte la respuesta servida, y
 * cuál? La nota se ata al HECHO de la generación (consumió todo su
 * presupuesto de tokens, `lastGenerationWasCut`), nunca a la
 * ASIGNACIÓN. Hasta la 0.1.90 la nota de espacio se disparaba con
 * `spaceCut` solo: `degradableGenTokens` marca `spaceCut` cuando el
 * turno recibe menos tokens de los DESEADOS (el tope por defecto,
 * 1024) — y en el peldaño de emergencia (nCtx 1024) el prompt
 * siempre deja menos de 1024, así que la nota salía en TODOS los
 * turnos de la ventana estrecha, también bajo respuestas de tres
 * frases cerradas con su punto (foto del dueño, Tab A9+,
 * 2026-11-09: tres de tres). Degradar la asignación no acorta
 * ninguna respuesta que termina natural dentro de lo asignado:
 * sin consumo total no hay corte y no hay nota. Si el consumo fue
 * total, manda la causa: con degradación, la de espacio; sin ella,
 * la del límite del turno.
 */
export function generationCutNote(
  spaceCut: boolean,
  genWasCut: boolean
): "spaceShortened" | "answerCut" | null {
  if (!genWasCut) return null;
  return spaceCut ? "spaceShortened" : "answerCut";
}

export function toFallbackLang(tag: string | null | undefined): FallbackLang {
  const t = (tag ?? "").toLowerCase();
  if (t.startsWith("en")) return "en";
  if (t.startsWith("pt")) return "pt";
  return "es";
}
