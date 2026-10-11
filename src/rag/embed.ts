/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { LlamaContext, initLlama } from "llama.rn";
import * as FileSystem from "expo-file-system/legacy";
import { checkRamBudget, readRamSnapshot, toGb } from "../inference/ramBudget";
import { assertTrustedModelFileByName } from "../models/modelTrust";
import { withStage } from "../utils/stageError";
import { MODEL_CATALOG } from "../models/manifest";
import { BGE_SMALL_EN_PROFILE, embeddingProfileForSha, type EmbeddingProfile } from "./embeddingProfile";

/**
 * Wraps a small local embedding model (GGUF, <300MB) via llama.rn's
 * embedding mode. Kept as a separate, lighter-weight context from the main
 * generation LLM so it can stay resident cheaply for fast retrieval without
 * competing with the primary model's RAM budget.
 */
export class EmbeddingEngine {
  private context: LlamaContext | null = null;
  private modelFilename: string | null = null;
  private modelSha256: string | null = null;
  // llama.rn rejects a call on a context that's still working ("Context is
  // busy"), so loads, embeddings and unloads run one at a time.
  private queue: Promise<unknown> = Promise.resolve();

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => {});
    return run;
  }

  load(modelFilename: string): Promise<void> {
    return this.enqueue(() => this.loadNow(modelFilename));
  }

  private async loadNow(modelFilename: string) {
    // Same rationale as LlamaEngine.load: ChatScreen re-mounts (and calls
    // load() again) every time Settings is closed, even if the user didn't
    // touch the model — skip re-initializing the native context if it's
    // already loaded with this exact file.
    if (this.context && this.modelFilename === modelFilename) {
      return;
    }

    const modelPath = `${FileSystem.documentDirectory}${modelFilename}`;
    // Integrity gate (NIDO): same trust requirement as the main LLM — the
    // embedding model is trusted only if it is a curated catalog asset
    // whose bytes are proven verified (see src/models/modelTrust.ts).
    // Existence at the expected path is never enough.
    await withStage("trust-check", () => assertTrustedModelFileByName(modelFilename));
    const info = await FileSystem.getInfoAsync(modelPath);
    if (!info.exists) {
      throw new Error(`Embedding model not found at ${modelPath}`);
    }
    const fileSizeBytes = (info as { size?: number }).size ?? 0;
    // F2-2026-10-06: pre-flight ANTES de liberar el modelo actual (igual
    // que LlamaEngine). Si el chequeo falla, se conserva el modelo en uso.
    const snapshot = readRamSnapshot();
    const verdict = snapshot ? checkRamBudget({ fileSizeBytes, nCtx: 512 }, snapshot) : null;
    if (verdict && !verdict.fits) {
      throw new Error(
        `Embedding model "${modelFilename}" needs roughly ${toGb(verdict.totalBytes)}GB of RAM, ` +
          `but this device only has about ${toGb(verdict.availableBytes)}GB free ` +
          `(of ${toGb(verdict.totalRamBytes)}GB total). Close background apps and retry.`
      );
    }
    await this.unloadNow();
    this.context = await withStage("initLlama-embedding", () =>
      initLlama({
        model: modelPath,
        embedding: true,
        n_ctx: 512,
        n_threads: 2,
      })
    );
    this.modelFilename = modelFilename;
    this.modelSha256 =
      MODEL_CATALOG.find((m) => m.kind === "embedding" && m.filename === modelFilename)?.sha256 ?? null;
  }

  /** Catalog SHA-256 of the loaded model (the knowledge base is stamped with it), or null. */
  get loadedModelSha256(): string | null {
    return this.modelSha256;
  }

  /** Search settings of the loaded model (bge's when none is loaded). */
  get profile(): EmbeddingProfile {
    return this.modelSha256 ? embeddingProfileForSha(this.modelSha256) : BGE_SMALL_EN_PROFILE;
  }

  /** A question, with the model's query prefix ("query: " for e5, nothing for bge). */
  embedQuery(text: string): Promise<Float32Array> {
    return this.embedQueryTagged(text).then((r) => r.vector);
  }

  /** embedQuery plus the model that computed it (its thresholds apply to the scores). */
  embedQueryTagged(text: string): Promise<{ vector: Float32Array; modelSha256: string | null }> {
    return this.enqueue(async () => {
      const modelSha256 = this.modelSha256;
      const prefix = modelSha256 ? embeddingProfileForSha(modelSha256).queryPrefix : "";
      const vector = await this.embedNow(prefix + text);
      return { vector, modelSha256 };
    });
  }

  /** A stored text (article, document chunk), with the model's passage prefix. */
  embedPassage(text: string): Promise<Float32Array> {
    return this.embedPassageTagged(text).then((r) => r.vector);
  }

  /**
   * Like embedPassage, plus the SHA-256 of the model that actually computed
   * the vector (read inside the same queued task, so a model switch queued
   * meanwhile can't be confused with it). Stored vectors are written with
   * this tag: see insertChunk's modelSha256.
   */
  embedPassageTagged(text: string): Promise<{ vector: Float32Array; modelSha256: string | null }> {
    return this.enqueue(async () => {
      const modelSha256 = this.modelSha256;
      const prefix = modelSha256 ? embeddingProfileForSha(modelSha256).passagePrefix : "";
      const vector = await this.embedNow(prefix + text);
      return { vector, modelSha256 };
    });
  }

  /** Raw embedding, no prefix. Callers use embedQuery / embedPassage. */
  embed(text: string): Promise<Float32Array> {
    return this.enqueue(() => this.embedNow(text));
  }

  private async embedNow(text: string): Promise<Float32Array> {
    if (!this.context) throw new Error("EmbeddingEngine: model not loaded");
    try {
      const result = await this.context.embedding(text);
      return Float32Array.from(result.embedding);
    } catch (e) {
      // The native llamaEmbedding JSI binding may be missing from the
      // build, surfacing as the cryptic "undefined is not a function".
      // Translate it to a descriptive error so callers can degrade
      // gracefully (seed without vectors) instead of blocking setup.
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("undefined is not a function")) {
        throw new Error(
          "EmbeddingEngine: native embedding unavailable in this build " +
            "(llama.rn JSI 'llamaEmbedding' missing or failed to install)"
        );
      }
      throw e;
    }
  }

  unload(): Promise<void> {
    return this.enqueue(() => this.unloadNow());
  }

  private async unloadNow() {
    await this.context?.release();
    this.context = null;
    this.modelFilename = null;
    this.modelSha256 = null;
  }
}

export const embeddingEngine = new EmbeddingEngine();

export { cosineSimilarity } from "./pure";
