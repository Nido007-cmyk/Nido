/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * QUARANTINED BENCHMARK TASK — NOT PRODUCTION CRYPTO.
 *
 * Runs the PBKDF2-HMAC-SHA256 candidate (scripts/benchmarks/pbkdf2-candidate/)
 * on-device to measure the NMB-1 physical cost gate (PBKDF2-600k, Tab A9+,
 * release/Hermes). This file is the ONLY production-tree file allowed to
 * import the candidate — enforced by src/eval/pbkdf2Quarantine.test.ts.
 *
 * Rules this task follows (and must keep following):
 * - TEST-ONLY data: fixed passphrase/salt constants below. Never derives
 *   keys from user input, the Keystore, or anything sensitive.
 * - Never touches user DBs, settings, P2P, wipe, network, or telemetry.
 * - Output is a JSON timing report in the eval results dir. Nothing else.
 * - This measurement does not constitute L3 authorization. NMB-1 stays draft.
 */
import * as FileSystem from "expo-file-system/legacy";
import { getMemoryInfo } from "ram-monitor";
import { trackPeakRss } from "../services/telemetry";
import { EVAL_RESULTS_DIR } from "./evalHarness";
import {
  pbkdf2Sha256,
  pbkdf2Sha256Chunked,
  PBKDF2_BENCH_ITERATIONS,
  PBKDF2_BENCH_SALT_LEN,
  PBKDF2_BENCH_DK_LEN,
  PBKDF2_BENCH_KDF_ID,
  PBKDF2_BENCH_CHUNK_ITERATIONS,
} from "../../scripts/benchmarks/pbkdf2-candidate/pbkdf2";
import { PBKDF2_CANDIDATE_SOURCE_SHA256 } from "../../scripts/benchmarks/pbkdf2-candidate/sourceHash";

/** TEST-ONLY. Not a secret, not user data — a fixed benchmark input. */
const BENCH_PASSPHRASE = "nido-pbkdf2-benchmark-test-passphrase-only";

/** TEST-ONLY fixed 32-byte salt (ascii prefix, zero-padded). */
function benchSalt(): Uint8Array {
  const s = new Uint8Array(PBKDF2_BENCH_SALT_LEN);
  s.set(new TextEncoder().encode("nido-pbkdf2-bench-salt"));
  return s;
}

const WARM_RUNS = 5;
/** Provisional evaluation criterion (NOT a frozen crypto constant). */
export const PBKDF2_PROVISIONAL_MAX_MS = 10_000;

export type Pbkdf2BenchMode = "chunked" | "unchunked";

export interface Pbkdf2CaseResult {
  mode: Pbkdf2BenchMode;
  coldMs: number;
  warmRunsMs: number[];
  warmMedianMs: number;
  peakRssBytes: number;
  rssBeforeBytes: number;
  rssAfterBytes: number;
}

export interface Pbkdf2BenchmarkReport {
  quarantine: string;
  candidateSourceHash: string;
  params: {
    kdf: "PBKDF2-HMAC-SHA256";
    kdfId: string;
    iterations: number;
    saltLen: number;
    dkLen: number;
  };
  chunkIterations: number;
  cases: Pbkdf2CaseResult[];
  observations: {
    /** By construction the JS thread (render, input) is frozen this long. */
    jsThreadBlockedMsUnchunked: number;
    /** Idle event-loop tick latency measured just before the unchunked run. */
    heartbeatBaselineMs: number;
    notes: string[];
  };
  provisionalCriterion: string;
  /** Provisional only — evaluated on-device against the criterion above. */
  provisionalVerdict: "PASS" | "FAIL";
}

function safeRssBytes(): number {
  try {
    return getMemoryInfo().rssBytes;
  } catch {
    return 0; // native module not linked (unit-test env); device runs report real values
  }
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
}

async function timedRun(
  mode: Pbkdf2BenchMode,
  onChunk?: (done: number, total: number) => void
): Promise<number> {
  const pw = new TextEncoder().encode(BENCH_PASSPHRASE);
  const salt = benchSalt();
  const t0 = performance.now();
  if (mode === "chunked") {
    await pbkdf2Sha256Chunked(pw, salt, PBKDF2_BENCH_ITERATIONS, PBKDF2_BENCH_DK_LEN, PBKDF2_BENCH_CHUNK_ITERATIONS, onChunk);
  } else {
    pbkdf2Sha256(pw, salt, PBKDF2_BENCH_ITERATIONS, PBKDF2_BENCH_DK_LEN);
  }
  return performance.now() - t0;
}

