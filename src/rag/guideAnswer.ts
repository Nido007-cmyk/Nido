/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * 0.1.59 — First aid answers in the guide's own words, no model.
 *
 * Seen on a physical tablet (0.1.58): «¿Cómo hago la RCP a un adulto?» got
 * the chest-pain guide, and the model's copy of it said «está sangrando»
 * where the guide says «NO está sangrando» (the aspirin rule). For choking,
 * the model said to keep the person at your side and watch. A small model
 * can drop a «no»; the sentence check in grounding.ts cannot see it (a
 * negation is not a content word). For first aid that is not acceptable.
 *
 * So when the best match for a question is a NIDO Essentials guide, NIDO
 * shows that guide's text exactly as written (the same idea as the emergency
 * numbers: verified content, no model in between) and links the whole guide.
 * Pure functions; the pack reading lives in guideAnswerRun.ts.
 */
import type { RetrievedChunk } from "./retrieve.types";
import { parsePackChunkId, type PackSourceDoc } from "./packSource";
import { detectTextLang, splitSentences, type GroundingLang } from "./grounding";
import type { SentenceProvenance } from "./provenance";

/** Packs whose guides are shown word for word (both embedding variants). */
export function isEssentialsChunk(chunkId: string | undefined): boolean {
  const ref = parsePackChunkId(chunkId);
  return !!ref && /^nido-esencial(-e5)?$/.test(ref.packId);
}

/**
 * Minimum semantic match (cosine) for the guide to be the answer. On the
 * tablet the right guide matched at 0.87–0.89; a lexical-only hit has no
 * cosine and never qualifies on its own (the wrong chest-pain section was
 * a lexical-only hit).
 */
export const GUIDE_MIN_SCORE = 0.8;

/** Longest answer shown inline; the rest is one tap away («Leer la guía entera»). */
export const GUIDE_MAX_CHARS = 2600;

/**
 * The Essentials chunk to answer from, or null. It has to be the strongest
 * semantic match of all the sources (not just any Essentials chunk), above
 * GUIDE_MIN_SCORE. Among Essentials chunks of near-equal strength, the one
 * written in the reader's language wins (Portuguese readers get Spanish:
 * the pack has guides in Spanish and English).
 */
export function pickGuideChunk(chunks: RetrievedChunk[], lang: GroundingLang): RetrievedChunk | null {
  const scored = chunks.filter((c) => typeof c.rawScore === "number");
  if (scored.length === 0) return null;
  const best = scored.reduce((a, b) => ((b.rawScore as number) > (a.rawScore as number) ? b : a));
  if (!isEssentialsChunk(best.chunkId) || (best.rawScore as number) < GUIDE_MIN_SCORE) return null;
  const want: GroundingLang = lang === "pt" ? "es" : lang;
  const close = scored.filter(
    (c) => isEssentialsChunk(c.chunkId) && (best.rawScore as number) - (c.rawScore as number) <= 0.03,
  );
  return close.find((c) => detectTextLang(`${c.title}. ${c.body}`) === want) ?? best;
}

const HEAD: Record<GroundingLang, (title: string) => string> = {
  es: (t) => `Guía «${t}» de NIDO Esencial, tal como está escrita (sin modelo):`,
  en: (t) => `NIDO Essentials guide “${t}”, exactly as written (no model):`,
  pt: (t) => `Guia «${t}» do NIDO Essencial, exatamente como está escrito (sem modelo):`,
};
const HEAD_SHORT: Record<GroundingLang, (title: string) => string> = {
  es: (t) => `Versión corta de la guía «${t}» de NIDO Esencial: su primera parte, tal como está escrita (sin modelo):`,
  en: (t) => `Short version of the NIDO Essentials guide “${t}”: its first part, exactly as written (no model):`,
  pt: (t) => `Versão curta do guia «${t}» do NIDO Essencial: a primeira parte, exatamente como está escrita (sem modelo):`,
};
const MORE_SHORT: Record<GroundingLang, string> = {
  es: "Es solo el principio: la guía completa es la referencia. Toca «Abrir la guía completa».",
  en: "This is only the beginning: the full guide is the reference. Tap “Open the full guide”.",
  pt: "É só o começo: o guia completo é a referência. Toque em «Abrir o guia completo».",
};

/**
 * 0.1.60 (decisión del plan, caso AT-04): «resúmeme la guía de RCP» no
 * hace que un modelo reescriba la guía (R1 de la constitución). Se muestra
 * su principio tal cual: las partes hasta el primer paso a paso numerado.
 */
const SHORT_REQUEST_RE =
  /\b(res[uú]me(?:me|la|lo)?|resumen|resumida|en (?:pocas|dos) palabras|versi[oó]n (?:corta|breve|resumida)|m[aá]s corto|corto y r[aá]pido|summari[sz]e|summary|short version|in (?:a )?few words|tl;?dr|resuma|resumo|vers[aã]o (?:curta|resumida)|em poucas palavras)\b/i;

