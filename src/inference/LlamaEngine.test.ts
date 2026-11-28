/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type FakeContext = {
  // m-80 (auditoría 2026-11-13, F2-m9): en llama.rn real, context.model
  // es un OBJETO (NativeLlamaContext.model) y el motor lee de él los
  // metadatos del GGUF (loadTimeSampling). El doble anterior lo traía
  // como string y SIN metadata: la capa de muestreo de la carga no se
  // podía ejercer de punta a punta. Ahora trae los metadatos que el
  // test declare en mockModelMetadata.
  model: { metadata: Record<string, unknown> };
  isJinjaSupported: () => boolean;
  released: boolean;
  release: () => Promise<void>;
  completion: (params: unknown, onToken: (d: { token: string }) => void) => Promise<{ text: string } & Record<string, unknown>>;
  stopCompletion: () => Promise<void>;
  releasedWhileGenerating: boolean;
  lastParams: unknown;
  // VEL-5 acto 3: el bench() del upstream, alimentado por mockBenchResults.
  bench: (
    pp: number,
    tg: number,
    pl: number,
    nr: number,
  ) => Promise<{ speedPp: number; speedTg: number; nGpuLayers: number; nThreads: number; nBatch: number; nUBatch: number; flashAttn: number }>;
};
const created: FakeContext[] = [];
let inFlightInits = 0;
// RAM-2026-10-11: parámetros de cada initLlama y rechazo simulado por perfil.
const initCalls: Array<Record<string, unknown>> = [];
let rejectInit: ((p: Record<string, unknown>) => boolean) | null = null;
let maxConcurrentInits = 0;
// H-09/H-10: puerta del resumen de dispositivos (ver getBackendDevicesInfo).
let backendGate: Promise<void> | null = null;
// La variante nativa que llama.rn expone como context.androidLib (null: sin ella).
let mockAndroidLib: string | null = null;
// m-80: los metadatos del GGUF que el contexto falso declara (los lee
// loadTimeSampling al cargar); {} = el fichero no declara nada.
let mockModelMetadata: Record<string, unknown> = {};
// m-80: si el contexto falso «soporta» Jinja (hasEmbeddedChatTemplate).
let mockJinjaSupported = true;
// m-80: el veredicto nativo con el que la completion falsa se asienta
// (stopped_eos / stopped_limit / context_full / interrupted…), como el
// NativeCompletionResult real; null = sin veredicto (cae al conteo).
let mockStopVerdict: Record<string, unknown> | null = null;
// m-80: si está puesto, la completion falsa rechaza con este error.
let mockCompletionError: Error | null = null;
// m-80: si está puesto, la puerta de confianza rechaza la carga con él.
let mockTrustError: Error | null = null;
// T-07: mensaje de error por intento de initLlama (para la cascada de
// perfiles de m-73: cada perfil puede fallar con su propia causa).
let mockInitErrorFor: ((p: Record<string, unknown>, attempt: number) => string) | null = null;
// T-07: dispositivos que getBackendDevicesInfo devuelve; null = el de
// siempre. mockBackendDevicesError lo hace lanzar (P-32).
let mockBackendDevices: Array<{ backend: string; type: string; deviceName: string }> | null = null;
let mockBackendDevicesError: Error | null = null;
// VEL-5 acto 3: resultados del bench() falso, por orden de llamada, y
// el registro de sus argumentos (la forma de la medición se cobra).
let mockBenchResults: Array<{ speedPp: number; speedTg: number; nGpuLayers: number; nThreads: number; nBatch: number; nUBatch: number; flashAttn: number }> | null = null;
const mockBenchCalls: Array<[number, number, number, number]> = [];
// Tanda too-heavy (0.1.115): el bench nativo se cuelga (su promesa no
// se asienta nunca) y el contexto nace SIN bench (builds sin la
// función): los dos cuelgues del «Measuring…» eterno del dueño.
let mockBenchHangs = false;
let mockOmitBench = false;
// T-07: stopCompletion lanza (m-76: la envoltura defensiva del motor).
let mockStopCompletionThrows = false;
// T-07: el contexto falso nace SIN isJinjaSupported (builds viejos, P-33).
let mockOmitJinja = false;

vi.mock("llama.rn", () => ({
  initLlama: async (params: { model: string } & Record<string, unknown>) => {
    const { model } = params;
    initCalls.push(params);
    if (rejectInit?.(params)) {
      throw new Error(mockInitErrorFor?.(params, initCalls.length) ?? "Failed to initialize context");
    }
    inFlightInits++;
    maxConcurrentInits = Math.max(maxConcurrentInits, inFlightInits);
    await new Promise((r) => setTimeout(r, 5));
    inFlightInits--;
    const finishes: Array<() => void> = [];
    let generating = false;
    const ctx: FakeContext = {
      model: { metadata: mockModelMetadata },
      isJinjaSupported: () => mockJinjaSupported,
      released: false,
      releasedWhileGenerating: false,
      lastParams: undefined,
      release: async () => {
        if (generating) ctx.releasedWhileGenerating = true;
        ctx.released = true;
      },
      // Like llama.cpp: runs until stopped, and settles a moment after the stop (prompt still processing).
      // m-80: se asienta con el veredicto nativo que el test declare
      // (mockStopVerdict) o rechaza si mockCompletionError está puesto.
      // T-07: el texto se emite por trozos, como el nativo (la guarda de
      // bucle necesita tokens durante el streaming para poder marcar),
      // y con veredicto declarado la completion se asienta SOLA a los
      // pocos ms (un EOS/límite real no espera a que nadie pare nada).
      completion: (params, onToken) =>
        new Promise((resolve, reject) => {
          generating = true;
          ctx.lastParams = params;
          for (let i = 0; i < mockReplyText.length; i += 12) {
            onToken({ token: mockReplyText.slice(i, i + 12) });
          }
          if (mockReplyText.length === 0) onToken({ token: "" });
          finishes.push(() =>
            setTimeout(() => {
              generating = false;
              if (mockCompletionError) reject(mockCompletionError);
              else resolve({ text: mockReplyText, ...(mockStopVerdict ?? {}) });
            }, 20)
          );
          if (mockStopVerdict) {
            setTimeout(() => finishes.splice(0).forEach((f) => f()), 5);
          }
        }),
      stopCompletion: async () => {
        if (mockStopCompletionThrows) throw new Error("native stop failed");
        finishes.splice(0).forEach((f) => f());
      },
      bench: (pp: number, tg: number, pl: number, nr: number) => {
        mockBenchCalls.push([pp, tg, pl, nr]);
        if (mockBenchHangs) return new Promise<never>(() => {});
        const r = mockBenchResults?.[mockBenchCalls.length - 1];
        return Promise.resolve(
          r ?? { speedPp: 100, speedTg: 10, nGpuLayers: 0, nThreads: 4, nBatch: 512, nUBatch: 256, flashAttn: 0 },
        );
      },
    };
    if (mockOmitJinja) delete (ctx as { isJinjaSupported?: unknown }).isJinjaSupported;
    if (mockOmitBench) delete (ctx as { bench?: unknown }).bench;
    if (mockAndroidLib) (ctx as FakeContext & { androidLib?: string }).androidLib = mockAndroidLib;
    created.push(ctx);
    return ctx;
  },
  // H-09/H-10: el sustituto de variante (getBackendDevicesInfo) existe
  // en este mock para poder ejercer la cola del registro; la puerta
  // `backendGate` lo retiene cuando un test quiere decidir cuándo
  // «llega» el resumen de dispositivos.
  getBackendDevicesInfo: async () => {
    if (backendGate) await backendGate;
    if (mockBackendDevicesError) throw mockBackendDevicesError;
    return mockBackendDevices ?? [{ backend: "CPU", type: "cpu", deviceName: "Probe" }];
  },
}));
// Bounty tanda 3: el CrashGuard persiste en un JSON junto a los
// modelos; el mock guarda los ficheros en memoria para poder sembrarlo.
const fsStore = new Map<string, string>();
// H-09/H-10: compuerta de aterrizaje para las escrituras del registro
// de sesión nativa SOLO (el resto de ficheros aterriza al instante).
// En modo «manual» cada escritura queda retenida hasta que el test la
// aterriza (flush) o la descarta (drop = el proceso murió antes);
// `failSessionWrites` las hace rechazar (disco lleno). Es el arnés de
// la sonda de la preparación nido-prep-h09h10, hecho permanente.
const SESSION_PATH_SUFFIX = "nido-native-session.json";
let sessionWriteMode: "auto" | "manual" = "auto";
let failSessionWrites = false;
let pendingSessionWrites: Array<{ path: string; data: string; resolve: () => void }> = [];
function flushNextSessionWrite(): boolean {
  const w = pendingSessionWrites.shift();
  if (!w) return false;
  fsStore.set(w.path, w.data);
  w.resolve();
  return true;
}
function flushAllSessionWrites(): void {
  while (flushNextSessionWrite()) {
    /* drena */
  }
}
/** La muerte del proceso: lo que no aterrizó, no aterriza nunca. */
function dropSessionWrites(): void {
  pendingSessionWrites = [];
}
// 0.1.122: caché del prompt en disco. null = sin carpeta de caché (los
// tests de siempre: la caché queda «unsupported» y nada cambia).
let mockCacheDir: string | null = null;
const promptCacheFiles = new Map<string, number>();
const fsOps: string[] = [];
vi.mock("expo-file-system/legacy", () => ({
  documentDirectory: "file:///docs/",
  get cacheDirectory() {
    return mockCacheDir;
  },
  makeDirectoryAsync: async () => {},
  deleteAsync: async (path: string) => {
    fsOps.push(`delete:${path}`);
    promptCacheFiles.delete(path);
  },
  moveAsync: async ({ from, to }: { from: string; to: string }) => {
    fsOps.push(`move:${to}`);
    promptCacheFiles.delete(from);
    promptCacheFiles.set(to, Date.now());
  },
  readDirectoryAsync: async (dir: string) =>
    [...promptCacheFiles.keys()].filter((p) => p.startsWith(dir)).map((p) => p.slice(dir.length)),
  getInfoAsync: async (path: string) => mockCacheDir && path.startsWith(mockCacheDir) ? {
    exists: promptCacheFiles.has(path),
    modificationTime: promptCacheFiles.get(path),
  } : ({
    exists: true,
    // 0.1.84: el tamaño declarado en el catálogo por fichero — el
    // pre-flight cobra el peso REAL del modelo pedido, no un genérico.
    size: mockFileSizes[path.split("/").pop() ?? ""] ?? 1_000_000,
  }),
  readAsStringAsync: async (path: string) => {
    const v = fsStore.get(path);
    if (v === undefined) throw new Error("File not found");
    return v;
  },
  writeAsStringAsync: async (path: string, data: string) => {
    if (path.endsWith(SESSION_PATH_SUFFIX)) {
      if (failSessionWrites) throw new Error("ENOSPC simulado");
      if (sessionWriteMode === "manual") {
        return new Promise<void>((resolve) => {
          pendingSessionWrites.push({ path, data, resolve });
        });
      }
    }
    fsStore.set(path, data);
  },
}));
let mockTotalRamBytes = 12 * 1024 ** 3;
let mockRssBytes = 1024 ** 3;
// M2+M3 (crash nativo): el informe de cierres simulado; null = el
// build no lo soporta (sin cruce, comportamiento de siempre).
let mockCrashReport: unknown = null;
// P-03: los núcleos que la sonda nativa «ve»; null = build sin sonda.
let mockProcessorCount: number | null = null;
// Texto que la completion falsa emite/resuelve (los tests de noThink lo
// cambian por una respuesta con bloque <think>).
let mockReplyText = "Hi";
// Fase 3 (optimización 2026-11-08): la sonda de batería del mock.
let mockBattery: { levelPct: number; charging: boolean; powerSave: boolean } | null = null;
// 0.1.84: la lectura de memoria libre en vivo del mock (availMem del
// sistema); null = el build no la lee y el pre-flight va solo por total.
let mockAvailMemory: { availBytes: number; thresholdBytes: number; lowMemory: boolean } | null = null;
// 0.1.84: tamaños de fichero por nombre para el mock de FileSystem —
// el pre-flight pesa el modelo REAL (los del catálogo pesan ~400 MB).
const mockFileSizes: Record<string, number> = {
  "qwen2.5-0.5b-instruct-q4km.gguf": 397_808_192,
  "qwen2.5-0.5b-instruct-q5km.gguf": 420_086_336,
};
vi.mock("ram-monitor", () => ({
  getDeviceTotalRamBytes: () => mockTotalRamBytes,
  getMemoryInfo: () => ({ rssBytes: mockRssBytes }),
  getCrashReport: () => mockCrashReport,
  getProcessorCount: () => mockProcessorCount,
  getBatteryStatus: () => mockBattery,
  getThermalStatus: () => null,
  // 0.1.84: la lectura en vivo (availMem) que el snapshot del motor
  // consume; null = build sin ella (manda solo la cuenta por total).
  getAvailableMemory: () => mockAvailMemory,
}));
// The integrity gate is covered by src/models/modelTrust.test.ts; here it
// is stubbed so engine behavior is tested in isolation.
// m-80: el stub ya no es «siempre válido» a ciegas — un test puede poner
// mockTrustError y probar que la carga se niega antes de initLlama.
vi.mock("../models/modelTrust", () => ({
  assertTrustedModelFileByName: vi.fn(async () => {
    if (mockTrustError) throw mockTrustError;
  }),
}));

import { LlamaEngine, resolveSampling, SAMPLING_PRESETS, loadTimeSampling, LLAMA_CPP_SAMPLING_DEFAULTS, BenchTimeoutError, BenchUnavailableError } from "./LlamaEngine";
import { setFeatureOverrideForTests, resetFeatureFlagsForTests } from "../config/featureFlags";
import { isNativeGateTaken } from "./nativeGate";
import { refreshDevicePressure } from "./devicePressure";
import {
  isBackgroundIndexingHeld,
  resetBackgroundIndexingHold,
  type NativeSessionRecord,
} from "../diagnostics/nativeSession";

const live = () => created.filter((c) => !c.released);

beforeEach(() => {
  created.length = 0;
  inFlightInits = 0;
  maxConcurrentInits = 0;
  mockTotalRamBytes = 12 * 1024 ** 3;
  mockRssBytes = 1024 ** 3;
  initCalls.length = 0;
  rejectInit = null;
  mockReplyText = "Hi";
  mockCrashReport = null;
  mockProcessorCount = null;
  mockAvailMemory = null;
  fsStore.clear();
  sessionWriteMode = "auto";
  failSessionWrites = false;
  pendingSessionWrites = [];
  backendGate = null;
  mockAndroidLib = null;
  mockModelMetadata = {};
  mockJinjaSupported = true;
  mockStopVerdict = null;
  mockCompletionError = null;
  mockTrustError = null;
  mockInitErrorFor = null;
  mockBackendDevices = null;
  mockBackendDevicesError = null;
  mockStopCompletionThrows = false;
  mockOmitJinja = false;
  mockBenchResults = null;
  mockBenchCalls.length = 0;
  mockBenchHangs = false;
  mockOmitBench = false;
  resetFeatureFlagsForTests();
  resetBackgroundIndexingHold();
});

describe("RAM-2026-10-11: perfiles de memoria del LLM", () => {
  it("usa primero el perfil ahorrador: KV q8_0, n_ubatch 256, n_batch 512", async () => {
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    expect(initCalls).toHaveLength(1);
    expect(initCalls[0]).toMatchObject({ cache_type_k: "q8_0", cache_type_v: "q8_0", n_ubatch: 256, n_batch: 512, use_mlock: false });
    expect(engine.getModelInfo()?.memoryProfile).toBe("kv-q8");
  });

  it("si llama.cpp rechaza la KV cuantizada, carga con lote pequeño y KV normal", async () => {
    rejectInit = (p) => p.cache_type_v !== undefined;
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    expect(initCalls).toHaveLength(2);
    expect(initCalls[1].cache_type_k).toBeUndefined();
    expect(initCalls[1].n_ubatch).toBe(256);
    expect(engine.getModelInfo()?.memoryProfile).toBe("small-batch");
  });

  it("como último recurso, el perfil default: sin claves de caché y sin lote — la llamada original (forma 0.1.98)", async () => {
    // El último recurso es «exactamente los parámetros originales»:
    // sin lote, como cargó la 0.1.98. (La era intermedia F3-06 le
    // añadía el lote de la clase; la reversa de la carga de la
    // 0.1.102 lo retiró con el resto de esa maquinaria.) La cascada
    // degrada en el eje KV (q8 → fp16) y en el lote de los dos
    // primeros perfiles; este banco rechaza por NÚMERO de intento.
    let attempts = 0;
    rejectInit = () => ++attempts < 3;
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    expect(initCalls).toHaveLength(3);
    expect(Object.keys(initCalls[2]).sort()).toEqual(
      // 0.1.121: + state_cache_budget_mb, el tope que el pre-flight cuenta
      // (sin efecto en modelos de atención pura).
      ["model", "n_ctx", "n_gpu_layers", "n_threads", "use_mlock", "state_cache_budget_mb"].sort(),
    );
    expect(engine.getModelInfo()?.memoryProfile).toBe("default");
  });

  it("si ningún perfil carga, el error llega igual que antes", async () => {
    rejectInit = () => true;
    const engine = new LlamaEngine();
    await expect(engine.load("models/a.gguf")).rejects.toThrow(/Failed to load/);
    expect(engine.isLoaded).toBe(false);
  });
});

