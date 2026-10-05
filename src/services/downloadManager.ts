import { ModelManager, DownloadProgress } from "../models/ModelManager";
import {
  DownloadErrorCode,
  DownloadFailure,
  downloadFailureUserMessage,
} from "../models/downloadErrors";
import { CatalogModel } from "../models/manifest";
import { holdWakeLockForDownload } from "./downloadWakeLock";

/**
 * Module-level (not component-local) download state, so it survives the
 * Settings screen unmounting/remounting — e.g. the user closes Settings
 * while a download is running, then reopens it later. Without this, a
 * previous version tracked download progress in ModelSetupScreen's local
 * React state: closing Settings meant losing track of the in-flight
 * download entirely, so reopening Settings showed a plain "Download"
 * button again (as if nothing were happening) even while the original
 * download was still writing to disk. Tapping "Download" again in that
 * state started a SECOND concurrent download to the same destination file
 * — a real race condition, and plausibly part of what produced the
 * truncated Qwen downloads found earlier (two writers to one path).
 *
 * `startDownload` guards against exactly that: if a download for this
 * asset is already in flight, it returns the existing one instead of
 * starting a duplicate.
 */

export interface DownloadState {
  downloading: boolean;
  progress: number;
  error: string | null;
  /**
   * Machine-readable failure code (see downloadErrors.ts). Lets the UI
   * distinguish "retry resumes" from "retry restarts" honestly instead of
   * guessing from the message text.
   */
  errorCode?: DownloadErrorCode;
  /**
   * True ONLY when the partial file and resume token were kept — the next
   * attempt genuinely continues from bytesWritten. False means the partial
   * was discarded and retrying starts from the beginning.
   */
  canResume?: boolean;
  bytesWritten?: number;
  bytesExpected?: number;
  speedBytesPerSec?: number;
  etaSeconds?: number;
  /**
   * Meta #3 ("hope is not a strategy"): automatic retry state. When a
   * TRANSIENT failure occurs and auto-retries remain, the manager waits
   * `nextRetryInSeconds` (counted down live) then retries by itself —
   * the user just watches. Never for permanent/resource failures, never
   * infinite: MAX_AUTO_RETRIES attempts, then the final error surfaces.
   */
  autoRetrying?: boolean;
  retryAttempt?: number;
  maxAutoRetries?: number;
  nextRetryInSeconds?: number;
}

/**
 * Meta #3: bounded automatic retry for transient failures only.
 * Exponential backoff (2s, 8s, 32s) with ±25% jitter so a fleet of
 * devices doesn't thundering-herd the server at the same instant.
 * Permanent and resource failures are never retried automatically —
 * retrying them cannot help (permanent) or needs the user to act (disk).
 */
export const MAX_AUTO_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 2000;
const RETRY_BACKOFF_FACTOR = 4;

export function retryDelayMs(attempt: number): number {
  const base = RETRY_BASE_DELAY_MS * Math.pow(RETRY_BACKOFF_FACTOR, attempt - 1);
  const jitter = base * 0.25 * (Math.random() * 2 - 1);
  return Math.max(500, Math.round(base + jitter));
}

const autoRetryAttempts = new Map<string, number>();
const autoRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();
const autoRetryCountdowns = new Map<string, ReturnType<typeof setInterval>>();

function clearAutoRetry(assetId: string) {
  const t = autoRetryTimers.get(assetId);
  if (t) clearTimeout(t);
  autoRetryTimers.delete(assetId);
  const c = autoRetryCountdowns.get(assetId);
  if (c) clearInterval(c);
  autoRetryCountdowns.delete(assetId);
  autoRetryAttempts.delete(assetId);
}

const modelManager = new ModelManager();
const state = new Map<string, DownloadState>();
const inFlight = new Map<string, Promise<void>>();
const downloadTimestamps = new Map<string, { lastBytes: number; lastTime: number; startTime: number }>();
type Listener = () => void;
const listeners = new Set<Listener>();

function notify() {
  listeners.forEach((l) => l());
}

