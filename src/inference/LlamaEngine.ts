import * as FileSystem from "expo-file-system/legacy";
import { initLlama, LlamaContext } from "llama.rn";
import { checkRamBudget, readRamSnapshot, toGb } from "./ramBudget";
import { assertTrustedModelFileByName } from "../models/modelTrust";
import { MODEL_CATALOG, type CatalogModel } from "../models/manifest";
import { withStage } from "../utils/stageError";

export interface ChatMessageInput {
  role: string;
  content: string;
}

export interface GenerateOptions {
  /** Legacy hand-built prompt string (assemblePrompt, src/rag/pure.ts). Exactly one of `prompt`/`messages` must be given. */
  prompt?: string;
  /**
   * Role-separated messages (assembleChatMessages, src/rag/pure.ts) for a
   * model that needs its own real chat/instruction template — passed
   * straight through to llama.rn's completion() with jinja enabled, which
   * applies the loaded GGUF's own embedded chat_template rather than any
   * template string this app would have to guess/hardcode. Only used for
   * models explicitly flagged `ModelCapabilities.usesChatTemplate`
   * (src/routing/types.ts) — everyone else keeps using `prompt`, unchanged.
   */
  messages?: ChatMessageInput[];
  nPredict?: number;
  temperature?: number;
  onToken?: (piece: string) => void;
  stop?: string[];
  /**
   * Safety-net budget, not a performance target — no per-generation timeout
   * existed anywhere in the app before this (see docs/ADAPTIVE_ROUTING.md
   * §14). Left unset for regular single-pass chat (already indirectly
   * bounded by nPredict); set for orchestrator.ts's multi-stage Deep
   * Research calls, where a stuck stage would otherwise compound silently
   * across several sequential model calls with no ceiling at all.
   */
  timeoutMs?: number;
  /** Called once, right before the timeout triggers stop() — lets the caller distinguish a timeout from a natural finish or a user-initiated stop. */
  onTimeout?: () => void;
}

/**
 * assemblePrompt (src/rag/pure.ts) hand-builds a plain-text prompt with our
 * own "User:"/"Assistant:"/"Question:" role labels rather than using
 * llama.rn's chat-template API (which would auto-derive stop tokens from
 * the GGUF's own Jinja template) — so nothing tells the model where a turn
 * actually ends. Left unset, a model that's done answering (especially on
 * a short/trivial prompt with little else to say) just keeps predicting
 * tokens and starts hallucinating a fake continuation of the conversation,
 * inventing new "User:" turns rather than stopping. These match our own
 * template's role markers so generation halts the moment it tries to do that.
 */
const DEFAULT_STOP_SEQUENCES = ["\nUser:", "\n\nUser:", "\nQuestion:", "\n\nQuestion:"];

export interface LoadedModelInfo {
  filename: string;
  nCtx: number;
  nThreads: number;
}

/**
 * Thin wrapper around llama.rn. Loads a GGUF model with mmap so weights
 * stream from disk rather than being fully resident, keeping peak RAM under
 * the model's working-set size (weights touched + KV cache), not the full
 * file size. No network access anywhere in this module.
 */