describe("Optimización 2026-11-08, fase 2: el lote sigue a la RAM del aparato", () => {
  it("en un aparato de 3,3 GiB el perfil kv-q8 nace con n_batch 256 / n_ubatch 128", async () => {
    mockTotalRamBytes = 3.3 * 1024 ** 3;
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    expect(initCalls).toHaveLength(1);
    expect(initCalls[0]).toMatchObject({ cache_type_k: "q8_0", n_batch: 256, n_ubatch: 128 });
    expect(engine.getModelInfo()?.memoryProfile).toBe("kv-q8");
  });

  it("en un aparato de 4 GiB el lote es el intermedio: 384/192", async () => {
    mockTotalRamBytes = 4 * 1024 ** 3;
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    expect(initCalls[0]).toMatchObject({ n_batch: 384, n_ubatch: 192 });
  });

  it("el perfil default no lleva lote ni en aparatos pequeños: es la llamada original (forma 0.1.98)", async () => {
    mockTotalRamBytes = 3.3 * 1024 ** 3;
    let attempts = 0;
    rejectInit = () => ++attempts < 3;
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    expect(initCalls).toHaveLength(3);
    expect(initCalls[2].cache_type_k).toBeUndefined();
    expect(initCalls[2].n_batch).toBeUndefined();
    expect(initCalls[2].n_ubatch).toBeUndefined();
    expect(engine.getModelInfo()?.memoryProfile).toBe("default");
  });
});

describe("Optimización 2026-11-08, fase 3: la presión del aparato baja los hilos", () => {
  it("con batería baja la carga nace con 3 hilos y n_ubatch 128", async () => {
    mockBattery = { levelPct: 10, charging: false, powerSave: false };
    refreshDevicePressure();
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    expect(initCalls[0].n_threads).toBe(3);
    expect(initCalls[0].n_ubatch).toBe(128);
    mockBattery = null;
    refreshDevicePressure();
  });

  it("con la opción explícita de hilos, la presión no manda", async () => {
    mockBattery = { levelPct: 10, charging: false, powerSave: false };
    refreshDevicePressure();
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf", { nThreads: 6 });
    expect(initCalls[0].n_threads).toBe(6);
    mockBattery = null;
    refreshDevicePressure();
  });
});

describe("LlamaEngine load/unload", () => {
  it("never leaves an orphaned context when loads overlap (quick model swaps)", async () => {
    const engine = new LlamaEngine();
    await Promise.all([engine.load("models/a.gguf"), engine.load("models/b.gguf"), engine.load("models/a.gguf")]);
    expect(maxConcurrentInits).toBe(1);
    expect(live()).toHaveLength(1);
    // m-80: el doble ya no trae model como string (en llama.rn real es un
    // objeto con metadata); la ruta cargada se comprueba en la llamada a
    // initLlama, que es donde el camino se decide.
    expect(initCalls[initCalls.length - 1].model).toBe("file:///docs/models/a.gguf");
    expect(engine.getModelInfo()?.filename).toBe("models/a.gguf");
  });

  it("skips a load of the model that is already loaded", async () => {
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    await Promise.all([engine.load("models/a.gguf"), engine.load("models/a.gguf")]);
    expect(created).toHaveLength(1);
  });

  it("serializes unload with a pending load, leaving nothing loaded", async () => {
    const engine = new LlamaEngine();
    await Promise.all([engine.load("models/a.gguf"), engine.unload()]);
    expect(live()).toHaveLength(0);
    expect(engine.isLoaded).toBe(false);
  });

  it("keeps working after a failed load", async () => {
    const engine = new LlamaEngine();
    const fs = await import("expo-file-system/legacy");
    const spy = vi.spyOn(fs, "getInfoAsync").mockResolvedValueOnce({ exists: false } as any);
    await expect(engine.load("models/missing.gguf")).rejects.toThrow(/not found/);
    await engine.load("models/b.gguf");
    expect(engine.getModelInfo()?.filename).toBe("models/b.gguf");
    spy.mockRestore();
  });

  it("stops and waits for a running generation before releasing its model", async () => {
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    const reply = engine.generate({ prompt: "say hi" });
    await engine.load("models/b.gguf");
    await expect(reply).resolves.toBe("Hi");
    expect(created[0].released).toBe(true);
    expect(created[0].releasedWhileGenerating).toBe(false);
    expect(engine.getModelInfo()?.filename).toBe("models/b.gguf");
  });

  it("F3-2026-10-06 + M-6: dos generate() a la vez se asientan; unload espera a la que corre y la encolada falla sin colgarse", async () => {
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    // M-6 (auditoría 2026-10-31): ya no corren dos completions a la
    // vez sobre el contexto (la caché KV es compartida). La primera
    // corre; la segunda espera en la cadena de generaciones. unload
    // detiene la que corre y libera; la encolada arranca después
    // contra un contexto liberado y rechaza con «model not loaded»
    // en vez de colgarse o de generar sobre un contexto muerto.
    const r1 = engine.generate({ prompt: "one" });
    const r2 = engine.generate({ prompt: "two" });
    await engine.unload();
    await expect(r1).resolves.toBe("Hi");
    await expect(r2).rejects.toThrow("model not loaded");
    expect(created[0].released).toBe(true);
    expect(created[0].releasedWhileGenerating).toBe(false);
    expect(engine.isLoaded).toBe(false);
  });

  it("M-6: dos generate() concurrentes corren en serie, cada una con su texto", async () => {
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    const ctx = created[0];
    const origCompletion = ctx.completion;
    let active = 0;
    let maxActive = 0;
    const starts: string[] = [];
    ctx.completion = (params, onToken) => {
      active++;
      maxActive = Math.max(maxActive, active);
      starts.push(String((params as { prompt?: string }).prompt ?? ""));
      return origCompletion(params, onToken).finally(() => { active--; });
    };
    const r1 = engine.generate({ prompt: "one" });
    const r2 = engine.generate({ prompt: "two" });
    // Dar tiempo a que arranquen las que puedan arrancar: solo la
    // primera debe haber empezado.
    await new Promise((r) => setTimeout(r, 30));
    expect(starts).toEqual(["one"]);
    expect(maxActive).toBe(1);
    // Al detener la primera (como hace stop en la app), se asienta
    // y solo entonces arranca la segunda.
    await engine.stop();
    await expect(r1).resolves.toBe("Hi");
    await new Promise((r) => setTimeout(r, 30));
    expect(starts).toEqual(["one", "two"]);
    await engine.stop();
    await expect(r2).resolves.toBe("Hi");
    expect(maxActive).toBe(1);
  });

  it("refuses to load with a clear RAM error when the model does not fit", async () => {
    // 2 GiB device, 1 GiB resident: 2 - 1 - 2 (headroom) = 0 available.
    // The error must mention RAM so ModelLoadErrorCard's memory diagnosis picks it up.
    mockTotalRamBytes = 2 * 1024 ** 3;
    mockRssBytes = 1024 ** 3;
    const engine = new LlamaEngine();
    await expect(engine.load("models/a.gguf")).rejects.toThrow(/RAM/);
    expect(created).toHaveLength(0);
    expect(engine.isLoaded).toBe(false);
  });

  it("loads when the model fits the device budget", async () => {
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    expect(engine.isLoaded).toBe(true);
    expect(created).toHaveLength(1);
  });

  it("skips the pre-flight when the RAM readout is blind instead of blocking", async () => {
    mockTotalRamBytes = 0;
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    expect(engine.isLoaded).toBe(true);
  });
});

describe("Bounty tanda 3: escalera de memoria y CrashGuard", () => {
  // Costes con la arquitectura por defecto y el fichero de 1 MB del
  // mock: ctx 4096 ≈ 387 MB · 3072 ≈ 291 MB (defecto 2026-11-08: los
  // logits ya no se cobran por lote completo). Disponible = total −
  // RSS − 2 GiB de reserva.
  // 0.1.84: estos escenarios viven en la clase ≤4 GiB y su escalera
  // baja hasta el peldaño de emergencia (1024) antes de rechazar; los
  // totales de abajo dejan sitio de sobra hasta 3072 (y el coste a
  // 4096 con el lote de su clase, 128, es 309,6 MB: cabe en 340), así
  // que el peldaño que manda es el techo o el siguiente, como siempre.
  it("baja un peldaño de contexto en vez de rechazar cuando el techo no cabe", async () => {
    // 0.1.84: con el cómputo cobrado al lote real de la clase (128),
    // el genérico cuesta 309,6 MB a 4096: 300 MB libres ya no bastan
    // para el techo pero sí para 3072 (232,6 MB). El proceso lleva el
    // RSS real de la Tab (367 MiB) y el total lo suma: el hueco sobre
    // la reserva sigue siendo 300 MB. (Hasta la 0.1.98 el banco
    // ponía RSS 0 — «el proceso no pesa» — y la foto lo aceptaba;
    // desde F3-12 un RSS 0 es una lectura vacía y entra la
    // estimación base, así que el banco declara el peso de verdad.)
    mockTotalRamBytes = 2 * 1024 ** 3 + 300_000_000 + 367 * 1024 ** 2;
    mockRssBytes = 367 * 1024 ** 2;
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    expect(engine.isLoaded).toBe(true);
    expect(initCalls[0].n_ctx).toBe(3072);
  });

  it("un choque sin confirmar reduce el presupuesto de la siguiente carga, y generar confirma", async () => {
    // ≈380 MB libres sobre la reserva, con el proceso pesando lo de
    // la Tab (367 MiB, sumados al total): a factor 1 el 4096 cabría
    // (309,6 MB con el lote de la clase); el pendiente de un proceso
    // muerto cuenta un choque (factor 0,8 → 304 MB) y el techo ya no
    // cabe: baja a 3072 (232,6). (El RSS 0 del banco antiguo dejó de
    // ser una foto posible con F3-12.)
    mockTotalRamBytes = 2 * 1024 ** 3 + 380_000_000 + 367 * 1024 ** 2;
    mockRssBytes = 367 * 1024 ** 2;
    fsStore.set(
      "file:///docs/nido-crash-guard.json",
      JSON.stringify({ crashes: 0, pending: { model: "models/a.gguf", nCtx: 4096, at: 1 } })
    );
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    expect(initCalls[0].n_ctx).toBe(3072);
    // El intento nuevo quedó persistido como pendiente…
    const during = JSON.parse(fsStore.get("file:///docs/nido-crash-guard.json")!) as {
      crashes: number;
      pending: unknown;
    };
    expect(during.crashes).toBe(1);
    expect(during.pending).not.toBeNull();
    // …y la primera generación que termina bien lo confirma todo
    // (la completion del mock solo se asienta al detener, como siempre).
    const gen = engine.generate({ prompt: "hola" });
    await new Promise((r) => setTimeout(r, 30));
    await engine.stop();
    await expect(gen).resolves.toBe("Hi");
    await new Promise((r) => setTimeout(r, 0));
    const after = JSON.parse(fsStore.get("file:///docs/nido-crash-guard.json")!) as {
      crashes: number;
      pending: unknown;
    };
    expect(after).toEqual({ crashes: 0, pending: null });
  });

  it("un fallo de initLlama capturado en JS deja el pendiente escrito: el siguiente asentamiento lo cuenta (forma 0.1.98)", async () => {
    // Como en la 0.1.98: el pendiente se escribe ANTES de crear el
    // contexto y nada lo limpia cuando el error es capturable — el
    // asentamiento de la siguiente carga lo cuenta como choque.
    // (La limpieza sin contar de F3-15 se retiró en la reversa de
    // la carga de la 0.1.102.)
    rejectInit = () => true;
    const engine = new LlamaEngine();
    await expect(engine.load("models/a.gguf")).rejects.toThrow(/Failed to load/);
    const rec = JSON.parse(fsStore.get("file:///docs/nido-crash-guard.json")!) as {
      crashes: number;
      pending: unknown;
    };
    expect(rec.crashes).toBe(0);
    expect(rec.pending).not.toBeNull();
    // El siguiente intento, sano, carga — y su asentamiento contó
    // el pendiente heredado: el registro queda con un choque.
    rejectInit = null;
    await engine.load("models/a.gguf");
    expect(engine.isLoaded).toBe(true);
    const rec2 = JSON.parse(fsStore.get("file:///docs/nido-crash-guard.json")!) as {
      crashes: number;
      pending: unknown;
    };
    expect(rec2.crashes).toBe(1);
  });

  it("la vía de contexto EXPLÍCITO se juzga contra el disponible crudo, sin el factor del CrashGuard (forma 0.1.98)", async () => {
    const GUARD = "file:///docs/nido-crash-guard.json";
    const Q4 = "models/qwen2.5-0.5b-instruct-q4km.gguf";
    // Aparato justo: por total quedan ~0,9 GiB; el 0.5B a 2048
    // cuesta ~0,50 GiB — cabe contra el disponible CRUDO. Con tres
    // choques contados el factor bajaría el presupuesto al 50 % y
    // no cabría, pero la vía explícita no aplica el factor: el
    // factor manda en la ESCALERA (la vía automática), como en la
    // 0.1.98. (El juicio factorizado de la vía explícita era F3-11,
    // retirado en la reversa de la carga de la 0.1.102.)
    mockTotalRamBytes = 3.3 * 1024 ** 3;
    mockRssBytes = 0.4 * 1024 ** 3;
    fsStore.set(GUARD, JSON.stringify({ crashes: 3, pending: null }));
    const engine = new LlamaEngine();
    await engine.load(Q4, { nCtx: 2048 });
    expect(engine.isLoaded).toBe(true);
    expect(engine.getModelInfo()?.nCtx).toBe(2048);
  });
});