export function wantsShortGuide(query: string): boolean {
  return SHORT_REQUEST_RE.test(query ?? "");
}

/** La pregunta sin la petición de resumen, para buscar la guía por su tema. */
export function stripShortRequest(query: string): string {
  const out = (query ?? "").replace(new RegExp(SHORT_REQUEST_RE.source, "gi"), " ").replace(/\s+/g, " ").trim();
  return out || query;
}

/** Hasta dónde llega la versión corta. */
export const GUIDE_SHORT_MAX_CHARS = 1200;

const MORE: Record<GroundingLang, string> = {
  es: "La guía sigue: toca «Abrir la guía completa».",
  en: "The guide goes on: tap “Open the full guide”.",
  pt: "O guia continua: toque em «Abrir o guia completo».",
};
const SOURCE: Record<GroundingLang, string> = { es: "Fuentes de la guía", en: "Guide sources", pt: "Fontes do guia" };
const CALL: Record<GroundingLang, string> = {
  es: "Si alguien está en peligro, llama primero al número de emergencias.",
  en: "If someone is in danger, call your emergency number first.",
  pt: "Se alguém estiver em perigo, ligue primeiro para o número de emergência.",
};

/**
 * The answer text: a heading naming the guide, then its parts verbatim and
 * in order (none rewritten, none dropped in the middle), cut only between
 * parts when long, then the guide's sources and the call-first line.
 */
export function composeGuideAnswer(doc: PackSourceDoc, lang: GroundingLang, opts: { short?: boolean } = {}): string {
  if (opts.short) return composeShortGuideAnswer(doc, lang);
  const parts: string[] = [];
  let used = 0;
  let cut = false;
  for (const p of doc.parts) {
    const body = p.body.trim();
    if (!body) continue;
    if (parts.length > 0 && used + body.length > GUIDE_MAX_CHARS) {
      cut = true;
      break;
    }
    parts.push(body);
    used += body.length;
  }
  const out = [HEAD[lang](doc.title), "", parts.join("\n\n")];
  if (cut) out.push("", MORE[lang]);
  if (doc.source.trim()) out.push("", `${SOURCE[lang]}: ${doc.source.trim()}`);
  out.push("", CALL[lang]);
  return out.join("\n");
}

/**
 * Versión corta: las partes en orden hasta la primera con un paso a paso
 * numerado («1. …»), incluida; si en las tres primeras no hay ninguna, las
 * dos primeras. Nunca más de GUIDE_SHORT_MAX_CHARS salvo la primera parte,
 * y siempre cortando entre partes, nunca dentro de una.
 */
export function composeShortGuideAnswer(doc: PackSourceDoc, lang: GroundingLang): string {
  const bodies = doc.parts.map((p) => p.body.trim()).filter(Boolean);
  const firstSteps = bodies.slice(0, 3).findIndex((b) => /^\s*1[.)]\s/m.test(b));
  const wanted = firstSteps >= 0 ? firstSteps + 1 : Math.min(2, bodies.length);
  const parts: string[] = [];
  let used = 0;
  for (const body of bodies.slice(0, wanted)) {
    if (parts.length > 0 && used + body.length > GUIDE_SHORT_MAX_CHARS) break;
    parts.push(body);
    used += body.length;
  }
  const out = [HEAD_SHORT[lang](doc.title), "", parts.join("\n\n"), "", MORE_SHORT[lang]];
  if (doc.source.trim()) out.push("", `${SOURCE[lang]}: ${doc.source.trim()}`);
  out.push("", CALL[lang]);
  return out.join("\n");
}

/**
 * 0.1.61: procedencia de una respuesta de guía. Las partes de la guía son
 * «guide»; el encabezado, el aviso de que sigue, las fuentes y «llama
 * primero» son textos fijos de NIDO, no frases de la guía.
 */
export function guideAnswerProvenance(text: string): SentenceProvenance[] {
  const fixedLine = (p: string) =>
    Object.values(HEAD).some((h) => p.startsWith(h("\u0000").split("\u0000")[0])) ||
    Object.values(HEAD_SHORT).some((h) => p.startsWith(h("\u0000").split("\u0000")[0])) ||
    Object.values(MORE).includes(p) ||
    Object.values(MORE_SHORT).includes(p) ||
    Object.values(CALL).includes(p) ||
    Object.values(SOURCE).some((s) => p.startsWith(`${s}: `));
  const out: SentenceProvenance[] = [];
  for (const para of text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)) {
    if (fixedLine(para)) {
      out.push({ text: para, origin: { kind: "fixed" } });
      continue;
    }
    for (const s of splitSentences(para)) out.push({ text: s, origin: { kind: "guide" } });
  }
  return out;
}
