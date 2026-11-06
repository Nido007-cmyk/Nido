/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { requireOptionalNativeModule } from "expo-modules-core";

interface NidoMetronomeNative {
  start(bpm: number, maxBeats: number): number;
  stop(): boolean;
}

const Native = requireOptionalNativeModule<NidoMetronomeNative>("NidoMetronome");

/** true si este build trae el pitido nativo. */
export function hasNativeMetronome(): boolean {
  return Native != null;
}

/** Empieza a pitar a `bpm` por minuto. Devuelve false si no hay pitido nativo. */
export function startBeeping(bpm: number, maxBeats = 0): boolean {
  try {
    return (Native?.start(Math.round(bpm), Math.max(0, Math.floor(maxBeats))) ?? -1) >= 0;
  } catch {
    return false;
  }
}

export function stopBeeping(): void {
  try {
    Native?.stop();
  } catch {
    /* noop */
  }
}
