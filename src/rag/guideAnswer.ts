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
import { guideTitleOf, parsePackChunkId, type PackSourceDoc } from "./packSource";
import { detectTextLang, splitSentences, type GroundingLang } from "./grounding";
import type { SentenceProvenance } from "./provenance";
import { BGE_SMALL_EN_PROFILE, guideMinScore, type EmbeddingProfile } from "./embeddingProfile";
import { buildLexicalQuery, countMatchedTerms, requiredTermMatches } from "./pure";

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
 * Minimum semantic match (cosine) for a BUILT-IN guide to be the
 * answer. On the tablet the right guide matched at 0.87–0.89; a
 * lexical-only hit has no cosine and never qualifies on its own (the
 * wrong chest-pain section was a lexical-only hit).
 *
 * 0.1.87: this bar is now only the built-in packs' bar. A guide from
 * a pack the signed door imported and verified is judged against
 * the ACTIVE EMBEDDING PROFILE's own bar (embeddingProfile.ts:
 * guideMinScore / guideMinScoreSingleTerm, transmitted from that
 * profile's measured pack floors): the 0.1.86 turn proved the
 * inherited 0.8 was calibrated on a different corpus — the imported
 * guide competed inside its own pack's cluster and against the
 * Essentials field and lost on a bar nobody had measured for it.
 */
export const GUIDE_MIN_SCORE = 0.8;

/**
 * 0.1.87: what a guide pick is judged against. `profile` is the
 * embedding profile retrieval actually ran with (embeddingProfile.ts);
 * `query` is the question as asked — the bar keeps the profile's
 * single-term discipline.
 */
export interface GuidePickOptions {
  profile?: EmbeddingProfile;
  query?: string;
}

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

/**
 * 0.1.87 (pieza 4): la vía literal SIN coseno. Cuando los vectores
 * de un pack importado verificado no casan con el modelo de
 * embeddings activo (vectorsMatch en packs.ts), sus fragmentos
 * llegan solo por la vía léxica y NUNCA traen rawScore: la elección
 * semántica los descartaba en silencio y la guía no se servía
 * aunque la pregunta fuera la suya. La elegibilidad la decide la
 * MISMA puerta de cobertura que la búsqueda aplica a los packs
 * (buildLexicalQuery + requiredTermMatches, con las `keys` de
 * formato v2 contando como texto): el fragmento literal sin coseno
 * sirve solo si cubre los términos exigidos de la pregunta.
 *
 * 0.1.88 (dirimen del turno del gas en la 0.1.87, medido con las
 * funciones reales y el pack real del dueño): el límite que la
 * pieza 4 declaró, que la vía solo abriera cuando NINGÚN fragmento
 * de la lista trajera coseno, es el turno que nunca ocurre: con la
 * búsqueda multilingüe activa, el Esencial y la base integrada
 * puntúan con coseno en la misma lista, y un solo coseno ajeno
 * cerraba la vía entera (la foto del dueño: la guía no salió ni una
 * vez, con el aviso de «solo búsqueda por palabras» ya pintado en
 * la tarjeta del pack). El desajuste de vectores no es global al
 * turno: es por pack. La vía juzga ahora a SUS fragmentos, los
 * literales de packs importados verificados que llegan sin coseno,
 * haya o no cosenos ajenos en la lista; y pickGuideChunk la recorre
 * también cuando la elección por coseno no eligió nada, salvo que
 * un literal CON coseno haya competido y perdido su vara (ahí la
 * pregunta sí casó con otra cosa dentro de la misma clase de
 * confianza, y no se cae a palabras).
 *
 * La elección dentro de la vía es por GUÍA, no por fragmento
 * suelto (segunda causa del mismo dirimen, también medida: la
 * cobertura por fragmento empata entre guías hermanas del mismo
 * pack, monóxido y fuga de gas a 3 de 3, y el orden de la lista
 * servía la guía que no era): la cobertura de una guía es la mejor
 * de sus fragmentos, y los empates se rompen con el rango de la
 * fusión (el `score` del mejor fragmento de cada guía, que dentro
 * de un pack es el rango de su propia búsqueda) antes que con el
 * orden de la lista. Dentro de la guía ganadora manda su fragmento
 * de mayor cobertura, con el mismo desempate, y la preferencia de
 * idioma corre entre ellos como siempre.
 *
 * 0.1.89 — entre la cobertura y el rango entra el SIGNO
 * PERCEPTIBLE (dirimen del empate de la 0.1.88, research_notes/
 * nido-gas-0.1.88-dirimen-2026-11-09.md, medido sobre el sqlite
 * real del dueño): el BM25 real del pack pone el fragmento del
 * monóxido primero de todo el clúster (bm25 −10,6672) con la
 * misma cobertura 3 de 3 que el de la fuga (−9,3133), así que el
 * desempate por rango servía la guía del monóxido a quien huele
 * gas, y la regresión de laboratorio no lo vio porque sus scores
 * iban puestos a mano al revés. La señal que los distingue está
 * en los textos, sin nombres de guía ni de pack: si la pregunta
 * afirma un sentido (huele, ve, oye) y una guía candidata
 * declara en su propio texto que su peligro no se percibe por
 * ese sentido («sin olor», «no se puede ver ni oler»,
 * «odorless», «sem cheiro»), esa guía pierde el empate contra
 * cualquier guía de igual cobertura que no lo declare: la
 * propia guía del monóxido dice que su gas no se huele, y si el
 * usuario huele algo, esa guía misma declara que no es la suya.
 */
