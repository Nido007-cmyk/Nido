/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Knowledge packs: SQLite files built on a computer by
 * scripts/build-knowledge-pack.mjs (docs/KNOWLEDGE_PACKS.md), each with its
 * own FTS5 index and int8 embeddings made with the app's embedding model.
 * They're opened read-only and searched alongside the built-in knowledge base.
 *
 * Search is keyword-first: FTS5 picks up to PACK_CANDIDATES chunks, and only
 * those are compared with the question's embedding. Scanning every embedding
 * of a large pack on each question would take seconds on the phone's JS engine.
 */
import * as SQLite from "expo-sqlite";
import * as FileSystem from "expo-file-system/legacy";
import { CORPUS_CATALOG, MODEL_CATALOG, CatalogModel } from "../models/manifest";
import { buildLexicalQuery, cosineSimilarityInt8, filterByMinScore, filterByTermCoverage, MIN_SEMANTIC_SIMILARITY, MIN_SEMANTIC_SIMILARITY_SINGLE_TERM, pruneSemanticByMargin, pruneVectorHits } from "./pure";
import type { RetrievedChunk } from "./retrieve.types";
import { BGE_SMALL_EN_PROFILE, packSemanticFloor, type EmbeddingProfile } from "./embeddingProfile";
import { packIndexIfReady, releaseAllIndexes, searchPackIndex } from "./vectorIndex";

const PACK_CANDIDATES = 400;
const REQUIRED_EMBEDDING_SHA256 = MODEL_CATALOG.find((m) => m.kind === "embedding" && m.required)!.sha256;

interface OpenPack {
  db: SQLite.SQLiteDatabase;
  /** Embedding model the pack's vectors were made with (meta.embeddingModelSha256). */
  modelSha256: string;
  sizeBytes: number;
}

const openPacks = new Map<string, OpenPack>();

const CORPUS_DIR = "corpus/";

/**
 * Catalog packs, plus any other pack file in corpus/ (e.g. one built with
 * scripts/build-knowledge-pack.mjs and copied over with npm run pack:push).
 * Those have no catalog size to check, only the format and model checks in openPack.
 */
export async function knowledgePacks(): Promise<CatalogModel[]> {
  const catalog = CORPUS_CATALOG.filter((m) => m.format === "sqlite-pack");
  const names = await FileSystem.readDirectoryAsync(`${FileSystem.documentDirectory}${CORPUS_DIR}`).catch(() => [] as string[]);
  const extra = names
    .filter((n) => n.endsWith(".sqlite") && !catalog.some((c) => c.filename === `${CORPUS_DIR}${n}`))
    .map(
      (n): CatalogModel => ({
        id: `local-${n.replace(/\.sqlite$/, "")}`,
        kind: "corpus",
        format: "sqlite-pack",
        label: n,
        filename: `${CORPUS_DIR}${n}`,
        sizeBytes: 0,
        sha256: "",
        sourceUrl: "",
        license: "",
        description: "",
        required: false,
      })
    );
  return [...catalog, ...extra];
}

export async function closePack(id: string): Promise<void> {
  const open = openPacks.get(id);
  openPacks.delete(id);
  await open?.db.closeAsync().catch(() => {});
}

export async function closeAllPacks(): Promise<void> {
  await Promise.all([...openPacks.keys()].map(closePack));
  releaseAllIndexes();
}

/**
 * The pack's database if it's fully downloaded and a knowledge pack, else
 * null. Its vectors are usable only with the embedding model they were made
 * with (`modelSha256`); with another model the pack is still searched by
 * keywords (0.2.0 — before, it was skipped entirely, which never happened
 * with the single catalog model).
 */
