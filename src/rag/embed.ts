/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { LlamaContext, initLlama } from "llama.rn";
import * as FileSystem from "expo-file-system/legacy";
import { checkRamBudget, RamBudgetError, readRamSnapshot, toGb } from "../inference/ramBudget";
import { withNativeLoadGate } from "../inference/nativeGate";
import { recordRamRejection } from "../inference/telemetry";
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
  // Optimización 2026-11-08 (fase 4): residencia bajo demanda. El
  // último fichero cargado se recuerda también tras descargar (para
  // poder recargar sin que el llamador repita la resolución), y la
  // pantalla registra un proveedor que resuelve el fichero activo
  // cuando este motor nunca cargó en la sesión.
  private lastFilename: string | null = null;
  private ensureProvider: (() => Promise<string | null>) | null = null;
  private ensuring: Promise<boolean> | null = null;
  // 0.1.84 (cierre de la desviación de la fase 4): la marca de último
  // uso vive en el MOTOR, no en la pantalla. La 0.1.83 la asignaba
  // solo ChatScreen al terminar el arranque, y las búsquedas — que no
  // pasan por la pantalla — no la renovaban: pasados 10 min el pulso
  // descargaba el motor pese a un uso reciente y ciclaba recarga y
  // descarga cada 30 s. Ahora cada embed consumado la renueva aquí.
  private lastUsedAt: number | null = null;
  // llama.rn rejects a call on a context that's still working ("Context is
  // busy"), so loads, embeddings and unloads run one at a time.
  private queue: Promise<unknown> = Promise.resolve();

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => {});
    return run;
  }

  load(modelFilename: string): Promise<void> {
    // Fase 2 (reapertura del defecto, 2026-11-08): tras la puerta de
    // carga, como el LLM — un initLlama a la vez en todo el proceso.
    // Antes los dos motores cargaban en paralelo (Promise.all en
    // ChatScreen) y cada pre-flight leía la foto de RAM sin el otro.
    return withNativeLoadGate(() => this.enqueue(() => this.loadNow(modelFilename)));
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
      // Fase 2 (reapertura, 2026-11-08): el rechazo también queda
      // registrado — la tarjeta no dice qué motor la disparó, y si el
      // que rechaza es este, el LLM ni siquiera lo intenta.
      recordRamRejection({
        modelId: modelFilename,
        totalRamBytes: snapshot!.totalRamBytes,
        rssBytes: snapshot!.rssBytes,
        availBytes: snapshot!.availBytes ?? null,
        thresholdBytes: snapshot!.lowMemThresholdBytes ?? null,
        availableBytes: verdict.availableBytes,
        neededBytes: verdict.totalBytes,
        nCtxChosen: 512,
        nCtxRequested: 512,
        crashSafety: null,
        embedding: true,
      });
      throw new RamBudgetError(
        `Embedding model "${modelFilename}" needs roughly ${toGb(verdict.totalBytes)}GB of RAM, ` +
          `but this device only has about ${toGb(verdict.availableBytes)}GB free ` +
          `(of ${toGb(verdict.totalRamBytes)}GB total). Close background apps and retry.`,
        verdict.totalBytes,
        verdict.availableBytes,
        verdict.totalRamBytes,
        null,
        null,
        null,
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
    this.lastFilename = modelFilename;
    this.touchUsed();
    this.modelSha256 =
      MODEL_CATALOG.find((m) => m.kind === "embedding" && m.filename === modelFilename)?.sha256 ?? null;
  }

  /** ¿Hay un contexto de embeddings residente ahora mismo? */
  get isLoaded(): boolean {
    return this.context !== null;
  }

  /**
   * Último uso real del motor (carga o embed consumado), o null si
   * nunca se usó en esta sesión. Lo consulta el pulso de descarga por
   * inactividad de ChatScreen (embeddingIdleUnloadDue).
   */
  get lastUsedAtMs(): number | null {
    return this.lastUsedAt;
  }

  /** Marca el uso: la carga cuenta como uso, y cada embed también. */
  private touchUsed(): void {
    this.lastUsedAt = Date.now();
  }

  /**
   * Registra quién sabe resolver el fichero de embedding activo
   * (la pantalla, al montar). Lo usa la recarga bajo demanda cuando
   * este motor aún no cargó en la sesión.
   */
  setEnsureLoadedProvider(fn: (() => Promise<string | null>) | null): void {
    this.ensureProvider = fn;
  }

  /**
   * Fase 4: garantiza el motor residente, cargándolo si hace falta.
   * Vuelo único: las llamadas concurrentes comparten la misma
   * carga. Devuelve false cuando no hay forma de saber qué cargar
   * (ni memoria de la sesión ni proveedor) o la carga falla — el
   * llamador degrada (búsqueda léxica) en vez de romper. NUNCA se
   * llama desde dentro de una tarea de la cola: load() también
   * encola y sería un deadlock; los métodos públicos lo invocan
   * ANTES de encolar su trabajo.
   */
  ensureLoaded(): Promise<boolean> {
    if (this.context) return Promise.resolve(true);
    if (!this.ensuring) {
      this.ensuring = (async () => {
        try {
          const filename = this.lastFilename ?? (this.ensureProvider ? await this.ensureProvider() : null);
          if (!filename) return false;
          await this.load(filename);
          return this.context !== null;
        } catch {
          return false;
        } finally {
          this.ensuring = null;
        }
      })();
    }
    return this.ensuring;
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
    return this.ensureLoaded().then(() =>
      this.enqueue(async () => {
        const modelSha256 = this.modelSha256;
        const prefix = modelSha256 ? embeddingProfileForSha(modelSha256).queryPrefix : "";
        const vector = await this.embedNow(prefix + text);
        return { vector, modelSha256 };
      }),
    );
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
    return this.ensureLoaded().then(() =>
      this.enqueue(async () => {
        const modelSha256 = this.modelSha256;
        const prefix = modelSha256 ? embeddingProfileForSha(modelSha256).passagePrefix : "";
        const vector = await this.embedNow(prefix + text);
        return { vector, modelSha256 };
      }),
    );
  }

  /** Raw embedding, no prefix. Callers use embedQuery / embedPassage. */
  embed(text: string): Promise<Float32Array> {
    return this.ensureLoaded().then(() => this.enqueue(() => this.embedNow(text)));
  }

  private async embedNow(text: string): Promise<Float32Array> {
    if (!this.context) throw new Error("EmbeddingEngine: model not loaded");
    try {
      const result = await this.context.embedding(text);
      // Uso consumado: renueva la marca (0.1.84, ver lastUsedAt).
      this.touchUsed();
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
