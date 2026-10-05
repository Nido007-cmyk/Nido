import { estimateContextBytes } from "../inference/ramBudget";

/**
 * Rough RAM-fit estimate for a GGUF model on this device — shared between
 * the catalog UI (CatalogItemCard) and the routing layer's ModelProfile
 * resolution, so both use the same formula rather than drifting apart.
 *
 * The estimate itself lives in src/inference/ramBudget.ts (weights + computed
 * KV cache + compute buffers — the same formula the engine's load-time
 * pre-flight uses), so a "green" badge and a successful pre-flight agree.
 * Heuristic, not a measurement; the green/yellow/red cutoffs are UI policy.
 */
export type Compatibility = "green" | "yellow" | "red" | "unknown";

export function computeCompatibility(sizeBytes: number, deviceRamBytes: number): Compatibility {
  if (deviceRamBytes <= 0) return "unknown";
  const estimatedRamBytes = estimateContextBytes({ fileSizeBytes: sizeBytes, nCtx: 4096 }).totalBytes;
  if (estimatedRamBytes <= deviceRamBytes * 0.65) return "green";
  if (estimatedRamBytes <= deviceRamBytes * 0.9) return "yellow";
  return "red";
}
