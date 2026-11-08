/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { MODEL_CATALOG, type CatalogModel } from "./manifest";
import {
  estimateContextBytes,
  readRamSnapshot,
  SYSTEM_HEADROOM_BYTES,
  type ContextSpec,
} from "../inference/ramBudget";

/**
 * RAM-based default LLM selection (2026-10-05, owner decision: the default
 * model follows the device's RAM, it is NOT one fixed model for everyone).
 *
 * - The preferred default stays Qwen2.5-1.5B on devices where the project's
 *   own pre-flight formula says it fits.
 * - On smaller devices the default is Qwen2.5-0.5B (same family, ~0.5 GiB
 *   working set at its default n_ctx 2048).
 * - The user can always switch in Settings > Tone & Model; this only picks
 *   the out-of-the-box default and what the setup wizard downloads.
 *
 * The threshold is not a magic number: it falls out of the pre-flight
 * formula. The 1.5B needs ~1.28 GiB (940 MiB weights + 112 MiB KV @4096 +
 * 256 MiB compute); with a 0.5 GiB app-baseline estimate and the 2 GiB
 * system headroom policy, devices reporting >= ~3.8 GiB total get the 1.5B
 * and anything below gets the 0.5B. A 4 GB phone (typically ~3.7 GiB
 * addressable) lands on the 0.5B; 6 GB+ phones get the 1.5B.
 */

const MiB = 1024 * 1024;
const GiB = 1024 * MiB;

/** App baseline RSS estimate at setup time, before any model is loaded. */
const SETUP_RSS_ESTIMATE_BYTES = 512 * MiB;

export const PREFERRED_LLM_ID = "qwen2.5-1.5b-instruct-q4km";
export const LIGHT_LLM_ID = "qwen2.5-0.5b-instruct-q4km";

/** ContextSpec for a catalog model: its declared arch + default n_ctx. */
export function contextSpecForModel(m: CatalogModel): ContextSpec {
  return {
    fileSizeBytes: m.sizeBytes,
    nCtx: m.defaultNCtx ?? 4096,
    nLayer: m.arch?.nLayer,
    nKvHeads: m.arch?.nKvHeads,
    headDim: m.arch?.headDim,
  };
}

/**
 * ContextSpec for a model file about to load: the catalog entry's arch when
 * known (falls back to the pre-flight default profile), the ACTUAL nCtx the
 * engine will use, and the real on-disk size.
 */
export function contextSpecForFilename(
  filename: string,
  fileSizeBytes: number,
  nCtx: number
): ContextSpec {
  const entry = MODEL_CATALOG.find((m) => m.filename === filename);
  return {
    fileSizeBytes,
    nCtx,
    nLayer: entry?.arch?.nLayer,
    nKvHeads: entry?.arch?.nKvHeads,
    headDim: entry?.arch?.headDim,
  };
}

/**
 * Techo de contexto por clase de aparato (optimización 2026-11-08,
 * plan adoptado n.º 7): en aparatos de ≤4 GiB, un modelo cuyo
 * contexto por defecto declarado es 3072 (hoy solo el Qwen3-0.6B,
 * cuya KV por token es ~9× la del 0.5B) nace con techo 2048: son
 * ~0,17 GiB menos de KV y de cómputo antes de que la escalera
 * empiece a trabajar. El resto de techos no se toca: el 0.5B
 * conserva su 4096 declarado y la escalera lo baja cuando el
 * aparato lo pide, como hasta ahora. Sin lectura de RAM (null o
 * basura) manda el techo declarado: cero cambio a ciegas. La opción
 * explícita de contexto tampoco pasa por aquí: manda ella.
 */
export function contextCeilingForDevice(
  catalogDefaultNCtx: number | undefined,
  totalRamBytes: number | null,
): number {
  const declared = catalogDefaultNCtx ?? 4096;
  if (
    totalRamBytes !== null &&
    Number.isFinite(totalRamBytes) &&
    totalRamBytes > 0 &&
    totalRamBytes <= 4 * GiB &&
    declared === 3072
  ) {
    return 2048;
  }
  return declared;
}
export function defaultLlmForRam(totalRamBytes: number): CatalogModel {
  const preferred = MODEL_CATALOG.find((m) => m.id === PREFERRED_LLM_ID)!;
  const light = MODEL_CATALOG.find((m) => m.id === LIGHT_LLM_ID)!;
  if (totalRamBytes <= 0) return preferred; // blind: preserve historic default
  const need = estimateContextBytes(contextSpecForModel(preferred)).totalBytes;
  const available = totalRamBytes - SETUP_RSS_ESTIMATE_BYTES - SYSTEM_HEADROOM_BYTES;
  return need <= available ? preferred : light;
}

/**
 * Device-aware default: reads total RAM via the pre-flight's snapshot
 * reader (which itself best-efforts the native module). Fail-open to the
 * historic default when the readout is unavailable — the load-time
 * pre-flight (ramBudget) remains the real safety net.
 */
export function defaultLlmForDevice(): CatalogModel {
  const snapshot = readRamSnapshot();
  if (snapshot && snapshot.totalRamBytes > 0) {
    return defaultLlmForRam(snapshot.totalRamBytes);
  }
  return MODEL_CATALOG.find((m) => m.id === PREFERRED_LLM_ID)!;
}

/**
 * Models offered in the setup wizard's model picker: the light and the
 * preferred LLM. The bigger catalog models (7B/8B MoE, Gemma, Phi) stay
 * available later in Settings for capable devices — offering them at
 * first-run would invite downloads that fail the load-time pre-flight.
 */
export function setupLlmChoices(): CatalogModel[] {
  const light = MODEL_CATALOG.find((m) => m.id === LIGHT_LLM_ID)!;
  const preferred = MODEL_CATALOG.find((m) => m.id === PREFERRED_LLM_ID)!;
  return [light, preferred];
}

/**
 * Which model id the setup picker preselects for a device with
 * `totalRamBytes` of total RAM. Pure and testable.
 */
export function preselectLlmId(totalRamBytes: number): string {
  return defaultLlmForRam(totalRamBytes).id;
}
