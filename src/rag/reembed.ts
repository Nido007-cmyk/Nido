/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Rebuilds missing vectors in the knowledge base with the loaded embedding
 * model: after a model switch (embeddingSwitch.ts drops every vector), or
 * for chunks that were indexed while embeddings were unavailable.
 *
 * - Background and resumable: it only ever looks at chunks with no vector,
 *   so an interrupted run continues where it stopped on the next start.
 * - Keyword search keeps working the whole time; semantic search covers the
 *   chunks done so far.
 * - Never mixes models: each vector is written only if the base is still
 *   stamped with the model that computed it (insertEmbeddingForModel).
 * - One run at a time (single flight).
 * - Native gate (M1, crash diagnosis): never computes while a generation
 *   is in flight — parks per chunk and resumes when it settles
 *   (src/inference/nativeGate.ts).
 */
import { embeddingEngine } from "./embed";
import { countChunkVectors, getDbEpoch, insertEmbeddingForModel, listChunksWithoutEmbedding } from "./db";
import { isNativeGateTaken, waitForNativeGateFree } from "../inference/nativeGate";

export interface ReembedProgress {
  done: number;
  total: number;
  running: boolean;
}

const BATCH = 24;

type Listener = (p: ReembedProgress) => void;
const listeners = new Set<Listener>();
let current: Promise<ReembedProgress> | null = null;
let last: ReembedProgress = { done: 0, total: 0, running: false };

function emit(p: ReembedProgress) {
  last = p;
  for (const l of listeners) {
    try {
      l(p);
    } catch {
      /* a listener's bug never stops the work */
    }
  }
}

export function onReembedProgress(listener: Listener): () => void {
  listeners.add(listener);
  listener(last);
  return () => listeners.delete(listener);
}

export function lastReembedProgress(): ReembedProgress {
  return last;
}

/** Starts (or joins) the background re-embedding. Resolves when there is nothing left or it had to stop. */
export function reembedMissing(): Promise<ReembedProgress> {
  if (current) return current;
  current = run().finally(() => {
    current = null;
  });
  return current;
}

async function run(): Promise<ReembedProgress> {
  const sha = embeddingEngine.loadedModelSha256;
  if (!sha) return last;
  const epoch = getDbEpoch();
  const counts = await countChunkVectors();
  let done = counts.withVector;
  const total = counts.chunks;
  if (done >= total) {
    emit({ done, total, running: false });
    return last;
  }
  // M1 (crash nativo): con una generación en vuelo, este arranque no
  // empieza — computar embeddings a la vez que el otro contexto
  // decodifica es el solape que la puerta existe para evitar. La
  // deuda sigue ahí y el siguiente arranque la recoge, como tras
  // cualquier parada.
  if (isNativeGateTaken()) return last;
  emit({ done, total, running: true });
  let previousFirst: string | null = null;
  try {
    for (;;) {
      // Clear All Data or a model switch since we started: stop; the next
      // start picks up whatever is still missing.
      if (getDbEpoch() !== epoch || embeddingEngine.loadedModelSha256 !== sha) break;
      const batch = await listChunksWithoutEmbedding(BATCH);
      if (batch.length === 0) break;
      // A chunk that keeps coming back means its vector isn't being stored:
      // stop instead of looping forever.
      if (batch[0].chunkId === previousFirst) break;
      previousFirst = batch[0].chunkId;
      for (const chunk of batch) {
        // M1: si una generación arrancó a mitad de tanda, aparcarse
        // ANTES del siguiente embedding y reanudar cuando la puerta
        // se libere. La generación nunca espera a este bucle: cede
        // en ≤ 1 embedding (el que ya estuviera en vuelo).
        if (isNativeGateTaken()) {
          await waitForNativeGateFree();
          // La espera pudo cruzar un borrado total o un cambio de
          // modelo: revalidar con la misma regla del bucle exterior.
          if (getDbEpoch() !== epoch || embeddingEngine.loadedModelSha256 !== sha) return finish(done, total);
        }
        const vec = await embeddingEngine.embedPassage(`${chunk.title}\n${chunk.body}`);
        if (embeddingEngine.loadedModelSha256 !== sha) return finish(done, total);
        const ok = await insertEmbeddingForModel(chunk.chunkId, vec, sha, { lifecycleEpoch: epoch });
        if (!ok) return finish(done, total);
        done += 1;
      }
      emit({ done: Math.min(done, total), total, running: true });
    }
  } catch (e) {
    // Native embeddings unavailable, DB reset mid-run, etc.: stop quietly,
    // keyword search is unaffected and the next start retries.
    console.warn("[reembed] stopped:", e instanceof Error ? e.message : String(e));
  }
  return finish(done, total);
}

function finish(done: number, total: number): ReembedProgress {
  emit({ done: Math.min(done, total), total, running: false });
  return last;
}
