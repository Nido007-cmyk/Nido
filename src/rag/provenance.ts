/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Procedencia por frase (plan profesional, función 5.1; regla R8 de la
 * constitución: una frase sin fuente nunca se presenta como si la tuviera).
 *
 * Cada frase de una respuesta lleva de dónde sale. Este archivo es puro:
 * tipos, el resumen de una línea y su texto en es/en/pt. Quién marca cada
 * frase: grounding.ts (respuestas del modelo con fuentes), guideAnswer.ts
 * (guías tal cual), safetyAnswers.ts (textos fijos) y las herramientas.
 */

export type ProvenanceLang = "es" | "en" | "pt";

export type ProvenanceOrigin =
  /** Guía de NIDO Esencial mostrada tal cual (R1). */
  | { kind: "guide"; chunkId?: string }
  /** Respaldada por la fuente n (1-based, como la cita [n]). */
  | { kind: "source"; n: number; support: number; negationFixed?: boolean }
  /** De la memoria de la persona. */
  | { kind: "memory" }
  /** Resultado de una herramienta (hora, conversión, recordatorio…). */
  | { kind: "tool"; tool: string }
  /** Texto fijo de NIDO (números de emergencia, aviso de CO, notas). */
  | { kind: "fixed" }
  /** NIDO dice que no lo sabe. */
  | { kind: "abstain" }
  /** Del modelo, sin fuente que la respalde o sin poder comprobarla. */
  | { kind: "model"; reason: "no-sources" | "too-short-to-check" | "unverified-language" };

export interface SentenceProvenance {
  text: string;
  origin: ProvenanceOrigin;
}

export interface ProvenanceCounts {
  guide: number;
  source: number;
  memory: number;
  tool: number;
  fixed: number;
  abstain: number;
  model: number;
}

export function countProvenance(sentences: readonly SentenceProvenance[]): ProvenanceCounts {
  const c: ProvenanceCounts = { guide: 0, source: 0, memory: 0, tool: 0, fixed: 0, abstain: 0, model: 0 };
  for (const s of sentences) c[s.origin.kind]++;
  return c;
}

const LABELS: Record<ProvenanceLang, Record<keyof ProvenanceCounts, [string, string]>> = {
  es: {
    guide: ["1 frase de la guía", "{{n}} frases de la guía"],
    source: ["1 de las fuentes", "{{n}} de las fuentes"],
    memory: ["1 de tu memoria", "{{n}} de tu memoria"],
    tool: ["1 calculada por NIDO", "{{n}} calculadas por NIDO"],
    fixed: ["1 de un texto fijo de NIDO", "{{n}} de textos fijos de NIDO"],
    abstain: ["1 donde NIDO dice que no lo sabe", "{{n}} donde NIDO dice que no lo sabe"],
    model: ["1 del modelo sin fuente", "{{n}} del modelo sin fuente"],
  },
  en: {
    guide: ["1 sentence from the guide", "{{n}} sentences from the guide"],
    source: ["1 from the sources", "{{n}} from the sources"],
    memory: ["1 from your memory", "{{n}} from your memory"],
    tool: ["1 worked out by NIDO", "{{n}} worked out by NIDO"],
    fixed: ["1 from a fixed NIDO text", "{{n}} from fixed NIDO texts"],
    abstain: ["1 where NIDO says it doesn't know", "{{n}} where NIDO says it doesn't know"],
    model: ["1 from the model with no source", "{{n}} from the model with no source"],
  },
  pt: {
    guide: ["1 frase do guia", "{{n}} frases do guia"],
    source: ["1 das fontes", "{{n}} das fontes"],
    memory: ["1 da sua memória", "{{n}} da sua memória"],
    tool: ["1 calculada pelo NIDO", "{{n}} calculadas pelo NIDO"],
    fixed: ["1 de um texto fixo do NIDO", "{{n}} de textos fixos do NIDO"],
    abstain: ["1 em que o NIDO diz que não sabe", "{{n}} em que o NIDO diz que não sabe"],
    model: ["1 do modelo sem fonte", "{{n}} do modelo sem fonte"],
  },
};

/** Orden del resumen: lo más fiable primero, lo que no tiene fuente al final. */
const ORDER: (keyof ProvenanceCounts)[] = ["guide", "source", "memory", "tool", "fixed", "abstain", "model"];

/**
 * Resumen de una línea: «3 frases de la guía · 1 del modelo sin fuente».
 * Vacío si no hay frases. Texto real (TalkBack lo lee), no solo colores.
 */
export function summarizeProvenance(sentences: readonly SentenceProvenance[], lang: ProvenanceLang): string {
  const c = countProvenance(sentences);
  return ORDER.filter((k) => c[k] > 0)
    .map((k) => {
      const [one, many] = LABELS[lang][k];
      return c[k] === 1 ? one : many.split("{{n}}").join(String(c[k]));
    })
    .join(" · ");
}

/** Todas las frases salen de un mismo origen fijo (guía, texto fijo…). */
export function allFrom(text: string, origin: ProvenanceOrigin, split: (t: string) => string[]): SentenceProvenance[] {
  return split(text).map((s) => ({ text: s, origin }));
}
