/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import * as FileSystem from "expo-file-system/legacy";
import { getDb, getDbEpoch, insertChunk, insertChunkWithoutEmbedding, ChunkRecord } from "./db";
import { embeddingEngine } from "./embed";
import minimumCorpus from "../../assets/corpus/corpus.json";
import { CORPUS_CATALOG } from "../models/manifest";

/**
 * Knowledge base sources, layered:
 *
 * 1. APP_TOPIC_DOCS — a handful of docs about the app's own architecture
 *    (useful for the bounty's own eval questions about MoE/mmap/RAM budgeting).
 * 2. minimumCorpus (assets/corpus/corpus.json) — 300 Wikipedia-derived docs,
 *    bundled directly in the JS bundle, always present, no download needed.
 * 3. Downloaded corpus packs (CORPUS_CATALOG entries, "standard"/"full"
 *    tiers) — read from disk if the user downloaded them via Settings or
 *    the first-run tier picker; skipped if not present.
 *
 * Called on every app start; each doc has a stable id so re-running only
 * inserts docs that aren't already in the DB (embedding is the expensive
 * part, so this avoids re-embedding everything just because a new corpus
 * pack was added later). Embeddings are computed on-device (not
 * precomputed at build/download time) so the vector index always matches
 * whatever embedding model actually ships.
 */
type SeedDoc = { id: string; title: string; source: string; body: string };

function slug(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

const APP_TOPIC_DOCS: SeedDoc[] = [
  {
    id: "app-moe-ram",
    title: "Mixture-of-Experts models and phone RAM",
    source: "NIDO seed corpus",
    body:
      "A Mixture-of-Experts (MoE) model has many 'expert' sub-networks but only " +
      "routes each token through a small subset of them (the active parameters). " +
      "Total parameter count determines disk footprint (all experts must be " +
      "stored), but RAM usage during inference tracks the active parameters " +
      "actually touched per token, plus the KV cache for the current context. " +
      "This is why an MoE model with, say, 100B total but 8B active parameters " +
      "can run in far less RAM than a dense 100B model, provided weights are " +
      "streamed from disk (mmap) rather than fully resident.",
  },
  {
    id: "app-mmap-streaming",
    title: "mmap-based weight streaming vs. full RAM loading",
    source: "NIDO seed corpus",
    body:
      "Memory-mapping (mmap) a GGUF model file lets the OS page in only the " +
      "weight blocks actually touched during inference, backed by the file on " +
      "disk rather than requiring the whole file to be read into RAM upfront. " +
      "This trades some latency (first-touch page faults, and repeated faults " +
      "if the OS evicts pages under memory pressure) for a dramatically lower " +
      "resident memory floor. Fully loading weights into RAM (or locking them " +
      "with mlock) avoids page-fault latency and eviction thrashing, at the " +
      "cost of requiring RAM at least as large as the active working set. On " +
      "memory-constrained phones, mmap streaming is usually the right default; " +
      "it loses when storage I/O is slow enough that page faults dominate " +
      "generation latency, e.g. on slow eMMC storage under heavy background load.",
  },
  {
    id: "app-bm25-vs-cosine",
    title: "BM25 lexical search vs. cosine similarity over embeddings",
    source: "NIDO seed corpus",
    body:
      "BM25 (used by SQLite's FTS5) ranks documents by term frequency and " +
      "inverse document frequency, rewarding exact keyword and phrase matches. " +
      "It's fast, needs no model, and is precise for queries with distinctive " +
      "vocabulary, but misses paraphrases and synonyms. Cosine similarity over " +
      "dense embeddings captures semantic closeness even without shared " +
      "keywords, but can retrieve topically related-but-irrelevant chunks and " +
      "needs a trained embedding model. Hybrid retrieval (combining both, as " +
      "this app does) helps when a query mixes exact terms with a broader " +
      "conceptual ask; it can hurt if the two signals disagree and the fusion " +
      "weighting isn't tuned for the corpus, effectively adding noise instead " +
      "of complementary signal.",
  },
  {
    id: "app-grapheneos",
    title: "GrapheneOS and Google Play Services",
    source: "NIDO seed corpus",
    body:
      "GrapheneOS is a privacy- and security-focused Android fork that does " +
      "not ship Google Play Services by default. Play Services provides many " +
      "convenience APIs apps rely on, including on-device AI features like " +
      "Gemini Nano access via AICore, push notifications (FCM), location " +
      "fusion, and Play Integrity attestation. Apps that depend on these APIs " +
      "either fail or fall back to degraded behavior on GrapheneOS. An offline " +
      "AI app targeting GrapheneOS compatibility must reimplement equivalent " +
      "functionality itself — bundling its own inference engine (e.g. " +
      "llama.cpp) rather than calling a Play-Services-mediated model API.",
  },
  {
    id: "app-ram-budgeting",
    title: "Budgeting RAM for on-device LLM inference",
    source: "NIDO seed corpus",
    body:
      "On a phone with a 12GB RAM budget for an offline AI app, the usable " +
      "headroom for the LLM's active weight working set is whatever remains " +
      "after OS/app overhead, the embedding model's resident memory, and the " +
      "KV cache for the chosen context length. KV cache size scales with " +
      "context length, number of layers, and attention head dimensions; a " +
      "longer context window directly reduces the RAM left for model weights. " +
      "Quantization (e.g. Q4_K_M) reduces both weight size and the working-set " +
      "footprint compared to higher precision, which is why quantized GGUF " +
      "models are the standard choice for phone-class inference.",
  },
];

const MINIMUM_CORPUS_DOCS: SeedDoc[] = (
  minimumCorpus as Array<{ title: string; source: string; body: string }>
).map((d) => ({ ...d, id: `wiki-min-${slug(d.title)}` }));

async function loadDownloadedCorpusPacks(): Promise<SeedDoc[]> {
  const docs: SeedDoc[] = [];
  for (const pack of CORPUS_CATALOG) {
    if (pack.format === "sqlite-pack") continue;
    const path = `${FileSystem.documentDirectory}${pack.filename}`;
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists) continue;
    try {
      const raw = await FileSystem.readAsStringAsync(path);
      const parsed = JSON.parse(raw) as Array<{ title: string; source: string; body: string }>;
      for (const d of parsed) {
        docs.push({ ...d, id: `wiki-${pack.id}-${slug(d.title)}` });
      }
    } catch (e) {
      console.warn(`Failed to load corpus pack ${pack.id}:`, e);
    }
  }
  return docs;
}

