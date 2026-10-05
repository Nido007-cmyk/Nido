/**
 * Evaluation requests sent from a development machine (scripts/eval-device.mjs)
 * by writing a JSON file into the app's private storage over adb. Parsing
 * and resolution live here, native-module-free; the file handling is in
 * deviceEvalRequest.ts.
 */
import type { CatalogModel } from "../models/manifest";
import type { EvalConfig } from "./evalHarness.pure";
import type { EvalQuery } from "./evalSet";

export interface EvalRequest {
  requestId: string;
  /** Model selectors: an exact model id, or a fragment of one id/label ("phi-3.5", "instella-moe"). */
  models?: string[];
  /** Include the adaptive-routing config. */
  adaptive?: boolean;
  /** Restrict to these query ids or categories. All queries when absent. */
  queries?: string[];
}

export type EvalRequestState = "accepted" | "running" | "done" | "failed";

export interface EvalRequestStatus {
  requestId: string;
  state: EvalRequestState;
  updatedAt: number;
  configs?: string[];
  total?: number;
  completed?: number;
  current?: string;
  runId?: string;
  /** Path of the JSONL result relative to the app's data directory, for `run-as <pkg> cat`. */
  resultPath?: string;
  stopped?: boolean;
  error?: string;
  installedModels?: string[];
}

const REQUEST_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

function stringList(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string" || v.trim() === "")) {
    throw new Error(`"${field}" must be a list of non-empty strings`);
  }
  return value.map((v: string) => v.trim());
}

export function parseEvalRequest(json: string): EvalRequest {
  const raw = JSON.parse(json);
  if (typeof raw !== "object" || raw === null) throw new Error("request must be a JSON object");
  if (typeof raw.requestId !== "string" || !REQUEST_ID_RE.test(raw.requestId)) {
    throw new Error("requestId must be 1-64 lowercase letters, digits or dashes");
  }
  if (raw.adaptive !== undefined && typeof raw.adaptive !== "boolean") throw new Error('"adaptive" must be a boolean');
  return {
    requestId: raw.requestId,
    models: stringList(raw.models, "models"),
    adaptive: raw.adaptive,
    queries: stringList(raw.queries, "queries"),
  };
}

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Exact id first; otherwise every installed model whose id or label contains the selector, ignoring case and punctuation. */
export function matchModels(selector: string, installed: CatalogModel[]): CatalogModel[] {
  const exact = installed.filter((m) => m.id === selector);
  if (exact.length) return exact;
  const needle = normalize(selector);
  return installed.filter((m) => normalize(m.id).includes(needle) || normalize(m.label).includes(needle));
}

export type ResolvedEvalRequest =
  | { ok: true; configs: EvalConfig[]; queries: EvalQuery[] }
  | { ok: false; error: string };

/**
 * No models and no adaptive flag means "everything installed plus adaptive",
 * the same default as the Evaluation screen. Every selector must match
 * exactly one installed model, so a typo or an ambiguous fragment fails
 * loudly instead of silently evaluating something else.
 */
export function resolveEvalRequest(
  request: EvalRequest,
  installed: CatalogModel[],
  evalSet: EvalQuery[],
  adaptiveLabel: string
): ResolvedEvalRequest {
  const everything = !request.models?.length && !request.adaptive;
  const configs: EvalConfig[] = [];
  const models = everything ? installed : [];
  if (!everything) {
    for (const selector of request.models ?? []) {
      const matches = matchModels(selector, installed);
      if (matches.length !== 1) {
        const detail = matches.length === 0 ? "matches no installed model" : `is ambiguous (${matches.map((m) => m.id).join(", ")})`;
        return { ok: false, error: `model "${selector}" ${detail}` };
      }
      if (!models.some((m) => m.id === matches[0].id)) models.push(matches[0]);
    }
  }
  for (const m of models) configs.push({ kind: "model", modelId: m.id, label: m.label });
  if (everything || request.adaptive) configs.push({ kind: "adaptive", label: adaptiveLabel });

  let queries = evalSet;
  if (request.queries?.length) {
    const unknown = request.queries.filter((s) => !evalSet.some((q) => q.id === s || q.category === s));
    if (unknown.length) return { ok: false, error: `unknown query id or category: ${unknown.join(", ")}` };
    queries = evalSet.filter((q) => request.queries!.includes(q.id) || request.queries!.includes(q.category));
  }
  return { ok: true, configs, queries };
}
