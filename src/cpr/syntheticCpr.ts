/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * Vídeo sintético de una reanimación, para probar el medidor de ritmo de
 * punta a punta sin personas (solo lo usan las pruebas; la app no lo
 * importa).
 *
 * Lo que simula, a partir de lo que los estudios con cámara de móvil
 * señalan como difícil (Meinich-Bache y otros, 2016–2018):
 * - quien comprime ocupa solo parte de la imagen y sube y baja con la
 *   forma real de una compresión (bajada más rápida que la subida);
 * - el ritmo varía un poco de una compresión a otra;
 * - ruido del sensor, parpadeo de la luz y deriva de la exposición;
 * - la cámara tiembla un poco;
 * - pelo suelto que se agita sin ritmo;
 * - otra persona moviéndose al fondo;
 * - y escenas sin compresiones, donde el medidor debe callar.
 * Todo con una semilla fija: las pruebas no dependen de la suerte.
 */

import type { LumaFrame } from "./frameMotion";

export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** Textura suave al azar (ruido de valor), tamaño w × h, valores 0..1. */
function texture(w: number, h: number, cell: number, r: () => number): Float32Array {
  const gw = Math.ceil(w / cell) + 2;
  const gh = Math.ceil(h / cell) + 2;
  const g = new Float32Array(gw * gh);
  for (let i = 0; i < g.length; i++) g[i] = r();
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const gy = y / cell;
    const y0 = Math.floor(gy);
    const fy = gy - y0;
    for (let x = 0; x < w; x++) {
      const gx = x / cell;
      const x0 = Math.floor(gx);
      const fx = gx - x0;
      const a = g[y0 * gw + x0];
      const b = g[y0 * gw + x0 + 1];
      const c = g[(y0 + 1) * gw + x0];
      const d = g[(y0 + 1) * gw + x0 + 1];
      out[y * w + x] = (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
    }
  }
  return out;
}

function sample(tex: Float32Array, w: number, h: number, x: number, y: number): number {
  const xi = Math.max(0, Math.min(w - 2, Math.floor(x)));
  const yi = Math.max(0, Math.min(h - 2, Math.floor(y)));
  const fx = Math.min(1, Math.max(0, x - xi));
  const fy = Math.min(1, Math.max(0, y - yi));
  const i = yi * w + xi;
  return (tex[i] * (1 - fx) + tex[i + 1] * fx) * (1 - fy) + (tex[i + w] * (1 - fx) + tex[i + w + 1] * fx) * fy;
}

/** Forma de una compresión: baja en el 45 % del ciclo, sube en el resto (0 arriba, 1 abajo). */
export function compressionShape(phase: number): number {
  const p = phase - Math.floor(phase);
  return p < 0.45 ? 0.5 - 0.5 * Math.cos((Math.PI * p) / 0.45) : 0.5 + 0.5 * Math.cos((Math.PI * (p - 0.45)) / 0.55);
}

export interface Scene {
  seconds: number;
  fps?: number;
  /** Ritmo de las compresiones; una función permite que cambie con el tiempo. 0 = no comprime. */
  bpm: number | ((tSec: number) => number);
  /** Recorrido del cuerpo en píxeles (5 cm a 1,5 m con una cámara frontal ≈ 6 px a 320 de ancho). */
  amplitudePx?: number;
  /** Fracción de la imagen que ocupa quien comprime (0..1, de ancho y de alto). */
  personSize?: number;
  /** Variación del ritmo de una compresión a otra (fracción). */
  jitter?: number;
  /** Desviación del ruido del sensor (niveles de 0..255). */
  sensorNoise?: number;
  /** Parpadeo de la luz (fracción del brillo). */
  flicker?: number;
  /** Temblor de la cámara (píxeles). */
  shakePx?: number;
  /** Pelo suelto que se agita sin ritmo sobre la cabeza. */
  hair?: boolean;
  /** Otra persona que se mueve al fondo sin ritmo. */
  bystander?: boolean;
  /** El movimiento va de lado (teléfono apaisado o girado). */
  horizontal?: boolean;
  /**
   * El teléfono está en el suelo con la pantalla hacia arriba: quien
   * comprime se acerca y se aleja de la cámara, y en la imagen crece y
   * encoge (fracción de tamaño por píxel de recorrido) en vez de subir y
   * bajar.
   */
  towardCamera?: number;
  /** Sin compresiones, pero quien estaba se mueve al azar (mira, se gira…). */
  fidget?: boolean;
  seed?: number;
  width?: number;
  height?: number;
}