describe("Crash nativo M2+M3: registro de sesión y CrashGuard que aprende", () => {
  const SESSION_PATH = "file:///docs/nido-native-session.json";
  const GUARD_PATH = "file:///docs/nido-crash-guard.json";

  const readSession = (): NativeSessionRecord =>
    JSON.parse(fsStore.get(SESSION_PATH)!) as NativeSessionRecord;
  const readGuard = (): { crashes: number; pending: unknown } =>
    JSON.parse(fsStore.get(GUARD_PATH)!) as { crashes: number; pending: unknown };

  /** El registro que dejaría una generación muerta a mitad en el arranque anterior. */
  function seedDeadGeneration(generating: boolean): void {
    fsStore.set(
      SESSION_PATH,
      JSON.stringify({
        at: 1_000,
        model: "models/a.gguf",
        nCtx: 4096,
        nThreads: 4,
        memoryProfile: "kv-q8",
        reembed: { running: true, done: 120, total: 900 },
        generating,
        backend: null,
        crossedExitAt: null,
        verdict: null,
      }),
    );
    fsStore.set(GUARD_PATH, JSON.stringify({ crashes: 0, pending: null }));
  }

  function seedExit(reason: string, timestamp = 2_000): void {
    seedExits([{ reason, timestamp }]);
  }

  /** H-09: el informe con la LISTA de cierres tal como Android la entrega. */
  function seedExits(list: Array<{ reason: string; timestamp: number }>): void {
    mockCrashReport = {
      lastCrash: null,
      sdkInt: 36,
      device: "SM-X218U",
      exits: list.map(({ reason, timestamp }) => ({
        timestamp,
        reason,
        description: null,
        status: reason === "CRASH_NATIVE" ? 11 : 0,
        importance: 100,
        pssKb: 0,
        rssKb: 526 * 1024,
        trace: null,
      })),
    };
  }

  it("el registro se escribe al empezar a generar y la bandera cae al asentarse", async () => {
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    const gen = engine.generate({ prompt: "hola" });
    await new Promise((r) => setTimeout(r, 30));
    // En vuelo: la bandera está puesta y el registro es de ESTA generación.
    const during = readSession();
    expect(during.generating).toBe(true);
    expect(during.model).toBe("models/a.gguf");
    expect(during.nCtx).toBe(4096);
    expect(during.nThreads).toBe(4);
    expect(during.memoryProfile).toBe("kv-q8");
    await engine.stop();
    await expect(gen).resolves.toBe("Hi");
    await new Promise((r) => setTimeout(r, 10));
    expect(readSession().generating).toBe(false);
  });

  it("el registro no filtra contenido del usuario: solo metadatos de sesión", async () => {
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    const gen = engine.generate({ prompt: "SECRETO-DE-PRUEBA-123 cuéntame de mi familia" });
    await new Promise((r) => setTimeout(r, 30));
    await engine.stop();
    await expect(gen).resolves.toBe("Hi");
    const raw = fsStore.get(SESSION_PATH)!;
    expect(raw).not.toContain("SECRETO-DE-PRUEBA-123");
    expect(raw).not.toContain("familia");
  });

  it("una generación que nunca se asienta deja la bandera puesta (la muerte simulada)", async () => {
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    const gen = engine.generate({ prompt: "hola" });
    await new Promise((r) => setTimeout(r, 30));
    // Sin stop(): la promesa no se asienta y el registro conserva la
    // bandera — exactamente el estado que el cruce lee tras un crash.
    expect(readSession().generating).toBe(true);
    await engine.stop();
    await expect(gen).resolves.toBe("Hi");
  });

  it("arranque tras CRASH_NATIVE generando: choque ×0,8 contado una vez, fondo apagado y veredicto asentado", async () => {
    // 380 MB libres sobre la reserva (el proceso pesa lo de la Tab,
    // 367 MiB, sumados al total): a factor 1 el 4096 cabría (309,6 MB
    // con el lote de la clase); el choque aprendido (×0,8 → 304 MB)
    // baja el plan a 3072 (232,6 MB), como un choque del CrashGuard.
    mockTotalRamBytes = 2 * 1024 ** 3 + 380_000_000 + 367 * 1024 ** 2;
    mockRssBytes = 367 * 1024 ** 2;
    seedDeadGeneration(true);
    // La carga que murió dejó su pendiente sin confirmar: el cruce lo
    // consume, para que la misma muerte no se cuente dos veces.
    fsStore.set(
      GUARD_PATH,
      JSON.stringify({ crashes: 0, pending: { model: "models/a.gguf", nCtx: 4096, at: 900 } }),
    );
    seedExit("CRASH_NATIVE");
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    expect(initCalls[0].n_ctx).toBe(3072);
    expect(readGuard().crashes).toBe(1);
    expect(isBackgroundIndexingHeld()).toBe(true);
    const session = readSession();
    expect(session.crossedExitAt).toBe(2_000);
    expect(session.verdict).toMatchObject({
      exitAt: 2_000,
      diedGenerating: true,
      reembedRunning: true,
      nCtx: 4096,
      memoryProfile: "kv-q8",
    });
    // Y la primera generación buena de la sesión confirma el choque
    // aprendido como cualquier otro (el contador vuelve a cero).
    const gen = engine.generate({ prompt: "hola" });
    await new Promise((r) => setTimeout(r, 30));
    await engine.stop();
    await expect(gen).resolves.toBe("Hi");
    await new Promise((r) => setTimeout(r, 0));
    expect(readGuard().crashes).toBe(0);
  });

  it("arranque tras CRASH_NATIVE sin generar: veredicto sin choque ni apagado", async () => {
    seedDeadGeneration(false);
    seedExit("CRASH_NATIVE");
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    expect(readGuard().crashes).toBe(0);
    expect(isBackgroundIndexingHeld()).toBe(false);
    expect(readSession().verdict).toMatchObject({ diedGenerating: false, reembedRunning: true });
  });

  it("arranque tras LOW_MEMORY generando: la muerte SÍ cuenta y el fondo se apaga; sin veredicto (C-02)", async () => {
    // Hasta la 0.1.98 este arranque era «fenómeno aparte»: la muerte
    // por memoria a mitad de generación no dejaba rastro en ningún
    // contador, y un aparato justo moría igual en cada respuesta
    // larga para siempre. Desde C-02 cuenta como cualquier muerte
    // (×0,8 en la siguiente carga) y el indexado de fondo — el otro
    // gran consumidor — se apaga esa sesión. Lo que sigue siendo de
    // CRASH_NATIVE es el VEREDICTO (qué configuración murió), no el
    // conteo.
    seedDeadGeneration(true);
    seedExit("LOW_MEMORY");
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    expect(readGuard().crashes).toBe(1);
    expect(isBackgroundIndexingHeld()).toBe(true);
    const session = readSession();
    expect(session.verdict).toBeNull();
    expect(session.generating).toBe(false);
    expect(session.crossedExitAt).toBe(2_000);
    // Y la primera generación buena lo confirma, como todo choque.
    const gen = engine.generate({ prompt: "hola" });
    await new Promise((r) => setTimeout(r, 30));
    await engine.stop();
    await expect(gen).resolves.toBe("Hi");
    await new Promise((r) => setTimeout(r, 0));
    expect(readGuard().crashes).toBe(0);
  });

  it("arranque tras LOW_MEMORY SIN generar: fenómeno aparte, como siempre — sin conteo ni apagado", async () => {
    seedDeadGeneration(false);
    seedExit("LOW_MEMORY");
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    expect(readGuard().crashes).toBe(0);
    expect(isBackgroundIndexingHeld()).toBe(false);
    expect(readSession().crossedExitAt).toBe(2_000);
  });

  it("sin informe de cierres (build sin soporte): la carga sigue como siempre", async () => {
    seedDeadGeneration(true);
    mockCrashReport = null;
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    expect(engine.isLoaded).toBe(true);
    expect(readGuard().crashes).toBe(0);
    expect(isBackgroundIndexingHeld()).toBe(false);
  });

  // H-09+H-10 (adversaria 2026-11-01; diseño en nido-prep-h09h10):
  // la secuencia completa y los bordes de la bandera, con el arnés de
  // aterrizaje de la sonda hecho permanente.
  it("H-09 E1 · muerte → inocente → arranque que importa: el cruce elige la muerte y la reacción M3 entera sobrevive", async () => {
    seedDeadGeneration(true);
    // Android entrega la lista con el inocente DELANTE (es el más
    // reciente: abrió, miró, cerró sin cargar modelo).
    seedExits([
      { reason: "USER_REQUESTED", timestamp: 3_000 },
      { reason: "CRASH_NATIVE", timestamp: 2_000 },
    ]);
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    expect(readGuard().crashes).toBe(1);
    expect(isBackgroundIndexingHeld()).toBe(true);
    const session = readSession();
    expect(session.crossedExitAt).toBe(2_000);
    expect(session.generating).toBe(false);
    expect(session.verdict).toMatchObject({
      exitAt: 2_000,
      diedGenerating: true,
      reembedRunning: true,
      nCtx: 4096,
      memoryProfile: "kv-q8",
    });
  });

  it("H-10 E2 · resto nombrado W1 fixturado: si la escritura de arranque no aterrizó, el registro calla — sin veredicto inventado; el conteo lo salva el pendiente del CrashGuard, no el cruce", async () => {
    fsStore.set(GUARD_PATH, JSON.stringify({ crashes: 0, pending: null }));
    const a = new LlamaEngine();
    await a.load("models/a.gguf");
    sessionWriteMode = "manual"; // a partir de aquí, nada aterriza sin el test
    const gen = a.generate({ prompt: "hola" });
    gen.catch(() => {});
    await new Promise((r) => setTimeout(r, 40));
    // La verdad de esta generación iba en la escritura retenida.
    expect(pendingSessionWrites.length).toBeGreaterThanOrEqual(1);
    expect(JSON.parse(pendingSessionWrites[0].data).generating).toBe(true);
    // MUERTE generando: lo retenido se pierde con el proceso.
    dropSessionWrites();
    seedExits([{ reason: "CRASH_NATIVE", timestamp: Date.now() + 60_000 }]);
    sessionWriteMode = "auto";
    const b = new LlamaEngine();
    await b.load("models/a.gguf");
    // El resto, asentado tal como es: sin registro no hay cruce ni
    // veredicto (la ventana de UNA escritura por borde no la cierra
    // ningún diseño JS: no hay API síncrona en expo-file-system).
    expect(fsStore.has(SESSION_PATH)).toBe(false);
    expect(isBackgroundIndexingHeld()).toBe(false);
    // El conteo sobrevive por OTRO instrumento: el pendiente que la
    // carga muerta dejó en el CrashGuard.
    expect(readGuard().crashes).toBe(1);
    // Limpieza del banco: el «proceso muerto» se asienta al final para
    // no dejar la puerta nativa tomada a los tests siguientes (en el
    // aparato, ese proceso ya no existe y su puerta muere con él).
    await a.stop();
    await expect(gen).resolves.toBe("Hi");
  });

  it("H-10 E3 · la caída de la bandera ya no espera al resumen de dispositivos (W3→cola): aterriza con el resumen retenido, y el adjunto posterior no resucita la bandera", async () => {
    fsStore.set(GUARD_PATH, JSON.stringify({ crashes: 0, pending: null }));
    let releaseBackend!: () => void;
    backendGate = new Promise<void>((r) => {
      releaseBackend = r;
    });
    sessionWriteMode = "manual";
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    const gen = engine.generate({ prompt: "hola" });
    gen.catch(() => {});
    await new Promise((r) => setTimeout(r, 40));
    // La op de arranque es UNA escritura: aterriza y la op termina,
    // sin esperar a que el resumen de dispositivos resuelva.
    expect(pendingSessionWrites).toHaveLength(1);
    expect(JSON.parse(pendingSessionWrites[0].data).generating).toBe(true);
    flushNextSessionWrite();
    await new Promise((r) => setTimeout(r, 10));
    expect(pendingSessionWrites).toHaveLength(0);
    await engine.stop();
    await expect(gen).resolves.toBe("Hi");
    await new Promise((r) => setTimeout(r, 10));
    // La caída de la bandera YA está en la cola aunque el resumen
    // sigue retenido: una escritura, y es la del cierre.
    expect(pendingSessionWrites).toHaveLength(1);
    expect(JSON.parse(pendingSessionWrites[0].data).generating).toBe(false);
    flushNextSessionWrite();
    expect(readSession().generating).toBe(false);
    // El resumen llega tarde: su adjunto se encola DESPUÉS y escribe
    // sobre el registro asentado — la bandera no resucita.
    releaseBackend();
    await new Promise((r) => setTimeout(r, 10));
    flushAllSessionWrites();
    await new Promise((r) => setTimeout(r, 10));
    const settled = readSession();
    expect(settled.generating).toBe(false);
    // M-41: el resumen declara la ejecución (CPU, n_gpu_layers: 0) y los
    // dispositivos como vistos — antes era solo la lista de dispositivos.
    expect(settled.backend).toBe("ejecución CPU · vistos: CPU/cpu/Probe");
  });

  it("2026-11-13: el registro guarda la variante nativa real (context.androidLib) delante de los dispositivos", async () => {
    fsStore.set(GUARD_PATH, JSON.stringify({ crashes: 0, pending: null }));
    mockAndroidLib = "librnllama_jni_v8_2_dotprod_i8mm.so";
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    const gen = engine.generate({ prompt: "hola" });
    await new Promise((r) => setTimeout(r, 40));
    await engine.stop();
    await expect(gen).resolves.toBe("Hi");
    await new Promise((r) => setTimeout(r, 20));
    expect(readSession().backend).toBe(
      "lib librnllama_jni_v8_2_dotprod_i8mm.so · ejecución CPU · vistos: CPU/cpu/Probe",
    );
  });

  it("H-10 E4 · el divorcio W4 curado: una escritura rechazada no deja la caché mintiendo — la siguiente generación parte del registro de DISCO", async () => {
    // El registro de una generación muerta generando, sin cruzar.
    seedDeadGeneration(true);
    seedExit("CRASH_NATIVE");
    failSessionWrites = true; // el disco rechaza la escritura del cruce
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    // La reacción en proceso sí ocurrió (conteo y apagado); lo que
    // falló fue solo su persistencia.
    expect(readGuard().crashes).toBe(1);
    expect(isBackgroundIndexingHeld()).toBe(true);
    expect(readSession().crossedExitAt).toBeNull(); // en disco, el cruce nunca aterrizó
    failSessionWrites = false;
    const gen = engine.generate({ prompt: "hola" });
    await new Promise((r) => setTimeout(r, 30));
    await engine.stop();
    await expect(gen).resolves.toBe("Hi");
    await new Promise((r) => setTimeout(r, 10));
    // La generación nueva conservó la historia DEL DISCO (sin cruzar,
    // sin veredicto), no la que la escritura rechazada dejó en memoria.
    const session = readSession();
    expect(session.generating).toBe(false);
    expect(session.crossedExitAt).toBeNull();
    expect(session.verdict).toBeNull();
  });
});

describe("Bounty tanda 8: la frase cortada", () => {
  it("una generación que consume su presupuesto devuelve el texto cerrado en frase completa", async () => {
    mockReplyText = "La primera frase está completa. La segunda quedó cort";
    // m-80: el corte lo dice el veredicto nativo (stopped_limit), como en
    // el aparato — la completion se asienta sola, sin stop() de por medio.
    mockStopVerdict = { stopped_limit: 1 };
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    const gen = engine.generate({ prompt: "hola", nPredict: 1 });
    await expect(gen).resolves.toBe("La primera frase está completa.");
    expect(engine.lastGenerationWasCut).toBe(true);
  });

  it("con presupuesto de sobra, el texto vuelve entero y sin marca de corte", async () => {
    mockReplyText = "La primera frase está completa. La segunda quedó cort";
    // La generación termina sola (EOS): ni corte ni recorte, aunque el
    // texto acabe sin punto — es la respuesta del modelo tal cual.
    mockStopVerdict = { stopped_eos: true };
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    const gen = engine.generate({ prompt: "hola", nPredict: 64 });
    await expect(gen).resolves.toBe("La primera frase está completa. La segunda quedó cort");
    expect(engine.lastGenerationWasCut).toBe(false);
  });
});

describe("P1.2 sampling presets", () => {
  it("resolveSampling: no preset, no overrides -> old 0.7 default", () => {
    expect(resolveSampling({})).toEqual({ temperature: 0.7, topK: undefined, topP: undefined, minP: undefined, repeatPenalty: undefined });
  });

  it("resolveSampling: preset fills unset values", () => {
    const s = resolveSampling({ samplingPreset: "structured" });
    expect(s.temperature).toBe(0.1);
    expect(s.minP).toBe(0);
    expect(s.repeatPenalty).toBeUndefined();
    const c = resolveSampling({ samplingPreset: "chat" });
    expect(c.temperature).toBe(0.7);
    expect(c.repeatPenalty).toBe(1.1);
    expect(c.minP).toBe(0);
  });

  it("resolveSampling: explicit values always win over the preset", () => {
    const s = resolveSampling({ samplingPreset: "structured", temperature: 0.5, minP: 0.05, repeatPenalty: 1.2 });
    expect(s.temperature).toBe(0.5);
    expect(s.minP).toBe(0.05);
    expect(s.repeatPenalty).toBe(1.2);
  });

  // Estudio de modelos (2026-10-12): la capa del fabricante va DEBAJO
  // del preset — rellena lo que ningún preset define (topK/topP) sin
  // pisar la política por tarea.
  it("resolveSampling: los defaults del modelo rellenan topK/topP", () => {
    const s = resolveSampling({ modelDefaults: { topK: 20, topP: 0.8 } });
    expect(s.temperature).toBe(0.7);
    expect(s.topK).toBe(20);
    expect(s.topP).toBe(0.8);
  });

  it("resolveSampling: el preset gana a la temperatura del modelo; el topK del modelo sobrevive", () => {
    const s = resolveSampling({ samplingPreset: "factual", modelDefaults: { temperature: 0.2, topK: 80, repeatPenalty: 1.05 } });
    expect(s.temperature).toBe(0.3); // factual, no el 0.2 de LiquidAI
    expect(s.topK).toBe(80);
    expect(s.repeatPenalty).toBe(1.1); // 0.1.34: factual trae su propia penalización (bucles en la Tab A9+)
  });

  it("resolveSampling: explícito gana al modelo, y el preset de chat gana en repetición", () => {
    expect(resolveSampling({ topK: 5, modelDefaults: { topK: 80 } }).topK).toBe(5);
    expect(resolveSampling({ samplingPreset: "chat", modelDefaults: { repeatPenalty: 1.05 } }).repeatPenalty).toBe(1.1);
    expect(resolveSampling({ modelDefaults: { temperature: 0.2 } }).temperature).toBe(0.2);
  });

  it("loadTimeSampling: general.sampling.* del GGUF como strtol/strtof; si falta o no es un número, llama.cpp", () => {
    // M-36: el resultado trae además `declared` (vacío cuando el fichero
    // no declara nada); los cuatro valores de relleno no cambian.
    expect(loadTimeSampling(undefined)).toMatchObject(LLAMA_CPP_SAMPLING_DEFAULTS);
    expect(loadTimeSampling(undefined).declared).toEqual({});
    expect(loadTimeSampling({})).toMatchObject({ topK: 40, topP: 0.95, minP: 0.05, repeatPenalty: 1.0 });
    expect(
      loadTimeSampling({
        "general.sampling.top_k": "20",
        "general.sampling.top_p": "0.8",
        "general.sampling.min_p": "0",
        "general.sampling.penalty_repeat": "1.05",
      }),
    ).toEqual({
      topK: 20,
      topP: 0.8,
      minP: 0,
      repeatPenalty: 1.05,
      // M-36: los cuatro venían declarados y válidos — quedan en `declared`.
      declared: { topK: 20, topP: 0.8, minP: 0, repeatPenalty: 1.05 },
    });
    // strtol/strtof toman el número del principio; sin número, el valor por defecto.
    expect(loadTimeSampling({ "general.sampling.top_k": "64abc", "general.sampling.top_p": "x" })).toMatchObject({
      topK: 64,
      topP: 0.95,
    });
    expect(loadTimeSampling({ "general.sampling.top_k": " 30" }).topK).toBe(30);
  });

  it("SAMPLING_PRESETS table matches the research calibration", () => {
    expect(SAMPLING_PRESETS.structured.temperature).toBeLessThanOrEqual(0.2);
    expect(SAMPLING_PRESETS.factual.temperature).toBeLessThanOrEqual(0.4);
    // min_p pinned to 0 everywhere (llama.cpp default 0.05 breaks repetition-loop escape)
    for (const p of Object.values(SAMPLING_PRESETS)) expect(p.minP).toBe(0);
    // repeat penalty only on open chat, never on structured paths
    expect(SAMPLING_PRESETS.structured.repeatPenalty).toBeUndefined();
    expect(SAMPLING_PRESETS.chat.repeatPenalty).toBeGreaterThan(1);
  });

  it("generate() sin opciones manda los valores de la carga (llama.cpp por defecto si el GGUF no trae los suyos)", async () => {
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    const reply = engine.generate({ prompt: "hi" });
    await engine.unload(); // mock completion only settles on stop, like the existing tests
    await expect(reply).resolves.toBe("Hi");
    const params = created[0].lastParams as Record<string, unknown>;
    expect(params.temperature).toBe(0.7);
    expect(params.top_k).toBe(40);
    expect(params.top_p).toBe(0.95);
    expect(params.min_p).toBe(0.05);
    expect(params.penalty_repeat).toBe(1.0);
    expect("response_format" in params).toBe(false);
    expect("grammar" in params).toBe(false);
  });

  it("2026-11-13: una respuesta no hereda el muestreo de la anterior (llama.rn lo conserva si no se manda)", async () => {
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    const first = engine.generate({ prompt: "hi", samplingPreset: "chat" });
    await new Promise((r) => setTimeout(r, 30)); // que arranque de verdad
    await engine.stop();
    await expect(first).resolves.toBe("Hi");
    expect(created[0].lastParams).toMatchObject({ min_p: 0, penalty_repeat: 1.1 });
    const second = engine.generate({ prompt: "hi", temperature: 0.4 });
    await new Promise((r) => setTimeout(r, 30));
    await engine.unload();
    await expect(second).resolves.toBe("Hi");
    // Sin preset: lo de la carga, no el min_p 0 y la penalización 1.1 de antes.
    expect(created[0].lastParams).toMatchObject({ temperature: 0.4, top_k: 40, top_p: 0.95, min_p: 0.05, penalty_repeat: 1.0 });
  });

  it("generate() forwards sampling tunables to the native call", async () => {
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    const reply = engine.generate({ prompt: "hi", samplingPreset: "structured", topK: 40 });
    await engine.unload();
    await expect(reply).resolves.toBe("Hi");
    const params = created[0].lastParams as Record<string, unknown>;
    expect(params.temperature).toBe(0.1);
    expect(params.min_p).toBe(0);
    expect(params.top_k).toBe(40);
    // structured no fija penalización: va la de la carga (1.0, desactivada).
    expect(params.penalty_repeat).toBe(1.0);
  });

  it("generate() forwards response_format and grammar (P1.1)", async () => {
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    const schema = { type: "object", properties: { verdict: { type: "string" } }, required: ["verdict"] };
    const reply = engine.generate({
      messages: [{ role: "user", content: "x" }],
      responseFormat: { type: "json_schema", json_schema: { schema } },
    });
    await engine.unload();
    await expect(reply).resolves.toBe("Hi");
    const params = created[0].lastParams as Record<string, unknown>;
    expect(params.response_format).toEqual({ type: "json_schema", json_schema: { schema } });
    // grammar on the prompt path too
    const engine2 = new LlamaEngine();
    await engine2.load("models/a.gguf");
    const reply2 = engine2.generate({ prompt: "y", grammar: "root ::= \"a\"" });
    await engine2.unload();
    await expect(reply2).resolves.toBe("Hi");
    const params2 = created[1].lastParams as Record<string, unknown>;
    expect(params2.grammar).toBe('root ::= "a"');
  });
});

