/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { getDeviceTotalRamBytes, getMemoryInfo } from "ram-monitor";

/**
 * NIDO's RAM pre-flight for native model loads — pure and unit-testable.
 *
 * Idea adopted from BOAR's `estimateFit` (fail with a clear message instead
 * of an OOM crash), but the estimate itself is ours, derived from the
 * transformer/llama.cpp memory model rather than BOAR's flat 1.15x factor:
 *
 *   working set = weights (mmap'd, hot) + KV cache (computed) + compute buffers
 *
 * - Weights: with `use_mlock: false` llama.cpp mmaps the GGUF and pages
 *   weights in on demand — but generation touches every layer on every
 *   token, so the resident hot set converges to the full file size for a
 *   dense model. Counting the full file is the conservative, correct term.
 * - KV cache: exact formula — 2 (K and V) x nLayer x nCtx x nKvHeads x
 *   headDim x 2 bytes (llama.cpp keeps the KV cache in fp16 by default).
 *   For the bundled default (Qwen2.5-1.5B, n_ctx 4096): 112 MiB.
 * - Compute buffers: llama.cpp's per-context graph/compute allocation,
 *   roughly proportional to context length. 256 MiB at n_ctx 4096 is a
 *   deliberately conservative allowance (over- rather than under-estimates).
 *
 * Sanity check against the old 1.15x heuristic for the default model
 * (0.92 GiB file, n_ctx 4096): 0.92 + 0.11 + 0.26 = 1.28 GiB ~= 1.40x file
 * size. The old factor *under*-estimated by ~20% — the dangerous direction
 * for a pre-flight, which is why it was replaced.
 *
 * Validation against our own device benchmark (docs/COMPLIANCE.md §2):
 * Qwen2.5-1.5B measured ~1.6 GB steady-state process RSS on a physical
 * phone. This module estimates ~1.28 GiB for the model's own working set;
 * the gap is the app's baseline RSS, which the pre-flight subtracts live
 * from the ram-monitor reading rather than estimating. Same order of
 * magnitude, erring to the conservative side.
 *
 * What this deliberately does NOT do:
 * - It is a pre-flight, not a guarantee: the OS may still kill under
 *   sudden pressure. It turns "cryptic native crash" into "clear message".
 * - Concurrent loads (ChatScreen starts the LLM and the embedding engine
 *   together) each check against the same baseline RSS; the joint total is
 *   not reserved atomically. The estimates are conservative enough that
 *   this only matters on devices that were already marginal.
 */

export interface RamSnapshot {
  totalRamBytes: number;
  rssBytes: number;
}

export interface ContextSpec {
  /** On-disk GGUF size in bytes (0 when unknown — estimate degrades gracefully). */
  fileSizeBytes: number;
  /** Context length the engine will be initialized with. */
  nCtx: number;
  /** Transformer architecture, for the KV-cache term. Defaults to the
   *  bundled default model's profile (Qwen2.5-1.5B: 28 layers, GQA 2 KV
   *  heads, head dim 128). Override when the manifest knows better. */
  nLayer?: number;
  nKvHeads?: number;
  headDim?: number;
}

export interface RamEstimate {
  weightsBytes: number;
  kvCacheBytes: number;
  computeBytes: number;
  totalBytes: number;
}

export interface BudgetVerdict extends RamEstimate {
  /** False when loading would likely OOM — the caller should refuse with a clear message. */
  fits: boolean;
  availableBytes: number;
  totalRamBytes: number;
}

const MiB = 1024 * 1024;
const GiB = 1024 * 1024 * 1024;

/** llama.cpp's default KV-cache element type is fp16. */
const KV_BYTES_PER_ELEMENT = 2;

const DEFAULT_ARCH = { nLayer: 28, nKvHeads: 2, headDim: 128 };

/**
 * Conservative allowance for llama.cpp's per-context compute/graph buffers
 * at n_ctx 4096, scaled linearly with context length. Deliberately an
 * over-estimate: for a pre-flight, firing early is annoying, firing late is
 * a crash.
 */
const COMPUTE_BUFFER_BYTES_AT_4K_CTX = 256 * MiB;

/**
 * Headroom reserved for the Android system and background apps — a policy
 * constant, not a measurement. Intentionally strict on small devices: an
 * OOM kill loses the user's session with no recovery path, so the check
 * errs toward refusing a load that would leave the system gasping.
 *
 * Exported so the RAM-based default-model selection (src/models/defaultModel.ts)
 * uses the same policy number as the load-time pre-flight instead of
 * hardcoding its own copy.
 */
export const SYSTEM_HEADROOM_BYTES = 2 * GiB;

/** Exact KV-cache footprint for one llama.cpp context. */
export function estimateKvCacheBytes(
  nLayer: number,
  nCtx: number,
  nKvHeads: number,
  headDim: number
): number {
  return 2 * nLayer * nCtx * nKvHeads * headDim * KV_BYTES_PER_ELEMENT;
}

export function estimateContextBytes(spec: ContextSpec): RamEstimate {
  const nLayer = spec.nLayer ?? DEFAULT_ARCH.nLayer;
  const nKvHeads = spec.nKvHeads ?? DEFAULT_ARCH.nKvHeads;
  const headDim = spec.headDim ?? DEFAULT_ARCH.headDim;
  const weightsBytes = Math.max(spec.fileSizeBytes, 0);
  const kvCacheBytes = estimateKvCacheBytes(nLayer, spec.nCtx, nKvHeads, headDim);
  const computeBytes = Math.ceil((COMPUTE_BUFFER_BYTES_AT_4K_CTX * Math.max(spec.nCtx, 0)) / 4096);
  return {
    weightsBytes,
    kvCacheBytes,
    computeBytes,
    totalBytes: weightsBytes + kvCacheBytes + computeBytes,
  };
}

/**
 * Pure budget check against a RAM snapshot. Returns null when the snapshot
 * carries no usable readout (totalRamBytes <= 0) — the caller must then skip
 * the check (fail open when blind) rather than block loading on missing data.
 */
export function checkRamBudget(spec: ContextSpec, snapshot: RamSnapshot): BudgetVerdict | null {
  if (snapshot.totalRamBytes <= 0) return null;
  const estimate = estimateContextBytes(spec);
  const availableBytes = Math.max(snapshot.totalRamBytes - snapshot.rssBytes - SYSTEM_HEADROOM_BYTES, 0);
  return {
    ...estimate,
    fits: estimate.totalBytes <= availableBytes,
    availableBytes,
    totalRamBytes: snapshot.totalRamBytes,
  };
}

/**
 * Reads the live RAM snapshot from the native ram-monitor module.
 * Best-effort: returns null when the native readouts are unavailable.
 */
export function readRamSnapshot(): RamSnapshot | null {
  try {
    const totalRamBytes = getDeviceTotalRamBytes();
    if (totalRamBytes <= 0) return null;
    return { totalRamBytes, rssBytes: getMemoryInfo().rssBytes };
  } catch {
    return null;
  }
}

/** "1.3" style GiB formatting for user-facing diagnostics. */
export function toGb(bytes: number): string {
  return (bytes / GiB).toFixed(1);
}
