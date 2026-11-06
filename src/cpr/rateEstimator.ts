/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * Medidor de ritmo de la RCP por cámara (0.1.76) — la parte que calcula.
 *
 * Entrada: lo que manda el módulo nativo nido-cpr por cada fotograma (el
 * instante y cuánto se desplazó la imagen en cada eje respecto al
 * anterior). Salida: el ritmo de las compresiones en compresiones por
 * minuto y una confianza de 0 a 1, o nada si no hay un ritmo claro.
 *
 * Cómo: se suma el desplazamiento para tener la posición (el cuerpo que
 * sube y baja), se remuestrea a 30 Hz, se quita la deriva lenta y se busca
 * el periodo con la autocorrelación entre 60 y 180 por minuto. Se queda el
 * eje con el ritmo más claro. Con poca confianza no se dice nada: la regla
 * del asistente es callar antes que corregir mal (el pitido sigue marcando
 * el ritmo bueno pase lo que pase).
 */

export interface MotionSample {
  t: number;
  dy: number;
  dx: number;
  e: number;
}

export interface RateEstimate {
  bpm: number;
  /** Autocorrelación del periodo elegido (0..1). */
  confidence: number;
  axis: "dy" | "dx";
}

export const WINDOW_MS = 6000;
export const MIN_SPAN_MS = 4000;
const FS = 30;
const MIN_BPM = 60;
const MAX_BPM = 180;
/** Por debajo, no hay ritmo que decir. */
export const MIN_CONFIDENCE = 0.6;
/** Movimiento mínimo (en muestras del perfil): por debajo es ruido de la cámara. */
const MIN_AMPLITUDE = 0.35;

function resample(ts: number[], xs: number[], fs: number): number[] {
  const out: number[] = [];
  const step = 1000 / fs;
  let j = 0;
  for (let t = ts[0]; t <= ts[ts.length - 1]; t += step) {
    while (j < ts.length - 2 && ts[j + 1] < t) j++;
    const t0 = ts[j];
    const t1 = ts[j + 1];
    const a = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
    out.push(xs[j] + (xs[j + 1] - xs[j]) * Math.min(1, Math.max(0, a)));
  }
  return out;
}

function detrend(x: number[], half: number): number[] {
  const out = new Array<number>(x.length);
  const pre = [0];
  for (const v of x) pre.push(pre[pre.length - 1] + v);
  for (let i = 0; i < x.length; i++) {
    const a = Math.max(0, i - half);
    const b = Math.min(x.length, i + half + 1);
    out[i] = x[i] - (pre[b] - pre[a]) / (b - a);
  }
  return out;
}

function autocorr(x: number[], lag: number): number {
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i + lag < x.length; i++) {
    sxy += x[i] * x[i + lag];
    sxx += x[i] * x[i];
    syy += x[i + lag] * x[i + lag];
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
}

function std(x: number[]): number {
  const m = x.reduce((a, b) => a + b, 0) / x.length;
  return Math.sqrt(x.reduce((a, b) => a + (b - m) * (b - m), 0) / x.length);
}

function axisRate(ts: number[], d: number[]): { bpm: number; confidence: number } | null {
  const pos: number[] = [];
  let acc = 0;
  for (const v of d) {
    acc += v;
    pos.push(acc);
  }
  const u = resample(ts, pos, FS);
  if (u.length < FS * (MIN_SPAN_MS / 1000)) return null;
  const x = detrend(u, Math.round(FS * 0.5));
  if (std(x) < MIN_AMPLITUDE) return null;
  const minLag = Math.floor((FS * 60) / MAX_BPM);
  const maxLag = Math.ceil((FS * 60) / MIN_BPM);
  const r: number[] = [];
  for (let L = 0; L <= maxLag + 1; L++) r.push(L >= minLag - 1 ? autocorr(x, L) : 0);
  // Picos locales dentro del rango; el primero que llegue al 85 % del más
  // alto (así un ritmo de 160 no se lee como 80 por su segundo pico).
  const peaks: number[] = [];
  for (let L = minLag; L <= maxLag; L++) if (r[L] >= r[L - 1] && r[L] >= r[L + 1] && r[L] > 0) peaks.push(L);
  if (peaks.length === 0) return null;
  const top = Math.max(...peaks.map((L) => r[L]));
  let L = peaks.find((p) => r[p] >= 0.85 * top) as number;
  // El doble del periodo también correlaciona: si hay un pico claro en la
  // mitad, el ritmo de verdad es ese (con ruido, 120 se leía como 60). En
  // un ritmo real de 60, la mitad del periodo correlaciona en negativo.
  for (;;) {
    const half = peaks.find((p) => p < L && Math.abs(p - L / 2) <= 3 && r[p] >= 0.25);
    if (half === undefined) break;
    L = half;
  }
  const a = r[L - 1];
  const b = r[L];
  const c = r[L + 1];
  const den = a - 2 * b + c;
  const lag = den < 0 ? L + (0.5 * (a - c)) / den : L;
  return { bpm: (60 * FS) / lag, confidence: Math.max(0, Math.min(1, b)) };
}

