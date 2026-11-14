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
import { packFileState } from "../models/modelTrust";
import { readImportedPacks } from "../models/importedPacksRegistry";
import { PACK_MAX_CHUNKS, PACK_MAX_FACTS, PACK_MAX_GUIDES, PACK_MAX_REGIONS } from "../models/packImport";
import { buildLexicalQuery, cosineSimilarityInt8, countMatchedTerms, distinctFloor, DISTINCT_BG_TO, EXACT_SEARCH_MAX_ROWS, exactVectorSearch, dropUnfoundedCorpus, filterByMinScore, filterByTermCoverage, MIN_SEMANTIC_SIMILARITY, MIN_SEMANTIC_SIMILARITY_SINGLE_TERM, normalizeCorpusScores, pruneSemanticByMargin, pruneVectorHits } from "./pure";
import type { RetrievedChunk } from "./retrieve.types";
import { guideTitleOf, markUsedPart, MAX_SOURCE_PARTS, parsePackChunkId, sectionLikePattern, type PackSourceDoc } from "./packSource";
import { BGE_SMALL_EN_PROFILE, packSemanticFloor, type EmbeddingProfile } from "./embeddingProfile";
import { packIndexIfReady, releaseAllIndexes, searchPackIndex } from "./vectorIndex";
import { isNativeGateTaken } from "../inference/nativeGate";
import { isBackgroundIndexingHeld } from "../diagnostics/nativeSession";
import { composeCrisisAnswer, composeFactsAnswer, composeMergedCrisisAnswer, emergencyRegions, markOutdated, mergePackFacts, type FactLang, type FactsAnswer, type PackFact, type PackRegion } from "./packFacts";

const PACK_CANDIDATES = 400;
const REQUIRED_EMBEDDING_SHA256 = MODEL_CATALOG.find((m) => m.kind === "embedding" && m.required)!.sha256;

interface OpenPack {
  db: SQLite.SQLiteDatabase;
  /** meta.formatVersion: 2 adds guides, regions, facts and chunks.keys (0.1.55). */
  formatVersion: number;
  /** Embedding model the pack's vectors were made with (meta.embeddingModelSha256). */
  modelSha256: string;
  sizeBytes: number;
  /** Vector size declared by the pack (meta.dims), 384 if absent. */
  dims: number;
  /** File mtime when opened: a replaced file (update promoted) is reopened. */
  mtime: number | null;
  /**
   * Vectors of a small pack, read once, for the exact search while its
   * index is (re)built; null when the pack is too big for that.
   */
  exactRows?: Array<{ id: number; vec: Uint8Array }> | null;
  /**
   * 0.1.57: an older verified version of a catalog pack (the app was updated
   * and the new pack isn't downloaded yet). Still used — offline it may be the
   * only copy — and answers say a newer version exists.
   */
  outdated: boolean;
}

const openPacks = new Map<string, OpenPack>();

const CORPUS_DIR = "corpus/";

/**
 * Catalog packs, plus the packs the signed door imported — and nothing
 * else. M-35 (auditoría 2026-11-13, carril 07 · F-03): until 0.1.99 ANY
 * `.sqlite` file found in corpus/ was listed here with an empty pin
 * (sizeBytes 0, sha256 "") and opened as a pack, so presence in the
 * directory was itself the credential. Now an extra file counts only
 * when the door's registry (models/importedPacksRegistry.ts) holds a
 * record for it, and the entry is built FROM that record: the SHA-256
 * and size the door verified become the pack's pin, checked at open by
 * packFileState exactly like a catalog pin. A record under a catalog
 * file name is not an import: the file presents as the catalog entry
 * (and the door only lets the catalog's own bytes take that name).
 */
export async function knowledgePacks(): Promise<CatalogModel[]> {
  const catalog = CORPUS_CATALOG.filter((m) => m.format === "sqlite-pack");
  const registry = await readImportedPacks();
  const extra: CatalogModel[] = [];
  for (const [filename, record] of Object.entries(registry)) {
    if (catalog.some((c) => c.filename === `${CORPUS_DIR}${filename}`)) continue;
    extra.push({
      id: `local-${filename.replace(/\.sqlite$/, "")}`,
      kind: "corpus",
      format: "sqlite-pack",
      label: record.name || filename,
      filename: `${CORPUS_DIR}${filename}`,
      sizeBytes: record.sizeBytes,
      sha256: record.sha256,
      sourceUrl: "",
      license: "",
      description: "",
      required: false,
    });
  }
  return [...catalog, ...extra];
}

