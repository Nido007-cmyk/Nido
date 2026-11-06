/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * Práctica de RCP — el reloj de la práctica (F-3, auditoría
 * adversaria de la 0.1.76, 2026-11-06).
 *
 * El hallazgo: la pantalla calculaba fases, conteo y rearme del
 * 30:2 con `Date.now()` (reloj de pared), mientras el pitido nativo
 * corre sobre el reloj monotónico. Un salto del reloj de pared a
 * mitad de práctica (sincronización de red, cambio de zona)
 * desplazaba el conteo pintado, la fase y el rearme, aunque el
 * pitido siguiera bien. Y el módulo nativo ya devolvía su instante
 * de inicio al arrancar: el puente lo reducía a un sí o un no.
 *
 * Este núcleo puro es el reloj único de la pantalla desde el
 * arreglo: todo el tiempo de práctica se mide en un reloj
 * monotónico, anclado al instante que el metrónomo devuelve, y
 * ninguna lectura pasa por el reloj de pared. El pitido ya corría
 * en monotónico; ahora la pantalla corre en el mismo reloj.
 *
 * Equivalencia de relojes, demostrada contra el código de esta
 * plataforma y no por costumbre: el nativo agenda cada pitido en
 * tiempos absolutos sobre `SystemClock.uptimeMillis()` (módulo
 * Kotlin de nido-cpr) y devuelve ese instante; el
 * `performance.now()` de Hermes cuenta milisegundos sobre el
 * mismo reloj monotónico del sistema (tiempo desde el arranque,
 * sin saltos por red ni por zona). `originFromNativeStart`
 * convierte el instante nativo al reloj local midiéndolo contra
 * el instante local del mismo momento, y declara su propia red:
 * si la diferencia medida fuera absurda (más de 60 s en cualquier
 * sentido, lo que en esta plataforma no puede salir de dos
 * lecturas del mismo reloj), se queda con el instante local, que
 * es monotónico igualmente. El origen exacto desplaza la fase a
 * lo sumo en la latencia de la llamada (milisegundos sobre una
 * rejilla de 545 ms por compresión); lo que el arreglo garantiza
 * es la propiedad que el hallazgo rompía: ningún salto del reloj
 * de pared mueve conteo, fase ni rearme.
 */

import { compressionBlockStartMs } from "./cprCoach";

/** Reloj monotónico local, en ms (`performance.now()` si existe). */
export function monotonicNow(): number {
  const p = (globalThis as { performance?: { now(): number } }).performance;
  return p && typeof p.now === "function" ? p.now() : Date.now();
}

/** Diferencia máxima plausible entre los dos relojes monotónicos. */
const MAX_PLAUSIBLE_SKEW_MS = 60_000;

/**
 * El origen de la práctica a partir del instante que el metrónomo
 * devolvió al arrancar: ese instante, si casa con el reloj
 * monotónico local del mismo momento; si no hay instante (no hay
 * pitido nativo) o la diferencia es absurda, el instante local.
 */
export function originFromNativeStart(
  nativeStartMs: number | null | undefined,
  localMonotonicMs: number,
): number {
  if (typeof nativeStartMs !== "number" || !Number.isFinite(nativeStartMs) || nativeStartMs < 0) {
    return localMonotonicMs;
  }
  return Math.abs(nativeStartMs - localMonotonicMs) <= MAX_PLAUSIBLE_SKEW_MS
    ? nativeStartMs
    : localMonotonicMs;
}

export interface PracticeClock {
  /** Fija el cero de la práctica en el instante monotónico dado. */
  start(originMonotonicMs: number): void;
  /**
   * Ms de práctica en el instante monotónico dado. Nunca
   * retrocede: un rearme puede corregir el ancla unos milisegundos
   * y el conteo pintado no salta hacia atrás por ello.
   */
  elapsedAt(monotonicMs: number): number;
  /**
   * Rearme del 30:2: el bloque de compresiones del ciclo `cycle`
   * empieza, en el reloj monotónico, en `blockOriginMonotonicMs`
   * (el instante que el metrónomo devuelve al rearrancar, ya
   * convertido). El tiempo de práctica de ese instante pasa a ser
   * el inicio del bloque según el horario de la práctica, así el
   * bloque pintado y el bloque pitado empiezan juntos y el conteo
   * es continuo entre bloques.
   */
  reanchor(cycle: number, blockOriginMonotonicMs: number): void;
}

export function createPracticeClock(): PracticeClock {
  let origin = 0;
  let anchoredElapsed = 0;
  let floor = 0;
  let started = false;
  return {
    start(originMonotonicMs: number) {
      origin = originMonotonicMs;
      anchoredElapsed = 0;
      floor = 0;
      started = true;
    },
    elapsedAt(monotonicMs: number) {
      if (!started) return 0;
      const elapsed = anchoredElapsed + (monotonicMs - origin);
      if (elapsed > floor) floor = elapsed;
      return floor;
    },
    reanchor(cycle: number, blockOriginMonotonicMs: number) {
      if (!started) return;
      anchoredElapsed = compressionBlockStartMs(cycle);
      origin = blockOriginMonotonicMs;
    },
  };
}
