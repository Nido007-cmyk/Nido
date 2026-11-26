/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * 0.1.59 — Reads the guide for guideAnswer.ts: retrieval, the whole guide
 * from the pack, and the sources to show (only that guide's parts, so an
 * unrelated section never appears as source 1). Never throws.
 */
import { retrieve, activeRetrievalProfile } from "./retrieve";
import { knowledgePacks, readPackSource, resolvePackGuideByKey } from "./packs";
import { guideTitleOf, parsePackChunkId } from "./packSource";
import { ANSWER_CONTEXT_CHUNKS, buildLexicalQuery, countMatchedTerms, requiredTermMatches } from "./pure";
import { GUIDE_PICK_CHUNKS, buildGuidePickCandidates } from "./guidePickCandidates";
import type { RetrievedChunk } from "./retrieve.types";
import type { GroundingLang, GroundingResult } from "./grounding";
import type { SentenceProvenance } from "./provenance";
import { composeGuideAnswer, isLiteralGuideChunk, isLiteralGuidePack, pickGuideChunk, pickIsSignDenied, stripShortRequest, wantsShortGuide, type LiteralRouteContext } from "./guideAnswer";
import { verifiedImportedPacks } from "../services/packImporter";
import { isEmergencySituation } from "../routing/emergencyGate";

export interface GuideAnswer {
  text: string;
  /** Sources to show: the parts of the guide that matched. */
  chunks: RetrievedChunk[];
}

/**
 * La guía de una clave, servida tal cual, SIN pasar por la
 * elección (espejo §1, pieza A — H-LOOP-1/3): el botón de
 * Emergencia trae la clave de su tema (`esencial-rcp-adultos`, …)
 * y la guía de la pregunta es la que se sirve por construcción,
 * también en los estados donde la elección no puede elegir (la
 * pata semántica sin puntuar de la pasada en vivo: paso 0 del
 * espejo, medido — con cosenos el pick elige bien; sin ellos no
 * elige, y el turno caía a la ruta del modelo). La búsqueda se
 * limita a los packs de la ruta literal instalados, en su orden
 * de catálogo. Si la clave no resuelve en ninguno (pack ausente,
 * clave desconocida, guía ilegible), null: el turno sigue su
 * camino normal — degradación honesta, sin decir nada falso.
 * Nunca lanza.
 */
export async function answerFromGuideKey(guideKey: string, lang: GroundingLang): Promise<GuideAnswer | null> {
  try {
    const packs = await knowledgePacks().catch(() => []);
    for (const pack of packs) {
      if (!isLiteralGuidePack(pack.id)) continue;
      const hit = await resolvePackGuideByKey(pack.id, guideKey).catch(() => null);
      if (!hit) continue;
      const doc = await readPackSource(hit.chunkId);
      if (!doc) continue;
      const chunk: RetrievedChunk = {
        chunkId: hit.chunkId,
        docId: `pack:${pack.id}:${hit.chunk.title}`,
        title: hit.chunk.title,
        body: hit.chunk.body,
        source: hit.chunk.source,
        score: 1,
        matchType: "lexical",
        sourceKind: "pack",
      };
      return {
        text: composeGuideAnswer(doc, lang, { short: false, packId: pack.id }),
        chunks: [chunk],
      };
    }
    return null;
  } catch (e) {
    console.warn("[guideAnswerKey]", e instanceof Error ? e.message : String(e));
    return null;
  }
}

/**
 * Retrieves once. Returns the guide answer when a NIDO Essentials guide is
 * the clear best match, else null plus the retrieved chunks so the normal
 * path can reuse them instead of searching again.
 *
 * `retrievalQuery` (R-03) is the conversation-contextualized form of
 * `query` built by the caller (contextualizeQuery in pure.ts): retrieval
 * runs with it, while guide picking and the short-guide rewrite keep
 * working on the question as asked.
 */