/** Ids of the signed catalog's packs: the deterministic-facts authority set (M-35/B3). */
const CATALOG_PACK_IDS = new Set(CORPUS_CATALOG.filter((m) => m.format === "sqlite-pack").map((m) => m.id));

/**
 * 0.1.55: la guía entera de la que salió un trozo de una respuesta, con la
 * parte usada marcada. Solo lectura, sin internet. null si el pack ya no
 * está, cambió o el trozo no es de un pack.
 */
export async function readPackSource(chunkId: string): Promise<PackSourceDoc | null> {
  const ref = parsePackChunkId(chunkId);
  if (!ref) return null;
  const pack = (await knowledgePacks()).find((p) => p.id === ref.packId);
  if (!pack) return null;
  const open = await openPack(pack);
  if (!open) return null;
  const head = await open.db.getFirstAsync<{ title: string; source: string | null }>(
    "SELECT title, source FROM chunks WHERE id = ?",
    [ref.rowId],
  );
  if (!head) return null;
  // La guía entera: el trozo sin apartado («Guía») y todos sus apartados
  // («Guía — Apartado»), en orden.
  const guide = guideTitleOf(head.title);
  const rows = await open.db.getAllAsync<{ id: number; body: string }>(
    "SELECT id, body FROM chunks WHERE title = ? OR title LIKE ? ESCAPE '\\' ORDER BY id LIMIT ?",
    [guide, sectionLikePattern(guide), MAX_SOURCE_PARTS],
  );
  return markUsedPart(guide, head.source ?? "", rows, ref.rowId);
}

export interface PackGuideEntry {
  id: number;
  key: string;
  lang: string;
  title: string;
  category: string;
  region: string;
  sources: string;
  verified: string;
}

export interface PackGuideDoc {
  title: string;
  source: string;
  /** Texto completo de la guía: sus trozos unidos en orden de lectura. */
  body: string;
}

/**
 * Guías de un pack instalado (solo packs de formato v2, que traen la tabla
 * de guías), en su orden. Lista vacía si el pack no está, no se puede abrir
 * o su formato no trae guías. Solo lectura: no carga ningún motor ni toca
 * la búsqueda; el lector de documentos vive de esto.
 */
export async function listPackGuides(packId: string): Promise<PackGuideEntry[]> {
  const pack = (await knowledgePacks()).find((p) => p.id === packId);
  if (!pack) return [];
  const open = await openPack(pack);
  if (!open || open.formatVersion < 2) return [];
  return open.db
    .getAllAsync<PackGuideEntry>(
      "SELECT id, key, lang, title, category, region, sources, verified FROM guides ORDER BY id",
    )
    .catch(() => [] as PackGuideEntry[]);
}

/**
 * El documento entero de una guía de un pack, para leerlo como un
 * documento: sus trozos unidos en orden, con la fila sin apartado primero
 * si la trae. null si el pack o la guía ya no están. Solo lectura, sin
 * internet y sin cargar ningún motor.
 */
export async function readPackGuide(packId: string, guideId: number): Promise<PackGuideDoc | null> {
  const pack = (await knowledgePacks()).find((p) => p.id === packId);
  if (!pack) return null;
  const open = await openPack(pack);
  if (!open || open.formatVersion < 2) return null;
  const head = await open.db
    .getFirstAsync<{ title: string }>("SELECT title FROM guides WHERE id = ?", [guideId])
    .catch(() => null);
  if (!head) return null;
  type ChunkRow = { id: number; title: string; body: string; source: string };
  let rows = await open.db
    .getAllAsync<ChunkRow>("SELECT id, title, body, source FROM chunks WHERE guide = ? ORDER BY id", [guideId])
    .catch(() => [] as ChunkRow[]);
  if (rows.length === 0) {
    // Packs sin enlace guía→trozo en los chunks: el mismo emparejamiento
    // por título que usa readPackSource (la guía y sus apartados).
    rows = await open.db
      .getAllAsync<ChunkRow>(
        "SELECT id, title, body, source FROM chunks WHERE title = ? OR title LIKE ? ESCAPE '\\' ORDER BY id LIMIT ?",
        [head.title, sectionLikePattern(head.title), MAX_SOURCE_PARTS],
      )
      .catch(() => [] as ChunkRow[]);
  }
  if (rows.length === 0) return null;
  const bare = rows.find((r) => r.title === head.title);
  const ordered = bare ? [bare, ...rows.filter((r) => r !== bare)] : rows;
  return {
    title: head.title,
    source: ordered[0].source ?? "",
    body: ordered.map((r) => r.body).join("\n\n"),
  };
}

