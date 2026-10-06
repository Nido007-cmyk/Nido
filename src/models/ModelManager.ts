import * as FileSystem from "expo-file-system/legacy";
import { copyBundledAssetToFile } from "bundled-assets";
import { checkStorageForDownload } from "./storageBudget";
import { networkAudit, sanitizeEndpoint } from "../privacy/networkAudit";
import { DownloadFailure, classifyHttpStatus, formatBytes, isSuccessfulDownloadStatus } from "./downloadErrors";
import {
  loadInstallState,
  getInstallRecord,
  recordInstall,
  clearInstallRecord,
} from "./installState";
import {
  assertImmutableSourcePreDownload,
  CatalogModel,
  ImmutableSourceGate,
  MODEL_CATALOG,
  REQUIRED_MODELS,
  STORAGE_BUDGET_BYTES,
} from "./manifest";
import { defaultLlmForDevice } from "./defaultModel";
// The integrity trust decision lives in modelTrust.ts (single choke point
// shared by the install UI, the download pipeline, and the inference load
// path). ModelManager keeps thin wrappers + compat re-exports here.
import {
  VERIFY_CHUNK_BYTES,
  assetPath,
  assertTrustedModelFile,
  checkModelTrust,
  currentMtimeMs,
  ensureInstallReconciled,
  sameSha,
  sha256OfFile,
  stagingPathFor,
  resumeTokenPathFor,
} from "./modelTrust";
export {
  VERIFY_CHUNK_BYTES,
  assetPath,
  stagingPathFor,
  resumeTokenPathFor,
  resetInstallReconcileForTests,
} from "./modelTrust";

export interface AssetStatus {
  asset: CatalogModel;
  present: boolean;
  sizeOnDiskBytes: number;
  checksumOk: boolean | null; // null = not verified yet (expensive on large files)
}

export interface DownloadProgress {
  totalBytesWritten: number;
  totalBytesExpectedToWrite: number;
  /**
   * Which stage the reported bytes belong to. Consumers must NOT render
   * 100% / "complete" while phase is "verifying" — the promise resolving
   * is the completion signal, not the progress callbacks.
   */
  phase?: "downloading" | "verifying";
}

// NIDO: SHA-256 is verified for EVERY asset after download, before the
// file is promoted to its installed path — no size cap. Verification
// streams the file (see verifyChecksum) so this is about UX time, not
// memory. A file is never treated as installed until its bytes are proven
// to be the expected bytes.
//
// VERIFY_CHUNK_BYTES lives in modelTrust.ts (imported + re-exported at the
// top of this file) so the inference load path shares the exact same
// streaming-hash parameters.

export interface VerifyOptions {
  /** Called after each chunk: (bytesHashed, totalBytes). */
  onProgress?: (bytesHashed: number, totalBytes: number) => void;
  /** Cancelling throws DownloadFailure(code "cancelled"); nothing is deleted. */
  signal?: AbortSignal;
  /**
   * File to hash. Defaults to the asset's installed path; set to the
   * staging path to verify a download BEFORE atomic promotion.
   */
  filePath?: string;
}

// How long a download can go with zero progress callbacks before it's
// treated as stalled and cancelled — see downloadCatalogModel's doc comment.
const DOWNLOAD_INACTIVITY_TIMEOUT_MS = 60_000;

// console.log shows up in the Metro/dev-client terminal (not just on-device
// LogBox) — this is the debug trail for diagnosing the "0 bytes despite a
// clean-looking completion" reports without needing device log access.
// Progress is throttled (not one line per native callback, which would be
// thousands of lines for a multi-GB file) but every state TRANSITION
// (start, resume, timeout/pause, completion, verification result) is
// always logged, since those are the rare, high-signal moments.
const DOWNLOAD_PROGRESS_LOG_INTERVAL_MS = 5_000;
function dlog(assetId: string, message: string): void {
  // T5-11-2026-10-06: console.debug en vez de console.log — en release
  // los logs de progreso de descarga no deben ensuciar logcat.
  console.debug(`[ModelManager:download:${assetId}] ${message}`);
}

// Module-level, not per-instance: many screens each construct their own
// ModelManager, and any of them calling statusOf() mid-download must see
// this. Holds ids of downloads that are running OR paused-for-resume —
// their on-disk file is legitimately partial and must not be deleted as
// "truncated". (Deleting it doesn't stop the native writer on Android —
// it keeps writing to the unlinked inode, resolves 200, and the path is
// simply gone at verification time.)
const downloadsOwningFile = new Map<string, CatalogModel>();

// Everything NIDO stores that counts toward the 50GB budget.
const STORAGE_DIRS = ["models/", "corpus/", "SQLite/"];

/** Bytes used by NIDO's offline assets, not counting the partial files of the given paths. */
async function measureUsedBytes(excludePaths: Set<string>): Promise<number> {
  let total = 0;
  for (const dir of STORAGE_DIRS) {
    const dirPath = `${FileSystem.documentDirectory}${dir}`;
    const names = await FileSystem.readDirectoryAsync(dirPath).catch(() => [] as string[]);
    for (const name of names) {
      const path = `${dirPath}${name}`;
      if (excludePaths.has(path)) continue;
      const info = await FileSystem.getInfoAsync(path).catch(() => null);
      if (info?.exists && !info.isDirectory) total += info.size ?? 0;
    }
  }
  return total;
}

// NOTE: assetPath / stagingPathFor / resumeTokenPathFor now live in
// modelTrust.ts (single choke point shared with the inference load path)
// and are imported + re-exported at the top of this file.