function pickLexicalGuideChunk(
  chunks: RetrievedChunk[],
  lang: GroundingLang,
  route: LiteralRouteContext | undefined,
  query: string,
): RetrievedChunk | null {
  const lexical = buildLexicalQuery(query);
  if (!lexical || lexical.terms.length === 0) return null;
  const required = requiredTermMatches(lexical.terms.length);
  const coverageOf = (c: RetrievedChunk) =>
    countMatchedTerms(c.keys ? `${c.title} ${c.body} ${c.keys}` : `${c.title} ${c.body}`, lexical.terms);
  const covering = chunks.filter(
    (c) =>
      typeof c.rawScore !== "number" &&
      isLiteralGuideChunk(c.chunkId, route) &&
      !isEssentialsChunk(c.chunkId) &&
      !isClosingSection(c) &&
      coverageOf(c) >= required,
  );
  if (covering.length === 0) return null;
  // Por guía: su cobertura es la de su mejor fragmento y su rango
  // el `score` de ese fragmento (la fusión lo dejó ordenado dentro
  // de su propio corpus). Gana la guía de mayor cobertura; a igual
  // cobertura, la capa del signo (0.1.89): pierde la guía que niega
  // el sentido que la pregunta afirma; a igual todo lo demás, la
  // de mayor rango; a igual todo, el orden de la lista.
  const senses = questionPerceptionSenses(query);
  interface GuideBid { best: RetrievedChunk; coverage: number; rank: number; chunks: RetrievedChunk[] }
  const bids = new Map<string, GuideBid>();
  for (const c of covering) {
    const key = `${parsePackChunkId(c.chunkId)?.packId ?? ""}|${guideTitleOf(c.title)}`;
    const bid = bids.get(key);
    if (!bid) {
      bids.set(key, { best: c, coverage: coverageOf(c), rank: c.score, chunks: [c] });
      continue;
    }
    bid.chunks.push(c);
    if (coverageOf(c) > bid.coverage || (coverageOf(c) === bid.coverage && c.score > bid.rank)) {
      bid.best = c;
      bid.coverage = coverageOf(c);
      bid.rank = c.score;
    }
  }
  const deniesSign = (bid: GuideBid): boolean =>
    senses.size > 0 && bid.chunks.some((c) => [...senses].some((s) => textDeniesSense(chunkSenseText(c), s)));
  const winner = [...bids.values()].reduce((a, b) => {
    if (b.coverage !== a.coverage) return b.coverage > a.coverage ? b : a;
    const aDenied = deniesSign(a);
    const bDenied = deniesSign(b);
    if (aDenied !== bDenied) return bDenied ? a : b;
    return b.rank > a.rank ? b : a;
  });
  const winnerPackId = parsePackChunkId(winner.best.chunkId)?.packId ?? "";
  const winnerGuide = guideTitleOf(winner.best.title);
  const guideChunks = covering.filter(
    (c) =>
      coverageOf(c) >= winner.coverage &&
      guideTitleOf(c.title) === winnerGuide &&
      (parsePackChunkId(c.chunkId)?.packId ?? "") === winnerPackId,
  );
  const best = guideChunks.reduce((a, b) => (b.score > a.score ? b : a));
  const close = guideChunks.filter((c) => c === best || coverageOf(c) >= coverageOf(best));
  const prefs: GroundingLang[] = lang === "pt" ? ["pt", "es"] : [lang];
  for (const want of prefs) {
    const hit = close.find((c) => detectTextLang(`${c.title}. ${c.body}`) === want);
    if (hit) return hit;
  }
  return best;
}

