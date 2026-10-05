/**
 * Native-module-free half of execution telemetry — row (de)serialization
 * and export formatting, kept separate from executionTelemetry.ts (which
 * pulls in expo-sqlite/expo-file-system/expo-sharing) so this stays
 * unit-testable under plain Node/vitest, same pattern as src/rag/pure.ts.
 */

export type ModelResidency = "cold" | "switched" | "resident";
export type ExecutionOutcome = "success" | "failure" | "cancelled";

export interface ExecutionTelemetryRecord {
  id: string;
  createdAt: number;
  modelId?: string;
  taskType?: string;
  adaptiveRoutingUsed: boolean;
  reasonCodes?: string[];
  retrievalUsed?: boolean;
  /** Plan-local switches (see executor.ts's PipelineResult.modelSwitches doc comment) — NOT the same question as crossMessageModelSwitch. */
  modelSwitches?: number;
  crossMessageModelSwitch?: boolean;
  modelResidency?: ModelResidency;
  modelLoadMs?: number;
  ttftMs?: number;
  generationLatencyMs?: number;
  totalLatencyMs?: number;
  tokensGenerated?: number;
  tokPerSec?: number;
  peakRssBytes?: number;
  outcome?: ExecutionOutcome;
  errorMessage?: string;
}

export function newExecutionId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function toExecutionRow(
  r: Omit<ExecutionTelemetryRecord, "id" | "createdAt">,
  id: string,
  createdAt: number
): (string | number | null)[] {
  return [
    id,
    createdAt,
    r.modelId ?? null,
    r.taskType ?? null,
    r.adaptiveRoutingUsed ? 1 : 0,
    r.reasonCodes ? JSON.stringify(r.reasonCodes) : null,
    r.retrievalUsed == null ? null : r.retrievalUsed ? 1 : 0,
    r.modelSwitches ?? null,
    r.crossMessageModelSwitch == null ? null : r.crossMessageModelSwitch ? 1 : 0,
    r.modelResidency ?? null,
    r.modelLoadMs ?? null,
    r.ttftMs ?? null,
    r.generationLatencyMs ?? null,
    r.totalLatencyMs ?? null,
    r.tokensGenerated ?? null,
    r.tokPerSec ?? null,
    r.peakRssBytes ?? null,
    r.outcome ?? null,
    r.errorMessage ?? null,
  ];
}

export interface ExecutionRow {
  id: string;
  created_at: number;
  model_id: string | null;
  task_type: string | null;
  adaptive_routing_used: number;
  reason_codes: string | null;
  retrieval_used: number | null;
  model_switches: number | null;
  cross_message_model_switch: number | null;
  model_residency: string | null;
  model_load_ms: number | null;
  ttft_ms: number | null;
  generation_latency_ms: number | null;
  total_latency_ms: number | null;
  tokens_generated: number | null;
  tok_per_sec: number | null;
  peak_rss_bytes: number | null;
  outcome: string | null;
  error_message: string | null;
}

/**
 * Fail-safe parse of the reason_codes column. Corrupt local telemetry must
 * never crash the surface that lists it (Q-1): a bad cell degrades to
 * `undefined` instead of throwing, and valid JSON with the wrong shape
 * (not an array of strings) is also treated as absent rather than flowing
 * through unchecked.
 */
function parseReasonCodes(raw: string | null): string[] | undefined {
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) {
      return parsed;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export function fromExecutionRow(r: ExecutionRow): ExecutionTelemetryRecord {
  return {
    id: r.id,
    createdAt: r.created_at,
    modelId: r.model_id ?? undefined,
    taskType: r.task_type ?? undefined,
    adaptiveRoutingUsed: r.adaptive_routing_used === 1,
    reasonCodes: parseReasonCodes(r.reason_codes),
    retrievalUsed: r.retrieval_used == null ? undefined : r.retrieval_used === 1,
    modelSwitches: r.model_switches ?? undefined,
    crossMessageModelSwitch: r.cross_message_model_switch == null ? undefined : r.cross_message_model_switch === 1,
    modelResidency: (r.model_residency as ModelResidency) ?? undefined,
    modelLoadMs: r.model_load_ms ?? undefined,
    ttftMs: r.ttft_ms ?? undefined,
    generationLatencyMs: r.generation_latency_ms ?? undefined,
    totalLatencyMs: r.total_latency_ms ?? undefined,
    tokensGenerated: r.tokens_generated ?? undefined,
    tokPerSec: r.tok_per_sec ?? undefined,
    peakRssBytes: r.peak_rss_bytes ?? undefined,
    outcome: (r.outcome as ExecutionOutcome) ?? undefined,
    errorMessage: r.error_message ?? undefined,
  };
}

export function executionRecordsToJson(records: ExecutionTelemetryRecord[]): string {
  return JSON.stringify(records, null, 2);
}

const CSV_COLUMNS: Array<keyof ExecutionTelemetryRecord> = [
  "id",
  "createdAt",
  "modelId",
  "taskType",
  "adaptiveRoutingUsed",
  "reasonCodes",
  "retrievalUsed",
  "modelSwitches",
  "crossMessageModelSwitch",
  "modelResidency",
  "modelLoadMs",
  "ttftMs",
  "generationLatencyMs",
  "totalLatencyMs",
  "tokensGenerated",
  "tokPerSec",
  "peakRssBytes",
  "outcome",
  "errorMessage",
];

export function csvCell(value: unknown): string {
  if (value === undefined || value === null) return "";
  const s = Array.isArray(value) ? value.join("|") : String(value);
  // Quote whenever the cell could otherwise be misread — a comma, a quote
  // (escaped by doubling, standard CSV), or a newline.
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function executionRecordsToCsv(records: ExecutionTelemetryRecord[]): string {
  const header = CSV_COLUMNS.join(",");
  const lines = records.map((r) => CSV_COLUMNS.map((c) => csvCell(r[c])).join(","));
  return [header, ...lines].join("\n");
}