export class LlamaEngine {
  private context: LlamaContext | null = null;
  private modelInfo: LoadedModelInfo | null = null;
  // load()/unload() run one at a time. Concurrent loads (e.g. switching
  // models and closing Settings quickly) used to both release, both create a
  // context, and the one overwritten in this.context was never released,
  // leaking a whole model's memory.
  private queue: Promise<void> = Promise.resolve();
  // Completions currently running. Releasing a context while one runs
  // leaves its promise unsettled forever (the chat stays "generating"),
  // so unload stops them and waits for all first. F3-2026-10-06: es un
  // conjunto, no una sola — generate() ahora va por la cola pero stop()
  // puede interrumpir desde fuera.
  private inFlight: Set<Promise<unknown>> = new Set();

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task);
    this.queue = run.then(
      () => {},
      () => {}
    );
    return run;
  }

  load(modelFilename: string, opts?: { nCtx?: number; nThreads?: number }): Promise<void> {
    return this.enqueue(() => this.loadNow(modelFilename, opts));
  }

  private async loadNow(modelFilename: string, opts?: { nCtx?: number; nThreads?: number }) {
    // Per-model default context: smaller models declare a smaller defaultNCtx
    // in the catalog (context is the second biggest RAM term after weights).
    // An explicit opt always wins.
    const catalogEntry: CatalogModel | undefined = MODEL_CATALOG.find(
      (m) => m.filename === modelFilename
    );
    const nCtx = opts?.nCtx ?? catalogEntry?.defaultNCtx ?? 4096;
    const nThreads = opts?.nThreads ?? 4;

    // ChatScreen re-mounts (and calls load() again) every time Settings is
    // closed, even if the user didn't touch the model — re-initializing the
    // native llama.cpp context is expensive (seconds, for a multi-GB model),
    // so skip it entirely when nothing actually changed.
    if (
      this.context &&
      this.modelInfo?.filename === modelFilename &&
      this.modelInfo.nCtx === nCtx &&
      this.modelInfo.nThreads === nThreads
    ) {
      return;
    }

    const modelPath = `${FileSystem.documentDirectory}${modelFilename}`;
    // Integrity gate (NIDO): a model file is trusted for inference ONLY if
    // it is a curated catalog asset whose bytes are proven to be the
    // verified bytes (journal + size + SHA-256 + mtime binding — see
    // src/models/modelTrust.ts). A file merely existing at the expected
    // path is NEVER enough to reach initLlama. This runs before the
    // exists-check below so even the "not found" case reports honestly.
    await withStage("trust-check", () => assertTrustedModelFileByName(modelFilename));
    const info = await FileSystem.getInfoAsync(modelPath);
    if (!info.exists) {
      throw new Error(
        `Model not found at ${modelPath}. Run the setup wizard to install it first.`
      );
    }
    const fileSizeBytes = (info as { size?: number }).size ?? 0;

    // F2-2026-10-06: pre-flight ANTES de liberar el modelo actual. Si el
    // chequeo de RAM falla, el motor conserva el modelo en uso en vez de
    // quedar sin ninguno. Se resta la huella estimada del modelo actual
    // del RSS para evitar falsos negativos ("no cabe" cuando sí cabría
    // tras liberar).
    const snapshot = readRamSnapshot();
    const spec = {
      fileSizeBytes,
      nCtx,
      nLayer: catalogEntry?.arch?.nLayer,
      nKvHeads: catalogEntry?.arch?.nKvHeads,
      headDim: catalogEntry?.arch?.headDim,
    };
    const verdict = snapshot ? checkRamBudget(spec, snapshot) : null;
    if (verdict && !verdict.fits) {
      throw new Error(
        `"${modelFilename}" needs roughly ${toGb(verdict.totalBytes)}GB of RAM, but this ` +
          `device only has about ${toGb(verdict.availableBytes)}GB free (of ${toGb(verdict.totalRamBytes)}GB total). ` +
          `Try a smaller model from Settings > Tone & Model.`
      );
    }

    // Release any previously loaded model (e.g. actually switching models
    // from Settings) so we don't leak the old context's native memory.
    await this.unloadNow();

    try {
      this.context = await withStage("initLlama", () =>
        initLlama({
          model: modelPath,
          use_mlock: false, // avoid pinning full weights in RAM; rely on mmap streaming
          n_ctx: nCtx,
          n_threads: nThreads,
          n_gpu_layers: 0, // CPU-only for broad device compatibility; adjust per-device
        })
      );
      this.modelInfo = { filename: modelFilename, nCtx, nThreads };
    } catch (e: any) {
      // The native error here (from llama.rn/llama.cpp) is often terse
      // ("Failed to initialize context" with no further detail) — append
      // our own RAM estimate so the user (and future debugging) has an
      // actual hypothesis instead of a dead end, per diagnostics above.
      const nativeMessage = e?.message ?? String(e);
      const hint = verdict
        ? ` (this device has ~${toGb(verdict.totalRamBytes)}GB RAM, ~${toGb(verdict.availableBytes)}GB free; ` +
          `"${modelFilename}" needs roughly ${toGb(verdict.totalBytes)}GB — likely the cause if those are close)`
        : "";
      throw new Error(`Failed to load "${modelFilename}": ${nativeMessage}${hint}`);
    }
  }

  unload(): Promise<void> {
    return this.enqueue(() => this.unloadNow());
  }

  private async unloadNow() {
    // Stop takes effect between tokens, so a completion still processing its
    // prompt can run on for a while; wait for all rather than release under
    // them. F3-2026-10-06: espera al conjunto completo, no solo a la última.
    if (this.inFlight.size > 0) {
      await this.context?.stopCompletion().catch(() => {});
      await Promise.allSettled([...this.inFlight]);
    }
    const context = this.context;
    this.context = null;
    this.modelInfo = null;
    await context?.release();
  }

  getModelInfo(): LoadedModelInfo | null {
    return this.modelInfo;
  }

  get isLoaded(): boolean {
    return this.context !== null;
  }

  /**
   * Whether the loaded GGUF ships its own chat template (tokenizer.chat_template
   * metadata) that llama.cpp can parse as Jinja — i.e. whether generate({ messages })
   * will be formatted in the model's own instruction format.
   */
  hasEmbeddedChatTemplate(): boolean {
    return this.context?.isJinjaSupported() ?? false;
  }

  /**
   * F3-2026-10-06: generate() está serializado respecto a load()/unload()
   * durante el *arranque* de la completion (la cola garantiza que no se
   * interleavea con un unload). La espera de la completion ocurre FUERA de
   * la cola: si generate() retuviera la cola mientras espera, un load()
   * posterior (encolado detrás) nunca podría ejecutar su unloadNow() para
   * detener la generación → deadlock. unloadNow() detiene y espera todas
   * las completions en vuelo vía el conjunto inFlight.
   */
  async generate({
    prompt,
    messages,
    nPredict = 512,
    temperature = 0.7,
    onToken,
    stop,
    timeoutMs,
    onTimeout,
  }: GenerateOptions): Promise<string> {
    const started = await this.enqueue(() => this.startCompletion({ prompt, messages, nPredict, temperature, onToken, stop, timeoutMs, onTimeout }));
    try {
      const { text } = await started.completion;
      return text ?? started.getFull();
    } finally {
      this.inFlight.delete(started.completion);
      if (started.timer) clearTimeout(started.timer);
    }
  }

  private async startCompletion({
    prompt,
    messages,
    nPredict = 512,
    temperature = 0.7,
    onToken,
    stop,
    timeoutMs,
    onTimeout,
  }: GenerateOptions): Promise<{ completion: Promise<{ text?: string }>; getFull: () => string; timer: ReturnType<typeof setTimeout> | null }> {
    if (!this.context) throw new Error("LlamaEngine: model not loaded");
    if (!prompt && !messages) {
      throw new Error("LlamaEngine.generate: either prompt or messages must be provided");
    }

    const timer = timeoutMs
      ? setTimeout(() => {
          onTimeout?.();
          this.context?.stopCompletion();
        }, timeoutMs)
      : null;

    // messages+jinja lets llama.cpp apply the loaded GGUF's own embedded
    // chat_template — DEFAULT_STOP_SEQUENCES exist specifically because
    // this app's hand-built "Question:/Answer:" prompt shape gives the
    // model no other signal for where a turn ends (see that constant's own
    // doc comment); a real chat template already has its own proper
    // end-of-turn token the model was fine-tuned to emit, so forcing our
    // unrelated string-based stops on top of it would be either inert or
    // could truncate genuine content that happens to contain "User:"/
    // "Question:". Only applied when the caller passes explicit `stop`.
    const completionParams = messages
      ? { messages, jinja: true, n_predict: nPredict, temperature, stop: stop ?? [] }
      : { prompt: prompt!, n_predict: nPredict, temperature, stop: stop ?? DEFAULT_STOP_SEQUENCES };

    let full = "";
    const completion = this.context.completion(completionParams, (data) => {
      full += data.token;
      onToken?.(data.token);
    });
    this.inFlight.add(completion);
    return { completion, getFull: () => full, timer };
  }

  /**
   * Signals the native completion loop to stop. The in-flight generate()
   * call's completion() promise resolves normally with whatever text was
   * generated so far — this is llama.cpp's own clean-stop behavior, not an
   * error/abort path, so no try/catch needed around a stopped generate().
   */
  async stop(): Promise<void> {
    await this.context?.stopCompletion();
  }
}

export const llamaEngine = new LlamaEngine();