export async function answerFromGuide(
  query: string,
  lang: GroundingLang,
  retrievalQuery?: string,
): Promise<{ answer: GuideAnswer | null; retrieved: RetrievedChunk[] | null }> {
  let retrieved: RetrievedChunk[] | null = null;
  try {
    // 0.1.60: «resúmeme la guía de RCP» busca por «la guía de RCP».
    const short = wantsShortGuide(query);
    retrieved = await retrieve(short ? stripShortRequest(query) : (retrievalQuery ?? query), ANSWER_CONTEXT_CHUNKS);
    // 0.1.86: packs the signed door imported and verified also travel the
    // literal route (their text passed the door's signature check, the same
    // trust bar as the built-in list). Read fresh each turn: the registry
    // is the only origin mark, and a pack removed since the last turn must
    // stop being literal at once. An unreadable registry degrades to the
    // built-in list only — never to opening the route.
    const imported = await verifiedImportedPacks().catch(() => null);
    const route: LiteralRouteContext | undefined = imported && imported.size > 0
      ? {
          importedVerifiedPackIds: new Set(imported.keys()),
          importedPackNames: new Map([...imported].map(([id, v]) => [id, v.name])),
        }
      : undefined;
    // 0.1.87: la elección juzga con la vara del perfil que puntuó de
    // verdad (retrieve la deja leída) y sobre la pregunta tal cual.
    const pickOpts = { profile: activeRetrievalProfile(), query };
    let candidates = retrieved;
    let pick = pickGuideChunk(candidates, lang, route, pickOpts);
    if (pick && pickIsSignDenied(candidates, pick, query)) {
      // 0.1.89: la primera lista puede traer solo a la vecina que
      // niega el signo de la pregunta (la guía del monóxido, que
      // declara que su gas no se huele, a quien SÍ huele gas): esa
      // guía no se sirve sola sin mirar la lista ancha, donde la
      // guía del signo puede estar esperando su turno de elección.
      // Si al ensanchar no aparece rival, se sirve la misma.
      const wide = await retrieve(short ? stripShortRequest(query) : (retrievalQuery ?? query), GUIDE_PICK_CHUNKS).catch(() => null);
      if (wide && wide.length > 0) {
        candidates = buildGuidePickCandidates(candidates, wide);
        pick = pickGuideChunk(candidates, lang, route, pickOpts) ?? pick;
      }
    }
    if (!pick) {
      // La elección mira más ancho que el contexto del prompt: una
      // segunda recuperación con el topK de elección, solo para
      // elegir. El `retrieved` devuelto no cambia: la ruta del
      // modelo sigue reutilizando la lista de 4 de siempre.
      const wide = await retrieve(short ? stripShortRequest(query) : (retrievalQuery ?? query), GUIDE_PICK_CHUNKS).catch(() => null);
      if (wide && wide.length > retrieved.length) {
        candidates = buildGuidePickCandidates(retrieved, wide);
        pick = pickGuideChunk(candidates, lang, route, pickOpts);
      }
    }
    // 0.1.106 (carril atragantamiento-01106): la elección sobre la
    // pregunta tal cual, calculada como mucho una vez y solo cuando
    // hubo arrastre. Es la MISMA elección que el bloque de la
    // 0.1.105 de abajo usa para mandar sobre el ancla; aquí se
    // comparte porque también es el rescate cuando el flujo
    // arrastrado no eligió nada (ver el `if (!pick)` siguiente).
    const askedQuery = short ? stripShortRequest(query) : query;
    const searchedQuery = short ? askedQuery : (retrievalQuery ?? query);
    let askedTried = false;
    let askedResult: { pick: RetrievedChunk; candidates: RetrievedChunk[] } | null = null;
    const electOnAsked = async (): Promise<{ pick: RetrievedChunk; candidates: RetrievedChunk[] } | null> => {
      if (askedTried) return askedResult;
      askedTried = true;
      if (searchedQuery === askedQuery) return null;
      const rawWide = await retrieve(askedQuery, GUIDE_PICK_CHUNKS).catch(() => null);
      if (!rawWide || rawWide.length === 0) return null;
      const rawPick = pickGuideChunk(rawWide, lang, route, pickOpts);
      if (!rawPick || pickIsSignDenied(rawWide, rawPick, query)) return null;
      askedResult = { pick: rawPick, candidates: rawWide };
      return askedResult;
    };
    if (!pick) {
      // 0.1.106 (foto del dueño, 07:39): el hueco que dejaba caer el
      // turno al texto seguro. El bloque de la 0.1.105 solo corre
      // con un pick arrastrado en la mano; con el pick en null este
      // return salía ANTES de elegir sobre la pregunta tal cual. Y
      // el pick puede ser null con la guía correcta empatada arriba:
      // un fragmento no literal como mejor global veta a todas las
      // integradas (la regla sellada de pickGuideChunk) y la vía
      // léxica de reserva las excluye por diseño. Si la pregunta tal
      // cual SÍ elige con claridad (su lista no trae el veto), se
      // sirve su guía; si tampoco elige, null como siempre: el suelo
      // no baja jamás.
      const rescued = await electOnAsked();
      if (!rescued) return { answer: null, retrieved };
      pick = rescued.pick;
      candidates = rescued.candidates;
    }
    // 0.1.105 (carril atragantamiento-01105, foto del dueño en su
    // Tab A9+ a las 05:31): la elección de la pregunta manda sobre
    // la del arrastre. La elección de arriba juzga sobre la lista
    // que trajo la búsqueda, y la búsqueda corre con la pregunta
    // contextualizada de R-03: una pregunta fina (la del
    // atragantamiento tiene 2 términos de contenido) hereda la
    // pregunta anterior como ancla, y tras un bloque de RCP la guía
    // coronada fue la del ANCLA, servida tal cual («sin modelo»)
    // sin que ninguna puerta mirara la pregunta que el usuario
    // hizo. Cuando la pregunta buscada difiere de la hecha, se
    // elige TAMBIÉN sobre la pregunta tal cual, con su propia
    // búsqueda (sus puntuaciones son de su escala: no se mezclan
    // con las de la lista arrastrada), y si esa elección clara es
    // OTRA guía, es la que se sirve: la misma pregunta no puede
    // cambiar de guía por el tema anterior. Si la pregunta tal cual
    // no elige guía (el caso legítimo de R-03: la continuación
    // elíptica que solo se entiende con el ancla), se sirve la
    // elección arrastrada como siempre. Sin arrastre no hay
    // segunda búsqueda ni cambio alguno. R-03/H-08 no se tocan: lo
    // que se acota es el efecto del arrastre sobre la única vía
    // que servía sin juez.
    if (searchedQuery !== askedQuery) {
      const raw = await electOnAsked();
      if (raw) {
        const otherGuide =
          (parsePackChunkId(raw.pick.chunkId)?.packId ?? "") !== (parsePackChunkId(pick.chunkId)?.packId ?? "") ||
          guideTitleOf(raw.pick.title) !== guideTitleOf(pick.title);
        if (otherGuide) {
          pick = raw.pick;
          candidates = raw.candidates;
        }
      }
    }
    // Tanda de precedencia de la guía (pieza 1): bajo una
    // emergencia DECLARADA por la puerta sobre la pregunta tal
    // cual, si la elección por IDENTIDAD (la misma que la
    // puerta de coherencia juzga, electGuideByIdentity) corona
    // a OTRA guía distinta de la que el coseno eligió, se
    // sirve la coronada: la identidad trae la señal de tema
    // que el coseno no trae. La foto del dueño (0.1.114 y
    // 0.1.115): «Mi hijo se esta ahogando con un pedazo de
    // comida» sirvió la guía de fiebre de NIDO Niños al 86 % —
    // la capa B no la excluye porque la pregunta nombra a un
    // niño, y la guía de atragantamiento SÍ estaba entre las
    // candidatas, fuera de la banda del coseno.
    //
    // La pieza NO veta: si la identidad no corona a ninguna
    // guía, la vía sigue exactamente como siempre. La vara
    // léxica no puede arbitrar las preguntas finas de la
    // morfología española («Que hago si un niño se esta
    // atragantando» cubre 0 de sus 2 términos por palabras
    // contra las guías reales), y esas preguntas ya tienen su
    // maquinaria gobernada — la elección limpia sobre la
    // pregunta tal cual y el rescate de la 0.1.106, con sus
    // baterías (cascara01105, secuencia01106) — que un veto
    // aquí rompía: medido en la CI de esta tanda (6 casos).
    // Sin emergencia declarada, este bloque no corre.
    if (isEmergencySituation(query)) {
      const elected = electGuideByIdentity(candidates, query, route);
      if (elected) {
        const pickGuideKey = `${parsePackChunkId(pick.chunkId)?.packId ?? ""}|${guideTitleOf(pick.title)}`;
        if (`${elected.packId}|${elected.title}` !== pickGuideKey) {
          pick = elected.best;
        }
      }
    }
    const doc = await readPackSource(pick.chunkId);
    if (!doc) return { answer: null, retrieved };
    const sameGuide = candidates.filter((c) => c !== pick && guideTitleOf(c.title) === doc.title);
    return {
      answer: { text: composeGuideAnswer(doc, lang, { short, packId: parsePackChunkId(pick.chunkId)?.packId, route }), chunks: [pick, ...sameGuide] },
      retrieved,
    };
  } catch (e) {
    console.warn("[guideAnswer]", e instanceof Error ? e.message : String(e));
    return { answer: null, retrieved };
  }
}