describe("P2.4 telemetry", () => {
  it("records an event per generation with timings and counts", async () => {
    const { clearTelemetry, getRecentTelemetry } = await import("./telemetry");
    clearTelemetry();
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    // The mock completion only resolves after stopCompletion (via unload),
    // like llama.cpp settling after a stop — same pattern as the P1.1 tests.
    const reply = engine.generate({
      messages: [{ role: "user", content: "hello" }],
      telemetryContext: { taskType: "test-task" },
    });
    await engine.unload();
    await expect(reply).resolves.toBe("Hi");
    const events = getRecentTelemetry(10);
    expect(events).toHaveLength(1);
    const e = events[0];
    expect(e.taskType).toBe("test-task");
    expect(e.completionTokens).toBe(1); // mock emits one token
    expect(e.ttftMs).not.toBeNull();
    expect(e.totalMs).toBeGreaterThanOrEqual(0);
    expect(e.stopReason).toBe("completed");
    expect(e.promptChars).toBeGreaterThan(0);
    expect(e.nPredict).toBe(512);
  });

  it("0.1.121: guarda la tasa y los tiempos que mide el motor (result.timings)", async () => {
    const { clearTelemetry, getRecentTelemetry } = await import("./telemetry");
    clearTelemetry();
    mockStopVerdict = {
      stopped_eos: true,
      timings: { cache_n: 40, prompt_n: 300, prompt_per_second: 88.5, predicted_n: 50, predicted_per_second: 15.6 },
    } as typeof mockStopVerdict;
    try {
      const engine = new LlamaEngine();
      await engine.load("models/a.gguf");
      await engine.generate({ messages: [{ role: "user", content: "hola" }] });
      const e = getRecentTelemetry(10)[0];
      // 0.1.123 (E-2): la tasa guardada es la vara sellada con la CUENTA
      // del motor (50 tokens): 49 / tiempo de generación. La del motor
      // (15,6) queda en los tiempos, no en tokensPerSec.
      const genMs = e.totalMs - (e.ttftMs ?? 0);
      expect(e.tokensPerSec).toBeCloseTo((49 / genMs) * 1000, 6);
      expect(e.tokensPerSec).not.toBe(15.6);
      expect(e.timings).toEqual({ promptN: 300, promptPerSec: 88.5, cacheN: 40, predictedN: 50, predictedPerSec: 15.6 });
      expect(engine.lastGenerationTimings?.promptPerSec).toBe(88.5);

      // «Última respuesta»: solo la generación que se vio escribirse.
      engine.beginVisibleTurn();
      expect(engine.lastVisibleGeneration).toBeNull();
      await engine.generate({ messages: [{ role: "user", content: "hola" }], onToken: () => {} });
      const visible = engine.lastVisibleGeneration;
      expect(visible?.timings?.promptN).toBe(300);
      const ring = getRecentTelemetry(10);
      expect(visible?.tokensPerSec).toBe(ring[ring.length - 1].tokensPerSec);
      // Una generación interna después (sin onToken) no la pisa.
      mockStopVerdict = {
        stopped_eos: true,
        timings: { cache_n: 0, prompt_n: 7, prompt_per_second: 10, predicted_n: 3, predicted_per_second: 9 },
      } as typeof mockStopVerdict;
      await engine.generate({ messages: [{ role: "user", content: "juez" }] });
      expect(engine.lastGenerationTimings?.promptN).toBe(7);
      expect(engine.lastVisibleGeneration).toBe(visible);
      await engine.unload();
    } finally {
      mockStopVerdict = null;
    }
  });

  it("0.1.123 (E-1): predictedCrashSafety da el factor de la PRÓXIMA carga sin escribir nada", async () => {
    const path = "file:///docs/nido-crash-guard.json";
    try {
      fsStore.set(path, JSON.stringify({ crashes: 2, pending: null }));
      let engine = new LlamaEngine();
      expect(await engine.predictedCrashSafety()).toBe(0.65);
      // Un pendiente sin modelo vivo contará como choque en la carga: la predicción lo cuenta ya.
      fsStore.set(path, JSON.stringify({ crashes: 0, pending: { model: "a.gguf", nCtx: 2048, at: 1 } }));
      engine = new LlamaEngine();
      expect(await engine.predictedCrashSafety()).toBe(0.8);
      // Y no escribe: el registro sigue con su pendiente.
      expect(JSON.parse(fsStore.get(path)!).pending).not.toBeNull();
      fsStore.delete(path);
      engine = new LlamaEngine();
      expect(await engine.predictedCrashSafety()).toBe(1);
    } finally {
      fsStore.delete(path);
    }
  });

  it("0.1.122: una respuesta completa anota el contexto como probado en este aparato (solo informa)", async () => {
    mockStopVerdict = { stopped_eos: true };
    try {
      const engine = new LlamaEngine();
      engine.resetProvenLoadsMemory();
      fsStore.delete("file:///docs/nido-proven-loads.json");
      expect(await engine.provenContexts()).toEqual({});
      await engine.load("models/qwen2.5-0.5b-instruct-q4km.gguf", { nCtx: 2048 });
      // 0.1.123 (auditoría, BAJA): una generación interna (sin onToken) no cuenta…
      await engine.generate({ prompt: "juez" });
      await new Promise((r) => setTimeout(r, 0));
      expect(await engine.provenContexts()).toEqual({});
      // …ni una cortada por el tope.
      mockStopVerdict = { stopped_limit: true };
      await engine.generate({ prompt: "larga", onToken: () => {} });
      await new Promise((r) => setTimeout(r, 0));
      expect(await engine.provenContexts()).toEqual({});
      // Una respuesta a la vista que termina sola, sí.
      mockStopVerdict = { stopped_eos: true };
      await engine.generate({ prompt: "hola", onToken: () => {} });
      await new Promise((r) => setTimeout(r, 0));
      const loads = await engine.provenContexts();
      expect(loads["qwen2.5-0.5b-instruct-q4km.gguf"]).toBe(engine.getModelInfo()?.nCtx);
      expect(loads["qwen2.5-0.5b-instruct-q4km.gguf"]).toBeGreaterThan(0);
      // Persistido: un motor nuevo lo lee del fichero.
      expect(JSON.parse(fsStore.get("file:///docs/nido-proven-loads.json") ?? "{}")).toEqual(loads);
      const fresh = new LlamaEngine();
      expect(await fresh.provenContexts()).toEqual(loads);
      await engine.unload();
    } finally {
      mockStopVerdict = null;
      fsStore.delete("file:///docs/nido-proven-loads.json");
    }
  });

  it("0.1.122: caché del prompt en disco — solo texto público, solo en contexto recién creado", async () => {
    mockStopVerdict = { stopped_eos: true };
    mockCacheDir = "file:///cache/";
    promptCacheFiles.clear();
    fsOps.length = 0;
    const SECRET = "Mi hija se llama Lucía";
    const publicPrefix = "Eres NIDO. Catálogo de herramientas fijo.\n";
    const msgs = [
      { role: "system", content: `${publicPrefix}## Memoria\n${SECRET}\nHoy es 27` },
      { role: "user", content: "¿qué tengo hoy?" },
    ];
    // Plantilla ChatML falsa, como la que aplicaría llama.rn.
    const fmt = (m: Array<{ role: string; content: string }>) =>
      m.map((x) => `<|im_start|>${x.role}\n${x.content}<|im_end|>\n`).join("") + "<|im_start|>assistant\n";
    const wire = (ctx: Record<string, unknown>, log: string[]) => {
      ctx.tokenize = async (t: string) => ({ tokens: new Array(Math.max(1, Math.ceil(t.length / 4))).fill(0) });
      ctx.getFormattedChat = async (m: Array<{ role: string; content: string }>) => ({ prompt: fmt(m) });
      const realCompletion = ctx.completion as (p: unknown, cb: (d: { token: string }) => void) => Promise<unknown>;
      ctx.completion = (p: Record<string, unknown>, cb: (d: { token: string }) => void) => {
        log.push(`completion:${typeof p.prompt === "string" ? p.prompt : "messages"}`);
        return realCompletion(p, cb);
      };
      ctx.saveSession = async (path: string, o: { tokenSize: number }) => {
        log.push(`save:${path}:${o.tokenSize}`);
        promptCacheFiles.set(path, Date.now());
        return o.tokenSize;
      };
      ctx.loadSession = async (path: string) => {
        log.push(`load:${path}`);
        return { tokens_loaded: 11, prompt: "" };
      };
    };
    try {
      // 1) Primer arranque: no hay fichero → procesa SOLO lo público y guarda.
      const engine = new LlamaEngine();
      await engine.load("models/a.gguf");
      const log: string[] = [];
      wire(created[created.length - 1] as unknown as Record<string, unknown>, log);
      await engine.generate({ messages: msgs, publicPrefix });
      expect(engine.lastPromptCache?.kind).toBe("saved");
      // Orden: calentamiento público → guardado → la respuesta real.
      expect(log[0]).toBe(`completion:<|im_start|>system\n${publicPrefix}`);
      expect(log[1]).toMatch(/^save:file:\/\/\/cache\/prompt-cache\/.*\.bin\.tmp:\d+$/);
      expect(log[2]).toBe("completion:messages");
      // Lo que se procesó antes de guardar NO contiene nada del usuario.
      expect(log[0]).not.toContain(SECRET);
      expect(log[0]).not.toContain("¿qué tengo hoy?");
      expect(log[0]).not.toContain("Hoy es");
      const saved = [...promptCacheFiles.keys()];
      expect(saved).toHaveLength(1);
      expect(saved[0]).toMatch(/\.bin$/);
      // 2) Segundo turno, mismo contexto: ni carga ni guarda (ya no es nuevo).
      log.length = 0;
      await engine.generate({ messages: msgs, publicPrefix });
      expect(log).toEqual(["completion:messages"]);
      await engine.unload();

      // 3) Arranque nuevo con el fichero en disco: lo carga, no guarda.
      const engine2 = new LlamaEngine();
      await engine2.load("models/a.gguf");
      const log2: string[] = [];
      wire(created[created.length - 1] as unknown as Record<string, unknown>, log2);
      await engine2.generate({ messages: msgs, publicPrefix });
      expect(engine2.lastPromptCache).toEqual({ kind: "loaded", tokens: 11 });
      expect(log2).toEqual([`load:${saved[0]}`, "completion:messages"]);
      await engine2.unload();

      // 4) Un fichero que no carga se borra y el turno sigue sin caché.
      const engine3 = new LlamaEngine();
      await engine3.load("models/a.gguf");
      const ctx3 = created[created.length - 1] as unknown as Record<string, unknown>;
      const log3: string[] = [];
      wire(ctx3, log3);
      ctx3.loadSession = async () => {
        throw new Error("Failed to load session");
      };
      await engine3.generate({ messages: msgs, publicPrefix });
      expect(engine3.lastPromptCache).toEqual({ kind: "failed", stage: "load" });
      expect(promptCacheFiles.has(saved[0])).toBe(false);
      expect(log3).toEqual(["completion:messages"]);
      await engine3.unload();

      // 5) Un prefijo que no es el principio del prompt real: no hay caché.
      const engine4 = new LlamaEngine();
      await engine4.load("models/a.gguf");
      const log4: string[] = [];
      wire(created[created.length - 1] as unknown as Record<string, unknown>, log4);
      await engine4.generate({ messages: msgs, publicPrefix: "otro texto\n" });
      expect(engine4.lastPromptCache).toEqual({ kind: "skipped", reason: "no-prefix" });
      expect(log4).toEqual(["completion:messages"]);
      await engine4.unload();
    } finally {
      mockStopVerdict = null;
      mockCacheDir = null;
      promptCacheFiles.clear();
    }
  });

  it("0.1.121: n_keep protege el prompt del sistema (tokens + margen de plantilla)", async () => {
    const { keepTokensFor, N_KEEP_TEMPLATE_MARGIN } = await import("./LlamaEngine");
    expect(keepTokensFor(300, 2048)).toBe(300 + N_KEEP_TEMPLATE_MARGIN);
    expect(keepTokensFor(5000, 2048)).toBe(2044);
    mockStopVerdict = { stopped_eos: true };
    try {
      const engine = new LlamaEngine();
      await engine.load("models/a.gguf");
      const ctx = created[created.length - 1] as unknown as Record<string, unknown>;
      let calls = 0;
      ctx.tokenize = async () => {
        calls++;
        return { tokens: new Array(120).fill(0) };
      };
      const msgs = [
        { role: "system", content: "Eres NIDO. Reglas de seguridad." },
        { role: "user", content: "hola" },
      ];
      await engine.generate({ messages: msgs });
      expect((ctx.lastParams as Record<string, unknown>).n_keep).toBe(120 + N_KEEP_TEMPLATE_MARGIN);
      await engine.generate({ messages: msgs });
      expect(calls).toBe(1); // el mismo prompt del sistema no se vuelve a contar
      // Sin mensaje de sistema, la llamada nativa no lleva n_keep.
      await engine.generate({ messages: [{ role: "user", content: "hola" }] });
      expect((ctx.lastParams as Record<string, unknown>).n_keep).toBeUndefined();
      await engine.unload();
    } finally {
      mockStopVerdict = null;
    }
  });

  it("0.1.121: la carga fija state_cache_budget_mb (sin efecto en atención pura)", async () => {
    const { llmInitParamsForProfile } = await import("./LlamaEngine");
    const p = llmInitParamsForProfile("kv-q8", { model: "m", n_ctx: 2048, n_threads: 4, state_cache_budget_mb: 64 }) as Record<string, unknown>;
    expect(p.state_cache_budget_mb).toBe(64);
    const legacy = llmInitParamsForProfile("default", { model: "m", n_ctx: 2048, n_threads: 4 }) as Record<string, unknown>;
    expect("state_cache_budget_mb" in legacy).toBe(false);
  });

  it("records timeout stopReason when the timer fires", async () => {
    const { clearTelemetry, getRecentTelemetry } = await import("./telemetry");
    clearTelemetry();
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    // The mock completion only resolves after stopCompletion; a 1ms
    // timeout forces the timeout path.
    await engine.generate({ prompt: "x", timeoutMs: 1 }).catch(() => {});
    await engine.unload();
    const events = getRecentTelemetry(10);
    expect(events).toHaveLength(1);
    expect(events[0].stopReason).toBe("timeout");
  });
});