/**
 * 0.1.89 — el signo perceptible: los sentidos que una pregunta
 * afirma y la negación de esos sentidos en el texto de una guía.
 * Listas cerradas en los tres idiomas, con el mismo precedente
 * que EMERGENCY_SIGNS o ABSENT_DATUM_TYPE_FORMS: cada forma está
 * porque un texto real de guía o una pregunta real la trae, y el
 * emparejamiento va sobre el texto plegado (sin acentos, en
 * minúsculas) para que la forma no dependa de la ortografía.
 */
export type PerceptionSense = "smell" | "sight" | "hearing";

const PERCEPTION_STEMS: Record<PerceptionSense, readonly string[]> = {
  smell: ["huel", "olor", "olfat", "smell", "cheir", "odor"],
  sight: ["veo", "viendo", "sees", "seeing", "seen", "vejo", "olho"],
  hearing: ["suena", "sonid", "silb", "escuch", "oigo", "hears", "heard", "hearing", "ouv", "escut"],
};

const PERCEPTION_DENIALS: Record<PerceptionSense, readonly string[]> = {
  smell: [
    "sin olor", "no tiene olor", "no huele", "no se huele", "no se puede oler",
    "no se puede ver ni oler", "no puedes oler", "no puede olerse", "inodoro", "inodora",
    "odorless", "cannot be smelled", "can not be smelled", "can't be smelled", "has no smell", "no smell",
    "sem cheiro", "nao tem cheiro", "nao se pode cheirar", "sem odor",
  ],
  sight: [
    "no se puede ver", "no puedes ver", "no puede verse", "invisible", "invisivel",
    "cannot be seen", "can't be seen", "nao se pode ver",
  ],
  hearing: [
    "no se oye", "no se escucha", "no hace ruido", "no hace ningun ruido", "silencioso", "silenciosa",
    "silent", "makes no sound", "makes no noise", "nao faz barulho", "nao se ouve", "sem ruido",
  ],
};

