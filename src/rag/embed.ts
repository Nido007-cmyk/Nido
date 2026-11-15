/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { LlamaContext, initLlama } from "llama.rn";
import * as FileSystem from "expo-file-system/legacy";
import { checkRamBudget, RamBudgetError, readRamSnapshot, toGb, type ContextSpec } from "../inference/ramBudget";
import {
  confirmCrashGuardRecord,
  parseCrashGuardRecord,
  settleCrashGuardRecord,
  type CrashGuardRecord,
} from "../inference/memoryLadder";
import { withNativeLoadGate } from "../inference/nativeGate";
import { recordRamRejection } from "../inference/telemetry";
import { assertTrustedModelFileByName } from "../models/modelTrust";
import { withStage } from "../utils/stageError";
import { MODEL_CATALOG } from "../models/manifest";
import { BGE_SMALL_EN_PROFILE, embeddingProfileForSha, type EmbeddingProfile } from "./embeddingProfile";

/**
 * F3-08 (auditoría 2026-11-13): la arquitectura REAL de los dos
 * ficheros de embeddings del catálogo, para que el estimador deje de
 * juzgarlos con el perfil por defecto del Qwen2.5-1.5B (28 capas,
 * 2 cabezas KV de 128, vocabulario 152064). Vive aquí y no en el
 * catálogo porque las entradas de embeddings de manifest.ts no
 * declaran `arch` (las de LLM sí) y el catálogo firmado no es
 * fichero de esta tanda; las cifras son las arquitecturas públicas
 * de los dos modelos:
 * - bge-small-en-v1.5: BERT — 12 capas, oculto 384 = 12 cabezas × 32,
 *   vocabulario WordPiece de 30.522.
 * - multilingual-e5-small: XLM-RoBERTa — 12 capas, oculto 384,
 *   vocabulario SentencePiece de 250.002.
 * Un fichero fuera de la tabla sigue con el perfil por defecto del
 * estimador (conservador en KV para estos tamaños).
 */
const EMBEDDING_ARCH: Record<string, Pick<ContextSpec, "nLayer" | "nKvHeads" | "headDim" | "nVocab">> = {
  "models/embedding.gguf": { nLayer: 12, nKvHeads: 12, headDim: 32, nVocab: 30_522 },
  "models/embedding-multilingual.gguf": { nLayer: 12, nKvHeads: 12, headDim: 32, nVocab: 250_002 },
};