// Lane Qwen3 (2026-10-12): el interruptor de pensamiento. Qwen3 piensa
// por defecto; su entrada de catálogo trae noThink y el motor debe
// pasar enable_thinking=false en la ruta jinja sin que ningún llamador
// tenga que acordarse, y sin tocar los params de los demás modelos.
describe("Qwen3 noThink: enable_thinking en el motor", () => {
  const QWEN3 = "models/qwen3-0.6b-q4km.gguf";
  const QWEN25 = "models/qwen2.5-0.5b-instruct-q4km.gguf";
  const MSGS = [{ role: "user", content: "hola" }];

  it("en la clase ≤4 GiB el Qwen3 (techo declarado 3072) nace con n_ctx 2048", async () => {
    mockTotalRamBytes = 3.3 * 1024 ** 3;
    // RSS 0 en este escenario: se mide el TECHO con el que el motor
    // nace, no el ajuste de la escalera a la presión del momento
    // (con el RSS por defecto del arnés el disponible cae por debajo
    // del piso y la escalera ni siquiera entra en juego).
    mockRssBytes = 0;
    const engine = new LlamaEngine();
    await engine.load(QWEN3);
    expect(initCalls[0].n_ctx).toBe(2048);
  });

  it("en la clase ancha el Qwen3 conserva su techo declarado 3072", async () => {
    mockTotalRamBytes = 12 * 1024 ** 3;
    const engine = new LlamaEngine();
    await engine.load(QWEN3);
    expect(initCalls[0].n_ctx).toBe(3072);
  });


  it("un modelo noThink recibe enable_thinking=false con messages", async () => {
    const engine = new LlamaEngine();
    await engine.load(QWEN3);
    const reply = engine.generate({ messages: MSGS });
    await engine.unload();
    await expect(reply).resolves.toBe("Hi");
    const params = created[0].lastParams as Record<string, unknown>;
    expect(params.jinja).toBe(true);
    expect(params.enable_thinking).toBe(false);
  });

  it("un modelo sin la marca NO recibe el parámetro (params legacy intactos)", async () => {
    const engine = new LlamaEngine();
    await engine.load(QWEN25);
    const reply = engine.generate({ messages: MSGS });
    await engine.unload();
    await expect(reply).resolves.toBe("Hi");
    const params = created[0].lastParams as Record<string, unknown>;
    expect("enable_thinking" in params).toBe(false);
  });

  it("la ruta prompt (sin plantilla) nunca lleva el parámetro", async () => {
    const engine = new LlamaEngine();
    await engine.load(QWEN3);
    const reply = engine.generate({ prompt: "hola" });
    await engine.unload();
    await expect(reply).resolves.toBe("Hi");
    const params = created[0].lastParams as Record<string, unknown>;
    expect("enable_thinking" in params).toBe(false);
  });

  it("la opción explícita gana sobre la marca del catálogo", async () => {
    const engine = new LlamaEngine();
    await engine.load(QWEN3);
    const reply = engine.generate({ messages: MSGS, enableThinking: true });
    await engine.unload();
    await expect(reply).resolves.toBe("Hi");
    const params = created[0].lastParams as Record<string, unknown>;
    expect(params.enable_thinking).toBe(true);
  });

  it("red de seguridad: un <think> filtrado no llega al texto final de un noThink", async () => {
    mockReplyText = "<think>razonamiento interno</think>Respuesta visible.";
    const engine = new LlamaEngine();
    await engine.load(QWEN3);
    const reply = engine.generate({ messages: MSGS });
    await engine.unload();
    await expect(reply).resolves.toBe("Respuesta visible.");
  });

  it("la red NO se aplica a modelos sin la marca (su texto pasa intacto)", async () => {
    mockReplyText = "<think>razonamiento interno</think>Respuesta visible.";
    const engine = new LlamaEngine();
    await engine.load(QWEN25);
    const reply = engine.generate({ messages: MSGS });
    await engine.unload();
    await expect(reply).resolves.toBe("<think>razonamiento interno</think>Respuesta visible.");
  });
});

// Estudio de modelos (2026-10-12): la receta del fabricante declarada en
// el catálogo llega a la llamada nativa vía el modelo cargado, y los
// modelos de razonamiento (LFM2.5) pierden su cadena en el texto final.
describe("estudio de modelos: sampling por modelo y stripReasoning", () => {
  const LFM = "models/hf-liquidai-lfm2-5-8b-a1b-gguf-lfm2-5-8b-a1b-q4-k-m-gguf.gguf";
  const QWEN15 = "models/qwen2.5-1.5b-instruct-q4km.gguf";
  const MSGS = [{ role: "user", content: "hola" }];

  it("LFM2.5 sin preset: llega su receta oficial (temp 0.2, top_k 80, rep 1.05)", async () => {
    const engine = new LlamaEngine();
    await engine.load(LFM);
    const reply = engine.generate({ messages: MSGS });
    await engine.unload();
    await expect(reply).resolves.toBe("Hi");
    const params = created[0].lastParams as Record<string, unknown>;
    expect(params.temperature).toBe(0.2);
    expect(params.top_k).toBe(80);
    expect(params.penalty_repeat).toBe(1.05);
  });

  it("LFM2.5 con preset factual: la temperatura es del preset, el top_k sobrevive", async () => {
    const engine = new LlamaEngine();
    await engine.load(LFM);
    const reply = engine.generate({ messages: MSGS, samplingPreset: "factual" });
    await engine.unload();
    await expect(reply).resolves.toBe("Hi");
    const params = created[0].lastParams as Record<string, unknown>;
    expect(params.temperature).toBe(0.3);
    expect(params.top_k).toBe(80);
  });

  it("0.1.34: un bucle de repetición del modelo queda en la primera vez", async () => {
    mockReplyText = "Ejemplos de plantas que conozco son " + "las aluminosas, ".repeat(30);
    const engine = new LlamaEngine();
    await engine.load(LFM);
    const reply = engine.generate({ messages: MSGS });
    await engine.unload();
    await expect(reply).resolves.toBe("Ejemplos de plantas que conozco son las aluminosas…");
  });

  it("0.1.34: con salida estructurada (JSON) la guarda no toca nada", async () => {
    mockReplyText = '{"a":"las aluminosas, ' + "las aluminosas, ".repeat(30) + '"}';
    const engine = new LlamaEngine();
    await engine.load(LFM);
    const reply = engine.generate({ messages: MSGS, responseFormat: { type: "json_object" } });
    await engine.unload();
    await expect(reply).resolves.toBe(mockReplyText);
  });

  it("LFM2.5: la cadena <think> no llega al texto final (stripReasoning)", async () => {
    mockReplyText = "<think>cadena de razonamiento muy larga</think>La respuesta final.";
    const engine = new LlamaEngine();
    await engine.load(LFM);
    const reply = engine.generate({ messages: MSGS });
    await engine.unload();
    await expect(reply).resolves.toBe("La respuesta final.");
  });

  it("Qwen2.5-1.5B: su top_p/top_k oficiales rellenan sin preset", async () => {
    const engine = new LlamaEngine();
    await engine.load(QWEN15);
    const reply = engine.generate({ messages: MSGS });
    await engine.unload();
    await expect(reply).resolves.toBe("Hi");
    const params = created[0].lastParams as Record<string, unknown>;
    expect(params.temperature).toBe(0.7);
    expect(params.top_k).toBe(20);
    expect(params.top_p).toBe(0.8);
  });

  it("un archivo fuera de catálogo no recibe capa de modelo (legacy intacto)", async () => {
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    const reply = engine.generate({ messages: MSGS });
    await engine.unload();
    await expect(reply).resolves.toBe("Hi");
    const params = created[0].lastParams as Record<string, unknown>;
    // Sin capa de modelo: los valores de la carga, no unos del catálogo.
    expect(params.top_k).toBe(40);
    expect(params.top_p).toBe(0.95);
  });
});

// Crash nativo (2026-10-31): M1 (la puerta que generate marca para
// que el indexado de fondo ceda) y M4 (la guarda de repetición ya no
// llama a stopCompletion desde dentro del callback de token).
describe("Crash nativo: puerta nativa y guarda de repetición", () => {
  it("M1: generate toma la puerta al llamar y la suelta al asentarse; dos en vuelo la mantienen tomada", async () => {
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    expect(isNativeGateTaken()).toBe(false);
    const r1 = engine.generate({ prompt: "one" });
    // Tomada de forma síncrona, al llamar: el fondo que consulte la
    // puerta desde este instante ya ve la generación.
    expect(isNativeGateTaken()).toBe(true);
    const r2 = engine.generate({ prompt: "two" });
    await new Promise((r) => setTimeout(r, 30)); // la primera ya corre (patrón de la casa)
    await engine.stop();
    await expect(r1).resolves.toBe("Hi");
    // La primera se asentó, pero la segunda llamó a generate y su
    // marca sigue: la puerta es un contador, no un booleano.
    expect(isNativeGateTaken()).toBe(true);
    await new Promise((r) => setTimeout(r, 30)); // que arranque la segunda
    await engine.stop();
    await expect(r2).resolves.toBe("Hi");
    expect(isNativeGateTaken()).toBe(false);
  });

  it("M1: una generación que falla al arrancar (sin modelo) también suelta la puerta", async () => {
    const engine = new LlamaEngine();
    await expect(engine.generate({ prompt: "x" })).rejects.toThrow("model not loaded");
    expect(isNativeGateTaken()).toBe(false);
  });

  it("M4: la guarda de repetición no llama a stopCompletion desde el callback de token; la parada diferida llega y el texto se recorta igual", async () => {
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    const ctx = created[0];
    // Completion falsa que emite token a token (el mock de la casa
    // emite todo de golpe y la guarda solo mira cada 8 tokens) y solo
    // se asienta cuando stopCompletion la detiene.
    const pieces = ["Ejemplos de plantas que conozco son ", ...Array.from({ length: 40 }, () => "las aluminosas, ")];
    let tokensSent = 0;
    let stopCalls = 0;
    let stopInsideCallback = false;
    let emitting = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    let settle: ((v: { text: string }) => void) | null = null;
    let settled = false;
    ctx.completion = (_params, onToken) =>
      new Promise<{ text: string }>((resolve) => {
        settle = resolve;
        let i = 0;
        timer = setInterval(() => {
          if (i >= pieces.length) {
            if (timer) clearInterval(timer);
            timer = null;
            if (!settled) {
              settled = true;
              settle?.({ text: pieces.join("") });
            }
            return;
          }
          emitting = true;
          tokensSent++;
          onToken({ token: pieces[i++] });
          emitting = false;
        }, 2);
      });
    ctx.stopCompletion = async () => {
      stopCalls++;
      if (emitting) stopInsideCallback = true;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      if (!settled) {
        settled = true;
        // Como llama.cpp: se asienta un momento después de la parada.
        setTimeout(() => settle?.({ text: pieces.slice(0, tokensSent).join("") }), 1);
      }
    };

    const forwarded: string[] = [];
    const gen = engine.generate({ prompt: "plantas", onToken: (p) => forwarded.push(p) });
    await new Promise((r) => setTimeout(r, 150));
    const callsWhileGenerating = stopCalls;
    const inside = stopInsideCallback;
    await engine.stop(); // seguridad: asienta la generación pase lo que pase
    const text = await gen;

    // La propiedad M4: ninguna parada se pidió con el callback de
    // token en la pila; la parada diferida sí llegó (una sola) con la
    // generación en vuelo.
    expect(inside).toBe(false);
    expect(callsWhileGenerating).toBe(1);
    // El comportamiento observable no cambia: el texto final es el de
    // siempre (primera aparición + «…») y lo transmitido se cortó al
    // detectarse el bucle, antes de que la generación se asentara.
    expect(text).toBe("Ejemplos de plantas que conozco son las aluminosas…");
    expect(forwarded.length).toBeLessThan(tokensSent);
  });
});

describe("P-03: hilos según los núcleos reales", () => {
  it("sin sonda (null) carga con 4, el default de siempre", async () => {
    mockProcessorCount = null;
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    expect(engine.getModelInfo()?.nThreads).toBe(4);
  });

  it("aparato estrecho (4 núcleos): la política baja a 2 sin opción explícita", async () => {
    mockProcessorCount = 4;
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    expect(engine.getModelInfo()?.nThreads).toBe(2);
  });

  it("aparato ancho (12 núcleos): la política sube al techo de 6", async () => {
    mockProcessorCount = 12;
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    expect(engine.getModelInfo()?.nThreads).toBe(6);
  });

  it("la clase de la Tab A9+ (8 núcleos) nace con 4", async () => {
    mockProcessorCount = 8;
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    expect(engine.getModelInfo()?.nThreads).toBe(4);
  });

  it("la opción explícita nThreads manda sobre la derivación", async () => {
    mockProcessorCount = 4; // la política diría 2
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf", { nThreads: 5 });
    expect(engine.getModelInfo()?.nThreads).toBe(5);
  });
});

describe("Fase 2 (reapertura 2026-11-08): el rechazo del pre-flight deja registro", () => {
  it("un rechazo queda en la telemetría con las cifras que vio el pre-flight", async () => {
    const { clearTelemetry, getRecentTelemetry } = await import("./telemetry");
    clearTelemetry();
    mockTotalRamBytes = 2 * 1024 ** 3;
    mockRssBytes = 1024 ** 3;
    const engine = new LlamaEngine();
    await expect(engine.load("models/a.gguf")).rejects.toThrow(/RAM/);
    const rejected = getRecentTelemetry(10).filter((e) => e.stopReason === "rejected");
    expect(rejected).toHaveLength(1);
    expect(rejected[0].modelId).toBe("models/a.gguf");
    expect(rejected[0].taskType).toBe("model-load");
    expect(rejected[0].ramRejection?.totalRamBytes).toBe(2 * 1024 ** 3);
    expect(rejected[0].ramRejection?.rssBytes).toBe(1024 ** 3);
    expect(rejected[0].ramRejection?.availableBytes).toBe(0);
    expect(rejected[0].ramRejection?.neededBytes).toBeGreaterThan(0);
  });

  it("una carga que cabe NO deja registro de rechazo", async () => {
    const { clearTelemetry, getRecentTelemetry } = await import("./telemetry");
    clearTelemetry();
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    expect(getRecentTelemetry(10).filter((e) => e.stopReason === "rejected")).toHaveLength(0);
  });
});

describe("0.1.84: la tableta real del dueño (3,54 GiB leídos, picos de 743–760 MB)", () => {
  const GiB = 1024 ** 3;
  const Q4 = "models/qwen2.5-0.5b-instruct-q4km.gguf";
  const Q5 = "models/qwen2.5-0.5b-instruct-q5km.gguf";

  it("el 0.5B Q4 carga en frío y pedírselo otra vez NO lo re-juzga ni lo recarga", async () => {
    mockTotalRamBytes = 3.54 * GiB;
    mockRssBytes = 0.35 * GiB;
    mockAvailMemory = { availBytes: 1.8 * GiB, thresholdBytes: 0.35 * GiB, lowMemory: false };
    const engine = new LlamaEngine();
    await engine.load(Q4);
    expect(engine.getModelInfo()?.nCtx).toBe(4096);
    expect(initCalls).toHaveLength(1);
    expect(initCalls[0]).toMatchObject({ n_ctx: 4096, cache_type_k: "q8_0", n_ubatch: 192 });
    // Segunda petición con el residente dentro: atajo, sin initLlama
    // nuevo y sin pasar por el pre-flight (si se re-juzgara con el
    // modelo contado en el RSS, esta foto lo rechazaría).
    mockRssBytes = 0.95 * GiB;
    mockAvailMemory = { availBytes: 0.5 * GiB, thresholdBytes: 0.35 * GiB, lowMemory: true };
    await engine.load(Q4);
    expect(initCalls).toHaveLength(1);
    expect(live()).toHaveLength(1);
  });

  it("el cambio Q4→Q5 pasa con el crédito del saliente en los dos términos", async () => {
    mockTotalRamBytes = 3.54 * GiB;
    mockRssBytes = 0.35 * GiB;
    mockAvailMemory = { availBytes: 1.8 * GiB, thresholdBytes: 0.35 * GiB, lowMemory: false };
    const engine = new LlamaEngine();
    await engine.load(Q4);
    // La foto del cambio: el Q4 residente sigue dentro del RSS (0,95)
    // y lo libre en vivo baja a 1,1 GiB. Sin el crédito simétrico el
    // término por total daría 0,59 GiB y el Q5 no cabría.
    mockRssBytes = 0.95 * GiB;
    mockAvailMemory = { availBytes: 1.1 * GiB, thresholdBytes: 0.35 * GiB, lowMemory: false };
    await engine.load(Q5);
    expect(engine.getModelInfo()?.filename).toBe(Q5);
    expect(engine.getModelInfo()?.nCtx).toBe(4096);
    expect(live()).toHaveLength(1);
    expect(created[0].released).toBe(true);
  });

  it("con la tableta apretada, el 0.5B solo entra por el peldaño de emergencia, fijado a kv-q8", async () => {
    mockTotalRamBytes = 3.54 * GiB;
    mockRssBytes = 0.95 * GiB;
    // Disponible en vivo 0,45 GiB: a 2048 el 0.5B cuesta 0,501 (no
    // cabe) y a 1024 cuesta 0,436 fp16 / 0,430 con la KV de q8 — el
    // peldaño de emergencia es el único que lo admite.
    mockAvailMemory = { availBytes: 1.05 * GiB, thresholdBytes: 0.35 * GiB, lowMemory: false };
    rejectInit = (p) => p.cache_type_v === undefined; // solo kv-q8 puede cargar
    const engine = new LlamaEngine();
    await engine.load(Q4);
    expect(engine.getModelInfo()?.nCtx).toBe(1024);
    expect(engine.getModelInfo()?.memoryProfile).toBe("kv-q8");
    expect(initCalls).toHaveLength(1);
    expect(initCalls[0]).toMatchObject({ n_ctx: 1024, cache_type_k: "q8_0" });
  });
});

