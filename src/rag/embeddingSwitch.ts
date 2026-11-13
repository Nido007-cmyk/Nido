/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Choosing and switching the embedding model (docs/design/BUSQUEDA_MULTILINGUE.md).
 *
 * Two models exist: bge-small-en (English, the original default) and
 * multilingual-e5-small (Spanish/Portuguese/English, opt-in for existing
 * installs, the default for new installs in es/pt).
 *
 * A switch is explicit and ordered so that no crash can leave the knowledge
 * base stamped for one model while another one is active with vectors:
 *   1. load the new model (fails → nothing changed);
 *   2. drop all vectors + re-stamp, in one transaction;
 *   3. make it the active model in Settings;
 *   4. rebuild vectors in the background (reembed.ts).
 * A crash between 2 and 3 leaves an empty vector table stamped for the new
 * model; the next start re-stamps it for the active one (db.ts), and the
 * switch simply didn't happen. A crash after 3 resumes at 4.
 */
import type { CatalogModel } from "../models/manifest";
import { getActiveModelId, setActiveModelId } from "../models/settings";
import { embeddingEngine } from "./embed";
import { resetEmbeddingsForModel } from "./db";
import { closeAllPacks, prepareVectorIndexes } from "./packs";
import { embeddingProfileForSha } from "./embeddingProfile";
import { reembedMissing } from "./reembed";

export {
  DEFAULT_EMBEDDING_ID,
  MULTILINGUAL_EMBEDDING_ID,
  embeddingModelById,
  defaultEmbeddingModel,
  defaultEmbeddingIdForLanguage,
  isMultilingualEmbedding,
  packIdForEmbedding,
  embeddingIdForPack,
} from "./packVariants";
import { embeddingModelById, defaultEmbeddingModel } from "./packVariants";

/** The embedding model in use: the Settings choice if it's a catalog model, else the default. */
export async function activeEmbeddingModel(): Promise<CatalogModel> {
  const id = await getActiveModelId("embedding").catch(() => null);
  return (id && embeddingModelById(id)) || defaultEmbeddingModel();
}

// Switches run one after another, in the order they were asked for, so the
// LAST request always wins (audit 2026-10-11: before, a second request made
// while one was running got the first one's promise and was silently lost).
let queue: Promise<void> = Promise.resolve();
let pendingTarget: string | null = null;
let pendingRun: Promise<void> | null = null;

/**
 * Makes `target` the embedding model. The model file must already be
 * downloaded and verified (the trust check runs inside load()).
 */
export function switchEmbeddingModel(target: CatalogModel): Promise<void> {
  if (target.kind !== "embedding") return Promise.reject(new Error(`${target.id} is not an embedding model`));
  // The same switch already waiting to run: join it instead of queuing a copy.
  if (pendingRun && pendingTarget === target.id) return pendingRun;
  const run = queue.then(() => {
    if (pendingRun === run) {
      pendingRun = null;
      pendingTarget = null;
    }
    return switchNow(target);
  });
  pendingRun = run;
  pendingTarget = target.id;
  queue = run.catch(() => {});
  return run;
}

async function switchNow(target: CatalogModel): Promise<void> {
  const before = await activeEmbeddingModel();
  if (before.id === target.id) {
    // Already the active model (the base is stamped for it): just make sure
    // it's loaded. Never drop vectors that are already right.
    if (embeddingEngine.loadedModelSha256 !== target.sha256) await embeddingEngine.load(target.filename);
    return;
  }
  // 1. Load first: if it doesn't fit in RAM or fails the trust check,
  //    nothing has changed yet.
  await embeddingEngine.load(target.filename);
  // 2 + 3. On failure, put everything back as it was: the previous model
  // loaded and the (now empty) vector table stamped for it.
  let restamped = false;
  try {
    await resetEmbeddingsForModel(target.sha256);
    restamped = true;
    await setActiveModelId("embedding", target.id);
  } catch (e) {
    if (!restamped) {
      await embeddingEngine.load(before.filename).catch(() => {});
      throw e;
    }
    // The base is already stamped for `target`. Re-stamp it back; if even
    // that fails, keep `target` loaded so this session stays consistent with
    // the stamp (vectors are only ever written for the stamped model), and
    // the next start re-stamps for the active model (db.ts) and rebuilds.
    const back = await resetEmbeddingsForModel(before.sha256).then(
      () => true,
      () => false
    );
    if (back) await embeddingEngine.load(before.filename).catch(() => {});
    void reembedMissing();
    throw e;
  }
  // Packs are opened (and checked) per model.
  await closeAllPacks();
  // 4. Background; progress via onReembedProgress.
  void reembedMissing();
  void prepareVectorIndexes(target.sha256, embeddingProfileForSha(target.sha256));
}