/**
 * Local file manager for model weights. Two ways an asset ends up on disk:
 *
 * 1. **Downloaded** (`downloadCatalogModel`): fetches a catalog entry over
 *    the network — used for both the required default models (via the
 *    mandatory first-run ModelSetupScreen) and optional extras (via the
 *    same screen's normal mode). Always an explicit user action; never
 *    automatic, never during chat/inference.
 * 2. **Bundled** (`installBundled`): copies a model baked into the APK's
 *    compiled assets (via the `bundled-assets` native module +
 *    plugins/withBundledModels.js) into the document directory, purely
 *    locally. Not used by default (keeps the installable app small/fast to
 *    build) but available as an alternate build path — see manifest.ts.
 */
export class ModelManager {
  /**
   * @param opts.inactivityTimeoutMs — override for tests; production uses
   *   DOWNLOAD_INACTIVITY_TIMEOUT_MS (60s).
   */
  constructor(
    private catalog: CatalogModel[] = MODEL_CATALOG,
    opts?: { inactivityTimeoutMs?: number }
  ) {
    this.inactivityTimeoutMs = opts?.inactivityTimeoutMs ?? DOWNLOAD_INACTIVITY_TIMEOUT_MS;
  }

  private readonly inactivityTimeoutMs: number;

  /**
   * Runs install reconciliation once per process, before any status or
   * download work. Never throws: reconciliation must not break startup.
   * The implementation lives in modelTrust.ts (shared with the inference
   * load path's trust gate).
   */
  private async ensureReconciled(): Promise<void> {
    await ensureInstallReconciled(this.catalog);
  }

  /**
   * Reconstructs honest install state after a crash. For every journal
   * record left in "downloading"/"verifying": the previous process died
   * mid-install, so the staging file is discarded and the record is marked
   * failed/interrupted — the next attempt restarts from zero and says so.
   * Staging files with no journal record at all are likewise discarded
   * (never trusted). "paused" records keep their staging file: the pause
   * was intentional and a resume token was persisted for genuine resume.
   */
  /**
   * Reconstructs honest install state after a crash, once per process.
   *
   * Rules:
   * - "paused" + staging file + resume token on disk → keep everything:
   *   the pause was intentional and a later attempt can genuinely resume.
   * - "downloading"/"verifying"/"paused"-without-token, or any staging
   *   file with no journal record → the previous process died mid-install:
   *   discard staging, mark the install failed/interrupted. The next
   *   attempt restarts from zero and says so honestly.
   * - The final installed path is never touched here.
   */
  /**
   * Restores a paused download after the in-memory resumable is gone
   * (app killed/restarted): a resume token on disk + the staging file →
   * rebuild the DownloadResumable with the persisted resumeData so the
   * next attempt genuinely continues the byte range. Returns undefined
   * when there is nothing honest to resume (then the caller starts from
   * zero and says so).
   *
   * The token file is the durable signal — reconcile() (which always runs
   * first) keeps it on disk ONLY for a legitimate paused attempt
   * (journal "paused" + staging + token together); any other combination
   * has the token deleted. The journal is deliberately NOT consulted here:
   * the caller journals the new attempt as "downloading" before this runs,
   * which would destroy the very signal we'd be looking for.
   *
   * Safety checks before trusting the token:
   * - the staging file must still exist (reconcile deletes the token when
   *   it doesn't, so this is belt-and-suspenders);
   * - the token must parse and carry non-empty resumeData;
   * - the token's fileUri must be THIS asset's staging path (never resume
   *   one asset's bytes into another asset's file).
   * If the resumed transfer later fails integrity, the SHA-256 check
   * fails closed anyway — garbage in can never be promoted.
   */
  private async restorePausedResumable(
    asset: CatalogModel,
    sourceUrl: string,
    onDownloadProgress: (data: { totalBytesWritten: number; totalBytesExpectedToWrite: number }) => void
  ): Promise<FileSystem.DownloadResumable | undefined> {
    const staging = stagingPathFor(asset);
    const stagingInfo = await FileSystem.getInfoAsync(staging).catch(() => null);
    if (!stagingInfo?.exists || stagingInfo.isDirectory) {
      dlog(asset.id, "no staging file — cannot resume, starting from zero");
      return undefined;
    }
    const raw = await FileSystem.readAsStringAsync(resumeTokenPathFor(asset), {
      encoding: FileSystem.EncodingType.UTF8,
    }).catch(() => null);
    if (!raw) {
      dlog(asset.id, "no resume token on disk — starting from zero");
      return undefined;
    }
    try {
      const parsed = JSON.parse(raw) as {
        url?: unknown;
        fileUri?: unknown;
        options?: unknown;
        resumeData?: unknown;
      };
      if (typeof parsed.resumeData !== "string" || parsed.resumeData.length === 0) {
        dlog(asset.id, "resume token has no resumeData — starting from zero");
        return undefined;
      }
      if (typeof parsed.fileUri === "string" && parsed.fileUri !== staging) {
        dlog(asset.id, `resume token fileUri mismatch (${parsed.fileUri}) — refusing to resume`);
        return undefined;
      }
      dlog(
        asset.id,
        `restoring paused resumable from token (staging has ${stagingInfo.size ?? 0} bytes)`
      );
      return FileSystem.createDownloadResumable(
        typeof parsed.url === "string" && parsed.url.length > 0 ? parsed.url : sourceUrl,
        staging,
        (parsed.options as object) ?? {},
        onDownloadProgress,
        parsed.resumeData
      );
    } catch (e: any) {
      dlog(asset.id, `corrupt resume token (${e?.message ?? String(e)}) — starting from zero`);
      return undefined;
    }
  }

  /**
   * Paused-but-resumable downloads, keyed by asset id. expo-file-system's
   * own docs: "When the app has been moved to the background, this
   * [progress] callback won't be fired until it's moved to the foreground"
   * — so backgrounding looks identical to a truly stalled connection from
   * downloadCatalogModel's inactivity timer's point of view, and the timer
   * correctly fires. The fix isn't to stop detecting that (a genuinely dead
   * connection should still surface an error) — it's to make what happens
   * next cheap: pause (keep the partial bytes + resume token) instead of
   * cancel-and-delete, so a retry continues from here instead of
   * restarting a multi-GB download from 0%.
   */
  private pausedDownloads = new Map<string, FileSystem.DownloadResumable>();