describe("0.1.85: la foto exacta de las 19:54 como motor completo (RAM total REAL 3416 MiB)", () => {
  const MiB = 1024 ** 2;
  const Q4 = "models/qwen2.5-0.5b-instruct-q4km.gguf";
  const GUARD = "file:///docs/nido-crash-guard.json";
  const setPhoto = () => {
    mockTotalRamBytes = 3416 * MiB;
    mockRssBytes = 367 * MiB;
    mockAvailMemory = { availBytes: 842 * MiB, thresholdBytes: 216 * MiB, lowMemory: false };
  };

  it("con el freno 0,65 (dos choques contados) el 0.5B CARGA a 1024 por la vía de emergencia, fijado a kv-q8", async () => {
    setPhoto();
    fsStore.set(GUARD, JSON.stringify({ crashes: 2, pending: null }));
    rejectInit = (p) => p.cache_type_v === undefined; // solo kv-q8 puede cargar
    const engine = new LlamaEngine();
    await engine.load(Q4);
    expect(engine.getModelInfo()?.nCtx).toBe(1024);
    expect(engine.getModelInfo()?.memoryProfile).toBe("kv-q8");
    expect(initCalls).toHaveLength(1);
    expect(initCalls[0]).toMatchObject({ n_ctx: 1024, cache_type_k: "q8_0", n_ubatch: 128 });
    // El intento quedó pendiente: si el proceso muriera cargando, el
    // CrashGuard contaría el choque como siempre.
    const rec = JSON.parse(fsStore.get(GUARD)!);
    expect(rec.crashes).toBe(2);
    expect(rec.pending).not.toBeNull();
  });

  it("generar tras cargar en emergencia CURA el freno: la siguiente evaluación planifica con factor 1", async () => {
    setPhoto();
    fsStore.set(GUARD, JSON.stringify({ crashes: 2, pending: null }));
    const engine = new LlamaEngine();
    await engine.load(Q4);
    expect(engine.getModelInfo()?.nCtx).toBe(1024);
    const gen = engine.generate({ prompt: "hola" });
    await new Promise((r) => setTimeout(r, 30));
    await engine.stop();
    await expect(gen).resolves.toBe("Hi");
    await new Promise((r) => setTimeout(r, 0));
    expect(JSON.parse(fsStore.get(GUARD)!)).toEqual({ crashes: 0, pending: null });
  });

  it("JUSTICIA: descargar por las buenas y recargar NO degrada el factor (la descarga ordenada confirma)", async () => {
    setPhoto();
    fsStore.set(GUARD, JSON.stringify({ crashes: 2, pending: null }));
    const engine = new LlamaEngine();
    await engine.load(Q4);
    // Descarga ordenada sin haber generado: hasta la 0.1.84 el
    // pendiente quedaba vivo y la recarga lo contaba como choque.
    await engine.unload();
    await new Promise((r) => setTimeout(r, 0));
    expect(JSON.parse(fsStore.get(GUARD)!)).toEqual({ crashes: 0, pending: null });
    // La recarga planifica con el factor curado (sin degradar) y el
    // ciclo completo descargar → recargar → generar deja el registro
    // limpio, sin choques fantasma.
    await engine.load(Q4);
    expect(engine.getModelInfo()?.nCtx).toBe(1024);
    await engine.unload();
    await new Promise((r) => setTimeout(r, 0));
    expect(JSON.parse(fsStore.get(GUARD)!)).toEqual({ crashes: 0, pending: null });
  });

  it("el simétrico que NO debe curarse: un pendiente de un proceso muerto sigue contando al recargar", async () => {
    setPhoto();
    // El proceso anterior murió con la carga en vuelo: su pendiente
    // sigue en disco y NADIE llamó a unload (eso es lo que lo
    // distingue de la descarga ordenada).
    fsStore.set(GUARD, JSON.stringify({ crashes: 1, pending: { model: Q4, nCtx: 1024, at: 1 } }));
    const engine = new LlamaEngine();
    await engine.load(Q4);
    const rec = JSON.parse(fsStore.get(GUARD)!);
    expect(rec.crashes).toBe(2); // contó exactamente uno más
    expect(rec.pending).not.toBeNull(); // el intento nuevo, en vuelo
  });

  it("REINTENTO IDEMPOTENTE: dos rechazos seguidos no escriben pendiente ni cambian el factor", async () => {
    // Una foto donde ni la vía de emergencia alcanza (libre 500 MiB):
    // el rechazo es honesto y NO debe castigar el registro.
    mockTotalRamBytes = 3416 * MiB;
    mockRssBytes = 367 * MiB;
    mockAvailMemory = { availBytes: 500 * MiB, thresholdBytes: 216 * MiB, lowMemory: true };
    fsStore.set(GUARD, JSON.stringify({ crashes: 1, pending: null }));
    const engine = new LlamaEngine();
    await expect(engine.load(Q4)).rejects.toThrow(/RAM/);
    await expect(engine.load(Q4)).rejects.toThrow(/RAM/);
    const rec = JSON.parse(fsStore.get(GUARD)!);
    expect(rec.crashes).toBe(1);
    expect(rec.pending).toBeNull();
    // Y nada más cambia en el registro: sin marcas ni castigos (la
    // marca de caducidad de F3-07 se retiró con la reversa de la
    // carga de la 0.1.102; el registro vuelve a su forma 0.1.98).
    expect(Object.keys(rec).sort()).toEqual(["crashes", "pending"]);
  });

  it("LECTURA FRESCA entre intentos: dos fotos nativas distintas dan dos decisiones distintas en el motor", async () => {
    // Intento 1 con la mesa ocupada de verdad (libre 500 MiB, el
    // sistema YA en lowMemory) y el freno 0,65 sembrado (2 choques):
    // ni la vía de emergencia alcanza — el rechazo es honesto
    // (presupuesto de emergencia floor((500 × 0,9 − 216) × 0,65) =
    // 152 < 431, el suelo q8 a 1024; desde F3-02/F3-12 la vía
    // reserva el 10 % y con lowMemory resta el threshold, así que
    // ni sin freno cabría en esta foto: el sistema ya está cerrando
    // aplicaciones con 500 MiB libres).
    mockTotalRamBytes = 3416 * MiB;
    mockRssBytes = 367 * MiB;
    mockAvailMemory = { availBytes: 500 * MiB, thresholdBytes: 216 * MiB, lowMemory: true };
    fsStore.set(GUARD, JSON.stringify({ crashes: 2, pending: null }));
    const engine = new LlamaEngine();
    await expect(engine.load(Q4)).rejects.toThrow(/RAM/);
    // Intento 2 con la foto de las 19:54 (libre 842): carga a 1024.
    // Si hubiera caché o supuesto entre intentos, repetiría el rechazo.
    mockAvailMemory = { availBytes: 842 * MiB, thresholdBytes: 216 * MiB, lowMemory: false };
    await engine.load(Q4);
    expect(engine.getModelInfo()?.nCtx).toBe(1024);
  });

  it("un rechazo juzgado SIN la lectura en vivo queda registrado con su causa (readFailure live)", async () => {
    const { clearTelemetry, getRecentTelemetry } = await import("./telemetry");
    clearTelemetry();
    // Total legible pero la lectura en vivo no existe en este mock
    // (mockAvailMemory null = el build no la trae): el pre-flight va
    // solo por total y, si rechaza, el registro lo dice.
    mockTotalRamBytes = 2 * 1024 ** 3;
    mockRssBytes = 1024 ** 3;
    mockAvailMemory = null;
    const engine = new LlamaEngine();
    await expect(engine.load("models/a.gguf")).rejects.toThrow(/RAM/);
    const rejected = getRecentTelemetry(10).filter((e) => e.stopReason === "rejected");
    expect(rejected).toHaveLength(1);
    expect(rejected[0].ramRejection?.readFailure).toBe("live");
    expect(rejected[0].ramRejection?.availBytes).toBeNull();
  });
});

describe("0.1.86: la segunda llamada q8 conserva la condición de emergencia", () => {
  const MiB = 1024 ** 2;
  const GEMMA = "models/hf-google-gemma-4-e4b-it-qat-q4-0-gguf-gemma-4-e4b-q4-0-it-gguf.gguf";

  // Foto sintética en la ventana del censo §4.1 C, dentro de la Tab
  // (3416 MiB): presupuesto normal 370 MiB (disponible reportado:
  // total − RSS − reserva de 2 GiB), presupuesto de emergencia
  // 757,8 MiB (el availMem con la reserva del 10 % de F3-02, freno 1;
  // hasta la 0.1.98 era el crudo, 842). El Gemma real pesa
  // 5.154.941.280 B en disco; aquí su fichero vale 350 MiB para caer
  // en la ventana del defecto: a 1024 cuesta 501,0 MiB fp16 (solo
  // cabe por la vía de emergencia) y 448,5 MiB con KV q8.
  it("en el peldaño de emergencia la carga sale con KV q8 a 1024", async () => {
    mockTotalRamBytes = 3416 * MiB;
    mockRssBytes = 367 * MiB;
    mockAvailMemory = { availBytes: 842 * MiB, thresholdBytes: 216 * MiB, lowMemory: false };
    mockFileSizes["hf-google-gemma-4-e4b-it-qat-q4-0-gguf-gemma-4-e4b-q4-0-it-gguf.gguf"] = 350 * MiB;
    // Solo la KV q8 puede nacer: simula un llama.cpp que rechaza los
    // perfiles fp16 (small-batch y default).
    rejectInit = (p) => p.cache_type_v === undefined;
    const engine = new LlamaEngine();
    await engine.load(GEMMA);
    expect(engine.getModelInfo()?.nCtx).toBe(1024);
    expect(engine.getModelInfo()?.memoryProfile).toBe("kv-q8");
    expect(initCalls).toHaveLength(1);
    expect(initCalls[0]).toMatchObject({ n_ctx: 1024, cache_type_k: "q8_0" });
    delete mockFileSizes["hf-google-gemma-4-e4b-it-qat-q4-0-gguf-gemma-4-e4b-q4-0-it-gguf.gguf"];
  });

  // La ventana donde la segunda llamada se distingue: con un modelo
  // residente y lo libre en vivo casi agotado, el crédito liberable
  // del residente entra en el término en vivo: el presupuesto de
  // emergencia (availMem con su reserva + crédito) sigue admitiendo el q8 a
  // 1024 (448,5 MiB), pero el presupuesto NORMAL queda muy por
  // debajo de ese coste. Sin la simetría, la segunda llamada se
  // juzga con techo 1024 — sin peldaño de emergencia — y NO cabe: no
  // hay fijación, y si además llama.cpp rechaza la KV q8 la carga
  // cae a los perfiles fp16 y nace. Con la simetría, el plan q8
  // cabe, la fijación deja la lista en [kv-q8] y el rechazo nativo
  // de ese único perfil hace FALLAR la carga entera en vez de
  // degradarla a fp16. Ese fracaso-vs-degradación es el observable
  // que separa el arreglo de su ausencia: la nota del plan no puede
  // separarlos (a igual peldaño y techo, la nota del plan q8 y la
  // del fp16 son la misma cadena).
  it("con un residente previo, la fijación a kv-q8 solo nace si la segunda llamada conserva la emergencia", async () => {
    const Q4 = "models/qwen2.5-0.5b-instruct-q4km.gguf";
    mockFileSizes["hf-google-gemma-4-e4b-it-qat-q4-0-gguf-gemma-4-e4b-q4-0-it-gguf.gguf"] = 350 * MiB;
    mockTotalRamBytes = 3416 * MiB;
    mockRssBytes = 367 * MiB;
    // Primera foto holgada: el Q4 residente nace a su techo (4096).
    mockAvailMemory = { availBytes: 1843 * MiB, thresholdBytes: 216 * MiB, lowMemory: false };
    const engine = new LlamaEngine();
    await engine.load(Q4);
    expect(engine.getModelInfo()?.nCtx).toBe(4096);
    // La foto del cambio: lo libre en vivo ha caído a 20 MiB y el
    // RSS subió a 717 MiB (el residente Q4 más el resto de la app y
    // de lo que Android aún no ha soltado). El crédito liberable del
    // residente (585,7 MiB, su coste estimado a 4096 con KV q8) es
    // lo que mantiene viva la vía: el presupuesto de emergencia
    // (avail con la reserva del 10 % + crédito ≈ 603,7) admite el q8 a 1024 (448,5),
    // pero el presupuesto normal (≈448,7 menos threshold y margen,
    // ≈185,7 efectivos) queda muy por debajo. Medido con planContext
    // sobre esta misma foto: fp16 → 1024 cabe por emergencia; q8 con
    // techo 4096 → 1024 cabe; q8 con techo 1024 → NO cabe.
    mockRssBytes = 717 * MiB;
    mockAvailMemory = { availBytes: 20 * MiB, thresholdBytes: 216 * MiB, lowMemory: false };
    // llama.cpp rechaza la KV q8: con fijación, la lista es [kv-q8]
    // y la carga falla; sin fijación, cae a small-batch y carga fp16.
    rejectInit = (p) => p.cache_type_v !== undefined;
    initCalls.length = 0;
    await expect(engine.load(GEMMA)).rejects.toThrow(/Failed to load/);
    expect(initCalls).toHaveLength(1);
    expect(initCalls[0]).toMatchObject({ n_ctx: 1024, cache_type_k: "q8_0" });
    // Y la carga fallida no dejó modelo residente: el Q4 saliente se
    // liberó en el intento y el motor quedó sin contexto (la justicia
    // de F2: el fallo de RAM no llega hasta aquí porque el plan cabía;
    // el fallo nativo sí, y no finge un modelo vivo).
    expect(engine.isLoaded).toBe(false);
    delete mockFileSizes["hf-google-gemma-4-e4b-it-qat-q4-0-gguf-gemma-4-e4b-q4-0-it-gguf.gguf"];
  });
});

describe("0.1.86: una misma muerte no cuenta dos choques (pieza 6)", () => {
  const SESSION_PATH = "file:///docs/nido-native-session.json";
  const GUARD_PATH = "file:///docs/nido-crash-guard.json";
  const readGuard = (): { crashes: number; pending: unknown } =>
    JSON.parse(fsStore.get(GUARD_PATH)!) as { crashes: number; pending: unknown };

  // El escenario de la muerte física del 2026-11-09 05:28: la carga
  // dejó su pendiente sin confirmar Y la generación en vuelo dejó la
  // bandera puesta, con un cierre CRASH_NATIVE posterior. Los dos
  // instrumentos describen EL MISMO hecho; el registro debe contar
  // UN choque, no dos.
  function seedDeathOfMay9(pendingAt: number): void {
    fsStore.set(
      SESSION_PATH,
      JSON.stringify({
        at: 1_000,
        model: "models/a.gguf",
        nCtx: 4096,
        nThreads: 4,
        memoryProfile: "kv-q8",
        reembed: { running: false, done: 900, total: 900 },
        generating: true,
        backend: null,
        crossedExitAt: null,
        verdict: null,
      }),
    );
    fsStore.set(
      GUARD_PATH,
      JSON.stringify({ crashes: 0, pending: { model: "models/a.gguf", nCtx: 4096, at: pendingAt } }),
    );
    mockCrashReport = {
      lastCrash: null,
      sdkInt: 36,
      device: "SM-X218U",
      exits: [
        {
          timestamp: 2_000,
          reason: "CRASH_NATIVE",
          description: null,
          status: 11,
          importance: 100,
          pssKb: 0,
          rssKb: 526 * 1024,
          trace: null,
        },
      ],
    };
  }

  it("pendiente de la MISMA generación que murió (at <= inicio de la generación): un solo choque", async () => {
    seedDeathOfMay9(900);
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    expect(readGuard().crashes).toBe(1);
    expect(isBackgroundIndexingHeld()).toBe(true);
  });

  // Este caso documenta el límite del instrumento, no un defecto de
  // conteo (informe del cierre §6.2, verificado sobre el código de la
  // 0.1.85): el registro de sesión nativa no guarda id de carga, así
  // que un pendiente con at POSTERIOR al inicio de la generación
  // registrada no puede distinguirse de «el pendiente de la misma
  // carga que generó», y el cruce lo consume igual. Físicamente ese
  // at posterior exigiría una segunda carga entre medias — y toda
  // carga asienta antes de marcar su pendiente, así que un pendiente
  // así nunca llega vivo a un cruce posterior: la ventana es
  // inalcanzable y el conteo queda en uno, el lado seguro (un choque
  // de menos se cura generando; uno de más castigaría dos veces).
  it("pendiente con at posterior al de la generación registrada: el cruce lo consume igual (límite del instrumento, ventana inalcanzable)", async () => {
    seedDeathOfMay9(1_500);
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    expect(readGuard().crashes).toBe(1);
    expect(isBackgroundIndexingHeld()).toBe(true);
  });
});

