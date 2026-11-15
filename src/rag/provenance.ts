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
  /**
   * Respaldada por la fuente n (1-based, como la cita [n]).
   * `replaced` (T-17, 0.1.99): la frase del modelo fue SUSTITUIDA
   * por el texto de la fuente, palabra por palabra — lo que se lee
   * es una cita literal. Sin la marca, «source» solo dice que la
   * frase tiene respaldo: su texto sigue siendo del modelo. La
   * distinción es la que pidió @Pezhonchain: respaldada no es cita.
   */
  | { kind: "source"; n: number; support: number; negationFixed?: boolean; replaced?: boolean }
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

/** Un tramo del texto final que es cita literal, con su fuente si la tiene. */
export interface VerbatimSpan {
  text: string;
  /** Número de cita [n] de la fuente; la guía no lleva número. */
  n?: number;
}

/** ¿La frase se lee palabra por palabra como salió de su origen? */
export function isVerbatimSentence(s: SentenceProvenance): boolean {
  return s.origin.kind === "guide" || (s.origin.kind === "source" && s.origin.replaced === true);
}

/**
 * T-17 (0.1.99): los tramos verbatim de una respuesta, alineados
 * contra su texto final tal y como se guarda, citas [n] incluidas.
 *
 * La alineación es búsqueda secuencial exacta: las frases de la
 * procedencia aparecen en orden dentro del texto final, y cada
 * tramo se busca a partir de donde terminó el anterior. Un tramo
 * que no se encuentra exactamente (deriva por edición, truncado o
 * limpieza de citas al pintar) NO se marca: fallar a «sin marca»,
 * nunca a «marca equivocada» — pintar como cita lo que no lo es
 * sería el engaño contrario al que esta marca existe para evitar.
 */
export function verbatimSpans(sentences: readonly SentenceProvenance[], fullText: string): VerbatimSpan[] {
  const spans: VerbatimSpan[] = [];
  let from = 0;
  for (const s of sentences) {
    if (!isVerbatimSentence(s) || s.text.length === 0) continue;
    const at = fullText.indexOf(s.text, from);
    if (at < 0) continue;
    spans.push(s.origin.kind === "source" ? { text: s.text, n: s.origin.n } : { text: s.text });
    from = at + s.text.length;
  }
  return spans;
}