async function openPack(pack: CatalogModel): Promise<OpenPack | null> {
  const uri = `${FileSystem.documentDirectory}${pack.filename}`;
  const info = await FileSystem.getInfoAsync(uri);
  // Catalog packs must be complete; a local pack (sizeBytes 0) has nothing to compare against.
  if (!info.exists || (pack.sizeBytes > 0 && info.size !== pack.sizeBytes)) {
    await closePack(pack.id);
    return null;
  }
  const cached = openPacks.get(pack.id);
  if (cached) return cached;

  const path = uri.replace(/^file:\/\//, "");
  const slash = path.lastIndexOf("/");
  const db = await SQLite.openDatabaseAsync(path.slice(slash + 1), { useNewConnection: true }, path.slice(0, slash));
  const meta = await db
    .getAllAsync<{ key: string; value: string }>("SELECT key, value FROM meta")
    .then((rows) => Object.fromEntries(rows.map((r) => [r.key, r.value])))
    .catch(() => ({} as Record<string, string>));
  // Pack format: "nido-knowledge-pack" (current). "boar-knowledge-pack" is
  // accepted as a legacy format from packs built before the NIDO rebrand —
  // same schema, embedding-model SHA check still enforced (per query).
  const format = meta.format as string | undefined;
  if (format !== "nido-knowledge-pack" && format !== "boar-knowledge-pack") {
    console.warn(`[packs] ${pack.filename} isn't a knowledge pack; skipping it`);
    await db.closeAsync().catch(() => {});
    return null;
  }
  const open: OpenPack = {
    db,
    modelSha256: String(meta.embeddingModelSha256 ?? ""),
    sizeBytes: (info as { size?: number }).size ?? 0,
  };
  openPacks.set(pack.id, open);
  return open;
}

type PackRow = { id: number; title: string; body: string; vec: Uint8Array; rank: number };

export interface PackSearchOptions {
  /** Search settings of the model that embedded the question. */
  profile?: EmbeddingProfile;
  /** That model's catalog SHA-256; packs made with another model are keyword-only. */
  modelSha256?: string | null;
}

/** Lexical and semantic candidates from every installed pack, scored like the built-in ones. */
export async function searchPacks(
  query: string,
  queryVec: Float32Array | null,
  limit: number,
  options: PackSearchOptions = {}
): Promise<{ lexical: RetrievedChunk[]; semantic: RetrievedChunk[] }> {
  const profile = options.profile ?? BGE_SMALL_EN_PROFILE;
  const modelSha256 = options.modelSha256 ?? REQUIRED_EMBEDDING_SHA256;
  const lexicalQuery = buildLexicalQuery(query);
  const lexical: RetrievedChunk[] = [];
  const semantic: RetrievedChunk[] = [];
  // bge (the original model) keeps the original keyword-first search exactly.
  // Other models (multilingual) need a full vector search: a question in
  // Spanish shares no keywords with an English article.
  const fullVectorSearch = profile.id !== BGE_SMALL_EN_PROFILE.id;
  if (!lexicalQuery && !(fullVectorSearch && queryVec)) return { lexical, semantic };

  for (const pack of await knowledgePacks()) {
    try {
      const open = await openPack(pack);
      if (!open) continue;
      const { db } = open;
      const vectorsMatch = open.modelSha256 === modelSha256;
      const toChunk = (r: { id: number; title: string; body: string }, score: number, matchType: RetrievedChunk["matchType"]): RetrievedChunk => ({
        chunkId: `pack:${pack.id}:${r.id}`,
        docId: `pack:${pack.id}:${r.title}`,
        title: r.title,
        body: r.body,
        score,
        matchType,
      });
      const rows = lexicalQuery
        ? await db.getAllAsync<PackRow>(
            `SELECT c.id, c.title, c.body, c.vec, bm25(chunks_fts) AS rank
             FROM chunks_fts f JOIN chunks c ON c.id = f.rowid
             WHERE chunks_fts MATCH ? ORDER BY rank LIMIT ?`,
            [lexicalQuery.match, PACK_CANDIDATES]
          )
        : [];
      if (lexicalQuery) {
        lexical.push(...filterByTermCoverage(rows, lexicalQuery.terms).slice(0, limit).map((r) => toChunk(r, -r.rank, "lexical")));
      }
      // F4-2026-10-06: sin queryVec (JSI de embedding ausente) se omite
      // la parte semántica; solo resultados léxicos.
      if (!queryVec || !vectorsMatch) continue;

      if (fullVectorSearch) {
        const floor = packSemanticFloor(profile, query);
        const indexUri = await packIndexIfReady(pack, open.sizeBytes);
        if (indexUri) {
          const hits = await searchPackIndex(indexUri, queryVec, floor, limit);
          if (hits && hits.ids.length > 0) {
            // Same margin pruning as the built-in search, over the whole
            // range that passed the floor (gatedMin), not just the top hits.
            const kept = pruneVectorHits(hits, profile.margin);
            const ids = kept.map((h) => h.id);
            const placeholders = ids.map(() => "?").join(",");
            const texts = await db.getAllAsync<{ id: number; title: string; body: string }>(
              `SELECT id, title, body FROM chunks WHERE id IN (${placeholders})`,
              ids
            );
            const byId = new Map(texts.map((t) => [t.id, t]));
            for (const h of kept) {
              const t = byId.get(h.id);
              if (t) semantic.push(toChunk(t, h.score, "semantic"));
            }
          }
          continue;
        }
        // Index not built yet (building in the background): keyword-first below.
      }

      const scored = rows.map((r) => toChunk(r, cosineSimilarityInt8(queryVec, r.vec), "semantic"));
      scored.sort((a, b) => b.score - a.score);
      // H1-2026-10-06: umbral más alto para queries de un solo término.
      // "hola" (1 token, fuera del idioma del corpus) puntuaba 0.56 y pasaba
      // el 0.45. Un solo término necesita evidencia más fuerte.
      const threshold = fullVectorSearch
        ? packSemanticFloor(profile, query)
        : (lexicalQuery?.terms.length ?? 0) <= 1
          ? MIN_SEMANTIC_SIMILARITY_SINGLE_TERM
          : MIN_SEMANTIC_SIMILARITY;
      // BUG-2-2026-10-06: poda por margen sobre cosenos crudos.
      const gated = filterByMinScore(scored, threshold);
      semantic.push(...pruneSemanticByMargin(gated, profile.margin).slice(0, limit));
    } catch (e: any) {
      console.warn(`[packs] search failed in ${pack.id}:`, e?.message ?? e);
    }
  }
  return { lexical, semantic };
}

/**
 * Builds, in the background, the full-vector-search index of every installed
 * pack whose vectors match `modelSha256` (multilingual search). Cheap when
 * they already exist. Never throws.
 */
export async function prepareVectorIndexes(modelSha256: string | null, profile: EmbeddingProfile): Promise<void> {
  if (!modelSha256 || profile.id === BGE_SMALL_EN_PROFILE.id) return;
  try {
    for (const pack of await knowledgePacks()) {
      const open = await openPack(pack).catch(() => null);
      if (!open || open.modelSha256 !== modelSha256) continue;
      await packIndexIfReady(pack, open.sizeBytes);
    }
  } catch (e) {
    console.warn("[packs] prepareVectorIndexes:", e instanceof Error ? e.message : String(e));
  }
}