/** El ritmo de los últimos segundos, o null si no hay uno claro. */
export function estimateRate(samples: readonly MotionSample[]): RateEstimate | null {
  if (samples.length < 2) return null;
  const end = samples[samples.length - 1].t;
  const win = samples.filter((s) => s.t >= end - WINDOW_MS);
  if (win.length < FS * (MIN_SPAN_MS / 1000) * 0.6) return null;
  if (end - win[0].t < MIN_SPAN_MS) return null;
  const ts = win.map((s) => s.t);
  // Tiempos estrictamente crecientes (un lote repetido no rompe nada).
  for (let i = 1; i < ts.length; i++) if (ts[i] <= ts[i - 1]) return null;
  const y = axisRate(ts, win.map((s) => s.dy));
  const x = axisRate(ts, win.map((s) => s.dx));
  const best =
    y && (!x || y.confidence >= x.confidence) ? { ...y, axis: "dy" as const } : x ? { ...x, axis: "dx" as const } : null;
  if (!best || best.confidence < MIN_CONFIDENCE) return null;
  return { bpm: Math.round(best.bpm), confidence: best.confidence, axis: best.axis };
}

export type Verdict = "faster" | "slower" | "good";

/** La guía: «Ritmo: 100 a 120 por minuto». */
export function verdictFor(bpm: number): Verdict {
  if (bpm < 100) return "faster";
  if (bpm > 120) return "slower";
  return "good";
}

export interface CueState {
  /** Los últimos veredictos, del más viejo al más nuevo. */
  recent: Verdict[];
  lastSpoken: Verdict | null;
  lastSpokenAt: number;
}

export const INITIAL_CUE_STATE: CueState = { recent: [], lastSpoken: null, lastSpokenAt: -Infinity };

/** Corregir se repite como mucho cada 8 s; «buen ritmo», cada 30 s. */
const REPEAT_CORRECTION_MS = 8000;
const REPEAT_GOOD_MS = 30000;

/**
 * ¿Hay que decir algo? Solo cuando los tres últimos veredictos coinciden
 * (≈1,5 s del mismo ritmo), y sin repetirse: una corrección nueva se dice
 * al momento; la misma, cada 8 s; «buen ritmo», al llegar a él y luego
 * cada 30 s. Sin estimación (null), se olvida lo reciente.
 */
export function nextCue(state: CueState, verdict: Verdict | null, now: number): { cue: Verdict | null; state: CueState } {
  if (verdict === null) return { cue: null, state: { ...state, recent: [] } };
  const recent = [...state.recent, verdict].slice(-3);
  const steady = recent.length === 3 && recent.every((v) => v === verdict);
  if (!steady) return { cue: null, state: { ...state, recent } };
  const since = now - state.lastSpokenAt;
  const changed = verdict !== state.lastSpoken;
  const due = changed || since >= (verdict === "good" ? REPEAT_GOOD_MS : REPEAT_CORRECTION_MS);
  if (!due) return { cue: null, state: { ...state, recent } };
  return { cue: verdict, state: { recent, lastSpoken: verdict, lastSpokenAt: now } };
}