interface GuideIdentityGroup {
  packId: string;
  title: string;
  chunks: RetrievedChunk[];
  identity: number;
  chunkCoverage: number;
  best: RetrievedChunk;
}

/**
 * Elección de una guía por su IDENTIDAD (título + claves v2,
 * cobertura de términos): la corona la única guía cuyo título
 * o claves cubren los términos de la pregunta por encima del
 * mínimo exigido (la mitad de los términos, mínimo 2), con
 * desempate por cobertura de fragmento y SIN corona en un
 * empate exacto en identidad y cobertura. Nació para la
 * puerta de coherencia (coherenceSubstitute) y la comparten
 * dos juicios: ella, sobre la guía ya entregada, y la pieza 1
 * de la tanda de precedencia (2026-11-25), que la corre ANTES
 * de servir bajo una emergencia declarada: un solo criterio
 * de «cuál es la guía de esta pregunta» para las dos puertas,
 * para que no puedan divergir.
 */
function electGuideByIdentity(
  candidates: RetrievedChunk[],
  query: string,
  route?: LiteralRouteContext,
): GuideIdentityGroup | null {
  const lexical = buildLexicalQuery(query);
  if (!lexical || lexical.terms.length === 0) return null;
  const required = requiredTermMatches(lexical.terms.length);
  const groups = new Map<string, GuideIdentityGroup>();
  for (const c of candidates) {
    if (!isLiteralGuideChunk(c.chunkId, route)) continue;
    const parsed = parsePackChunkId(c.chunkId);
    if (!parsed) continue;
    const title = guideTitleOf(c.title);
    const key = `${parsed.packId}|${title}`;
    let g = groups.get(key);
    if (!g) {
      g = { packId: parsed.packId, title, chunks: [], identity: 0, chunkCoverage: 0, best: c };
      groups.set(key, g);
    }
    g.chunks.push(c);
    const cov = countMatchedTerms(c.keys ? `${c.title} ${c.body} ${c.keys}` : `${c.title} ${c.body}`, lexical.terms);
    if (cov > g.chunkCoverage) {
      g.chunkCoverage = cov;
      g.best = c;
    }
  }
  if (groups.size === 0) return null;
  for (const g of groups.values()) {
    const identityText = `${g.title} ${g.chunks.map((c) => c.keys ?? "").join(" ")}`;
    g.identity = countMatchedTerms(identityText, lexical.terms);
  }
  const ranked = [...groups.values()].sort((a, b) => b.identity - a.identity || b.chunkCoverage - a.chunkCoverage);
  const winner = ranked[0];
  if (!winner || winner.identity < required) return null;
  const runnerUp = ranked[1];
  if (runnerUp && runnerUp.identity === winner.identity && runnerUp.chunkCoverage === winner.chunkCoverage) return null;
  return winner;
}