  /**
   * A file that exists but doesn't match the catalog's expected size is
   * treated as NOT present (and cleaned up) rather than a false "present" —
   * this is what an interrupted/truncated download looks like (e.g. the
   * app backgrounded or network dropped mid-transfer), and llama.cpp fails
   * to load such a file with a generic, unhelpful error. Catching this here
   * means the UI correctly offers "Download"/"Retry" instead of showing a
   * green "Downloaded" badge for a file that will fail the moment it's used.
   */
  /**
   * Whether an asset is honestly installed. "Installed" means: the file is
   * at its final path AND it passes the integrity trust gate
   * (modelTrust.checkModelTrust): size matches the catalog, the catalog
   * declares a SHA-256, and either the journal records a verified install
   * of exactly these bytes with an unchanged mtime, or the bytes verify
   * right now. Anything else — missing file, size mismatch, no/invalid
   * journal, rewritten file, checksum mismatch — is NOT present.
   *
   * Never throws for untrusted files: it returns present=false and deletes
   * files that are proven corrupt/partial so they can't be mistaken for a
   * valid install later. The inference path uses assertTrustedForLoad(),
   * which throws instead.
   */
  async statusOf(asset: CatalogModel): Promise<AssetStatus> {
    await this.ensureReconciled();
    const verdict = await checkModelTrust(asset);
    if (verdict.trusted) {
      return { asset, present: true, sizeOnDiskBytes: verdict.sizeOnDiskBytes, checksumOk: true };
    }
    if (verdict.deleteFile) {
      dlog(asset.id, `statusOf(): deleting untrusted file (${verdict.reason})`);
      await FileSystem.deleteAsync(assetPath(asset), { idempotent: true }).catch(() => {});
      await clearInstallRecord(asset.id);
      return { asset, present: false, sizeOnDiskBytes: 0, checksumOk: false };
    }
    return { asset, present: false, sizeOnDiskBytes: 0, checksumOk: null };
  }

  /**
   * Inference-path gate: resolves only when the asset's file is proven to
   * be the verified bytes (see modelTrust). Throws ModelNotTrustedError
   * otherwise — a file merely existing at the expected path is NEVER
   * enough to reach inference.
   */
  async assertTrustedForLoad(asset: CatalogModel): Promise<void> {
    await assertTrustedModelFile(asset);
  }

  async statusAll(): Promise<AssetStatus[]> {
    return Promise.all(this.catalog.map((a) => this.statusOf(a)));
  }

  /**
   * Verifies a file's SHA-256 against the asset's expected hash. Streams
   * the file's RAW BYTES in ~1 MiB chunks (position/length reads) with
   * O(chunk) peak memory — never the whole file in the JS heap. Reports
   * progress per chunk and honors an AbortSignal (throws DownloadFailure
   * "cancelled"; the file is left untouched).
   *
   * Fail-closed: an asset WITHOUT an expected SHA-256 THROWS instead of
   * returning true. "No hash declared" must never read as "verified" —
   * that was the weaker second path (since removed). Callers that want a
   * non-throwing verdict use checkModelTrust() instead.
   *
   * T-005: the file must be hashed as bytes, not as the base64 string
   * itself — hashing the base64 text produces a different digest for every
   * file, so verification used to fail deterministically.
   */
  async verifyChecksum(
    asset: Pick<CatalogModel, "filename" | "sha256"> & { id?: string },
    opts?: VerifyOptions
  ): Promise<boolean> {
    if (!asset.sha256) {
      throw new Error(
        `verifyChecksum(${asset.id ?? asset.filename}): asset declares no expected SHA-256 — refusing to "verify" without integrity metadata`
      );
    }
    const path = opts?.filePath ?? assetPath(asset);
    const digest = await sha256OfFile(path, {
      signal: opts?.signal,
      onProgress: opts?.onProgress,
      assetId: asset.id,
      filename: asset.filename,
    }).catch((e) => {
      // A missing/empty/unreadable file can never match a declared checksum.
      if (e instanceof DownloadFailure) throw e;
      return null;
    });
    if (digest === null) return false;
    return sameSha(digest, asset.sha256);
  }

  /**
   * Installs a bundled model from the APK's compiled assets into the
   * document directory, if not already trusted. No network access.
   * Idempotent — safe to call on every launch.
   *
   * Integrity: the copied bytes get the SAME SHA-256 guarantee as a
   * download. Size is checked first (a short copy is deleted, never
   * trusted); then the destination file is hash-verified BEFORE the
   * install is journaled. A corrupt bundled artifact is deleted and the
   * install fails closed — it is never marked installed, never preserved.
   * There is no weaker second integrity path for bundled assets.
   */
  async installBundled(asset: CatalogModel): Promise<void> {
    const status = await this.statusOf(asset);
    if (status.present && status.sizeOnDiskBytes === asset.sizeBytes) return;

    if (!asset.sha256) {
      throw new Error(
        `Bundled asset ${asset.id} declares no expected SHA-256 — refusing to install without integrity metadata`
      );
    }
    const assetSubPath = `models/${asset.filename.split("/").pop()}`;
    const destPath = assetPath(asset);
    const writtenBytes = await copyBundledAssetToFile(assetSubPath, destPath);

    if (writtenBytes !== asset.sizeBytes) {
      await FileSystem.deleteAsync(destPath, { idempotent: true }).catch(() => {});
      await recordInstall(asset.id, {
        status: "failed",
        sizeBytes: asset.sizeBytes,
        sha256: asset.sha256,
        failureCode: "bundled-size-mismatch",
        failureKind: "permanent",
        bytesWritten: writtenBytes,
      });
      throw new Error(
        `Bundled asset ${asset.id} size mismatch after copy: expected ${asset.sizeBytes}, got ${writtenBytes} (partial copy deleted, never trusted)`
      );
    }
    await recordInstall(asset.id, {
      status: "verifying",
      sizeBytes: asset.sizeBytes,
      sha256: asset.sha256,
      bytesWritten: writtenBytes,
    });
    const digest = await sha256OfFile(destPath, { assetId: asset.id }).catch(() => null);
    if (!sameSha(digest, asset.sha256)) {
      await FileSystem.deleteAsync(destPath, { idempotent: true }).catch(() => {});
      await recordInstall(asset.id, {
        status: "failed",
        sizeBytes: asset.sizeBytes,
        sha256: asset.sha256,
        failureCode: "bundled-checksum-mismatch",
        failureKind: "permanent",
        bytesWritten: writtenBytes,
      });
      throw new Error(
        `Bundled asset ${asset.id} failed SHA-256 verification after copy (corrupt artifact deleted, never marked installed)`
      );
    }
    dlog(asset.id, "sha256 verified on bundled copy");
    await recordInstall(asset.id, {
      status: "installed",
      sizeBytes: asset.sizeBytes,
      sha256: asset.sha256,
      mtimeMs: (await currentMtimeMs(destPath)) ?? undefined,
    });
  }

