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

export type FallbackKind = "notUnderstood" | "actionFailed" | "memoryFailed" | "emptyAnswer";

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
};

export function agentFallbackText(kind: FallbackKind, lang: FallbackLang = "es"): string {
  return TEXTS[kind][lang] ?? TEXTS[kind].es;
}

/** Normaliza un tag de idioma de la UI ("es-MX", "pt-BR", "en") a es/en/pt. */
export function toFallbackLang(tag: string | null | undefined): FallbackLang {
  const t = (tag ?? "").toLowerCase();
  if (t.startsWith("en")) return "en";
  if (t.startsWith("pt")) return "pt";
  return "es";
}
