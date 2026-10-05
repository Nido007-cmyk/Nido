/**
 * The app side of the device evaluation CLI (scripts/eval-device.mjs). The
 * CLI writes a request to files/eval/requests/pending.json over
 * `adb ... run-as`; the app (development builds only, see ChatScreen.tsx)
 * picks it up, runs it through the same runEvaluation() the Evaluation
 * screen uses, and reports progress in files/eval/requests/<requestId>.status.json,
 * which the CLI polls. The app never talks to adb itself.
 */
import * as FileSystem from "expo-file-system/legacy";
import { getRoutingPreset } from "../models/settings";
import { EVAL_SET } from "./evalSet";
import { EVAL_RESULTS_DIR, listInstalledEvalModels, runEvaluation, RunEvaluationOptions, EvaluationRun } from "./evalHarness";
import { evalConfigId } from "./evalHarness.pure";
import { EvalRequest, EvalRequestStatus, parseEvalRequest, resolveEvalRequest } from "./deviceEvalRequest.pure";

export const EVAL_REQUESTS_DIR = `${EVAL_RESULTS_DIR}requests/`;
const PENDING_PATH = `${EVAL_REQUESTS_DIR}pending.json`;

async function writeStatus(status: Omit<EvalRequestStatus, "updatedAt">): Promise<void> {
  await FileSystem.makeDirectoryAsync(EVAL_REQUESTS_DIR, { intermediates: true }).catch(() => {});
  await FileSystem.writeAsStringAsync(
    `${EVAL_REQUESTS_DIR}${status.requestId}.status.json`,
    JSON.stringify({ ...status, updatedAt: Date.now() })
  );
}

/** Path relative to the app's data directory, the form `adb exec-out run-as <pkg> cat` takes. */
function toRunAsPath(uri: string): string {
  const docs = FileSystem.documentDirectory ?? "";
  return uri.startsWith(docs) ? `files/${uri.slice(docs.length)}` : uri;
}

/**
 * Claims the pending request, if any: deletes the file so it runs once.
 * An unreadable request is answered with a "failed" status instead of
 * being silently dropped.
 */
export async function takePendingEvalRequest(): Promise<EvalRequest | null> {
  const info = await FileSystem.getInfoAsync(PENDING_PATH);
  if (!info.exists) return null;
  const text = await FileSystem.readAsStringAsync(PENDING_PATH);
  await FileSystem.deleteAsync(PENDING_PATH, { idempotent: true });
  try {
    return parseEvalRequest(text);
  } catch (e: any) {
    const id = /"requestId"\s*:\s*"([a-z0-9-]{1,64})"/.exec(text)?.[1] ?? "invalid";
    await writeStatus({ requestId: id, state: "failed", error: `invalid request: ${e?.message ?? e}` });
    console.warn("[EVAL] rejected invalid device request:", e?.message ?? e);
    return null;
  }
}

export async function rejectEvalRequest(request: EvalRequest, error: string): Promise<void> {
  await writeStatus({ requestId: request.requestId, state: "failed", error });
}

/**
 * Resolves the request against what's installed and runs it. Callbacks are
 * passed through to runEvaluation so the Evaluation screen can show the
 * same progress as for a manual run.
 */
export async function runDeviceEvalRequest(
  request: EvalRequest,
  adaptiveLabel: (preset: string) => string,
  callbacks: Pick<RunEvaluationOptions, "onProgress" | "onRow" | "shouldStop"> = {}
): Promise<EvaluationRun | null> {
  const { requestId } = request;
  const [installed, preset] = await Promise.all([listInstalledEvalModels(), getRoutingPreset()]);
  const installedModels = installed.map((m) => m.id);
  const resolved = resolveEvalRequest(request, installed, EVAL_SET, adaptiveLabel(preset));
  if (!resolved.ok) {
    await writeStatus({ requestId, state: "failed", error: resolved.error, installedModels });
    return null;
  }

  const configs = resolved.configs.map(evalConfigId);
  const total = resolved.configs.length * resolved.queries.length;
  let completed = 0;
  let current: string | undefined;
  // One queue for every write, so a progress update can never land after "done".
  let writes = Promise.resolve();
  const queueStatus = (status: Omit<EvalRequestStatus, "updatedAt">) => {
    writes = writes.then(() => writeStatus(status)).catch(() => {});
    return writes;
  };
  await queueStatus({ requestId, state: "accepted", configs, total, completed, installedModels });
  console.log(`[EVAL] device request ${requestId}: ${configs.join(", ")} x ${resolved.queries.length} queries`);

  try {
    const run = await runEvaluation({
      configs: resolved.configs,
      queries: resolved.queries,
      shouldStop: callbacks.shouldStop,
      onProgress: (p) => {
        current = `${evalConfigId(p.config)} / ${p.query.id}`;
        queueStatus({ requestId, state: "running", configs, total, completed, current, installedModels });
        callbacks.onProgress?.(p);
      },
      onRow: (row) => {
        completed += 1;
        queueStatus({ requestId, state: "running", configs, total, completed, current, installedModels });
        callbacks.onRow?.(row);
      },
    });
    await queueStatus({
      requestId,
      state: "done",
      configs,
      total,
      completed: run.rows.length,
      runId: run.runId,
      resultPath: toRunAsPath(run.savedPath),
      stopped: run.stopped,
      installedModels,
    });
    return run;
  } catch (e: any) {
    await queueStatus({ requestId, state: "failed", configs, total, completed, error: e?.message ?? String(e), installedModels });
    throw e;
  }
}