describe("0.1.85: separación embeddings/CrashGuard (la indexación no castiga al LLM)", () => {
  const GUARD = "file:///docs/nido-crash-guard.json";

  it("un rechazo del pre-flight de embeddings deja el registro del CrashGuard byte a byte igual", async () => {
    const before = JSON.stringify({ crashes: 2, pending: { model: "models/x.gguf", nCtx: 2048, at: 7 } });
    fsStore.set(GUARD, before);
    // El motor de embeddings con un aparato donde no cabe ni su
    // contexto de 512: rechaza por su propio pre-flight.
    mockTotalRamBytes = 2 * 1024 ** 3;
    mockRssBytes = 2 * 1024 ** 3;
    const { EmbeddingEngine } = await import("../rag/embed");
    const emb = new EmbeddingEngine();
    await expect(emb.load("models/embedding.gguf")).rejects.toThrow(/RAM/);
    expect(fsStore.get(GUARD)).toBe(before);
  });
});

describe("M-36/m-72 (auditoría 2026-11-13): lo que el GGUF declara de sí mismo manda", () => {
  it("loadTimeSampling lee la temperatura del fichero y separa lo declarado", () => {
    const s = loadTimeSampling({
      "general.sampling.temp": "0.35",
      "general.sampling.top_k": "12",
      "general.sampling.top_p": "0.9",
    });
    expect(s.declared.temperature).toBe(0.35);
    expect(s.declared.topK).toBe(12);
    expect(s.declared.topP).toBe(0.9);
    expect(s.declared.minP).toBeUndefined();
    expect(s.topK).toBe(12);
    expect(s.topP).toBe(0.9);
    // Lo no declarado se rellena con lo de llama.cpp, como siempre.
    expect(s.minP).toBe(LLAMA_CPP_SAMPLING_DEFAULTS.minP);
    expect(s.repeatPenalty).toBe(LLAMA_CPP_SAMPLING_DEFAULTS.repeatPenalty);
  });

  it("m-72: valores fuera de rango no llegan al nativo — cuentan como no declarados", () => {
    const s = loadTimeSampling({
      "general.sampling.top_k": "-3",
      "general.sampling.top_p": "7.5",
      "general.sampling.min_p": "1.7",
      "general.sampling.penalty_repeat": "0",
      "general.sampling.temp": "99",
    });
    expect(s.declared).toEqual({});
    expect(s.topK).toBe(LLAMA_CPP_SAMPLING_DEFAULTS.topK);
    expect(s.topP).toBe(LLAMA_CPP_SAMPLING_DEFAULTS.topP);
    expect(s.minP).toBe(LLAMA_CPP_SAMPLING_DEFAULTS.minP);
    expect(s.repeatPenalty).toBe(LLAMA_CPP_SAMPLING_DEFAULTS.repeatPenalty);
  });

  it("m-72: los bordes válidos sí cuentan (top_k 0 desactiva, temp 0 es greedy)", () => {
    const s = loadTimeSampling({ "general.sampling.top_k": "0", "general.sampling.temp": "0" });
    expect(s.declared.topK).toBe(0);
    expect(s.declared.temperature).toBe(0);
  });

  it("resolveSampling: el fichero gana al catálogo; el preset y el llamante ganan al fichero", () => {
    const file = { temperature: 0.9, topK: 7, topP: 0.5, minP: 0.2, repeatPenalty: 1.3 };
    const catalog = { temperature: 0.2, topK: 80, topP: 0.8, repeatPenalty: 1.05 };
    expect(resolveSampling({ fileDefaults: file, modelDefaults: catalog })).toEqual({
      temperature: 0.9,
      topK: 7,
      topP: 0.5,
      minP: 0.2,
      repeatPenalty: 1.3,
    });
    // El preset factual fija temperatura/min_p/penalización: gana al fichero en lo suyo.
    const withPreset = resolveSampling({ fileDefaults: file, modelDefaults: catalog, samplingPreset: "factual" });
    expect(withPreset.temperature).toBe(0.3);
    expect(withPreset.minP).toBe(0);
    expect(withPreset.repeatPenalty).toBe(1.1);
    expect(withPreset.topK).toBe(7); // el preset no fija top_k: manda el fichero
    // El llamante gana a todas las capas.
    expect(resolveSampling({ fileDefaults: file, modelDefaults: catalog, temperature: 0.42 }).temperature).toBe(0.42);
    // Sin fichero, el catálogo sigue mandando como hasta ahora.
    expect(resolveSampling({ modelDefaults: catalog }).temperature).toBe(0.2);
  });

  it("motor: la temperatura y el top_k del GGUF pisan la receta del catálogo (LFM2.5)", async () => {
    mockModelMetadata = { "general.sampling.temp": "0.9", "general.sampling.top_k": "7" };
    const engine = new LlamaEngine();
    await engine.load("models/hf-liquidai-lfm2-5-8b-a1b-gguf-lfm2-5-8b-a1b-q4-k-m-gguf.gguf");
    const reply = engine.generate({ messages: [{ role: "user", content: "hola" }] });
    await engine.unload();
    await expect(reply).resolves.toBe("Hi");
    const params = created[0].lastParams as Record<string, unknown>;
    // El catálogo dice 0.2/80: el fichero declara 0.9/7 y el fichero manda.
    expect(params.temperature).toBe(0.9);
    expect(params.top_k).toBe(7);
    // Lo que el fichero calla sigue viniendo del catálogo.
    expect(params.penalty_repeat).toBe(1.05);
  });

  it("motor: un top_p imposible del GGUF (7.5) no viaja al nativo", async () => {
    mockModelMetadata = { "general.sampling.top_p": "7.5" };
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    const reply = engine.generate({ prompt: "hi" });
    await engine.unload();
    await expect(reply).resolves.toBe("Hi");
    const params = created[0].lastParams as Record<string, unknown>;
    expect(params.top_p).toBe(0.95);
  });

  it("m-80: si la puerta de confianza rechaza, la carga muere antes de initLlama", async () => {
    mockTrustError = new Error("ModelNotTrustedError: sha mismatch");
    const engine = new LlamaEngine();
    await expect(engine.load("models/a.gguf")).rejects.toThrow(/sha mismatch/);
    expect(initCalls).toHaveLength(0);
    expect(engine.isLoaded).toBe(false);
  });
});

describe("T-07: corte honesto (M-39), red de vacío (M-40) y bucle solo si se marcó (m-78)", () => {
  const FRASES = "Primera frase completa. Segunda a media fr";

  it("M-39: una parada del usuario recorta la frase a medias en el propio motor", async () => {
    mockReplyText = FRASES;
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    const gen = engine.generate({ prompt: "hola" });
    await new Promise((r) => setTimeout(r, 30));
    await engine.stop();
    await expect(gen).resolves.toBe("Primera frase completa.");
    // El veredicto de tope sigue siendo el del motor: aquí no hubo tope.
    expect(engine.lastGenerationWasCut).toBe(false);
  });

  it("M-39: un timeout también recorta la frase a medias", async () => {
    mockReplyText = FRASES;
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    const gen = engine.generate({ prompt: "hola", timeoutMs: 10 });
    await expect(gen).resolves.toBe("Primera frase completa.");
  });

  it("M-39: tras un corte, una generación que FALLA no deja el veredicto rancio", async () => {
    mockReplyText = FRASES;
    mockStopVerdict = { stopped_limit: 1 };
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    await expect(engine.generate({ prompt: "hola", nPredict: 1 })).resolves.toBe("Primera frase completa.");
    expect(engine.lastGenerationWasCut).toBe(true);
    // La siguiente generación muere con un error nativo: el veredicto de
    // la anterior no puede sobrevivir como si fuera de esta.
    mockStopVerdict = null;
    mockCompletionError = new Error("native completion failed");
    const gen = engine.generate({ prompt: "hola" });
    await new Promise((r) => setTimeout(r, 30));
    await engine.stop();
    await expect(gen).rejects.toThrow(/native completion failed/);
    expect(engine.lastGenerationWasCut).toBe(false);
  });

  it("M-40: un <think> sin cerrar no deja la respuesta vacía — se sirve el razonamiento", async () => {
    mockReplyText = "<think>El razonamiento completo queda aquí. Y sigue pens";
    mockStopVerdict = { stopped_limit: 1 };
    const engine = new LlamaEngine();
    await engine.load("models/hf-liquidai-lfm2-5-8b-a1b-gguf-lfm2-5-8b-a1b-q4-k-m-gguf.gguf");
    await expect(engine.generate({ messages: [{ role: "user", content: "hola" }] })).resolves.toBe(
      "El razonamiento completo queda aquí.",
    );
  });

  it("M-40: si solo hay bloque de pensamiento y nada más, se sirve ese texto, no un vacío", async () => {
    mockReplyText = "<think>pensando en voz alta</think>";
    mockStopVerdict = { stopped_eos: true };
    const engine = new LlamaEngine();
    await engine.load("models/hf-liquidai-lfm2-5-8b-a1b-gguf-lfm2-5-8b-a1b-q4-k-m-gguf.gguf");
    await expect(engine.generate({ messages: [{ role: "user", content: "hola" }] })).resolves.toBe(
      "pensando en voz alta",
    );
  });

  it("m-78: un texto que termina solo (EOS) no se recorta aunque su cola se repita", async () => {
    // La cola repetida cumple los umbrales de la guarda, pero la
    // generación terminó sola: ese texto es la respuesta del modelo y
    // el motor no le inventa un «…» ni le quita un trozo.
    mockReplyText = "El estribillo dice " + "ven aquí, ".repeat(12) + "y se acabó la canción.";
    mockStopVerdict = { stopped_eos: true };
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    await expect(engine.generate({ prompt: "hola" })).resolves.toBe(mockReplyText);
    expect(engine.lastGenerationLoopCut).toBe(false);
  });

  it("m-78: si la guarda marcó bucle en vivo, el asentado sí se recorta y queda registrado", async () => {
    mockReplyText = "Ejemplos de plantas que conozco son " + "las aluminosas, ".repeat(30);
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    const gen = engine.generate({ prompt: "hola" });
    await expect(gen).resolves.toBe("Ejemplos de plantas que conozco son las aluminosas…");
    expect(engine.lastGenerationLoopCut).toBe(true);
  });
});

describe("T-07: el diagnóstico dice lo que corrió (M-41/P-32)", () => {
  const SESSION_PATH = "file:///docs/nido-native-session.json";
  const readSession = (): NativeSessionRecord =>
    JSON.parse(fsStore.get(SESSION_PATH)!) as NativeSessionRecord;

  it("con GPU capaz (Adreno 750) el registro dice lo que ejecutó: la GPU, y los dispositivos vistos", async () => {
    // M-41 sigue mandando — el resumen dice lo que EJECUTÓ — pero
    // desde VEL-5 (0.1.110) lo que ejecuta una carga con la puerta
    // abierta ES el acelerador: la frase «ejecución CPU» era el
    // hecho de la era de n_gpu_layers: 0 universal, no la ley. La
    // ley es la correspondencia con el perfil que cargó.
    mockAndroidLib = "libggml-opencl.so";
    mockBackendDevices = [
      { backend: "OpenCL", type: "gpu", deviceName: "Adreno 750" },
      { backend: "CPU", type: "cpu", deviceName: "Probe" },
    ];
    mockStopVerdict = { stopped_eos: true };
    const engine = new LlamaEngine();
    // 0.1.111: la puerta de GPU se condiciona por formato — el
    // escenario carga el Q4_0 del catálogo, el que OpenCL acelera.
    await engine.load("models/hf-google-gemma-4-e4b-it-qat-q4-0-gguf-gemma-4-e4b-q4-0-it-gguf.gguf");
    await engine.generate({ prompt: "hola" });
    await new Promise((r) => setTimeout(r, 40));
    const backend = readSession().backend ?? "";
    expect(backend).toContain("lib libggml-opencl.so");
    expect(backend).toContain("ejecución GPU (Adreno 750)");
    expect(backend).toContain("vistos: OpenCL/gpu/Adreno 750");
    expect(backend).not.toMatch(/^OpenCL/);
  });

  it("P-32: si la sonda de dispositivos falla, el diagnóstico NO queda vacío para siempre", async () => {
    mockBackendDevicesError = new Error("sin sonda");
    mockStopVerdict = { stopped_eos: true };
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    await engine.generate({ prompt: "hola" });
    await new Promise((r) => setTimeout(r, 40));
    // Sin librería ni dispositivos, lo que ejecutó (CPU) sí se sabe.
    expect(readSession().backend).toContain("ejecución CPU");
  });

  it("P-32: con muchos dispositivos el resumen no corta un nombre por la mitad", async () => {
    mockBackendDevices = Array.from({ length: 12 }, (_, i) => ({
      backend: "OpenCL",
      type: "gpu",
      deviceName: `DispositivoConUnNombreLargo${i}`,
    }));
    mockStopVerdict = { stopped_eos: true };
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    await engine.generate({ prompt: "hola" });
    await new Promise((r) => setTimeout(r, 40));
    const backend = readSession().backend ?? "";
    expect(backend.length).toBeLessThanOrEqual(200);
    expect(backend).toMatch(/\+\d+ más/);
    // Cada nombre presente aparece ENTERO como entrada: ninguno partido.
    const vistosPart = backend.split("vistos: ")[1]?.replace(/ · \+\d+ más$/, "") ?? "";
    expect(vistosPart.length).toBeGreaterThan(0);
    for (const entry of vistosPart.split(", ")) {
      expect(entry).toMatch(/^OpenCL\/gpu\/DispositivoConUnNombreLargo\d+$/);
    }
  });
});

describe("T-07: VEL-5 acto 2 — la puerta de aceleración y el perfil «accel»", () => {
  it("con Adreno 750 y RAM amplia, la primera llamada es «accel» con su matriz entera", async () => {
    mockBackendDevices = [
      { backend: "OpenCL", type: "gpu", deviceName: "Adreno 750" },
      { backend: "CPU", type: "cpu", deviceName: "Probe" },
    ];
    const engine = new LlamaEngine();
    // 0.1.111: el escenario carga el Q4_0 del catálogo (42 capas),
    // el formato que la puerta de GPU condicionada deja pasar.
    await engine.load("models/hf-google-gemma-4-e4b-it-qat-q4-0-gguf-gemma-4-e4b-q4-0-it-gguf.gguf");
    expect(initCalls).toHaveLength(1);
    // La matriz sellada del perfil: dispositivo elegido, capas por
    // presupuesto (el fichero de 1 MB del arnés cabe entero: 42),
    // FA 'off', K q8_0, V f16.
    expect(initCalls[0]).toMatchObject({
      devices: ["Adreno 750"],
      n_gpu_layers: 42,
      flash_attn_type: "off",
      cache_type_k: "q8_0",
      cache_type_v: "f16",
    });
    expect(engine.getModelInfo()?.memoryProfile).toBe("accel");
    expect(engine.getModelInfo()?.accelDevice).toBe("Adreno 750");
  });

  it("declarado: en la Tab A9+ del dueño (Adreno 619) la puerta NO abre y la carga es la CPU de siempre", async () => {
    mockBackendDevices = [
      { backend: "OpenCL", type: "gpu", deviceName: "Adreno 619" },
      { backend: "CPU", type: "cpu", deviceName: "Probe" },
    ];
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    expect(initCalls).toHaveLength(1);
    expect(initCalls[0].n_gpu_layers).toBe(0);
    expect(initCalls[0].devices).toBeUndefined();
    expect(engine.getModelInfo()?.memoryProfile).toBe("kv-q8");
    expect(engine.getModelInfo()?.accelDevice).toBeUndefined();
  });

  it("un HTP presente no se auto-elige con la opción de NPU apagada (su defecto): encenderlo es la elección expresa del acto 3", async () => {
    mockBackendDevices = [
      { backend: "Hexagon", type: "accel", deviceName: "HTP0" },
      { backend: "CPU", type: "cpu", deviceName: "Probe" },
    ];
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    expect(initCalls[0].n_gpu_layers).toBe(0);
    expect(initCalls[0].devices).toBeUndefined();
    expect(engine.getModelInfo()?.memoryProfile).toBe("kv-q8");
  });

  it("si la creación acelerada falla, la cascada sigue a kv-q8 intacta (la cascada que PocketPal no tiene)", async () => {
    mockBackendDevices = [
      { backend: "OpenCL", type: "gpu", deviceName: "Adreno 750" },
      { backend: "CPU", type: "cpu", deviceName: "Probe" },
    ];
    rejectInit = (p) => Array.isArray(p.devices);
    mockInitErrorFor = () => "ggml-opencl: failed to create context";
    const engine = new LlamaEngine();
    // 0.1.111: Q4_0 del catálogo, para que el pick de GPU exista.
    await engine.load("models/hf-google-gemma-4-e4b-it-qat-q4-0-gguf-gemma-4-e4b-q4-0-it-gguf.gguf");
    expect(initCalls).toHaveLength(2);
    expect(initCalls[0].devices).toEqual(["Adreno 750"]);
    expect(initCalls[1].devices).toBeUndefined();
    expect(initCalls[1].cache_type_k).toBe("q8_0");
    expect(initCalls[1].cache_type_v).toBe("q8_0");
    expect(engine.getModelInfo()?.memoryProfile).toBe("kv-q8");
  });

  it("con presión (batería baja) la puerta se cierra en esa carga aunque el aparato sea capaz", async () => {
    mockBackendDevices = [
      { backend: "OpenCL", type: "gpu", deviceName: "Adreno 750" },
      { backend: "CPU", type: "cpu", deviceName: "Probe" },
    ];
    mockBattery = { levelPct: 10, charging: false, powerSave: false };
    refreshDevicePressure();
    const engine = new LlamaEngine();
    // 0.1.111: Q4_0 del catálogo, para que sea la PRESIÓN (y no la
    // puerta de formato) la que cierra esta carga.
    await engine.load("models/hf-google-gemma-4-e4b-it-qat-q4-0-gguf-gemma-4-e4b-q4-0-it-gguf.gguf");
    expect(initCalls[0].n_gpu_layers).toBe(0);
    expect(initCalls[0].devices).toBeUndefined();
    expect(engine.getModelInfo()?.memoryProfile).toBe("kv-q8");
    mockBattery = null;
    refreshDevicePressure();
  });

  it("sin lectura de RAM no hay presupuesto y no hay aceleración: la carga va en CPU", async () => {
    mockBackendDevices = [
      { backend: "OpenCL", type: "gpu", deviceName: "Adreno 750" },
      { backend: "CPU", type: "cpu", deviceName: "Probe" },
    ];
    mockTotalRamBytes = 0;
    const engine = new LlamaEngine();
    // 0.1.111: Q4_0 del catálogo, para que sea la falta de RAM (y no
    // la puerta de formato) la que deje esta carga sin presupuesto.
    await engine.load("models/hf-google-gemma-4-e4b-it-qat-q4-0-gguf-gemma-4-e4b-q4-0-it-gguf.gguf");
    expect(initCalls[0].n_gpu_layers).toBe(0);
    expect(initCalls[0].devices).toBeUndefined();
    expect(engine.getModelInfo()?.memoryProfile).toBe("kv-q8");
  });
});

