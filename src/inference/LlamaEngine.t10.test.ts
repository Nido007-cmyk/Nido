/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * LlamaEngine.t10.test.ts — TANDA T-10 (0.1.99): disponibilidad y
 * cancelación en el motor.
 *
 * m-25 (sonda): la ruta de mensajes debía llevar las secuencias de
 * parada por defecto igual que la de prompt (P-34, T-07).
 * m-26 (parte 2): la guarda de repetición no vigilaba en modo
 * structured: un bucle ahí quemaba la generación entera.
 * m-31: ninguna superficie fijaba semilla; los presets structured y
 * factual deben ser reproducibles.
 * M-20 (motor): la señal de aborto debe parar la completion en vuelo.
 *
 * El arnés (mock de llama.rn con FakeContext) es el de
 * LlamaEngine.test.ts, copiado tal cual: es el patrón de la casa para
 * este módulo.
 */
  completion: (params: unknown, onToken: (d: { token: string }) => void) => Promise<{ text: string } & Record<string, unknown>>;
import { describe, it, expect, vi, beforeEach } from "vitest";

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
    };
    if (mockOmitJinja) delete (ctx as { isJinjaSupported?: unknown }).isJinjaSupported;
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
vi.mock("expo-file-system/legacy", () => ({
  documentDirectory: "file:///docs/",
  getInfoAsync: async (path: string) => ({
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

import { LlamaEngine, resolveSampling, SAMPLING_PRESETS, loadTimeSampling, LLAMA_CPP_SAMPLING_DEFAULTS } from "./LlamaEngine";
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
  resetBackgroundIndexingHold();
});


describe("T-10 (0.1.99): disponibilidad y cancelación en el motor", () => {
  const STOP_DEFAULTS = [
    "\nUser:",
    "\n\nUser:",
    "\nQuestion:",
    "\n\nQuestion:",
    "\nAssistant:",
    "\nAnswer:",
  ];

  async function settle<T>(p: Promise<T>, engine: LlamaEngine): Promise<T> {
    await new Promise((r) => setTimeout(r, 30));
    await engine.stop();
    return p;
  }

  it("m-25 (sonda): la ruta de mensajes lleva las paradas por defecto sin stop explícito", async () => {
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    const reply = engine.generate({
      messages: [{ role: "user", content: "hola" }],
    });
    await settle(reply, engine);
    const params = created[0].lastParams as Record<string, unknown>;
    expect(params.stop).toEqual(STOP_DEFAULTS);
  });

  it("m-25 (sonda): la ruta de prompt lleva las mismas paradas por defecto", async () => {
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    const reply = engine.generate({ prompt: "hola" });
    await settle(reply, engine);
    const params = created[0].lastParams as Record<string, unknown>;
    expect(params.stop).toEqual(STOP_DEFAULTS);
  });

  it("m-31: structured y factual fijan una semilla estable; chat no manda ninguna", async () => {
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");

    const p1 = engine.generate({ prompt: "{}", samplingPreset: "structured" });
    await settle(p1, engine);
    const seed1 = (created[0].lastParams as Record<string, unknown>).seed;
    expect(typeof seed1).toBe("number");

    const p2 = engine.generate({ prompt: "{}", samplingPreset: "factual" });
    await settle(p2, engine);
    const seed2 = (created[0].lastParams as Record<string, unknown>).seed;
    expect(seed2).toBe(seed1);

    const p3 = engine.generate({ prompt: "hola", samplingPreset: "chat" });
    await settle(p3, engine);
    expect("seed" in (created[0].lastParams as Record<string, unknown>)).toBe(false);
  });

  it("m-31: una semilla explícita manda sobre el preset", async () => {
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    const p = engine.generate({ prompt: "hola", samplingPreset: "chat", seed: 42 });
    await settle(p, engine);
    expect((created[0].lastParams as Record<string, unknown>).seed).toBe(42);
  });

  it("m-26: en modo structured la guarda SÍ corta un bucle, pero el texto no se recorta", async () => {
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    const ctx = created[0];
    let stops = 0;
    const origStop = ctx.stopCompletion;
    ctx.stopCompletion = async () => {
      stops++;
      return origStop();
    };
    mockReplyText = " las aluminosas,".repeat(30);
    const p = engine.generate({
      messages: [{ role: "user", content: "dame el json" }],
      samplingPreset: "structured",
      responseFormat: {
        type: "json_schema",
        json_schema: { schema: { type: "object" } },
      },
    });
    await new Promise((r) => setTimeout(r, 200));
    const cutByGuard = stops > 0;
    if (!cutByGuard) {
      // Limpieza: sin la guarda, la completion falsa no se asienta sola.
      await engine.stop();
    }
    const text = await p;
    expect(cutByGuard).toBe(true);
    // Structured nunca se recorta: ni «…» ni cierre en frase.
    expect(text).toBe(mockReplyText);
  });

  it("M-20: abortar la señal durante la generación la asienta con el texto parcial", async () => {
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    mockReplyText = "Respuesta parcial";
    const controller = new AbortController();
    const p = engine.generate({ prompt: "hola", signal: controller.signal });
    await new Promise((r) => setTimeout(r, 30));
    controller.abort();
    const settled = await Promise.race([
      p.then(() => "settled" as const),
      new Promise<"hung">((r) => setTimeout(() => r("hung"), 800)),
    ]);
    if (settled === "hung") await engine.stop();
    expect(settled).toBe("settled");
    await expect(p).resolves.toBe("Respuesta parcial");
  });

  it("M-20: una señal ya abortada al llamar también asienta la generación", async () => {
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    const controller = new AbortController();
    controller.abort();
    const p = engine.generate({ prompt: "hola", signal: controller.signal });
    const settled = await Promise.race([
      p.then(() => "settled" as const),
      new Promise<"hung">((r) => setTimeout(() => r("hung"), 800)),
    ]);
    if (settled === "hung") await engine.stop();
    expect(settled).toBe("settled");
  });
});
