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
import { detectTextLang, type GroundingLang } from "./grounding";

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
export function composeGuideAnswer(doc: PackSourceDoc, lang: GroundingLang): string {
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