export async function closePack(id: string): Promise<void> {
  const open = openPacks.get(id);
  openPacks.delete(id);
  factsCache.delete(id);
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
  if (!info.exists) {
    await closePack(pack.id);
    return null;
  }
  const size = (info as { size?: number }).size ?? 0;
  const mtime = (info as { modificationTime?: number }).modificationTime ?? null;
  const cached = openPacks.get(pack.id);
  if (cached && cached.sizeBytes === size && cached.mtime === mtime) return cached;
  if (cached) await closePack(pack.id);
  // Every pack must be complete for its pin (the catalog's, or the
  // import registry's), or an older version whose bytes were verified
  // at install (0.1.57). A pack without a pin never reaches this line:
  // knowledgePacks() only builds entries that carry one (M-35/F-03).
  const state = await packFileState(pack).catch(() => "unusable" as const);
  if (state === "unusable") return null;

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
  const formatVersion = Number(meta.formatVersion) > 0 ? Number(meta.formatVersion) : 1;
  // P-39 (auditoría 2026-11-13, carril 07 · B7): the byte size never
  // bounded the WORK of opening a pack — a signed file under the byte
  // cap can still declare millions of rows for the indexers and the
  // facts merge to walk. Row counts are four cheap COUNT(*) reads;
  // above the caps (models/packImport.ts) the pack does not open,
  // however it arrived. A chunks count that cannot even be read means
  // the table the search runs on is not there: not a pack.
  const rowCounts = await packRowCounts(db, formatVersion);
  if (
    !rowCounts ||
    rowCounts.chunks > PACK_MAX_CHUNKS ||
    rowCounts.guides > PACK_MAX_GUIDES ||
    rowCounts.regions > PACK_MAX_REGIONS ||
    rowCounts.facts > PACK_MAX_FACTS
  ) {
    console.warn(`[packs] ${pack.filename} exceeds the row caps or its chunks are unreadable; skipping it`);
    await db.closeAsync().catch(() => {});
    return null;
  }
  const open: OpenPack = {
    db,
    formatVersion,
    modelSha256: String(meta.embeddingModelSha256 ?? ""),
    sizeBytes: size,
    dims: Number(meta.dims) > 0 ? Number(meta.dims) : 384,
    mtime,
    outdated: state === "outdated",
  };
  openPacks.set(pack.id, open);
  return open;
}

/**
 * Row counts of a pack's content tables. Null only when the chunks
 * count is unreadable; the v2 tables degrade to 0 when unreadable
 * (their readers already tolerate a failed read the same way).
 */
async function packRowCounts(
  db: SQLite.SQLiteDatabase,
  formatVersion: number
): Promise<{ chunks: number; guides: number; regions: number; facts: number } | null> {
  const count = async (table: string): Promise<number | null> => {
    const row = await db
      .getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)
      .catch(() => null);
    return row && Number.isFinite(row.n) ? row.n : null;
  };
  const chunks = await count("chunks");
  if (chunks === null) return null;
  if (formatVersion < 2) return { chunks, guides: 0, regions: 0, facts: 0 };
  return {
    chunks,
    guides: (await count("guides")) ?? 0,
    regions: (await count("regions")) ?? 0,
    facts: (await count("facts")) ?? 0,
  };
}

type PackRow = { id: number; title: string; body: string; keys?: string; vec: Uint8Array; rank: number };

export interface PackSearchOptions {
  /** Search settings of the model that embedded the question. */
  profile?: EmbeddingProfile;
  /** That model's catalog SHA-256; packs made with another model are keyword-only. */
  modelSha256?: string | null;
}

