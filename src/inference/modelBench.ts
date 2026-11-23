/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * VEL-5 (0.1.110, acto 3): la medición de velocidad en el propio
 * teléfono, en su forma pura — qué se mide y cómo se compone el
 * resultado. La corrida nativa vive en LlamaEngine.benchLoadedModel;
 * aquí solo hay política y aritmética, sin nativo.
 *
 * La forma es la de PocketPal [PP-MIT, §2 del estudio de su código]
 * sobre bench() del upstream: dos configuraciones prefijadas
 * (512/128 y 128/32, pl 1, nr 3 repeticiones), el pico de memoria
 * muestreado cada segundo durante la corrida y la foto de los
 * parámetros que produjeron el número pegada a cada resultado. Su
 * mitad de red (subir el resultado a una tabla pública) NO se
 * adopta: la medición de NIDO nace y muere en el teléfono.
 *
 * Honestidad de la pieza: el número que sale es el del contexto
 * residente, cargado tal como la conversación lo cargó — el
 * dispositivo que EJECUTÓ esa carga (CPU, GPU o NPU) es parte del
 * resultado, con la misma ley del resumen de backend (M-41): un
 * nombre que empieza por «HTP» es NPU; otro dispositivo acelerado
 * es GPU; sin dispositivo, CPU. Nada aquí afirma una velocidad que
 * no se haya medido en el aparato que enseña el resultado.
 */

/** Una configuración de medición: prompt/generación/paralelismo/repeticiones. */
export interface BenchConfig {
  pp: number;
  tg: number;
  pl: number;
  nr: number;
}

/** Las dos configuraciones prefijadas [forma PP-MIT]. */
export const BENCH_CONFIGS: readonly BenchConfig[] = [
  { pp: 512, tg: 128, pl: 1, nr: 3 },
  { pp: 128, tg: 32, pl: 1, nr: 3 },
];

/** Lo que el bench() nativo devuelve y esta pieza consume. */
export interface RawBenchResult {
  speedPp: number;
  speedTg: number;
  nGpuLayers: number;
  nThreads: number;
  nBatch: number;
  nUBatch: number;
  flashAttn: number;
}

/** La foto mínima de la carga medida (estructural: la cumple LoadedModelInfo). */
export interface BenchLoadPhoto {
  filename: string;
  nCtx: number;
  nThreads: number;
  memoryProfile?: string;
  accelDevice?: string;
}

/** Una corrida medida: su configuración y sus dos velocidades (tok/s). */
export interface BenchRunReport extends BenchConfig {
  speedPp: number;
  speedTg: number;
}

/** El resultado entero de una medición, con su foto de parámetros. */
export interface ModelBenchReport {
  modelFilename: string;
  /** Lo que ejecutó la carga medida: «CPU», «GPU (nombre)» o «NPU (nombre)». */
  executed: string;
  nCtx: number;
  nThreads: number;
  /** Capas en el acelerador según el propio bench nativo (0 en CPU). */
  nGpuLayers: number;
  /** Flash attention según el propio bench nativo. */
  flashAttn: number;
  /** Pico de RSS muestreado a 1 s durante la corrida; null si no se pudo leer. */
  peakRssBytes: number | null;
  wallMs: number;
  runs: BenchRunReport[];
}

/**
 * La ley del resumen de backend (M-41) aplicada a la foto de una
 * carga: lo ejecutado se dice como lo que fue, no como lo que se vio.
 */
export function executedLabelFor(photo: BenchLoadPhoto): string {
  if (photo.memoryProfile === "accel" && photo.accelDevice) {
    return photo.accelDevice.startsWith("HTP")
      ? `NPU (${photo.accelDevice})`
      : `GPU (${photo.accelDevice})`;
  }
  return "CPU";
}

/**
 * Compone el informe desde las corridas crudas (en el orden de
 * BENCH_CONFIGS) y la foto de la carga. La foto de parámetros del
 * informe (capas, flash attention) es la de la ÚLTIMA corrida: es
 * el contexto medido declarándose a sí mismo.
 */
export function buildBenchReport(args: {
  photo: BenchLoadPhoto;
  raw: readonly RawBenchResult[];
  peakRssBytes: number | null;
  wallMs: number;
}): ModelBenchReport {
  const runs: BenchRunReport[] = args.raw.map((r, i) => ({
    ...(BENCH_CONFIGS[i] ?? BENCH_CONFIGS[BENCH_CONFIGS.length - 1]),
    speedPp: r.speedPp,
    speedTg: r.speedTg,
  }));
  const last = args.raw[args.raw.length - 1];
  return {
    modelFilename: args.photo.filename,
    executed: executedLabelFor(args.photo),
    nCtx: args.photo.nCtx,
    nThreads: args.photo.nThreads,
    nGpuLayers: last?.nGpuLayers ?? 0,
    flashAttn: last?.flashAttn ?? 0,
    peakRssBytes: args.peakRssBytes,
    wallMs: args.wallMs,
    runs,
  };
}