async function measureCase(
  mode: Pbkdf2BenchMode,
  onProgress?: (label: string) => void
): Promise<Pbkdf2CaseResult> {
  const peak = trackPeakRss(safeRssBytes, 200);
  const rssBeforeBytes = safeRssBytes();

  onProgress?.(`${mode}: cold run (1/${1 + WARM_RUNS})`);
  const coldMs = await timedRun(mode, (done, total) =>
    onProgress?.(`${mode}: cold ${((done / total) * 100).toFixed(0)}%`)
  );

  const warmRunsMs: number[] = [];
  for (let i = 0; i < WARM_RUNS; i++) {
    onProgress?.(`${mode}: warm run ${i + 1}/${WARM_RUNS}`);
    warmRunsMs.push(await timedRun(mode));
  }

  const peakRssBytes = peak.stop();
  const rssAfterBytes = safeRssBytes();
  return {
    mode,
    coldMs,
    warmRunsMs,
    warmMedianMs: median(warmRunsMs),
    peakRssBytes,
    rssBeforeBytes,
    rssAfterBytes,
  };
}

/**
 * Runs the full physical-gate protocol: cold (first derivation after start)
 * + warm (median of 5), chunked vs unchunked. Writes the JSON report to the
 * eval results dir and returns it with its saved path.
 */
export async function runPbkdf2Benchmark(onProgress?: (label: string) => void): Promise<{
  report: Pbkdf2BenchmarkReport;
  savedPath: string;
}> {
  // PBKDF2-2026-10-06: se eliminó la fase "unchunked". El research confirmó
  // que ambas fases miden lo mismo (600k iteraciones idénticas, ~1-2ms de
  // diferencia vs segundos de hashing) y el veredicto del gate ya se
  // calculaba solo del chunked. La fase sincrónica solo congelaba la UI
  // sin aportar información adicional.
  const chunked = await measureCase("chunked", onProgress);

  const provisionalVerdict: "PASS" | "FAIL" =
    chunked.warmMedianMs <= PBKDF2_PROVISIONAL_MAX_MS ? "PASS" : "FAIL";

  const report: Pbkdf2BenchmarkReport = {
    quarantine:
      "BENCHMARK CANDIDATE ONLY — NOT REVIEWED, NOT APPROVED FOR PRODUCTION. " +
      "This measurement does not constitute L3 authorization. NMB-1 remains draft.",
    candidateSourceHash: PBKDF2_CANDIDATE_SOURCE_SHA256,
    params: {
      kdf: "PBKDF2-HMAC-SHA256",
      kdfId: PBKDF2_BENCH_KDF_ID,
      iterations: PBKDF2_BENCH_ITERATIONS,
      saltLen: PBKDF2_BENCH_SALT_LEN,
      dkLen: PBKDF2_BENCH_DK_LEN,
    },
    chunkIterations: PBKDF2_BENCH_CHUNK_ITERATIONS,
    cases: [chunked],
    observations: {
      // La fase unchunked se eliminó el 2026-10-06: medía lo mismo que la
      // chunked (ver nota arriba). Se conserva el campo por compatibilidad
      // de schema, con el valor del cold chunked como proxy documentado.
      jsThreadBlockedMsUnchunked: chunked.coldMs,
      heartbeatBaselineMs: 0,
      notes: [
        "2026-10-06: unchunked phase removed — it measured the same 600k iterations as chunked (~1-2ms scheduling difference vs seconds of hashing). jsThreadBlockedMsUnchunked now carries the chunked cold time as a documented proxy.",
        "Chunked derivation yields to the event loop every 4096 iterations; UI stays responsive by design.",
        "RSS sampled via ram-monitor every 200ms during each case (same source as eval peak memory).",
      ],
    },
    provisionalCriterion: `chunked warm median <= ${PBKDF2_PROVISIONAL_MAX_MS}ms (provisional evaluation criterion, NOT a frozen crypto constant)`,
    provisionalVerdict,
  };

  const filename = `pbkdf2-benchmark-${Date.now()}.json`;
  const savedPath = `${EVAL_RESULTS_DIR}${filename}`;
  await FileSystem.makeDirectoryAsync(EVAL_RESULTS_DIR, { intermediates: true });
  await FileSystem.writeAsStringAsync(savedPath, JSON.stringify(report, null, 2));

  return { report, savedPath };
}
