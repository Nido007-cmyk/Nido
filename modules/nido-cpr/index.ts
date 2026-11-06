/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { requireOptionalNativeModule, type EventSubscription } from "expo-modules-core";

interface NidoMetronomeNative {
  start(bpm: number, maxBeats: number): number;
  stop(): boolean;
}

export interface CameraSamples {
  /** Instantes de cada fotograma (ms, reloj del sistema desde el arranque). */
  t: number[];
  /**
   * `stride` números por fotograma, seguidos: por cada bloque de la
   * rejilla, [dy, dx, e] (ver src/cpr/frameMotion.ts).
   */
  v: number[];
  stride: number;
}

interface NidoCprCameraNative {
  start(): Promise<boolean>;
  stop(): boolean;
  addListener(event: "onCprCameraSamples", listener: (s: CameraSamples) => void): EventSubscription;
  addListener(event: "onCprCameraError", listener: (e: { reason: string }) => void): EventSubscription;
}

const Metronome = requireOptionalNativeModule<NidoMetronomeNative>("NidoMetronome");
const Camera = requireOptionalNativeModule<NidoCprCameraNative>("NidoCprCamera");

/** true si este build trae el pitido nativo. */
export function hasNativeMetronome(): boolean {
  return Metronome != null;
}

/** Empieza a pitar a `bpm` por minuto. Devuelve false si no hay pitido nativo. */
export function startBeeping(bpm: number, maxBeats = 0): boolean {
  try {
    return (Metronome?.start(Math.round(bpm), Math.max(0, Math.floor(maxBeats))) ?? -1) >= 0;
  } catch {
    return false;
  }
}

export function stopBeeping(): void {
  try {
    Metronome?.stop();
  } catch {
    /* noop */
  }
}

export function hasCprCamera(): boolean {
  return Camera != null;
}

/**
 * Enciende el medidor de ritmo por cámara (pide el permiso si hace
 * falta). Devuelve una función para apagarlo, o null si no arrancó.
 */
export async function startCprCamera(
  onSamples: (s: CameraSamples) => void,
  onError: (reason: string) => void,
): Promise<(() => void) | null> {
  if (!Camera) return null;
  const subs = [
    Camera.addListener("onCprCameraSamples", onSamples),
    Camera.addListener("onCprCameraError", (e) => onError(e.reason)),
  ];
  const stop = () => {
    for (const s of subs) s.remove();
    try {
      Camera.stop();
    } catch {
      /* noop */
    }
  };
  let ok = false;
  try {
    ok = await Camera.start();
  } catch {
    ok = false;
  }
  if (!ok) {
    stop();
    return null;
  }
  return stop;
}
