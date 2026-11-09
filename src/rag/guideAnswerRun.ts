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
import { readPackSource } from "./packs";
import { guideTitleOf, parsePackChunkId } from "./packSource";
import { ANSWER_CONTEXT_CHUNKS } from "./pure";
import { GUIDE_PICK_CHUNKS, buildGuidePickCandidates } from "./guidePickCandidates";
import type { RetrievedChunk } from "./retrieve.types";
import type { GroundingLang } from "./grounding";
import { composeGuideAnswer, pickGuideChunk, stripShortRequest, wantsShortGuide, type LiteralRouteContext } from "./guideAnswer";
import { verifiedImportedPacks } from "../services/packImporter";

export interface GuideAnswer {
  text: string;
  /** Sources to show: the parts of the guide that matched. */
  chunks: RetrievedChunk[];
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
    if (!pick) return { answer: null, retrieved };
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