function foldForSense(text: string): string {
  return text.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/** Los sentidos que la pregunta afirma («huele a gas», «I smell gas», «sinto cheiro»). */
export function questionPerceptionSenses(query: string): ReadonlySet<PerceptionSense> {
  const tokens = foldForSense(query).split(/[^a-z0-9]+/).filter(Boolean);
  const found = new Set<PerceptionSense>();
  (Object.keys(PERCEPTION_STEMS) as PerceptionSense[]).forEach((sense) => {
    if (tokens.some((tok) => PERCEPTION_STEMS[sense].some((stem) => tok.startsWith(stem)))) found.add(sense);
  });
  return found;
}

/** Si el texto declara que su peligro no se percibe por ese sentido. */
export function textDeniesSense(text: string, sense: PerceptionSense): boolean {
  const folded = foldForSense(text);
  return PERCEPTION_DENIALS[sense].some((pattern) => folded.includes(pattern));
}

function chunkSenseText(c: RetrievedChunk): string {
  return c.keys ? `${c.title} ${c.body} ${c.keys}` : `${c.title} ${c.body}`;
}

/**
 * 0.1.89 — si la guía de un fragmento ya elegido declara, en los
 * fragmentos suyos que la lista trae, que su peligro no se
 * percibe por un sentido que la pregunta afirma. La corrida
 * (guideAnswerRun) lo usa para no servir esa guía desde la
 * primera lista corta sin mirar la ancha: la primera lista puede
 * traer solo a la vecina que niega el signo, y la guía del signo
 * solo aparece al ensanchar.
 */
export function pickIsSignDenied(candidates: RetrievedChunk[], pick: RetrievedChunk, query: string): boolean {
  const senses = questionPerceptionSenses(query);
  if (senses.size === 0) return false;
  const packId = parsePackChunkId(pick.chunkId)?.packId ?? "";
  const guide = guideTitleOf(pick.title);
  return candidates
    .filter((c) => (parsePackChunkId(c.chunkId)?.packId ?? "") === packId && guideTitleOf(c.title) === guide)
    .some((c) => [...senses].some((s) => textDeniesSense(chunkSenseText(c), s)));
}

export function pickGuideChunk(
  chunks: RetrievedChunk[],
  lang: GroundingLang,
  route?: LiteralRouteContext,
  opts?: GuidePickOptions,
): RetrievedChunk | null {
  const profile = opts?.profile ?? BGE_SMALL_EN_PROFILE;
  const scored = chunks.filter(
    (c) =>
      typeof c.rawScore === "number" &&
      !(isLiteralGuideChunk(c.chunkId, route) && isClosingSection(c)) &&
      !isOtherNidoGuideIntro(c, route),
  );
  if (scored.length === 0) return pickLexicalGuideChunk(chunks, lang, route, opts?.query ?? "");
  const globalBest = Math.max(...scored.map((c) => c.rawScore as number));
  // 0.1.87 (dirimen del turno del gas): la guía IMPORTADA se juzga
  // contra su vara, no contra la exigencia de ser la mejor global.
  // Hasta la 0.1.86 el fragmento literal tenía que ser a la vez el
  // mejor coseno de toda la lista y valer 0,8: la guía de un pack
  // importado competía contra la base integrada y contra el campo
  // del Esencial en escalas que no son la suya, y un mejor global
  // ajeno la vetaba en silencio. Lo que cambia es solo la clase que
  // el dirimen midió rota: los packs INTEGRADOS conservan su regla
  // sellada (ser el mejor y valer GUIDE_MIN_SCORE — su campo es el
  // que se calibró en la tableta), y la importada verificada se mide
  // contra la vara del perfil activo, con el veto del margen
  // declarado del perfil: un literal muy por debajo del mejor global
  // sigue sin servirse, porque esa distancia sí declara que la
  // pregunta casa con otra cosa. Si un integrado pasa su regla, gana
  // como hasta ahora: la cercanía en su propia escala sigue
  // decidiendo entre clases, y la preferencia de idioma corre sobre
  // los cercanos del ganador, como siempre.
  const globalBestChunk = scored.reduce((a, b) => ((b.rawScore as number) > (a.rawScore as number) ? b : a));
  const eligible = scored.filter((c) => {
    if (!isLiteralGuideChunk(c.chunkId, route)) return false;
    if (isEssentialsChunk(c.chunkId)) {
      // Regla sellada de los integrados: el candidato ES el mejor
      // global con su vara, o está en la banda de cercanía histórica
      // (0,03, la de la preferencia de idioma) del mejor cuando el
      // mejor también es literal. Fuera de eso, no compite.
      if ((c.rawScore as number) < GUIDE_MIN_SCORE) return false;
      if (c === globalBestChunk) return true;
      return isLiteralGuideChunk(globalBestChunk.chunkId, route) && globalBest - (c.rawScore as number) <= 0.03;
    }
    return (c.rawScore as number) >= guideMinScore(profile, opts?.query ?? "") && globalBest - (c.rawScore as number) <= profile.guidePickMargin;
  });
  if (eligible.length === 0) {
    // 0.1.88: la elección por coseno no eligió. Si un literal de un
    // pack IMPORTADO traía coseno y perdió su vara, la pregunta
    // casó con otra cosa en la escala de ese pack: no se cae a
    // palabras. Los integrados no bloquean: su regla sellada puede
    // no elegir porque el mejor global es ajeno o porque su coseno
    // quedó bajo la vara calibrada en otra época, y ninguno de los
    // dos casos dice nada del pack importado, cuya escala no es la
    // semántica de este turno (dirimen: el Esencial e5 bajo la vara
    // o vetado por un ajeno cerraba también la vía del pack).
    if (scored.some((c) => isLiteralGuideChunk(c.chunkId, route) && !isEssentialsChunk(c.chunkId))) return null;
    return pickLexicalGuideChunk(chunks, lang, route, opts?.query ?? "");
  }
  const best = eligible.reduce((a, b) => ((b.rawScore as number) > (a.rawScore as number) ? b : a));
  const close = eligible.filter((c) => (best.rawScore as number) - (c.rawScore as number) <= 0.03);
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