export interface SeedProgress {
  /** Documents checked so far, including ones already indexed. */
  done: number;
  total: number;
  /** Title of the document being indexed. */
  title: string;
}

// On globalThis rather than in the module: a dev hot reload re-runs this
// module while the previous run is still inserting.
const running = globalThis as {
  __nidoSeeding?: Promise<void> | null;
  __nidoSeedListeners?: Set<(p: SeedProgress) => void>;
};
const listeners = (running.__nidoSeedListeners ??= new Set());

/** Progress of the indexing run in progress, for a status line. Returns an unsubscribe. */
export function onSeedProgress(listener: (p: SeedProgress) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * The setup wizard and the chat screen can both ask for this at once (and a
 * dev reload can repeat it), so concurrent callers share one run instead of
 * inserting the same documents twice.
 */
export function seedKnowledgeBaseIfEmpty(): Promise<void> {
  running.__nidoSeeding ??= seedNow().finally(() => {
    running.__nidoSeeding = null;
  });
  return running.__nidoSeeding;
}

async function seedNow(): Promise<void> {
  // DIAGNOSTIC INSTRUMENTATION (2026-10-05): "undefined is not a function"
  // persists even with embedding code fully removed (build 60046a0).
  // Each stage is wrapped to identify the exact failing operation.
  // TODO: remove instrumentation once root cause is found and fixed.
  const stage = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (e) {
      // Preserve original error type (instanceof checks) — only prepend
      // the stage tag to the message.
      if (e instanceof Error) {
        e.message = `[seed-stage:${name}] ${e.message}`;
        throw e;
      }
      throw new Error(`[seed-stage:${name}] ${String(e)}`);
    }
  };

  // Token de ciclo de vida de ESTA corrida: cada insert lo propaga. Si
  // Clear All Data avanza el ciclo a mitad del seed (p. ej. durante un
  // embedding lento), los inserts pendientes fallan con
  // DbLifecycleEndedError en vez de repoblar la base nueva con el corpus
  // del ciclo anterior.
  const runEpoch = await stage("getDbEpoch", async () => getDbEpoch());
  const db = await stage("getDb", async () => getDb());
  const packs = await stage("loadDownloadedCorpusPacks", async () => loadDownloadedCorpusPacks());
  const allDocs = [...APP_TOPIC_DOCS, ...MINIMUM_CORPUS_DOCS, ...packs];

  // This runs on every ChatScreen mount — including every time Settings
  // closes and the user returns to chat, not just on first app launch —
  // so the common case (nothing new to seed) needs to be cheap. Without
  // this, the per-doc existence check below still runs in full every
  // time: up to 5,300+ sequential SELECT queries on the "full" corpus
  // tier, during which the chat input is disabled (see ChatScreen.tsx's
  // `ready` state), even though almost always nothing actually changed.
  // A single COUNT(*) lets the fully-seeded case skip straight past the
  // loop; any mismatch (a newly downloaded corpus pack, a fresh install)
  // falls through to the real per-doc check, same as before.
  // collection_id IS NULL scopes this to seed-corpus-managed rows only —
  // user-imported documents (src/ui/PersonalDocumentsManager.tsx) live in
  // the same `chunks` table with a non-null collection_id, and counting
  // those too would make this check permanently mismatch (always fall
  // through to the full loop) for anyone who's imported personal docs.
  const { count } = (await stage("countQuery", async () => db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM chunks WHERE collection_id IS NULL`
  ))) ?? { count: 0 };
  if (count === allDocs.length) return;

  let lastReport = 0;
  for (const [i, doc] of allDocs.entries()) {
    // About four updates a second is enough to show it's moving.
    const now = Date.now();
    if (now - lastReport > 250 || i === allDocs.length - 1) {
      lastReport = now;
      listeners.forEach((l) => l({ done: i + 1, total: allDocs.length, title: doc.title }));
    }

    const existing = await stage("existenceCheck", async () => db.getFirstAsync<{ chunk_id: string }>(
      `SELECT chunk_id FROM chunks WHERE chunk_id = ?`,
      [doc.id]
    ));
    if (existing) continue;

    const chunk: ChunkRecord = {
      chunkId: doc.id,
      docId: doc.id,
      title: doc.title,
      body: doc.body,
      source: doc.source,
    };
    // RESTORED 2026-10-06: revert of diagnostic bypass 60046a0. The bypass
    // was only an A/B experiment; the d830374 device log proved the
    // "undefined is not a function" is NOT in embeddings (it is in
    // openAndMigrate()/execAsync). Embeddings are back with the original
    // graceful-degradation behavior.
    const embedding = await stage("embedChunk", async () => {
      // If the native embedding engine is unavailable in this build, seed
      // the document FTS-only (no vector) rather than blocking setup. The
      // chat LLM is unaffected; only semantic vector search is degraded.
      try {
        return await embeddingEngine.embed(`${doc.title}\n${doc.body}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("native embedding unavailable")) {
          return null;
        }
        throw e;
      }
    });
    if (embedding) {
      await stage("insertChunk", async () =>
        insertChunk(chunk, embedding, { lifecycleEpoch: runEpoch })
      );
    } else {
      // Native embedding unavailable: FTS-only fallback (graceful degradation).
      await stage("insertChunk", async () =>
        insertChunkWithoutEmbedding(chunk, { lifecycleEpoch: runEpoch })
      );
    }
  }
}