/** Exact search over a small pack's vectors (no index yet), or null for a big pack. */
async function exactSearcherFor(
  open: OpenPack,
  queryVec: Float32Array,
): Promise<((floor: number, n: number) => Promise<ReturnType<typeof exactVectorSearch>>) | null> {
  if (open.exactRows === undefined) {
    try {
      const count = (await open.db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM chunks"))?.n ?? 0;
      open.exactRows =
        count > 0 && count <= EXACT_SEARCH_MAX_ROWS
          ? await open.db.getAllAsync<{ id: number; vec: Uint8Array }>("SELECT id, vec FROM chunks")
          : null;
    } catch {
      // Sin lectura: el camino de siempre (palabras primero).
      open.exactRows = null;
    }
  }
  const rows = open.exactRows;
  if (!rows || rows.length === 0) return null;
  return async (floor, n) => exactVectorSearch(rows, queryVec, floor, n);
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
      // Same model AND same vector size as the question (a pack that
      // declares another size is never scored against it).
      const vectorsMatch = open.modelSha256 === modelSha256 && (!queryVec || queryVec.length === open.dims);
      const toChunk = (r: { id: number; title: string; body: string; keys?: string }, score: number, matchType: RetrievedChunk["matchType"], termCoverage?: number): RetrievedChunk => ({
        chunkId: `pack:${pack.id}:${r.id}`,
        docId: `pack:${pack.id}:${r.title}`,
        title: r.title,
        body: r.body,
        ...(termCoverage !== undefined ? { termCoverage } : {}),
        // 0.1.87: las claves de pregunta del formato v2 viajan con
        // el fragmento: la vía léxica de la elección de la guía las
        // cuenta como texto, igual que la puerta de cobertura de
        // esta búsqueda (sin esto, el mapeo las dejaba en la fila).
        ...(r.keys ? { keys: r.keys } : {}),
        // R-03: provenance for the fusion's personal-corpus reserve.
        sourceKind: "pack" as const,
        score,
        matchType,
      });
      const rows = lexicalQuery
        ? await db.getAllAsync<PackRow>(
            `SELECT c.id, c.title, c.body, ${open.formatVersion >= 2 ? "c.keys," : ""} c.vec, bm25(chunks_fts) AS rank
             FROM chunks_fts f JOIN chunks c ON c.id = f.rowid
             WHERE chunks_fts MATCH ? ORDER BY rank LIMIT ?`,
            [lexicalQuery.match, PACK_CANDIDATES]
          )
        : [];
      if (lexicalQuery) {
        // C-05: presence signals PER PACK, over the gate's output — a
        // pack that does not contain the topic (or the datum type asked
        // for) serves nothing, so the question can reach the honest
        // no-source fall instead of citing a plausible neighbour. Packs
        // are always house corpus: signal B's user exemption never
        // applies here.
        const gated = filterByTermCoverage(rows, lexicalQuery.terms, lexicalQuery.lang);
        const founded = dropUnfoundedCorpus(rows, gated, lexicalQuery.terms, { query });
        // C-02: normalize PER PACK — each pack is its own corpus with
        // its own BM25 scale; normalizing over the union of packs (or
        // not at all) would re-create the cross-scale inversion this
        // normalization exists to cure.
        const packLexical = founded.slice(0, limit).map((r) =>
          toChunk(
            r,
            -r.rank,
            "lexical",
            lexicalQuery.terms.length > 0
              ? countMatchedTerms(r.keys ? `${r.title} ${r.body} ${r.keys}` : `${r.title} ${r.body}`, lexicalQuery.terms) / lexicalQuery.terms.length
              : undefined
          )
        );
        lexical.push(...normalizeCorpusScores(packLexical));
      }
      // F4-2026-10-06: sin queryVec (JSI de embedding ausente) se omite
      // la parte semántica; solo resultados léxicos.
      if (!queryVec || !vectorsMatch) continue;

      if (fullVectorSearch) {
        let floor = packSemanticFloor(profile, query);
        const indexUri = await packIndexIfReady(pack, open.sizeBytes, open.dims);
        // Sin índice todavía (se construye en segundo plano, p. ej. justo tras
        // actualizar el pack): un pack pequeño se recorre entero con el
        // mismo contrato que el índice, en vez de caer a «solo palabras».
        const search = indexUri
          ? (floorArg: number, n: number) => searchPackIndex(indexUri, queryVec, floorArg, n)
          : await exactSearcherFor(open, queryVec);
        if (search) {
          // 0.1.36 distintividad: el fondo (puestos 10–50) sale de una
          // primera búsqueda sin piso; el piso efectivo sube a fondo+gap
          // cuando el mejor no destaca (pregunta sin respuesta en el pack).
          if (profile.packDistinctGap > 0) {
            const top = await search(-1, DISTINCT_BG_TO + 1);
            if (top && top.scores.length > 0) {
              floor = distinctFloor(floor, [...top.scores].sort((a, b) => b - a), profile.packDistinctGap);
            }
          }
          const hits = await search(floor, limit);
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
        // Un pack grande (la Wikipedia) sin índice todavía: palabras primero, abajo.
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
export async function prepareVectorIndexes(
  modelSha256: string | null,
  profile: EmbeddingProfile,
  embeddingLoaded = true,
): Promise<void> {
  if (!modelSha256 || profile.id === BGE_SMALL_EN_PROFILE.id) return;
  // Optimización 2026-11-08 (fase 4): el fondo no mantiene residente
  // el motor de embeddings — el llamador pasa si está cargado y, si
  // ya se descargó por inactividad, la deuda se recoge en el
  // siguiente arranque, como tras cualquier parada (el mismo
  // criterio que run() en reembed.ts). El parámetro mantiene a este
  // módulo fuera del grafo de imports del motor a propósito: la
  // biblioteca de guías importa packs.ts y su cadena no debe
  // alcanzar ningún motor.
  if (!embeddingLoaded) return;
  // M3 (crash nativo): con el fondo apagado por la muerte de la
  // sesión anterior, tampoco se construyen índices esta sesión.
  if (isBackgroundIndexingHeld()) return;
  // M1 (crash nativo): construir índices es trabajo de fondo lanzado
  // en la misma tormenta de arranque que el re-indexado; con una
  // generación en vuelo se difiere entero (es barato cuando los
  // índices ya existen y se relanza en cada arranque) y, si la
  // generación llega a mitad, se cede entre packs.
  if (isNativeGateTaken()) return;
  try {
    for (const pack of await knowledgePacks()) {
      if (isNativeGateTaken()) break;
      const open = await openPack(pack).catch(() => null);
      if (!open || open.modelSha256 !== modelSha256) continue;
      await packIndexIfReady(pack, open.sizeBytes, open.dims);
    }
  } catch (e) {
    console.warn("[packs] prepareVectorIndexes:", e instanceof Error ? e.message : String(e));
  }
}

/** Verified facts read once per open pack (they never change while it's installed). */
const factsCache = new Map<string, { regions: PackRegion[]; facts: PackFact[] }>();

async function packFacts(packId: string, open: OpenPack): Promise<{ regions: PackRegion[]; facts: PackFact[] }> {
  const cached = factsCache.get(packId);
  if (cached && openPacks.get(packId) === open) return cached;
  const empty = { regions: [], facts: [] };
  if (open.formatVersion < 2) return empty;
  const parse = (json: string): any => {
    try {
      return JSON.parse(json);
    } catch {
      return {};
    }
  };
  const regionRows = await open.db.getAllAsync<{ code: string; names: string; aliases: string; phrases: string }>(
    "SELECT code, names, aliases, phrases FROM regions"
  );
  const factRows = await open.db.getAllAsync<{
    region: string; key: string; value: string; label: string; note: string;
    source_title: string; source_url: string; quote: string; checked: string;
  }>("SELECT region, key, value, label, note, source_title, source_url, quote, checked FROM facts ORDER BY id");
  const out = {
    regions: regionRows.map((r) => {
      const aliases = parse(r.aliases);
      return { code: r.code, names: parse(r.names), phrases: parse(r.phrases), aliases: Array.isArray(aliases) ? aliases.map(String) : [] };
    }),
    facts: factRows.map((f) => ({
      region: f.region, key: f.key, value: f.value, label: parse(f.label), note: parse(f.note),
      sourceTitle: f.source_title, sourceUrl: f.source_url, quote: f.quote, checked: f.checked,
    })),
  };
  factsCache.set(packId, out);
  return out;
}

/**
 * 0.1.55: "what number do I call in X?" answered from the verified facts of
 * the installed packs (source and date cited), or null to follow the normal
 * path. The first pack that covers the country answers. A crisis-line
 * question is answered from the same tables (the `crisis.*` facts) when no
 * emergency number was asked for. Never throws.
 */
export async function answerFromPackFacts(text: string, lang: FactLang): Promise<FactsAnswer | null> {
  try {
    const perPack: Array<{ regions: PackRegion[]; facts: PackFact[] }> = [];
    const packMeta: Array<{ label: string; outdated: boolean }> = [];
    for (const pack of await knowledgePacks()) {
      // M-35/B3 (auditoría 2026-11-13, carril 07): deterministic emergency
      // answers — a number to call, a crisis line — are spoken with the
      // house's authority, so only the signed catalog's packs may be
      // their source. An imported pack's signature proves who published
      // it, not that the house stands behind its emergency numbers; it
      // still serves its guides and its search like any pack. A pack
      // imported under a catalog file name IS the catalog entry here
      // (knowledgePacks presents it as such, bytes pinned), so it keeps
      // the authority its verified bytes earn.
      if (!CATALOG_PACK_IDS.has(pack.id)) continue;
      const open = await openPack(pack).catch(() => null);
      if (!open || open.formatVersion < 2) continue;
      const { regions, facts } = await packFacts(pack.id, open).catch(() => ({ regions: [], facts: [] }));
      const answer = composeFactsAnswer(text, lang, regions, facts) ?? composeCrisisAnswer(text, lang, regions, facts);
      if (answer) return open.outdated ? markOutdated(answer, lang, pack.label) : answer;
      perPack.push({ regions, facts });
      packMeta.push({ label: pack.label, outdated: !!open.outdated });
    }
    // Auditoría completa 2026-10-31 (F1 S-1): la pestaña de
    // Emergencia fusiona los packs (la región es del primer pack
    // que la define y los hechos crisis.* de los demás se suman),
    // pero el chat componía pack a pack: una línea de crisis cuyo
    // hecho vive en un pack que no define esa región se veía en la
    // pestaña y el chat no la podía responder. Con los datos de
    // hoy no pasa (el pack de Crisis define sus 14 regiones y sus
    // 14 líneas), pero la divergencia es estructural: si ningún
    // pack responde solo, se compone la respuesta de crisis sobre
    // el conjunto fusionado, con la misma regla que la pestaña.
    if (perPack.length > 1) {
      const fallback = composeMergedCrisisAnswer(text, lang, perPack);
      if (fallback) {
        const meta = packMeta[fallback.ownerIndex];
        return meta?.outdated ? markOutdated(fallback.answer, lang, meta.label) : fallback.answer;
      }
    }
  } catch (e) {
    console.warn("[packs] answerFromPackFacts:", e instanceof Error ? e.message : String(e));
  }
  return null;
}

/**
 * 0.1.55: every verified fact of the installed catalog v2 packs, for the
 * Emergency tab (M-35/B3: imported packs are not a facts source — see
 * answerFromPackFacts). A country covered by two packs keeps the first
 * pack's numbers (the catalog order), so one screen never mixes two
 * sources; the merge rule itself (and its one exception, the `crisis.*`
 * family) lives in packFacts.ts › mergePackFacts. Never throws.
 */
export async function loadAllPackFacts(): Promise<{ regions: PackRegion[]; facts: PackFact[]; outdatedPacks: string[] }> {
  const perPack: Array<{ regions: PackRegion[]; facts: PackFact[] }> = [];
  /** Parallel to perPack: label and outdated flag of each pack read. */
  const packMeta: Array<{ label: string; outdated: boolean }> = [];
  try {
    for (const pack of await knowledgePacks()) {
      // M-35/B3: the Emergency tab shows the same deterministic facts
      // the chat answers from — catalog packs only, as in
      // answerFromPackFacts (see its note).
      if (!CATALOG_PACK_IDS.has(pack.id)) continue;
      const open = await openPack(pack).catch(() => null);
      if (!open || open.formatVersion < 2) continue;
      const data = await packFacts(pack.id, open).catch(() => ({ regions: [] as PackRegion[], facts: [] as PackFact[] }));
      perPack.push(data);
      packMeta.push({ label: pack.label, outdated: !!open.outdated });
    }
  } catch (e) {
    console.warn("[packs] loadAllPackFacts:", e instanceof Error ? e.message : String(e));
  }
  const merged = mergePackFacts(perPack);
  // 0.1.57: labels of the packs used here (owners of at least one region)
  // that have a newer version to download.
  const owners = new Set(merged.regionOwner);
  const outdatedPacks = packMeta.filter((m, i) => m.outdated && owners.has(i)).map((m) => m.label);
  return { regions: merged.regions, facts: merged.facts, outdatedPacks };
}

/**
 * 0.1.57: names of the countries the installed packs have checked numbers for,
 * sorted in the language — for the fixed "I won't guess" answer, whose own
 * list only has the 8 countries of the built-in table. Empty without packs.
 */
export async function packCountryNames(lang: FactLang): Promise<string[]> {
  const { regions, facts } = await loadAllPackFacts();
  return emergencyRegions(lang, regions, facts).map((r) => r.name);
}