  async installAllBundled(): Promise<void> {
    const bundled = this.catalog.filter((m) => m.bundled);
    for (const asset of bundled) {
      await this.installBundled(asset);
    }
  }

  /**
   * Escape hatch for a download that's stuck with no error at all — no
   * progress, no failure, `pausedDownloads` possibly holding a resumable
   * whose underlying transfer nothing is actually driving forward anymore
   * (e.g. a stale reference left over from a dev Fast Refresh mid-download,
   * or a native task that silently stopped calling back). Unlike the
   * timeout/backgrounding path, this doesn't wait for anything to detect
   * the stall — it's user-triggered.
   *
   * Split into two steps (signal, then delete) rather than one, because
   * `pauseAsync()` resolving only means cancellation was *requested* — the
   * native write loop notices `isPausing` and stops on its next iteration,
   * which is asynchronous and not awaited by pause() itself. Deleting the
   * file and starting a new download immediately after signalling cancel
   * (as an earlier version of this method did) raced the old, now-orphaned
   * writer: if its stream happened to close *after* the new download
   * finished, it silently truncated the file right back down — the new
   * download would verify as `0 bytes` despite having fully completed.
   * Callers MUST await the corresponding downloadCatalogModel() promise's
   * settlement between calling signalCancelDownload and
   * deletePartialDownload (see downloadManager.restartDownload) so the old
   * writer is actually gone before the file is touched again.
   */
  async signalCancelDownload(asset: CatalogModel): Promise<void> {
    const active = this.pausedDownloads.get(asset.id);
    dlog(asset.id, `signalCancelDownload() called, had a tracked resumable: ${!!active}`);
    if (active) {
      await active.pauseAsync().catch(() => {});
      this.pausedDownloads.delete(asset.id);
    }
  }

  /**
   * Deletes the staging file (and any resume token) for an asset. Never
   * touches the final installed path — a failed download must not destroy
   * a previously valid install.
   */
  async deletePartialDownload(asset: CatalogModel): Promise<void> {
    dlog(asset.id, "deletePartialDownload() called");
    downloadsOwningFile.delete(asset.id);
    await FileSystem.deleteAsync(stagingPathFor(asset), { idempotent: true }).catch(() => {});
    await FileSystem.deleteAsync(resumeTokenPathFor(asset), { idempotent: true }).catch(() => {});
  }

