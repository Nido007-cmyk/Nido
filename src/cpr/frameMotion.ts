/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * Medidor de ritmo de la RCP por cámara — el análisis de cada fotograma.
 *
 * Este es el algoritmo de referencia. El módulo nativo
 * (modules/nido-cpr/.../CprMotionCore.kt) hace exactamente lo mismo en
 * Kotlin sobre la luminancia de la cámara; aquí existe para poder
 * probarlo de punta a punta con vídeo sintético y para fijar valores
 * dorados que el núcleo de Kotlin debe reproducir
 * (scripts/check-cpr-motion-parity.mjs).
 *
 * Por qué por bloques: quien hace las compresiones ocupa solo una parte
 * de la imagen. Un perfil de la imagen entera lo dominaría el fondo
 * quieto (o una persona que pasa). Con una rejilla de 4 × 3 bloques, cada
 * uno da su propio desplazamiento, y el estimador se queda con el bloque
 * que tenga el ritmo más claro: es la «región de interés dinámica» de
 * los estudios con cámara de móvil (Meinich-Bache y otros, 2016–2018).
 *
 * Cada fotograma se reduce a 36 números (por bloque: desplazamiento
 * vertical, horizontal y cuánto cambió) y se descarta.
 */

export const GRID_X = 4;
export const GRID_Y = 3;
export const BLOCKS = GRID_X * GRID_Y;
/** Desplazamiento máximo buscado, en muestras del perfil (2 píxeles cada una). */
export const MAX_SHIFT = 6;

export interface LumaFrame {
  width: number;
  height: number;
  /** Bytes por fila (≥ width). */
  rowStride: number;
  /** Luminancia 0..255. */
  data: Uint8Array;
}

/** Perfiles de cada bloque del fotograma anterior. */
export interface MotionState {
  rows: Float64Array[];
  cols: Float64Array[];
  width: number;
  height: number;
}

function normalise(p: Float64Array): void {
  let mean = 0;
  for (let i = 0; i < p.length; i++) mean += p[i];
  mean /= p.length;
  let sq = 0;
  for (let i = 0; i < p.length; i++) sq += (p[i] - mean) * (p[i] - mean);
  const sd = Math.max(1, Math.sqrt(sq / p.length));
  for (let i = 0; i < p.length; i++) p[i] = (p[i] - mean) / sd;
}

/**
 * Perfil por filas del bloque (una de cada 2 filas, media de 1 de cada 4
 * píxeles) y perfil por columnas (una de cada 2 columnas, media de 1 de
 * cada 4 filas). Todo en doble precisión y en el mismo orden de
 * operaciones que el Kotlin: así los dos dan los mismos números.
 */
function blockProfiles(f: LumaFrame, bx: number, by: number): { rows: Float64Array; cols: Float64Array } {
  const bw = Math.floor(f.width / GRID_X);
  const bh = Math.floor(f.height / GRID_Y);
  const x0 = bx * bw;
  const y0 = by * bh;
  const nr = Math.floor(bh / 2);
  const nc = Math.floor(bw / 2);
  const rows = new Float64Array(nr);
  const cols = new Float64Array(nc);
  for (let r = 0; r < nr; r++) {
    const base = (y0 + r * 2) * f.rowStride + x0;
    let sum = 0;
    let n = 0;
    for (let c = 0; c < bw; c += 4) {
      sum += f.data[base + c];
      n++;
    }
    rows[r] = sum / n;
  }
  for (let c = 0; c < nc; c++) {
    const x = x0 + c * 2;
    let sum = 0;
    let n = 0;
    for (let r = 0; r < bh; r += 4) {
      sum += f.data[(y0 + r) * f.rowStride + x];
      n++;
    }
    cols[c] = sum / n;
  }
  normalise(rows);
  normalise(cols);
  return { rows, cols };
}

/** Desplazamiento que mejor alinea `cur` con `prev` (con media muestra de precisión) y el cambio sin desplazar. */
export function shiftOf(cur: Float64Array, prev: Float64Array): { d: number; e: number } {
  const len = cur.length;
  if (len <= 2 * MAX_SHIFT + 4 || prev.length !== len) return { d: 0, e: 0 };
  const errs = new Float64Array(2 * MAX_SHIFT + 1);
  for (let s = -MAX_SHIFT; s <= MAX_SHIFT; s++) {
    let e = 0;
    let n = 0;
    for (let i = MAX_SHIFT; i < len - MAX_SHIFT; i++) {
      e += Math.abs(cur[i] - prev[i + s]);
      n++;
    }
    errs[s + MAX_SHIFT] = e / n;
  }
  let best = 0;
  for (let i = 1; i < errs.length; i++) if (errs[i] < errs[best]) best = i;
  let d = best - MAX_SHIFT;
  if (best >= 1 && best < errs.length - 1) {
    const a = errs[best - 1];
    const b = errs[best];
    const c = errs[best + 1];
    const den = a - 2 * b + c;
    if (den > 1e-6) d += (0.5 * (a - c)) / den;
  }
  return { d, e: errs[MAX_SHIFT] };
}

/**
 * Analiza un fotograma. Devuelve el nuevo estado y, si había fotograma
 * anterior del mismo tamaño, 36 números: [dy, dx, e] de cada bloque, en
 * orden de filas de la rejilla.
 */
export function analyseFrame(f: LumaFrame, prev: MotionState | null): { state: MotionState; out: Float64Array | null } {
  const rows: Float64Array[] = [];
  const cols: Float64Array[] = [];
  for (let by = 0; by < GRID_Y; by++) {
    for (let bx = 0; bx < GRID_X; bx++) {
      const p = blockProfiles(f, bx, by);
      rows.push(p.rows);
      cols.push(p.cols);
    }
  }
  const state: MotionState = { rows, cols, width: f.width, height: f.height };
  if (!prev || prev.width !== f.width || prev.height !== f.height) return { state, out: null };
  const out = new Float64Array(BLOCKS * 3);
  for (let b = 0; b < BLOCKS; b++) {
    const v = shiftOf(rows[b], prev.rows[b]);
    const h = shiftOf(cols[b], prev.cols[b]);
    out[b * 3] = v.d;
    out[b * 3 + 1] = h.d;
    out[b * 3 + 2] = v.e;
  }
  return { state, out };
}
