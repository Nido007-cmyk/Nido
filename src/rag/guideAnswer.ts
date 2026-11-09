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

/**
 * Packs whose guides are shown word for word (both embedding variants),
 * with the name the answer's heading gives them in each language.
 *
 * Only first-aid packs, by the doctrine in this file's header: the literal
 * route exists because a small model can drop a "no", and in first aid
 * that is not acceptable. NIDO Niños IS first aid (choking, burns, fever
 * in babies), so it travels the same route; the other guide packs (home,
 * field, crisis, disasters…) keep the model path — the route opens pack
 * by pack, on this doctrine, never by family resemblance.
 */
const LITERAL_GUIDE_PACKS: Record<string, Record<GroundingLang, string>> = {
  "nido-esencial": { es: "NIDO Esencial", en: "NIDO Essentials", pt: "NIDO Essencial" },
  "nido-ninos": { es: "NIDO Niños", en: "NIDO Niños", pt: "NIDO Niños" },
};

function basePackId(packId: string): string {
  return packId.replace(/-e5$/, "");
}

export function isEssentialsChunk(chunkId: string | undefined): boolean {
  const ref = parsePackChunkId(chunkId);
  return !!ref && !!LITERAL_GUIDE_PACKS[basePackId(ref.packId)];
}

/**
 * 0.1.86 — the literal route also covers packs imported through the signed
 * pack door (services/packImporter.ts) whose origin the door verified
 * (SALVORA signature or NIDO catalog pin): the registry the door writes is
 * the same trust bar as the built-in list, verified text only. The caller
 * (guideAnswerRun.ts) passes the verified pack ids it read from that
 * registry; a `local-…` chunk whose pack is NOT in the set (a loose file
 * in corpus/, a user document) stays on the model path, unchanged.
 */
export interface LiteralRouteContext {
  /** Pack ids (`local-…`) the signed door imported and verified. */
  importedVerifiedPackIds?: ReadonlySet<string>;
  /** Display name per imported pack id, for the answer's heading. */
  importedPackNames?: ReadonlyMap<string, string>;
}

export function isLiteralGuideChunk(chunkId: string | undefined, route?: LiteralRouteContext): boolean {
  if (isEssentialsChunk(chunkId)) return true;
  const ref = parsePackChunkId(chunkId);
  return !!ref && !!route?.importedVerifiedPackIds?.has(ref.packId);
}

/** Display name of the pack a literal answer comes from (its own name when imported). */
export function literalRoutePackName(packId: string | undefined, lang: GroundingLang, route?: LiteralRouteContext): string {
  const imported = packId ? route?.importedPackNames?.get(packId) : undefined;
  return imported ?? literalPackName(packId, lang);
}

