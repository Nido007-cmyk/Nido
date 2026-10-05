/**
 * Local, in-memory performance/memory telemetry for the live Usage Stats
 * display. Nothing here is persisted or transmitted anywhere — wiped on
 * every reload/restart, by design; it's for auditing THIS session's
 * inference performance and RAM footprint against the bounty's 12GB RAM /
 * 50GB storage caps.
 *
 * This is deliberately kept as-is (a compatibility layer, not replaced) by
 * Phase 7 (docs/ADAPTIVE_ROUTING.md) — for a record that survives a
 * reload/restart and can be browsed/compared/exported across many runs,
 * see src/services/executionTelemetry.ts's SQLite-backed
 * execution_telemetry table instead, which is the actual persistent
 * source of truth going forward.
 */
import { getMemoryInfo } from "ram-monitor";
import type { TaskType } from "../routing/types";
import type { ModelResidency } from "../routing/executor";

export interface QueryStats {
  tokensGenerated: number;
  /**
   * Full request span (start of send() to final response) — for the
   * adaptive path this INCLUDES model load time, retrieval, and
   * generation all together; see totalLatencyMs (identical value, kept as
   * a differently-named duplicate so adaptive-routed records don't need
   * two different field names depending on path) and the more precise
   * modelLoadMs/ttftMs/generationLatencyMs breakdown below for that path.
   */
  durationMs: number;
  /**
   * For the adaptive path (Phase 9), this is executor.ts's precisely-
   * scoped ttftMs: from the moment generate() was called (model already
   * loaded/ready — load time excluded) to the first streamed token. For
   * the fixed-active-model path and Deep Research, this is still the
   * coarser "start of send() to first token" measurement (no separate
   * model-load phase to exclude there — the model's loaded once at mount
   * and never changes per-message, so the two measurements are close in
   * practice for that path, just not renamed/unified here to avoid
   * touching Deep Research or the fixed-model path's behavior).
   */
  ttftMs: number;
  tokPerSec: number;
  peakRssBytes: number;
  timestamp: number;
  /**
   * Adaptive routing (Phase 9) fields — all optional, present only when
   * the request actually went through runAdaptiveChat()
   * (src/services/adaptiveChat.ts). Undefined for the existing fixed-
   * active-model path and for Deep Research Mode (unaffected by this
   * integration), so this stays a strict addition — every existing
   * QueryStats consumer keeps working unchanged.
   */
  adaptiveRoutingUsed?: boolean;
  modelId?: string;
  taskType?: TaskType;
  reasonCodes?: string[];
  /** Plan-local switches only (a single plan needing multiple roles) — see executor.ts's PipelineResult.modelSwitches doc comment. NOT "did the model differ from the previous request" — see crossMessageModelSwitch for that. */
  modelSwitches?: number;
  /** Whether the resident model actually changed between the start and end of this request, per LlamaEngine's own real state (not an assumption) — false for a cold start or a failed/skipped load, true for a genuine Qwen<->Phi transition, whether within this plan or carried over from a previous, separate request. */
  crossMessageModelSwitch?: boolean;
  /** "cold" | "switched" | "resident" — see executor.ts's ModelResidency/PipelineResult.modelResidency doc comments. Undefined when not adaptive-routed (not measured there). */
  modelResidency?: ModelResidency;
  /** Time spent in llamaEngine.load() for the generate step's model — 0 when modelResidency is "resident". Phase 7 (docs/ADAPTIVE_ROUTING.md): this is the field that separates cold-load cost from actual generation speed, which the old undifferentiated ttftMs conflated. */
  modelLoadMs?: number;
  retrievalUsed?: boolean;
  /**
   * For the adaptive path: from the first streamed token to generate()
   * resolving (i.e. the whole generate() call's duration minus ttftMs) —
   * NOT "time spent inside executeRoutingPlan() (retrieval + generation +
   * verification)" the way this field used to be defined; that coarser,
   * conflated meaning is what motivated splitting modelLoadMs/ttftMs out
   * as their own fields in the first place, so this was corrected to
   * match rather than kept as a stale duplicate of a renamed field.
   */
  generationLatencyMs?: number;
  /** Full request span, same basis/value as durationMs — kept as a named field so it doesn't get confused with generationLatencyMs for adaptive-routed requests. */
  totalLatencyMs?: number;
  outcome?: "success" | "failure" | "cancelled";
}

type Listener = (stats: QueryStats) => void;

let lastStats: QueryStats | null = null;
const listeners = new Set<Listener>();

export function recordQueryStats(stats: QueryStats): void {
  lastStats = stats;
  listeners.forEach((l) => l(stats));
}

export function getLastQueryStats(): QueryStats | null {
  return lastStats;
}

export function subscribeQueryStats(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Tracks peak RSS by sampling `ram-monitor` at an interval while a
 * generation is in flight. Call `stop()` once the query is done to get the
 * peak observed during that window (and stop the interval).
 */
export function trackPeakRss(sampleFn: () => number, intervalMs = 400) {
  let peak = sampleFn();
  const id = setInterval(() => {
    const current = sampleFn();
    if (current > peak) peak = current;
  }, intervalMs);

  return {
    stop(): number {
      clearInterval(id);
      const current = sampleFn();
      if (current > peak) peak = current;
      return peak;
    },
  };
}

/**
 * App-lifetime peak RSS (process resident set size), not just during a
 * single query — tracks the high-water mark from the moment the app
 * started polling (typically once a model is loaded), so "was this app
 * ever over 12GB" is answerable even between queries. Started once,
 * lazily, on first read/poll — see startAppMemoryTracking().
 */
let appPeakRssBytes = 0;
let trackingStarted = false;

export function startAppMemoryTracking(intervalMs = 2000): void {
  if (trackingStarted) return;
  trackingStarted = true;
  const poll = () => {
    try {
      const rss = getMemoryInfo().rssBytes;
      if (rss > appPeakRssBytes) appPeakRssBytes = rss;
    } catch {
      // native module not linked; leave peak at whatever we've seen
    }
  };
  poll();
  setInterval(poll, intervalMs);
}

export function getAppPeakRssBytes(): number {
  return appPeakRssBytes;
}