  /**
   * Downloads an optional (non-bundled) catalog model. Network access
   * happens ONLY here, and only when explicitly invoked (a user tap in
   * ModelSetupScreen) — never automatically and never during chat/inference.
   * Verifies the downloaded size matches the catalog entry; deletes and
   * throws on mismatch rather than leaving a truncated/corrupt file.
   */
  /**
   * Downloads a catalog model with the full reliability pipeline:
   *
   *   pre-flight storage check (fail BEFORE any network I/O)
   *     → transfer to STAGING path (never the final path)
   *     → size check on staging
   *     → SHA-256 verification of staging (ALL assets, streaming)
   *     → atomic promote (rename) staging → final path
   *     → journal "installed"
   *
   * Every transition is journaled, so a crash at any point is
   * reconstructible on the next launch (see reconcileInstallState): the
   * final path is only ever written by the atomic rename, which means a
   * crash can never leave NIDO believing a partial/unverified file is an
   * installed model.
   *
   * Failure honesty:
   * - "stalled" (inactivity timeout): the transfer is PAUSED, the partial
   *   staging file is kept, and retry genuinely resumes where it stopped
   *   (canResume=true) — within this process lifetime.
   * - "interrupted" (transfer threw): the staging file is deleted and
   *   retry restarts from zero (canResume=false) — the message says so.
   * - "insufficientStorage": local resource failure, never labeled a
   *   network error; previously valid installs are untouched.
   * - Size/SHA-256 mismatch: staging is deleted, never promoted.
   *
   * Network access happens ONLY here, and only when explicitly invoked —
   * never automatically and never during chat/inference.
   */
  async downloadCatalogModel(
    asset: CatalogModel,
    onProgress?: (p: DownloadProgress) => void
  ): Promise<void> {
    // Reconstruct honest state after a crash BEFORE touching anything.
    await this.ensureReconciled();

    // Meta #1 (blast radius / rollback): snapshot the pre-download journal.
    // A failed (re-)download must never clobber a previously valid install:
    // the final file is only ever replaced by the atomic promote AFTER
    // verification, so on any failure path the previous bytes are provably
    // untouched — the failure recorder below restores the "installed"
    // record instead of writing "failed".
    const previousRecord = await getInstallRecord(asset.id);
    const previousInstall =
      previousRecord?.status === "installed" &&
      previousRecord.sizeBytes === asset.sizeBytes &&
      sameSha(previousRecord.sha256 ?? "", asset.sha256 ?? "")
        ? previousRecord
        : null;

    /**
     * Records a download failure — with rollback. If this download was a
     * re-attempt over a previously verified install, the final file was
     * never touched (only staging), so the honest journal state is still
     * "installed": restore it instead of writing "failed". Without this, a
     * single failed re-download would make the app forget a perfectly good
     * multi-GB install and force a full re-hash on the next trust check.
     */
    const recordFailedWithRollback = async (failure: DownloadFailure) => {
      if (previousInstall) {
        dlog(
          asset.id,
          `download failed (${failure.code}) but a previous verified install exists — ` +
            `restoring journal (rollback), final file untouched`
        );
        await recordInstall(asset.id, {
          status: "installed",
          sizeBytes: previousInstall.sizeBytes,
          sha256: previousInstall.sha256,
          mtimeMs: previousInstall.mtimeMs,
          bytesWritten: previousInstall.bytesWritten,
        });
        return;
      }
      await recordInstall(asset.id, {
        status: "failed",
        sizeBytes: asset.sizeBytes,
        sha256: asset.sha256,
        failureCode: failure.code,
        failureKind: failure.kind,
        bytesWritten: failure.bytesReceived,
      });
    };

    // R1 (2026-09-28): the immutable-source gate is contract-aware — see
    // sourceContractOf()/assertImmutableSourcePreDownload() in manifest.ts.
    // A Hugging Face / raw.githubusercontent branch-pointer URL without a
    // pinned revision must never silently reach the downloader (C/F2, kept);
    // a GitHub release asset is a published artifact — immutable by host
    // contract — so it needs no revision (R1); any other URL fails closed.
    // This runs BEFORE any journal record or network I/O, and it is the
    // SAME validation every catalog entry must pass — SetupWizard reaches
    // downloads only through this method.
    let source: ImmutableSourceGate;
    try {
      source = assertImmutableSourcePreDownload(asset);
    } catch (e) {
      const failure =
        e instanceof DownloadFailure
          ? e
          : new DownloadFailure({
              code: "unknownSourceContract",
              kind: "permanent",
              canResume: false,
              assetId: asset.id,
              bytesReceived: 0,
              bytesExpected: asset.sizeBytes,
              detail: `source gate threw non-DownloadFailure: ${String(e)}`,
            });
      await recordFailedWithRollback(failure);
      networkAudit.log({
        kind: "download_failed",
        endpoint: sanitizeEndpoint(asset.sourceUrl),
        assetId: asset.id,
        bytesExpected: asset.sizeBytes,
        bytesReceived: 0,
        error: failure.detail ?? failure.code,
      });
      throw failure;
    }

    const destPath = assetPath(asset);
    const stagingPath = stagingPathFor(asset);
    const destDir = destPath.substring(0, destPath.lastIndexOf("/"));
    await FileSystem.makeDirectoryAsync(destDir, { intermediates: true }).catch(() => {});

    // Record the attempt BEFORE network I/O: a crash from here on is
    // reconstructible from the journal, never a mystery file.
    await recordInstall(asset.id, {
      status: "downloading",
      sizeBytes: asset.sizeBytes,
      sha256: asset.sha256,
    });

    // Refuse before any network request if it wouldn't fit. Bytes already
    // staged for THIS asset are reusable (a resume continues them); other
    // in-flight downloads reserve their full remaining size.
    const others = [...downloadsOwningFile.values()].filter((m) => m.id !== asset.id);
    const staged = await FileSystem.getInfoAsync(stagingPath).catch(() => null);
    const stagedBytes = staged?.exists && !staged.isDirectory ? staged.size ?? 0 : 0;
    const freeDiskBytes = await FileSystem.getFreeDiskStorageAsync().catch(() => null);
    const storage = checkStorageForDownload({
      usedBytes: await measureUsedBytes(new Set([destPath, stagingPath, ...others.map(assetPath)])),
      reservedBytes: others.reduce((sum, m) => sum + m.sizeBytes, 0),
      downloadBytes: asset.sizeBytes,
      alreadyDownloadedBytes: stagedBytes,
      freeDiskBytes,
      budgetBytes: STORAGE_BUDGET_BYTES,
    });
    dlog(asset.id, `storage check: ${storage.ok ? "ok" : storage.reason}, projected ${storage.projectedBytes} of ${STORAGE_BUDGET_BYTES} bytes`);
    if (!storage.ok) {
      const failure = new DownloadFailure({
        code: "insufficientStorage",
        kind: "resource",
        canResume: false,
        assetId: asset.id,
        bytesReceived: stagedBytes,
        bytesExpected: asset.sizeBytes,
        extraVars: {
          needed: formatBytes(Math.max(asset.sizeBytes - stagedBytes, 0)),
          free: freeDiskBytes === null ? "unknown" : formatBytes(freeDiskBytes),
        },
        detail: `pre-flight storage check failed (${storage.reason}): ${storage.message}`,
      });
      await recordFailedWithRollback(failure);
      networkAudit.log({
        kind: "download_failed",
        endpoint: sanitizeEndpoint(source.fetchUrl),
        assetId: asset.id,
        bytesExpected: asset.sizeBytes,
        bytesReceived: stagedBytes,
        error: failure.detail ?? failure.code,
      });
      throw failure;
    }

    downloadsOwningFile.set(asset.id, asset);

    const freeBytesAtStart = await FileSystem.getFreeDiskStorageAsync().catch(() => -1);
    // NIDO privacy: the gate-validated fetch URL (revision-pinned for
    // branch-pointer contracts, the published release asset URL otherwise)
    // is what actually gets fetched, and every network request is recorded
    // in the audit log.
    const sourceUrl = source.fetchUrl;
    dlog(
      asset.id,
      `start — expected ${asset.sizeBytes} bytes, stagingPath=${stagingPath}, ` +
        `alreadyHasPausedResumable=${this.pausedDownloads.has(asset.id)}, sourceUrl=${sourceUrl}, ` +
        `freeDiskStorage=${freeBytesAtStart}`
    );

    // Inactivity timeout, not a flat deadline: a large model on a slow-but-
    // working connection can legitimately take many minutes, but zero
    // progress callbacks for this long means something stopped it —
    // either a genuinely dead connection, OR the app was backgrounded
    // (expo-file-system: progress callbacks "won't be fired until moved to
    // foreground"). Both look identical from here, so both are handled the
    // same way: pause (keep the staging bytes + resume token), not
    // cancel-and-delete. A subsequent call for the same asset — the Retry
    // button, or the auto-resume-on-foreground in SetupWizardScreen —
    // reuses the paused resumable and continues from where it left off
    // instead of restarting a multi-GB download from 0%.
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let downloadResumable: FileSystem.DownloadResumable;
    let lastProgressLogAt = 0;
    let progressCallbackCount = 0;
    // Honest byte accounting for failure paths: the last progress callback's
    // count is the ground truth for "how far did we get", and every
    // DownloadFailure below reports it (instead of the old hardcoded 0).
    let lastBytesWritten = stagedBytes;
    const resetInactivityTimer = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        timedOut = true;
        dlog(asset.id, `INACTIVITY TIMEOUT after ${this.inactivityTimeoutMs}ms with no progress callback — pausing`);
        downloadResumable.pauseAsync().catch(() => {});
      }, this.inactivityTimeoutMs);
    };

    const transferProgressCb = (data: {
      totalBytesWritten: number;
      totalBytesExpectedToWrite: number;
    }) => {
      resetInactivityTimer();
      progressCallbackCount++;
      lastBytesWritten = data.totalBytesWritten;
      const now = Date.now();
      if (now - lastProgressLogAt >= DOWNLOAD_PROGRESS_LOG_INTERVAL_MS) {
        lastProgressLogAt = now;
        const pct = data.totalBytesExpectedToWrite > 0
          ? ((data.totalBytesWritten / data.totalBytesExpectedToWrite) * 100).toFixed(1)
          : "?";
        dlog(asset.id, `progress: ${data.totalBytesWritten}/${data.totalBytesExpectedToWrite} bytes (${pct}%), callback #${progressCallbackCount}`);
      }
      onProgress?.({
        totalBytesWritten: data.totalBytesWritten,
        totalBytesExpectedToWrite: data.totalBytesExpectedToWrite,
        phase: "downloading",
      });
    };
    const resuming =
      this.pausedDownloads.get(asset.id) ??
      (await this.restorePausedResumable(asset, sourceUrl, transferProgressCb));
    dlog(
      asset.id,
      resuming
        ? "resuming from a previously paused DownloadResumable (genuine byte-range resume)"
        : "starting a fresh downloadAsync() from zero"
    );
    const endpoint = sanitizeEndpoint(sourceUrl);
    const auditFail = (error: string, bytesReceived: number) =>
      networkAudit.log({
        kind: "download_failed",
        endpoint,
        assetId: asset.id,
        bytesExpected: asset.sizeBytes,
        bytesReceived,
        error,
      });
    // Meta #1: every failure in the download body rolls back to the previous
    // verified install when one exists (see recordFailedWithRollback).
    const recordFailed = (failure: DownloadFailure) => recordFailedWithRollback(failure);
    networkAudit.log({
      kind: "download_start",
      endpoint,
      assetId: asset.id,
      bytesExpected: asset.sizeBytes,
      bytesReceived: stagedBytes,
    });
    // Persist the resumable's resume data so a LATER attempt — including one
    // after the app was killed — can genuinely resume instead of restarting
    // from zero. Best-effort: if it fails, the retry restarts from zero and
    // says so (the journal stays "paused" only while the token is on disk;
    // reconcile() discards paused-without-token as a dead attempt).
    const persistResumeToken = async (resumable: FileSystem.DownloadResumable) => {
      try {
        const savable = resumable.savable();
        if (savable && typeof savable.resumeData === "string" && savable.resumeData.length > 0) {
          await FileSystem.writeAsStringAsync(
            resumeTokenPathFor(asset),
            JSON.stringify(savable),
            { encoding: FileSystem.EncodingType.UTF8 }
          );
          dlog(asset.id, "resume token persisted — a later attempt can genuinely resume");
        } else {
          dlog(asset.id, "savable() returned no resume data — a retry will restart from zero");
        }
      } catch (e: any) {
        dlog(
          asset.id,
          `could not persist resume token (${e?.message ?? String(e)}) — a retry will restart from zero`
        );
      }
    };
    downloadResumable =
      resuming ?? FileSystem.createDownloadResumable(sourceUrl, stagingPath, {}, transferProgressCb);
    this.pausedDownloads.set(asset.id, downloadResumable);
    resetInactivityTimer();

    let result: FileSystem.FileSystemDownloadResult | undefined;
    try {
      result = await (resuming ? downloadResumable.resumeAsync() : downloadResumable.downloadAsync());
      dlog(
        asset.id,
        `${resuming ? "resumeAsync" : "downloadAsync"}() resolved — ` +
          `result=${result ? `{uri: ${result.uri}, status: ${result.status}}` : "undefined"}, ` +
          `total progress callbacks received: ${progressCallbackCount}`
      );
    } catch (e: any) {
      clearTimeout(timer);
      const rawMessage = e?.message ?? String(e);
      dlog(asset.id, `${resuming ? "resumeAsync" : "downloadAsync"}() THREW: ${rawMessage} (timedOut=${timedOut})`);
      if (timedOut) {
        // Paused, not deleted — stays in pausedDownloads for the next call
        // to pick up, so canResume=true and the user message honestly says
        // the retry resumes where it stopped.
        const failure = new DownloadFailure({
          code: "stalled",
          kind: "transient",
          canResume: true,
          assetId: asset.id,
          bytesReceived: lastBytesWritten,
          bytesExpected: asset.sizeBytes,
          extraVars: { seconds: this.inactivityTimeoutMs / 1000 },
          detail: `stalled (no progress for ${this.inactivityTimeoutMs / 1000}s) at ${lastBytesWritten}/${asset.sizeBytes} bytes`,
        });
        await recordInstall(asset.id, {
          status: "paused",
          sizeBytes: asset.sizeBytes,
          sha256: asset.sha256,
          bytesWritten: lastBytesWritten,
        });
          await persistResumeToken(downloadResumable);
        auditFail(failure.detail ?? failure.code, lastBytesWritten);
        throw failure;
      }
      if (/enospc|no space left|insufficient storage|disk full/i.test(rawMessage)) {
        // The phone ran out of space mid-transfer. This is a LOCAL
        // RESOURCE failure, not a network problem — classify it honestly.
        // Previously valid installs are untouched (we only ever wrote to
        // staging); the unusable staging file is discarded.
        this.pausedDownloads.delete(asset.id);
        downloadsOwningFile.delete(asset.id);
        await FileSystem.deleteAsync(stagingPath, { idempotent: true }).catch(() => {});
        const failure = new DownloadFailure({
          code: "insufficientStorage",
          kind: "resource",
          canResume: false,
          assetId: asset.id,
          bytesReceived: lastBytesWritten,
          bytesExpected: asset.sizeBytes,
          extraVars: {
            needed: formatBytes(Math.max(asset.sizeBytes - lastBytesWritten, 0)),
            free: "unknown",
          },
          detail: `disk filled mid-download: ${rawMessage}`,
        });
        await recordFailed(failure);
        auditFail(failure.detail ?? failure.code, lastBytesWritten);
        throw failure;
      }
      this.pausedDownloads.delete(asset.id);
      downloadsOwningFile.delete(asset.id);
      await FileSystem.deleteAsync(stagingPath, { idempotent: true }).catch(() => {});
      // The staging file is deleted above, so a retry restarts from zero —
      // canResume=false, and the user message says exactly that. Never
      // claim "resume" here.
      const failure = new DownloadFailure({
        code: "interrupted",
        kind: "transient",
        canResume: false,
        assetId: asset.id,
        bytesReceived: lastBytesWritten,
        bytesExpected: asset.sizeBytes,
        detail: rawMessage,
      });
      await recordFailed(failure);
      auditFail(failure.detail ?? failure.code, lastBytesWritten);
      throw failure;
    } finally {
      clearTimeout(timer);
    }

    if (!result) {
      // resolves to undefined on pause too, not just cancel — same
      // stalled/paused case as the throw path above, just via the resolve
      // side of the promise instead of a rejection. The resumable is kept,
      // so the next attempt genuinely resumes.
      dlog(asset.id, "result was undefined (pause/cancel) — leaving paused for next attempt to resume");
      const failure = new DownloadFailure({
        code: "stalled",
        kind: "transient",
        canResume: true,
        assetId: asset.id,
        bytesReceived: lastBytesWritten,
        bytesExpected: asset.sizeBytes,
        extraVars: { seconds: this.inactivityTimeoutMs / 1000 },
        detail: `paused/cancelled with no result at ${lastBytesWritten}/${asset.sizeBytes} bytes`,
      });
      await recordInstall(asset.id, {
        status: "paused",
        sizeBytes: asset.sizeBytes,
        sha256: asset.sha256,
        bytesWritten: lastBytesWritten,
      });
        await persistResumeToken(downloadResumable);
      auditFail(failure.detail ?? failure.code, lastBytesWritten);
      throw failure;
    }

    this.pausedDownloads.delete(asset.id);
    downloadsOwningFile.delete(asset.id);

    // C/F1: HTTP 206 (Partial Content) is a SUCCESS, not a failure — it is
    // what a server returns when it honors a byte-range resume (RFC 9110
    // §15.3.7), and expo-file-system passes the raw status through. The old
    // `!== 200` check misclassified an honest resume as a permanent error
    // and deleted the valid staging file. Trust is NOT placed in the status:
    // promotion is still gated on the exact size check and the mandatory
    // SHA-256 verification below, so a lying 206 can never be installed.
    // A non-200/206 that resolved (rather than throwing) means the
    // "download" wrote an error page, not the model — classify honestly
    // instead of letting it fall through to the size check mislabeled.
    if (!isSuccessfulDownloadStatus(result.status)) {
      const { code, kind } = classifyHttpStatus(result.status);
      await FileSystem.deleteAsync(stagingPath, { idempotent: true });
      const failure = new DownloadFailure({
        code,
        kind,
        canResume: false, // error page deleted; nothing resumable kept
        assetId: asset.id,
        bytesReceived: lastBytesWritten,
        bytesExpected: asset.sizeBytes,
        httpStatus: result.status,
        detail: `HTTP ${result.status} for ${asset.id} at ${lastBytesWritten}/${asset.sizeBytes} bytes`,
      });
      await recordFailed(failure);
      auditFail(failure.detail ?? failure.code, lastBytesWritten);
      throw failure;
    }

    const info = await FileSystem.getInfoAsync(stagingPath);
    const freeBytesAtEnd = await FileSystem.getFreeDiskStorageAsync().catch(() => -1);
    dlog(
      asset.id,
      `post-download verification: info.exists=${info.exists}, info.size=${info.exists ? info.size : "n/a"}, ` +
        `expected=${asset.sizeBytes}, freeDiskStorage=${freeBytesAtEnd} (was ${freeBytesAtStart} at start)`
    );
    if (!info.exists || info.isDirectory || info.size !== asset.sizeBytes) {
      const actualSize = info.exists && !info.isDirectory ? info.size ?? 0 : 0;
      // A multi-hundred-MB+ GGUF landing at a few KB almost always means the
      // "download" actually succeeded at the HTTP level but the body wasn't
      // the model — e.g. a rate-limit/error page served with a 200 status,
      // which a plain byte-count check alone can't distinguish from a truly
      // corrupt transfer. Surfacing the actual size (and a text snippet when
      // it's small enough to plausibly be one of those pages) turns "size
      // mismatch" from a dead end into an actionable signal instead of
      // silently deleting the only evidence of what really happened.
      let snippet = "";
      if (actualSize > 0 && actualSize < 65536) {
        try {
          const text = await FileSystem.readAsStringAsync(stagingPath, {
            encoding: FileSystem.EncodingType.UTF8,
          });
          snippet = ` Response body: ${text.slice(0, 300)}`;
        } catch {
          // Not decodable as UTF8 (genuinely partial binary) — no snippet, still report sizes.
        }
      }
      await FileSystem.deleteAsync(stagingPath, { idempotent: true });
      const failure = new DownloadFailure({
        code: "sizeMismatch",
        kind: "permanent",
        canResume: false, // truncated file deleted; retry starts from zero
        assetId: asset.id,
        bytesReceived: actualSize,
        bytesExpected: asset.sizeBytes,
        detail: `size mismatch — got ${actualSize} bytes, expected ${asset.sizeBytes}.${snippet}`,
      });
      await recordFailed(failure);
      auditFail(failure.detail ?? failure.code, actualSize);
      throw failure;
    }

    // Integrity enforcement for EVERY asset, no size cap: the staging file
    // is hash-verified (streaming, bounded memory) BEFORE it is allowed
    // near the final path. A mismatch deletes staging and fails closed —
    // the corrupt bytes are never promoted, never trusted, never used.
    await recordInstall(asset.id, {
      status: "verifying",
      sizeBytes: asset.sizeBytes,
      sha256: asset.sha256,
      bytesWritten: asset.sizeBytes,
    });
    const checksumOk = await this.verifyChecksum(asset, {
      filePath: stagingPath,
      onProgress: (hashed, total) =>
        onProgress?.({
          totalBytesWritten: hashed,
          totalBytesExpectedToWrite: total,
          phase: "verifying",
        }),
    }).catch(() => false);
    if (!checksumOk) {
      await FileSystem.deleteAsync(stagingPath, { idempotent: true });
      const failure = new DownloadFailure({
        code: "checksumMismatch",
        kind: "permanent",
        canResume: false, // corrupt file deleted; retry starts from zero
        assetId: asset.id,
        bytesReceived: asset.sizeBytes,
        bytesExpected: asset.sizeBytes,
        detail: "sha256 mismatch on staging file — deleted, never promoted",
      });
      await recordFailed(failure);
      auditFail(failure.detail ?? failure.code, asset.sizeBytes);
      throw failure;
    }
    dlog(asset.id, "sha256 verified on staging file");

    // Atomic promotion: rename within the same directory. Either the old
    // final file or the new verified one is at destPath afterwards — never
    // a half-written mix. Only AFTER the rename succeeds is the install
    // recorded as complete.
    await FileSystem.moveAsync({ from: stagingPath, to: destPath });
    await FileSystem.deleteAsync(resumeTokenPathFor(asset), { idempotent: true }).catch(() => {});
    await recordInstall(asset.id, {
      status: "installed",
      sizeBytes: asset.sizeBytes,
      sha256: asset.sha256,
      bytesWritten: asset.sizeBytes,
      // mtime binding for the load-time trust gate: the bytes at destPath
      // were just hash-verified, so the current mtime is the "verified"
      // baseline. Any later rewrite changes mtime and forces re-verify.
      mtimeMs: (await currentMtimeMs(destPath)) ?? undefined,
    });
    networkAudit.log({
      kind: "download_complete",
      endpoint,
      assetId: asset.id,
      bytesExpected: asset.sizeBytes,
      bytesReceived: asset.sizeBytes,
    });
  }
  async deleteModel(asset: CatalogModel): Promise<void> {
    await FileSystem.deleteAsync(assetPath(asset), { idempotent: true });
    await FileSystem.deleteAsync(stagingPathFor(asset), { idempotent: true }).catch(() => {});
    await FileSystem.deleteAsync(resumeTokenPathFor(asset), { idempotent: true }).catch(() => {});
    await clearInstallRecord(asset.id);
  }

  async currentStorageUsageBytes(): Promise<number> {
    const statuses = await this.statusAll();
    return statuses.reduce((sum, s) => sum + s.sizeOnDiskBytes, 0);
  }


  missingAssets(statuses: AssetStatus[]): CatalogModel[] {
    return statuses.filter((s) => !s.present).map((s) => s.asset);
  }

  /**
   * Whether the default (required) LLM + embedding models are already on
   * disk. Gates first-run navigation: if false, the app shows the mandatory
   * setup screen instead of the chat UI. This is the only place the app's
   * flow depends on network having been used at some point — once true, no
   * further network access is needed.
   *
   * The "default LLM" is RAM-aware (src/models/defaultModel.ts): on low-RAM
   * devices the setup downloads the light model instead of the 1.5B, so the
   * presence check must look for the same model the setup would install —
   * not blindly for the catalog's `required` LLM.
   */
  async requiredModelsPresent(): Promise<boolean> {
    const defaultLlm = defaultLlmForDevice();
    const needed = [
      defaultLlm,
      ...REQUIRED_MODELS.filter((m) => m.kind !== "llm"),
    ];
    const statuses = await Promise.all(needed.map((a) => this.statusOf(a)));
    return statuses.every((s) => s.present && s.sizeOnDiskBytes === s.asset.sizeBytes);
  }
}
