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
 * Cómo: en cada canal se suma el desplazamiento para tener la posición
 * (el cuerpo que sube y baja), se remuestrea a 30 Hz, se quita la deriva
 * lenta y se busca el periodo con la autocorrelación entre 60 y 180 por
 * minuto. Se queda el canal con el ritmo más claro. Con poca confianza no se dice nada: la regla
 * de la práctica es callar antes que corregir mal (el pitido sigue marcando
 * el ritmo bueno pase lo que pase).
 */

/**
 * Un fotograma: su instante y el desplazamiento en cada canal (en el
 * módulo nativo, vertical y horizontal de cada bloque de la rejilla; ver
 * frameMotion.ts). Cada canal se mide por separado.
 */
export interface MotionSample {
  t: number;
  ch: number[];
}

export interface RateEstimate {
  bpm: number;
  /** Autocorrelación del periodo elegido (0..1). */
  confidence: number;
  /** El canal (bloque y eje) con el ritmo más claro. */
  channel: number;
}

export const WINDOW_MS = 6000;

/**
 * Lo que manda el módulo nativo (lotes de fotogramas, `stride` números
 * por fotograma: [dy, dx, e] por bloque) → un MotionSample por fotograma
 * con los canales dy y dx de cada bloque.
 */
export function camSamplesToMotion(b: { t: number[]; v: number[]; stride: number }): MotionSample[] {
  const out: MotionSample[] = [];
  const blocks = Math.floor(b.stride / 3);
  if (blocks < 1) return out;
  for (let i = 0; i < b.t.length; i++) {
    const base = i * b.stride;
    if (base + b.stride > b.v.length) break;
    const ch: number[] = [];
    for (let k = 0; k < blocks; k++) ch.push(b.v[base + k * 3], b.v[base + k * 3 + 1]);
    out.push({ t: b.t[i], ch });
  }
  return out;
}
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
  const n = win[0].ch.length;
  let best: RateEstimate | null = null;
  for (let c = 0; c < n; c++) {
    const r = axisRate(ts, win.map((s) => s.ch[c] ?? 0));
    if (r && (!best || r.confidence > best.confidence)) best = { bpm: r.bpm, confidence: r.confidence, channel: c };
  }
  if (!best || best.confidence < MIN_CONFIDENCE) return null;
  return { ...best, bpm: Math.round(best.bpm) };
}

/**
 * Lo que se enseña y se dice no es cada estimación suelta, sino el ritmo
 * que se sostiene: dos estimaciones seguidas (≈1 s) a menos de 8 por
 * minuto la una de la otra. Y un salto a la mitad o al doble del ritmo
 * recién aceptado (el error típico de leer un periodo doble) no se cree
 * hasta que dura 3 estimaciones: hasta entonces se sigue mostrando el
 * anterior. Con vídeo sintético muy ruidoso, 125 llegó a leerse una vez
 * como 64; sin esta regla habría dicho «más rápido» a quien iba bien.
 */
export interface RateTrack {
  lastRaw: number | null;
  accepted: number | null;
  acceptedAt: number;
  octaveRun: number;
}

export const INITIAL_RATE_TRACK: RateTrack = { lastRaw: null, accepted: null, acceptedAt: -Infinity, octaveRun: 0 };

const HOLD_MS = 2000;

function nearRatio(a: number, b: number, ratio: number): boolean {
  return Math.abs(a - b * ratio) <= 0.12 * b * ratio;
}

export function trackRate(st: RateTrack, est: RateEstimate | null, now: number): { shown: number | null; state: RateTrack } {
  const hold = st.accepted !== null && now - st.acceptedAt <= HOLD_MS ? st.accepted : null;
  if (!est) return { shown: hold, state: { ...st, lastRaw: null, octaveRun: 0 } };
  const bpm = est.bpm;
  if (st.accepted !== null && now - st.acceptedAt <= 4000 && (nearRatio(bpm, st.accepted, 0.5) || nearRatio(bpm, st.accepted, 2))) {
    const run = st.octaveRun + 1;
    if (run < 3) return { shown: hold, state: { ...st, lastRaw: bpm, octaveRun: run } };
  }
  if (st.lastRaw !== null && Math.abs(bpm - st.lastRaw) <= 8) {
    const shown = Math.round((bpm + st.lastRaw) / 2);
    return { shown, state: { lastRaw: bpm, accepted: shown, acceptedAt: now, octaveRun: 0 } };
  }
  return { shown: hold, state: { ...st, lastRaw: bpm, octaveRun: 0 } };
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