describe("T-07: VEL-5 acto 3 — la opción de NPU y la medición con bench()", () => {
  const GEMMA_Q4_0 = "models/hf-google-gemma-4-e4b-it-qat-q4-0-gguf-gemma-4-e4b-q4-0-it-gguf.gguf";
  const QWEN_Q4KM = "models/qwen2.5-1.5b-instruct-q4km.gguf";
  const HTP_AND_CPU = [
    { backend: "Hexagon", type: "accel", deviceName: "HTP0" },
    { backend: "CPU", type: "cpu", deviceName: "Probe" },
  ];

  afterEach(() => {
    resetFeatureFlagsForTests();
  });

  it("con la opción encendida y un formato que el HTP sí descarga (Q4_0 del catálogo), la carga elige el NPU", async () => {
    setFeatureOverrideForTests("inference.npuAccel", true);
    mockBackendDevices = HTP_AND_CPU;
    const engine = new LlamaEngine();
    await engine.load(GEMMA_Q4_0);
    expect(initCalls).toHaveLength(1);
    expect(initCalls[0]).toMatchObject({
      devices: ["HTP0"],
      flash_attn_type: "off",
      cache_type_k: "q8_0",
      cache_type_v: "f16",
    });
    expect((initCalls[0].n_gpu_layers as number) ?? 0).toBeGreaterThan(0);
    expect(engine.getModelInfo()?.memoryProfile).toBe("accel");
    expect(engine.getModelInfo()?.accelDevice).toBe("HTP0");
  });

  it("con la opción encendida pero un Q4_K_M, el NPU ni se intenta: la carga es la CPU de siempre sin GPU", async () => {
    setFeatureOverrideForTests("inference.npuAccel", true);
    mockBackendDevices = HTP_AND_CPU;
    const engine = new LlamaEngine();
    await engine.load(QWEN_Q4KM);
    expect(initCalls).toHaveLength(1);
    expect(initCalls[0].devices).toBeUndefined();
    expect(initCalls[0].n_gpu_layers).toBe(0);
    expect(engine.getModelInfo()?.memoryProfile).toBe("kv-q8");
  });

  it("con la opción encendida, un Q4_K_M y una GPU capaz, ningún acelerador lo descarga de verdad: la carga es la CPU de siempre", async () => {
    // 0.1.111 (auditoría §7b.4): hasta la 0.1.110 este escenario
    // esperaba el pick de GPU, porque su puerta no condicionaba por
    // formato. Con la puerta condicionada como la del NPU, el
    // Q4_K_M no lo descarga de verdad ni el HTP ni OpenCL (que lo
    // degradaría a CPU en silencio): no hay pick, y la cascada de
    // CPU corre intacta y diciendo la verdad.
    setFeatureOverrideForTests("inference.npuAccel", true);
    mockBackendDevices = [
      { backend: "Hexagon", type: "accel", deviceName: "HTP0" },
      { backend: "OpenCL", type: "gpu", deviceName: "Adreno 750" },
      { backend: "CPU", type: "cpu", deviceName: "Probe" },
    ];
    const engine = new LlamaEngine();
    await engine.load(QWEN_Q4KM);
    expect(initCalls).toHaveLength(1);
    expect(initCalls[0].devices).toBeUndefined();
    expect(initCalls[0].n_gpu_layers).toBe(0);
    expect(engine.getModelInfo()?.memoryProfile).toBe("kv-q8");
  });

  it("si la creación en el NPU falla, la cascada sigue a kv-q8 sin tocar la conversación", async () => {
    setFeatureOverrideForTests("inference.npuAccel", true);
    mockBackendDevices = HTP_AND_CPU;
    rejectInit = (p) => Array.isArray(p.devices);
    mockInitErrorFor = () => "ggml-hexagon: failed to create context";
    const engine = new LlamaEngine();
    await engine.load(GEMMA_Q4_0);
    expect(initCalls).toHaveLength(2);
    expect(initCalls[0].devices).toEqual(["HTP0"]);
    expect(initCalls[1].devices).toBeUndefined();
    expect(initCalls[1].cache_type_v).toBe("q8_0");
    expect(engine.getModelInfo()?.memoryProfile).toBe("kv-q8");
  });

  it("probeNpuDevice: nombra el HTP cuando lo hay y devuelve null en la Tab A9+ (sin HTP)", async () => {
    mockBackendDevices = HTP_AND_CPU;
    await expect(new LlamaEngine().probeNpuDevice()).resolves.toBe("HTP0");
    mockBackendDevices = [
      { backend: "OpenCL", type: "gpu", deviceName: "Adreno 619" },
      { backend: "CPU", type: "cpu", deviceName: "Probe" },
    ];
    await expect(new LlamaEngine().probeNpuDevice()).resolves.toBeNull();
  });

  it("benchLoadedModel sin modelo residente devuelve null: no se inventa una medición", async () => {
    await expect(new LlamaEngine().benchLoadedModel()).resolves.toBeNull();
    expect(mockBenchCalls).toHaveLength(0);
  });

  it("benchLoadedModel mide el contexto residente en la forma del estudio: (512,128,1,3) y (128,32,1,3), con su foto", async () => {
    // 0.1.121: cada repetición es su propia llamada nativa (nr = 1), tres
    // por configuración: el mismo trabajo, con la dispersión a la vista.
    const r = (speedPp: number, speedTg: number) => ({ speedPp, speedTg, nGpuLayers: 0, nThreads: 4, nBatch: 512, nUBatch: 256, flashAttn: 0 });
    mockBenchResults = [r(200, 20), r(210, 21), r(221.5, 22.75), r(310, 24), r(320, 24.5), r(332.25, 25)];
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    const report = await engine.benchLoadedModel();
    expect(mockBenchCalls).toEqual([
      [512, 128, 1, 1],
      [512, 128, 1, 1],
      [512, 128, 1, 1],
      [128, 32, 1, 1],
      [128, 32, 1, 1],
      [128, 32, 1, 1],
    ]);
    expect(report).not.toBeNull();
    expect(report?.modelFilename).toBe("models/a.gguf");
    expect(report?.executed).toBe("CPU");
    expect(report?.runs).toHaveLength(2);
    expect(report?.runs[0]).toMatchObject({ pp: 512, tg: 128, pl: 1, nr: 3, speedPp: 210.5, speedTg: 21.25 });
    expect(report?.runs[0].ppStats).toMatchObject({ min: 200, max: 221.5, n: 3 });
    expect(report?.runs[1]).toMatchObject({ pp: 128, tg: 32, pl: 1, nr: 3, speedPp: 320.75, speedTg: 24.5 });
    expect(report?.runs[1].tgStats).toMatchObject({ min: 24, max: 25, n: 3 });
    expect(report?.peakRssBytes).toBe(1024 ** 3);
    // La duración de la carga viaja con la medida.
    expect(typeof report?.loadMs).toBe("number");
  });

  // Tanda too-heavy (pasada del dueño sobre la 0.1.115): «Measure
  // speed» se quedó en «Measuring…» sin medir nada. No había timeout
  // en ninguna capa (las generaciones sí tienen el suyo) y el null
  // del «bench no es función» enseñaba el mensaje del «sin modelo».
  it("benchLoadedModel con el bench nativo colgado rechaza por su timeout y la cola sigue viva", async () => {
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    mockBenchHangs = true;
    await expect(engine.benchLoadedModel(60)).rejects.toBeInstanceOf(BenchTimeoutError);
    // La tarea colgada no se queda con la cola: con el bench sano,
    // la siguiente medición corre y entrega su informe.
    mockBenchHangs = false;
    const report = await engine.benchLoadedModel(5000);
    expect(report).not.toBeNull();
    expect(report?.runs).toHaveLength(2);
  });

  it("benchLoadedModel en un contexto sin bench no devuelve el null del «sin modelo»: rechaza BenchUnavailableError", async () => {
    mockOmitBench = true;
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    await expect(engine.benchLoadedModel()).rejects.toBeInstanceOf(BenchUnavailableError);
    // Y el «sin modelo» de verdad sigue siendo null, distinguible.
    await expect(new LlamaEngine().benchLoadedModel()).resolves.toBeNull();
  });

  it("una medición encolada detrás de otra que no se asienta tampoco se queda sin salida: manda su timeout", async () => {
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    mockBenchHangs = true;
    // La primera medición ocupa la cola colgada dentro del bench
    // nativo; la segunda ni siquiera empieza su tarea, y aun así su
    // promesa se asienta con SU timeout: «Measuring…» no es eterno
    // ni esperando turno. (No se usa una carga colgada para ocupar
    // la cola: la puerta de carga nativa es global al proceso y un
    // test no puede dejarla ocupada sin colgar los demás.)
    const first = engine.benchLoadedModel(800);
    await expect(engine.benchLoadedModel(60)).rejects.toBeInstanceOf(BenchTimeoutError);
    await expect(first).rejects.toBeInstanceOf(BenchTimeoutError);
  });
});

describe("T-07: cascada de carga (m-73), validación de generación (m-74) y contexto sospechoso (m-79)", () => {
  it("m-73: un error que nombra el fichero aborta la cascada al primer perfil", async () => {
    rejectInit = () => true;
    mockInitErrorFor = () => "llama_model_load: failed to load model (gguf): bad magic";
    const engine = new LlamaEngine();
    await expect(engine.load("models/a.gguf")).rejects.toThrow(/bad magic/);
    expect(initCalls).toHaveLength(1);
  });

  it("m-73: el error final conserva la causa del primer perfil además de la del último", async () => {
    rejectInit = () => true;
    mockInitErrorFor = (_p, attempt) => `fallo del intento ${attempt}`;
    const engine = new LlamaEngine();
    const err = await engine.load("models/a.gguf").catch((e) => e);
    expect(initCalls).toHaveLength(3);
    expect(String(err?.message)).toContain("fallo del intento 3");
    expect(String(err?.message)).toContain("fallo del intento 1");
  });

  it("m-74: nPredict que no es un entero positivo se rechaza antes de tocar el nativo", async () => {
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    await expect(engine.generate({ prompt: "hola", nPredict: 0 })).rejects.toThrow(/nPredict/);
    await expect(engine.generate({ prompt: "hola", nPredict: -3 })).rejects.toThrow(/nPredict/);
    await expect(engine.generate({ prompt: "hola", nPredict: 2.5 })).rejects.toThrow(/nPredict/);
    expect(created[0].lastParams).toBeUndefined();
  });

  it("m-74: un prompt que no cabe en el contexto se rechaza con la cuenta, no a media generación", async () => {
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf", { nCtx: 128 });
    await expect(engine.generate({ prompt: "x".repeat(600) })).rejects.toThrow(/no cabe|contexto/);
    expect(created[0].lastParams).toBeUndefined();
    // Y uno que sí cabe sigue su camino.
    mockStopVerdict = { stopped_eos: true };
    await expect(engine.generate({ prompt: "hola" })).resolves.toBe("Hi");
  });

  it("m-79: si la carga nueva falla, el motor queda sin modelo (la restauración del anterior era de la era intermedia; forma 0.1.98)", async () => {
    // En la 0.1.98 la carga soltaba el modelo residente antes de
    // intentar la nueva, y un fallo dejaba el motor vacío y el
    // error en manos del llamante. La restauración automática del
    // anterior (la mitad de carga de m-79) se retiró en la reversa
    // de la carga de la 0.1.102; la otra mitad de m-79 (recrear el
    // contexto tras una generación fallida) se queda, abajo.
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    rejectInit = (p) => String(p.model).includes("b.gguf");
    await expect(engine.load("models/b.gguf")).rejects.toThrow(/Failed to load/);
    expect(engine.isLoaded).toBe(false);
    expect(engine.getModelInfo()).toBeNull();
  });

  it("m-79: tras una generación fallida, la siguiente recrea el contexto en vez de reutilizarlo", async () => {
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    mockCompletionError = new Error("native completion failed");
    const gen = engine.generate({ prompt: "hola" });
    await new Promise((r) => setTimeout(r, 30));
    await engine.stop();
    await expect(gen).rejects.toThrow(/native completion failed/);
    mockCompletionError = null;
    mockStopVerdict = { stopped_eos: true };
    await expect(engine.generate({ prompt: "hola" })).resolves.toBe("Hi");
    // El contexto sospechoso se liberó y se creó otro para el mismo modelo.
    expect(created).toHaveLength(2);
    expect(created[0].released).toBe(true);
  });
});

describe("T-07: parada defensiva (m-76), plantilla sin Jinja (P-33) y paradas por defecto (P-34)", () => {
  it("m-76: stop() no propaga un fallo del stopCompletion nativo", async () => {
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    mockStopCompletionThrows = true;
    await expect(engine.stop()).resolves.toBeUndefined();
    // Y la generación en vuelo se asienta igual cuando el temporizador manda.
    mockStopVerdict = { stopped_eos: true };
    await expect(engine.generate({ prompt: "hola", timeoutMs: 5 })).resolves.toBe("Hi");
  });

  it("P-33: un contexto sin isJinjaSupported no revienta hasEmbeddedChatTemplate", async () => {
    mockOmitJinja = true;
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    expect(engine.hasEmbeddedChatTemplate()).toBe(false);
  });

  it("P-33: con Jinja declarado, la respuesta sigue al nativo", async () => {
    mockJinjaSupported = false;
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    expect(engine.hasEmbeddedChatTemplate()).toBe(false);
    const engine2 = new LlamaEngine();
    await engine2.load("models/a.gguf");
    expect(engine2.hasEmbeddedChatTemplate()).toBe(false); // mockJinjaSupported sigue en false
  });

  it("P-34: la ruta messages también nace con red de paradas (Assistant:/Answer:)", async () => {
    mockStopVerdict = { stopped_eos: true };
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    await engine.generate({ messages: [{ role: "user", content: "hola" }] });
    const stop = (created[0].lastParams as { stop?: string[] }).stop ?? [];
    expect(stop).toContain("\nAssistant:");
    expect(stop).toContain("\nAnswer:");
    expect(stop).toContain("\nUser:");
  });

  it("P-34: la ruta prompt incluye los marcadores nuevos", async () => {
    mockStopVerdict = { stopped_eos: true };
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    await engine.generate({ prompt: "hola" });
    const stop = (created[0].lastParams as { stop?: string[] }).stop ?? [];
    expect(stop).toContain("\nAssistant:");
    expect(stop).toContain("\nAnswer:");
  });
});

describe("T-07: la cola de generaciones tiene cota y plazo (P-15)", () => {
  it("la novena generación en línea se rechaza al momento, no espera a la cadena", async () => {
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    const pending: Array<Promise<string>> = [];
    for (let i = 0; i < 8; i++) {
      const p = engine.generate({ prompt: "hola" });
      p.catch(() => {});
      pending.push(p);
    }
    await expect(engine.generate({ prompt: "hola" })).rejects.toThrow(/en línea|cola/);
    await engine.unload();
    await Promise.allSettled(pending);
  });

  it("una generación que espera más del plazo en la cola muere al llegar su turno", async () => {
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    const first = engine.generate({ prompt: "hola" });
    first.catch(() => {});
    const second = engine.generate({ prompt: "hola" });
    second.catch(() => {});
    // El reloj salta 16 minutos mientras la segunda espera su turno.
    const realNow = Date.now;
    let offset = 0;
    const spy = vi.spyOn(Date, "now").mockImplementation(() => realNow() + offset);
    try {
      offset = 16 * 60_000;
      await new Promise((r) => setTimeout(r, 30));
      await engine.stop(); // la primera se asienta; la segunda llega a su turno
      await expect(second).rejects.toThrow(/espera|plazo/);
      await expect(first).resolves.toBe("Hi");
    } finally {
      spy.mockRestore();
    }
  });
});