/**
 * La puerta de coherencia de guía (espejo §1, pieza B —
 * H-LOOP-1/3, la forma verificada de PC trasplantada tal cual).
 *
 * La elección no eligió (sin pata semántica no puede) y el modelo
 * compuso su respuesta DESDE LA GUÍA VECINA: cada frase descansa
 * en una fuente de verdad, pero en la guía equivocada, y el juez
 * la deja pasar porque su vara es el respaldo, no la pertinencia
 * (la pasada en vivo: la aspirina del dolor de pecho servida para
 * la pregunta de RCP; la nariz para la del sangrado). Esta puerta
 * corre tras el juez, sobre su procedencia, y solo cuando el
 * texto servido es exactamente la composición que el juez dejó
 * («grounded» o «partial»):
 *
 * - La pregunta tiene guía ganadora por su IDENTIDAD: el título
 *   de la guía más las preguntas que sus claves v2 declaran
 *   responder, con la cobertura de pure.ts sobre la lista ancha
 *   de candidatas (la cobertura por fragmento de la elección
 *   empata en este clúster — el título de la vecina ES la palabra
 *   de la pregunta — y el rango prefiere a la vecina: medido en
 *   la apertura de la pieza). Máximo único estricto sobre el
 *   umbral de requiredTermMatches, con la cobertura por
 *   fragmento como desempate; empate final = sin ganadora clara.
 * - TODAS las frases que el juez dejó con origen «source»
 *   descansan en fragmentos de guía literal (integrada o
 *   importada verificada), y ninguna en la ganadora.
 *
 * Cumplido eso, se sirve la ganadora tal cual, con la composición
 * del paso 6 y sus propios fragmentos como fuentes. En cualquier
 * otro caso devuelve null y el turno sirve lo que el modelo y el
 * juez dejaron. Nunca lanza, como answerFromGuide.
 */