/** El registro CrashGuard PROPIO de los embeddings (el del LLM es otro fichero y no se toca). */
const EMBEDDING_CRASH_GUARD_FILENAME = "nido-crash-guard-embedding.json";

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
  // F3-08: el registro CrashGuard de ESTE motor, leído una vez y
  // cacheado; null = aún no leído. Las funciones puras son las del
  // LLM (memoryLadder.ts); el fichero es otro.
  private crashGuard: CrashGuardRecord | null = null;
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

  // ---- CrashGuard propio (F3-08). Hasta la 0.1.98 este motor vivía
  // FUERA del sistema de memoria: su pre-flight no aplicaba factor
  // alguno (allí no había choques que aprender porque sus muertes no
  // se registraban en ninguna parte: la recarga bajo demanda de la
  // fase 4 reintentaba la misma carga idéntica para siempre). Ahora
  // sigue el mismo ciclo de vida que el LLM — asentar al abrir,
  // pendiente antes de initLlama, confirmación al primer embed bueno
  // o a la descarga ordenada con contexto vivo, pendiente limpiado
  // sin contar si initLlama falla en JS — con su propio registro.
  // Todo a prueba de fallos, como en LlamaEngine: si el fichero no
  // se puede leer o escribir, el motor sigue como antes.

  private crashGuardPath(): string {
    return `${FileSystem.documentDirectory}${EMBEDDING_CRASH_GUARD_FILENAME}`;
  }

  private async crashGuardRead(): Promise<CrashGuardRecord> {
    if (this.crashGuard) return this.crashGuard;
    let record: CrashGuardRecord = { crashes: 0, pending: null, lastCrashAt: null };
    try {
      const raw = await FileSystem.readAsStringAsync(this.crashGuardPath());
      record = parseCrashGuardRecord(raw);
    } catch {
      // Sin fichero (primera vez) o ilegible: registro vacío.
    }
    this.crashGuard = record;
    return record;
  }

  private async crashGuardWrite(record: CrashGuardRecord): Promise<void> {
    this.crashGuard = record;
    try {
      await FileSystem.writeAsStringAsync(this.crashGuardPath(), JSON.stringify(record));
    } catch {
      // La memoria en proceso manda; el siguiente arranque reintenta.
    }
  }

  /** Al abrir una carga: asienta el registro y devuelve el factor que manda en su pre-flight. */
  private async crashGuardSettle(): Promise<number> {
    const before = await this.crashGuardRead();
    const { record, safety } = settleCrashGuardRecord(before, {
      modelAlive: this.context !== null,
      now: Date.now(),
    });
    if (record !== before) await this.crashGuardWrite(record);
    return safety;
  }

  /** Deja el intento en vuelo persistido ANTES de crear el contexto. */
  private async crashGuardMarkPending(model: string): Promise<void> {
    const record = await this.crashGuardRead();
    await this.crashGuardWrite({ ...record, pending: { model, nCtx: 512, at: Date.now() } });
  }

  /** F3-15, en los dos motores: un fallo JS capturable limpia el pendiente sin contar. */
  private async crashGuardClearPending(): Promise<void> {
    const record = await this.crashGuardRead();
    if (!record.pending) return;
    await this.crashGuardWrite({ ...record, pending: null });
  }

  /** Una descarga ordenada con contexto vivo, o el primer embed bueno: contador a cero. */
  private async crashGuardConfirm(): Promise<void> {
    const record = await this.crashGuardRead();
    if (record.crashes === 0 && record.pending === null) return;
    await this.crashGuardWrite(confirmCrashGuardRecord(record));
  }

  /**
   * Borrado total (Clear All Data): olvida el registro en memoria,
   * como el del LLM. El wipe borra el fichero del disco (inventario
   * de appReset.ts), pero este singleton conserva su copia y la
   * siguiente carga la reescribiría tal cual.
   */
  resetCrashGuardMemory(): void {
    this.crashGuard = null;
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
    // F3-08: el registro se asienta al abrir la carga, como en el
    // LLM — un pendiente de un proceso muerto cuenta su choque y el
    // factor resultante juzga ESTE pre-flight.
    const crashSafety = await this.crashGuardSettle();
    // F2-2026-10-06: pre-flight ANTES de liberar el modelo actual (igual
    // que LlamaEngine). Si el chequeo falla, se conserva el modelo en uso.
    const snapshot = readRamSnapshot();
    const rawVerdict = snapshot
      ? checkRamBudget({ fileSizeBytes, nCtx: 512, ...(EMBEDDING_ARCH[modelFilename] ?? {}) }, snapshot)
      : null;
    // El factor del CrashGuard manda también aquí (F3-08): el
    // veredicto conserva el disponible de la foto y lo que se
    // recalcula es fits, contra el presupuesto reducido.
    const budgetBytes =
      rawVerdict && crashSafety < 1 ? Math.floor(rawVerdict.availableBytes * crashSafety) : null;
    const verdict =
      rawVerdict && budgetBytes !== null
        ? { ...rawVerdict, fits: rawVerdict.totalBytes <= budgetBytes }
        : rawVerdict;
    if (verdict && !verdict.fits) {
      // Fase 2 (reapertura, 2026-11-08): el rechazo también queda
      // registrado — la tarjeta no dice qué motor la disparó, y si el
      // que rechaza es este, el LLM ni siquiera lo intenta. Desde
      // F3-08 el registro lleva el factor de SU CrashGuard cuando el
      // rechazo viene de él (antes: siempre null, otro síntoma de
      // vivir fuera del sistema).
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
        crashSafety: crashSafety < 1 ? crashSafety : null,
        embedding: true,
        readFailure: snapshot!.liveReadMissing ? "live" : null,
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
        crashSafety < 1 ? crashSafety : null,
        budgetBytes !== null && budgetBytes < verdict.availableBytes ? budgetBytes : null,
      );
    }
    await this.unloadNow();
    // El intento queda persistido ANTES de crear el contexto — si el
    // proceso muere dentro de initLlama, el siguiente arranque lo
    // cuenta (la recarga bajo demanda ya no reintenta a ciegas la
    // carga que mató al proceso: entra con el factor reducido).
    await this.crashGuardMarkPending(modelFilename);
    try {
      // M-37 (F2-M2): la puerta se repite pegada a initLlama, como en el
      // LLM — la ventana entre la primera comprobación y la creación del
      // contexto nativo queda reducida a la propia puerta. Dentro del
      // try: su rechazo limpia el pendiente sin contar (F3-15), como
      // cualquier otro error JS diagnosticado con el proceso vivo.
      await withStage("trust-check", () => assertTrustedModelFileByName(modelFilename));
      this.context = await withStage("initLlama-embedding", () =>
        initLlama({
          model: modelPath,
          embedding: true,
          n_ctx: 512,
          n_threads: 2,
          // m-75/F2-m4: la misma política de init que el LLM —
          // sin mlock (los pesos se leen por mmap, no se fijan en
          // RAM) y sin capas de GPU (CPU en toda la flota). Hasta
          // la 0.1.98 esta llamada no las llevaba y su residencia
          // real dependía de los valores por defecto del binario.
          use_mlock: false,
          n_gpu_layers: 0,
        })
      );
    } catch (e) {
      // F3-15: error JS capturable, proceso vivo — el pendiente se
      // limpia sin contar antes de relanzar.
      await this.crashGuardClearPending();
      throw e;
    }
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
      // F3-08: el primer embed bueno CONFIRMA la carga, como la
      // primera generación en el LLM — el pendiente cae y el
      // contador vuelve a cero. Sin escritura cuando no hay nada
      // que confirmar (crashGuardConfirm lo comprueba).
      void this.crashGuardConfirm();
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
    // Justicia del conteo, la misma regla que el LLM (0.1.85): la
    // descarga ordenada confirma SOLO si libera un contexto VIVO —
    // se captura a la entrada. loadNow llama a unloadNow siempre,
    // también sin residente y justo después de asentar: confirmar
    // ahí perdonaría en la misma carga el choque recién contado.
    const hadLiveContext = this.context !== null;
    await this.context?.release();
    this.context = null;
    this.modelFilename = null;
    this.modelSha256 = null;
    if (hadLiveContext) await this.crashGuardConfirm();
  }
}

export const embeddingEngine = new EmbeddingEngine();

export { cosineSimilarity } from "./pure";
