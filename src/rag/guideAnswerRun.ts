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
import { ANSWER_CONTEXT_CHUNKS } from "./pure";
import { GUIDE_PICK_CHUNKS, buildGuidePickCandidates } from "./guidePickCandidates";
import type { RetrievedChunk } from "./retrieve.types";
import type { GroundingLang } from "./grounding";
import { composeGuideAnswer, isLiteralGuidePack, pickGuideChunk, pickIsSignDenied, stripShortRequest, wantsShortGuide, type LiteralRouteContext } from "./guideAnswer";
import { verifiedImportedPacks } from "../services/packImporter";

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