export async function coherenceSubstitute(input: {
  query: string;
  lang: GroundingLang;
  sources: readonly RetrievedChunk[];
  sentences: readonly SentenceProvenance[];
  status: GroundingResult["status"];
}): Promise<GuideAnswer | null> {
  try {
    if (input.status !== "grounded" && input.status !== "partial") return null;
    // Las frases con respaldo y el fragmento que cada una cita
    // (la misma indexación de shouldSubstituteSafeText: [n] es
    // sources[n-1]).
    const cited: RetrievedChunk[] = [];
    for (const s of input.sentences) {
      if (s.origin.kind !== "source") continue;
      const c = input.sources[s.origin.n - 1];
      if (c) cited.push(c);
    }
    if (cited.length === 0) return null;

    const imported = await verifiedImportedPacks().catch(() => null);
    const route: LiteralRouteContext | undefined = imported && imported.size > 0
      ? {
          importedVerifiedPackIds: new Set(imported.keys()),
          importedPackNames: new Map([...imported].map(([id, v]) => [id, v.name])),
        }
      : undefined;
    // La puerta solo gobierna composiciones hechas enteras de
    // guías literales: una sola frase apoyada fuera de ellas y
    // la respuesta ya no es «la vecina servida como la pedida».
    if (!cited.every((c) => isLiteralGuideChunk(c.chunkId, route))) return null;

    const lexical = buildLexicalQuery(input.query);
    if (!lexical || lexical.terms.length === 0) return null;

    // Las candidatas de la ganadora: las fuentes del turno más la
    // lista ancha de la elección (la guía pedida puede no estar
    // entre las citadas: en la pasada ni siquiera fue citada).
    const wide = await retrieve(input.query, GUIDE_PICK_CHUNKS).catch(() => null);
    const candidates = buildGuidePickCandidates([...input.sources], wide ?? []);
    const winner = electGuideByIdentity(candidates, input.query, route);
    if (!winner) return null;

    const guideKeyOf = (c: RetrievedChunk): string => `${parsePackChunkId(c.chunkId)?.packId ?? ""}|${guideTitleOf(c.title)}`;
    if (cited.some((c) => guideKeyOf(c) === `${winner.packId}|${winner.title}`)) return null;

    const doc = await readPackSource(winner.best.chunkId);
    if (!doc) return null;
    return {
      text: composeGuideAnswer(doc, input.lang, { packId: winner.packId, route }),
      chunks: winner.chunks,
    };
  } catch (e) {
    console.warn("[guideAnswer]", e instanceof Error ? e.message : String(e));
    return null;
  }
}