/** Genera los fotogramas (luminancia) de la escena, uno a uno. */
export function* renderScene(sc: Scene): Generator<{ tMs: number; frame: LumaFrame }> {
  const W = sc.width ?? 320;
  const H = sc.height ?? 240;
  const fps = sc.fps ?? 30;
  const r = rng(sc.seed ?? 11);
  const bg = texture(W + 40, H + 40, 24, r);
  const PW = Math.round(W * (sc.personSize ?? 0.4));
  const PH = Math.round(H * (sc.personSize ?? 0.4) * 1.6);
  const person = texture(PW + 40, PH + 40, 8, r);
  const by = texture(80, 160, 10, r);
  const px0 = Math.round(W * 0.45);
  const py0 = Math.round(H * 0.25);
  const amp = sc.amplitudePx ?? 6;
  let phase = 0;
  let bpmNow = 0;
  let shakeX = 0;
  let shakeY = 0;
  let fidX = 0;
  let fidY = 0;
  let fidVX = 0;
  let fidVY = 0;
  let byX = W * 0.1;
  let byVX = 0;
  const data = new Uint8Array(W * H);
  const frames = Math.round(sc.seconds * fps);
  for (let k = 0; k < frames; k++) {
    const tSec = k / fps;
    const target = typeof sc.bpm === "function" ? sc.bpm(tSec) : sc.bpm;
    // Cada compresión tiene su propio ritmo (variación natural).
    if (target > 0) {
      if (bpmNow === 0 || phase - Math.floor(phase) < (target / 60) / fps) bpmNow = target * (1 + (r() - 0.5) * 2 * (sc.jitter ?? 0.04));
      phase += bpmNow / 60 / fps;
    }
    const press = target > 0 ? amp * compressionShape(phase) : 0;
    if (sc.fidget) {
      fidVX = 0.85 * fidVX + (r() - 0.5) * 1.2;
      fidVY = 0.85 * fidVY + (r() - 0.5) * 1.2;
      fidX = Math.max(-15, Math.min(15, fidX + fidVX));
      fidY = Math.max(-15, Math.min(15, fidY + fidVY));
    }
    const dx = (sc.horizontal ? press : 0) + fidX;
    const dy = (sc.horizontal ? 0 : press) + fidY;
    shakeX = 0.7 * shakeX + (r() - 0.5) * (sc.shakePx ?? 0.3);
    shakeY = 0.7 * shakeY + (r() - 0.5) * (sc.shakePx ?? 0.3);
    byVX = 0.9 * byVX + (r() - 0.5) * 1.5;
    byX = Math.max(0, Math.min(W * 0.35, byX + byVX));
    const light = 1 + (sc.flicker ?? 0.01) * Math.sin(2 * Math.PI * 10 * tSec) + 0.05 * Math.sin(2 * Math.PI * 0.07 * tSec);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let v = sample(bg, W + 40, H + 40, x + 20 + shakeX, y + 20 + shakeY) * 0.6 + 0.2;
        // Quien comprime: el torso y la cabeza suben y bajan juntos.
        let lx = x - px0 - dx + shakeX;
        let ly = y - py0 - dy + shakeY;
        if (sc.towardCamera) {
          // Crece desde su centro al acercarse (se quita el desplazamiento).
          const k = 1 + sc.towardCamera * press;
          lx = (x + shakeX - px0 - PW / 2 - fidX) / k + PW / 2;
          ly = (y + shakeY - py0 - PH / 2 - fidY) / k + PH / 2;
        }
        if (lx >= 0 && lx < PW && ly >= 0 && ly < PH) {
          v = sample(person, PW + 40, PH + 40, lx + 20, ly + 20) * 0.9 + 0.05;
          if (sc.hair && ly < PH * 0.3) v = 0.5 * v + 0.5 * sample(person, PW + 40, PH + 40, lx + 20 + (r() - 0.5) * 6, ly + 20 + (r() - 0.5) * 6);
        }
        if (sc.bystander) {
          const bx = x - byX;
          const byy = y - H * 0.3;
          if (bx >= 0 && bx < 70 && byy >= 0 && byy < 150) v = sample(by, 80, 160, bx, byy) * 0.9 + 0.05;
        }
        const n = (r() + r() + r() - 1.5) * 2 * (sc.sensorNoise ?? 3);
        data[y * W + x] = Math.max(0, Math.min(255, Math.round(v * 255 * light + n)));
      }
    }
    yield { tMs: 1000 + (k * 1000) / fps, frame: { width: W, height: H, rowStride: W, data } };
  }
}