export function subscribeDownloads(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getDownloadState(assetId: string): DownloadState | undefined {
  return state.get(assetId);
}

export function isDownloading(assetId: string): boolean {
  return inFlight.has(assetId);
}

/**
 * All currently-tracked download states, keyed by asset id. Used by
 * screens that don't already know the specific set of asset ids to watch —
 * e.g. ChatScreen surfacing a "download complete" toast for whatever
 * optional model the user started downloading from the Models screen,
 * without needing its own copy of the full catalog+discovered-models list
 * just to enumerate what to check.
 */
export function listDownloadStates(): Array<{ assetId: string; state: DownloadState }> {
  return Array.from(state.entries()).map(([assetId, s]) => ({ assetId, state: s }));
}

/**
 * Forgets all tracked download state without cancelling any in-flight
 * FileSystem transfer (there's no cancel handle stored here to call) — used
 * by appReset.ts right before deleting the model files those transfers
 * would have been writing to, so a stale/failed entry doesn't linger for a
 * file that no longer exists.
 */
export function resetDownloadState(): void {
  for (const id of Array.from(autoRetryTimers.keys())) clearAutoRetry(id);
  state.clear();
  inFlight.clear();
  downloadTimestamps.clear();
  notify();
}

/**
 * Force-restarts a download that's stuck with no error surfaced at all —
 * no progress, no failure, just inert. This can happen with no real device
 * problem: `inFlight`/`state` are module-level singletons, so a dev Fast
 * Refresh mid-download can leave a stale in-flight entry pointing at a
 * promise nothing will ever resolve, which `startDownload`'s "already
 * running" guard then treats as legitimately in progress forever. Unlike
 * `startDownload`, this doesn't check that guard — it clears the tracked
 * state unconditionally and cancels+deletes whatever ModelManager was
 * actually holding, then starts clean.
 *
 * Ordering matters: signal cancel, then AWAIT the stale in-flight promise's
 * settlement, and only then delete the file and start over. Deleting the
 * file right after signalling cancel (without waiting) races the old
 * download's writer, which doesn't stop touching the file the instant
 * pauseAsync() resolves — if it closes its stream after the new download
 * already finished, it silently truncates the file back down, and a fully-
 * downloaded model comes back verified as 0 bytes.
 */
export async function restartDownload(asset: CatalogModel): Promise<void> {
  const stale = inFlight.get(asset.id);
  await modelManager.signalCancelDownload(asset);
  if (stale) {
    await stale.catch(() => {});
  }
  await modelManager.deletePartialDownload(asset);
  inFlight.delete(asset.id);
  state.delete(asset.id);
  downloadTimestamps.delete(asset.id);
  notify();
  await startDownload(asset);
}

/** Starts a download if one isn't already running for this asset; otherwise no-ops. */
export function startDownload(asset: CatalogModel): Promise<void> {
  // Manual start (user tapped Retry/Download): any pending auto-retry chain
  // is superseded — clear it and start the counter fresh.
  clearAutoRetry(asset.id);
  return startDownloadInternal(asset);
}

/** Automatic retry path: keeps the attempt counter so the chain stays bounded. */
function startDownloadInternal(asset: CatalogModel): Promise<void> {
  const existing = inFlight.get(asset.id);
  if (existing) return existing;

  const now = Date.now();
  downloadTimestamps.set(asset.id, { lastBytes: 0, lastTime: now, startTime: now });

  state.set(asset.id, {
    downloading: true,
    progress: 0,
    error: null,
    bytesWritten: 0,
    bytesExpected: asset.sizeBytes,
    speedBytesPerSec: 0,
    etaSeconds: 0,
  });
  notify();

  const releaseWakeLock = holdWakeLockForDownload(asset.id);
  const promise = modelManager
    .downloadCatalogModel(asset, (p: DownloadProgress) => {
      const progress = p.totalBytesExpectedToWrite > 0 ? p.totalBytesWritten / p.totalBytesExpectedToWrite : 0;
      const ts = downloadTimestamps.get(asset.id);
      const currentTime = Date.now();
      let speedBytesPerSec = 0;
      let etaSeconds = 0;

      if (ts) {
        const timeDiffSec = (currentTime - ts.lastTime) / 1000;
        if (timeDiffSec >= 0.5) {
          const bytesDiff = p.totalBytesWritten - ts.lastBytes;
          speedBytesPerSec = Math.max(0, bytesDiff / timeDiffSec);
          ts.lastBytes = p.totalBytesWritten;
          ts.lastTime = currentTime;
        } else {
          const prev = state.get(asset.id);
          speedBytesPerSec = prev?.speedBytesPerSec ?? 0;
        }

        const remainingBytes = Math.max(0, p.totalBytesExpectedToWrite - p.totalBytesWritten);
        if (speedBytesPerSec > 0) {
          etaSeconds = Math.ceil(remainingBytes / speedBytesPerSec);
        }
      }

      state.set(asset.id, {
        downloading: true,
        progress,
        error: null,
        bytesWritten: p.totalBytesWritten,
        bytesExpected: p.totalBytesExpectedToWrite,
        speedBytesPerSec,
        etaSeconds,
      });
      notify();
    })
    .then(() => {
      clearAutoRetry(asset.id);
      state.set(asset.id, {
        downloading: false,
        progress: 1,
        error: null,
        bytesWritten: asset.sizeBytes,
        bytesExpected: asset.sizeBytes,
        speedBytesPerSec: 0,
        etaSeconds: 0,
        autoRetrying: false,
      });
      downloadTimestamps.delete(asset.id);
    })
    .catch((e: any) => {
      const failure = e instanceof DownloadFailure ? e : null;
      const attempts = autoRetryAttempts.get(asset.id) ?? 0;
      // Meta #3: transient failures get bounded automatic retries with
      // backoff+jitter. Permanent/resource failures surface immediately —
      // retrying them automatically cannot help.
      if (failure && failure.kind === "transient" && attempts < MAX_AUTO_RETRIES) {
        const nextAttempt = attempts + 1;
        autoRetryAttempts.set(asset.id, nextAttempt);
        const delayMs = retryDelayMs(nextAttempt);
        let remainingSec = Math.ceil(delayMs / 1000);
        state.set(asset.id, {
          downloading: false,
          progress: 0,
          error: null, // not a final error yet — we're retrying
          errorCode: failure.code,
          canResume: failure.canResume,
          bytesWritten: failure.bytesReceived,
          bytesExpected: asset.sizeBytes,
          autoRetrying: true,
          retryAttempt: nextAttempt,
          maxAutoRetries: MAX_AUTO_RETRIES,
          nextRetryInSeconds: remainingSec,
        });
        notify();
        autoRetryCountdowns.set(
          asset.id,
          setInterval(() => {
            remainingSec = Math.max(0, remainingSec - 1);
            const s = state.get(asset.id);
            if (s?.autoRetrying) {
              state.set(asset.id, { ...s, nextRetryInSeconds: remainingSec });
              notify();
            }
          }, 1000)
        );
        autoRetryTimers.set(
          asset.id,
          setTimeout(() => {
            // Fire the retry: clear only the timer handles, KEEP the attempt
            // counter so the chain stays bounded across attempts.
            const t = autoRetryTimers.get(asset.id);
            if (t) clearTimeout(t);
            autoRetryTimers.delete(asset.id);
            const c = autoRetryCountdowns.get(asset.id);
            if (c) clearInterval(c);
            autoRetryCountdowns.delete(asset.id);
            startDownloadInternal(asset);
          }, delayMs)
        );
        downloadTimestamps.delete(asset.id);
        return;
      }
      // Final failure: retries exhausted, non-transient, or unknown error.
      clearAutoRetry(asset.id);
      state.set(asset.id, {
        downloading: false,
        progress: 0,
        // DownloadFailure messages are resolved through i18n (English
        // fallback); anything else keeps its original message.
        error: failure ? downloadFailureUserMessage(failure) : (e?.message ?? String(e)),
        errorCode: failure?.code,
        canResume: failure ? failure.canResume : false,
        // Record how far the download got even on failure — the UI and a
        // retry decision need the honest byte count, not a blank.
        bytesWritten: failure?.bytesReceived,
        bytesExpected: asset.sizeBytes,
        autoRetrying: false,
      });
      downloadTimestamps.delete(asset.id);
    })
    .finally(() => {
      releaseWakeLock();
      inFlight.delete(asset.id);
      notify();
    });

  inFlight.set(asset.id, promise);
  return promise;
}