/** Heading name of a literal-route pack in the reader's language (Essentials when unknown). */
function literalPackName(packId: string | undefined, lang: GroundingLang): string {
  const names = (packId && LITERAL_GUIDE_PACKS[basePackId(packId)]) || LITERAL_GUIDE_PACKS["nido-esencial"];
  return names[lang];
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
 * written in the reader's language wins when the pack carries that language
 * (the packs are trilingual now: a Portuguese reader gets the Portuguese
 * guide, not the Spanish twin). When the pack has no guide in the reader's
 * language, the honest fallback: Spanish for a Portuguese reader (as
 * before the pack had Portuguese), else the strongest chunk.
 */
/**
 * 2026-11-06 (prueba física): «Quiero hacer un curso de rcp el mes que
 * viene» abrió la guía «Accidente de tráfico» por su apartado «Importante»,
 * que solo dice en qué fuentes se basa y recomienda un curso. Ese apartado
 * de cierre (el mismo en las 58 guías de cada idioma) no responde a nada:
 * nunca es la entrada a una guía.
 */
const CLOSING_SECTION_RE = /\s[—–-]\s*(?:Importante|Important)\s*$/i;

export function isClosingSection(c: Pick<RetrievedChunk, "title">): boolean {
  return CLOSING_SECTION_RE.test(c.title ?? "");
}

/**
 * 2026-11-06 (prueba física): con NIDO Desastres instalado, «¿Qué hago
 * durante un terremoto?» se lo llevó la INTRODUCCIÓN de su guía
 * «Atrapado bajo escombros…» («La guía de terremoto del pack Esencial
 * resume el caso en una línea; esta guía lo desarrolla…»). La entrada de
 * una guía de otro pack de NIDO describe la guía, no responde: no le
 * quita la respuesta a la guía literal de Esencial. Sus apartados (título
 * «Guía — Apartado») sí compiten, como siempre.
 */
function isOtherNidoGuideIntro(c: RetrievedChunk, route?: LiteralRouteContext): boolean {
  const ref = parsePackChunkId(c.chunkId);
  if (!ref || !/^nido-/.test(ref.packId) || isLiteralGuideChunk(c.chunkId, route)) return false;
  return !/\s[—–]\s/.test(c.title ?? "");
}

export function pickGuideChunk(chunks: RetrievedChunk[], lang: GroundingLang, route?: LiteralRouteContext): RetrievedChunk | null {
  const scored = chunks.filter(
    (c) =>
      typeof c.rawScore === "number" &&
      !(isLiteralGuideChunk(c.chunkId, route) && isClosingSection(c)) &&
      !isOtherNidoGuideIntro(c, route),
  );
  if (scored.length === 0) return null;
  const best = scored.reduce((a, b) => ((b.rawScore as number) > (a.rawScore as number) ? b : a));
  if (!isLiteralGuideChunk(best.chunkId, route) || (best.rawScore as number) < GUIDE_MIN_SCORE) return null;
  const close = scored.filter(
    (c) => isLiteralGuideChunk(c.chunkId, route) && (best.rawScore as number) - (c.rawScore as number) <= 0.03,
  );
  const prefs: GroundingLang[] = lang === "pt" ? ["pt", "es"] : [lang];
  for (const want of prefs) {
    const hit = close.find((c) => detectTextLang(`${c.title}. ${c.body}`) === want);
    if (hit) return hit;
  }
  return best;
}

const HEAD: Record<GroundingLang, (title: string, pack: string) => string> = {
  es: (t, pack) => `Guía «${t}» de ${pack}, tal como está escrita (sin modelo):`,
  en: (t, pack) => `${pack} guide “${t}”, exactly as written (no model):`,
  pt: (t, pack) => `Guia «${t}» do ${pack}, exatamente como está escrito (sem modelo):`,
};
/**
 * 2026-10-30 (prueba física): «Sintomas del monoxide of carbono?» trajo
 * la guía correcta, pero servida desde el primer apartado — los tóxicos
 * tragados — y no desde el de los síntomas preguntados. Cuando el
 * apartado que casó no es el primero, la cabecera lo dice con honestidad.
 */
const HEAD_ANCHORED: Record<GroundingLang, (title: string, pack: string) => string> = {
  es: (t, pack) => `Guía «${t}» de ${pack}, desde el apartado que responde a tu pregunta, tal como está escrita (sin modelo):`,
  en: (t, pack) => `${pack} guide “${t}”, from the section that answers your question, exactly as written (no model):`,
  pt: (t, pack) => `Guia «${t}» do ${pack}, a partir do trecho que responde à sua pergunta, exatamente como está escrito (sem modelo):`,
};
const HEAD_SHORT: Record<GroundingLang, (title: string, pack: string) => string> = {
  es: (t, pack) => `Versión corta de la guía «${t}» de ${pack}: su primera parte, tal como está escrita (sin modelo):`,
  en: (t, pack) => `Short version of the ${pack} guide “${t}”: its first part, exactly as written (no model):`,
  pt: (t, pack) => `Versão curta do guia «${t}» do ${pack}: a primeira parte, exatamente como está escrita (sem modelo):`,
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
 *
 * 2026-10-30: the parts start at the one retrieval matched (the part
 * packSource marks `used`), not always at the guide's first section —
 * asking for carbon-monoxide symptoms used to open the guide at its
 * swallowed-toxics section. From the matched part on, everything is
 * still verbatim and in order with the same cut rules; only the heading
 * changes, to say where the text starts. If the matched part is the
 * first (or none is marked), the answer is exactly what it was before.
 *
 * 2026-10-31 (D-1, decisión del dueño): anclar perdía la primera
 * sección de la guía, que es la que trae el marco y los avisos que
 * valen para la guía entera. La cura de la auditoría de arreglos,
 * adoptada por el dueño: al anclar, la primera sección viaja siempre
 * delante (cabecera anclada, primera sección, el apartado que casó y
 * lo que sigue, todo literal y en orden), y el apartado que casó
 * nunca es el que cae por el tope de longitud. Queda asentado para
 * la revisión línea a línea de Claude del martes 2026-11-03.
 */
export function composeGuideAnswer(doc: PackSourceDoc, lang: GroundingLang, opts: { short?: boolean; packId?: string; route?: LiteralRouteContext } = {}): string {
  if (opts.short) return composeShortGuideAnswer(doc, lang, opts.packId, opts.route);
  const pack = literalRoutePackName(opts.packId, lang, opts.route);
  const bodies = doc.parts
    .map((p) => ({ body: p.body.trim(), used: p.used }))
    .filter((x) => x.body.length > 0);
  const anchor = bodies.findIndex((x) => x.used);
  const shown = anchor > 0 ? [bodies[0], ...bodies.slice(anchor)] : bodies;
  const parts: string[] = [];
  let used = 0;
  let cut = false;
  // En modo anclado entran siempre las dos primeras piezas de
  // `shown` (la primera sección y el apartado que casó): el tope
  // solo corta desde la tercera.
  const mustShow = anchor > 0 ? Math.min(2, shown.length) : 1;
  for (const x of shown) {
    if (parts.length >= mustShow && used + x.body.length > GUIDE_MAX_CHARS) {
      cut = true;
      break;
    }
    parts.push(x.body);
    used += x.body.length;
  }
  const out = [anchor > 0 ? HEAD_ANCHORED[lang](doc.title, pack) : HEAD[lang](doc.title, pack), "", parts.join("\n\n")];
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
export function composeShortGuideAnswer(doc: PackSourceDoc, lang: GroundingLang, packId?: string, route?: LiteralRouteContext): string {
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
  const out = [HEAD_SHORT[lang](doc.title, literalRoutePackName(packId, lang, route)), "", parts.join("\n\n"), "", MORE_SHORT[lang]];
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
  // A heading is fixed text whichever literal-route pack it names: the
  // prefix up to the guide title, tried with every built-in pack's display
  // name — plus an imported-pack form: the pack's own (arbitrary) name sits
  // between the same fixed prefix and suffix, so a heading is recognized
  // structurally whenever it ends with a HEAD/HEAD_ANCHORED suffix.
  const packNames = Object.values(LITERAL_GUIDE_PACKS).flatMap((names) => Object.values(names));
  const headPrefixes = [HEAD, HEAD_ANCHORED, HEAD_SHORT].flatMap((table) =>
    Object.values(table).flatMap((h) => packNames.map((name) => h("\u0000", name).split("\u0000")[0])),
  );
  const headSuffixes = [HEAD, HEAD_ANCHORED, HEAD_SHORT].flatMap((table) =>
    Object.values(table).map((h) => h("\u0000", "pack").split("\u0000")[1] ?? ""),
  );
  const fixedLine = (p: string) =>
    headPrefixes.some((pre) => p.startsWith(pre)) ||
    headSuffixes.some((suf) => suf.length > 0 && p.endsWith(suf)) ||
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
