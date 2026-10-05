import { LlamaContext, initLlama } from "llama.rn";
import * as FileSystem from "expo-file-system/legacy";
import { checkRamBudget, readRamSnapshot, toGb } from "../inference/ramBudget";
import { assertTrustedModelFileByName } from "../models/modelTrust";

/**
 * Wraps a small local embedding model (GGUF, <300MB) via llama.rn's
 * embedding mode. Kept as a separate, lighter-weight context from the main
 * generation LLM so it can stay resident cheaply for fast retrieval without
 * competing with the primary model's RAM budget.
 */
export class EmbeddingEngine {
  private context: LlamaContext | null = null;
  private modelFilename: string | null = null;
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
    await assertTrustedModelFileByName(modelFilename);
    const info = await FileSystem.getInfoAsync(modelPath);
    if (!info.exists) {
      throw new Error(`Embedding model not found at ${modelPath}`);
    }
    const fileSizeBytes = (info as { size?: number }).size ?? 0;
    await this.unloadNow();
    // Same RAM pre-flight as the main LLM (src/inference/ramBudget.ts): a
    // clear "this won't fit" message beats a native OOM crash. Best-effort —
    // skipped when the native RAM readouts are unavailable.
    const snapshot = readRamSnapshot();
    const verdict = snapshot ? checkRamBudget({ fileSizeBytes, nCtx: 512 }, snapshot) : null;
    if (verdict && !verdict.fits) {
      throw new Error(
        `Embedding model "${modelFilename}" needs roughly ${toGb(verdict.totalBytes)}GB of RAM, ` +
          `but this device only has about ${toGb(verdict.availableBytes)}GB free ` +
          `(of ${toGb(verdict.totalRamBytes)}GB total). Close background apps and retry.`
      );
    }
    this.context = await initLlama({
      model: modelPath,
      embedding: true,
      n_ctx: 512,
      n_threads: 2,
    });
    this.modelFilename = modelFilename;
  }

  embed(text: string): Promise<Float32Array> {
    return this.enqueue(async () => {
      if (!this.context) throw new Error("EmbeddingEngine: model not loaded");
      const result = await this.context.embedding(text);
      return Float32Array.from(result.embedding);
    });
  }

  unload(): Promise<void> {
    return this.enqueue(() => this.unloadNow());
  }

  private async unloadNow() {
    await this.context?.release();
    this.context = null;
    this.modelFilename = null;
  }
}

export const embeddingEngine = new EmbeddingEngine();

export { cosineSimilarity } from "./pure";
