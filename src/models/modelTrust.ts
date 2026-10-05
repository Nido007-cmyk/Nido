/**
 * modelTrust.ts — the single trust decision for model weight files.
 *
 * INTEGRITY TRUST MODEL (NIDO)
 *
 * A model file becomes trusted for inference if and only if ALL of these hold:
 *
 *   1. The file exists at the catalog's final installed path.
 *   2. Its size matches the catalog's expected `sizeBytes` exactly.
 *   3. The catalog declares a non-empty SHA-256 for the asset (an asset
 *      without integrity metadata can NEVER become trusted — fail closed).
 *   4. Either:
 *      a. the install journal records a completed, verified install of
 *         exactly these bytes (size + SHA-256) AND the file has not been
 *         rewritten since that verification (mtime binding — the cached
 *         fast path, no re-hash), OR
 *      b. the file's bytes are hash-verified RIGHT NOW (streaming SHA-256,
 *         ~1 MiB chunks, O(chunk) memory) and the verification is recorded
 *         in the journal (the slow path — taken on first sight of a file,
 *         after a crash/reinstall, when the journal is missing or corrupt,
 *         or when the file was rewritten).
 *
 * What this defeats:
 *   - truncated/interrupted files (size check; deleted, never trusted);
 *   - same-size tampering / manual replacement (any rewrite changes mtime,
 *     which drops the fast path and forces a byte re-verification);
 *   - journal loss or corruption (a missing/corrupt journal can only ever
 *     degrade to "re-verify", never to a false "trusted");
 *   - catalog SHA changes (a new expected hash no longer matches the old
 *     record → re-verify against the new hash).
 *
 * What this does NOT defeat (documented residuals, out of scope):
 *   - in-place bit decay that leaves size AND mtime untouched (flash bitrot
 *     with a forged-or-frozen mtime): the fast path cannot see it. A
 *     privileged attacker (root/adb) who can rewrite bytes AND forge mtime
 *     already owns the device (keystore, process memory) — defending the
 *     model file against that adversary is not a meaningful boundary.
 *   - mtime granularity: expo-file-system reports whole seconds, so a
 *     rewrite landing inside the same second as the verified install is
 *     theoretically invisible. The window is one second, at install time.
 *
 * Performance posture: a legitimately installed model that survives a
 * restart is trusted via the fast path (one stat + one small journal read)
 * — a ~1 GB model is NOT re-hashed on every chat or model activation.
 * The full hash is paid only when trust is genuinely in doubt (cases 4b),
 * because performance must never replace integrity, but it also must not
 * punish the common case.
 *
 * Trust boundary: everything below the `assertTrustedModelFile*` functions
 * is mechanism; everything above them (engines, UI) must treat a resolved
 * promise as "these bytes were verified" and a rejection as "do not load".
 */

import * as FileSystem from "expo-file-system/legacy";
import { decodeBase64 } from "../p2p/base64";
import { createSha256 } from "./sha256";
import { DownloadFailure } from "./downloadErrors";
import {
  clearInstallRecord,
  getInstallRecord,
  loadInstallState,
  recordInstall,
} from "./installState";
import { CatalogModel, MODEL_CATALOG } from "./manifest";

/**
 * Streaming hash chunk.
 *
 * ~1 MiB, a multiple of 3: expo-file-system's position/length are FILE
 * BYTES, and every non-final chunk must decode from base64 independently —
 * a byte length divisible by 3 guarantees no cross-chunk padding.
 */
export const VERIFY_CHUNK_BYTES = 3 * 349_524; // 1,048,572

function dlog(assetId: string, message: string): void {
  // Keep the same log namespace ModelManager uses so trust decisions stay
  // greppable alongside install decisions.
  console.debug(`[ModelManager:${assetId}] ${message}`);
}

export function assetPath(asset: Pick<CatalogModel, "filename">): string {
  return `${FileSystem.documentDirectory}${asset.filename}`;
}

/**
 * Staging path: downloads ALWAYS land here first, never directly at the
 * final installed path. Only after size + SHA-256 verification does the
 * file get atomically promoted (rename) to assetPath().
 */
export function stagingPathFor(asset: Pick<CatalogModel, "filename">): string {
  return `${assetPath(asset)}.partial`;
}

/** Resume-token path for paused downloads (see ModelManager). */
export function resumeTokenPathFor(asset: Pick<CatalogModel, "filename">): string {
  return `${assetPath(asset)}.resume.json`;
}

export type TrustFailureReason =
  | "missing"
  | "size-mismatch"
  | "no-expected-sha256"
  | "checksum-mismatch"
  | "unverifiable"
  | "unknown-model-file";

export class ModelNotTrustedError extends Error {
  readonly reason: TrustFailureReason;
  constructor(reason: TrustFailureReason, detail: string) {
    super(`Model file is not trusted for inference (${reason}): ${detail}`);
    this.name = "ModelNotTrustedError";
    this.reason = reason;
  }
}

export interface TrustVerdict {
  trusted: boolean;
  reason: TrustFailureReason | "ok";
  /**
   * The file is corrupt/partial and can never become trusted as-is — the
   * caller should delete it (and clear the journal) rather than leave it
   * where a later, weaker check might mistake it for valid.
   */
  deleteFile: boolean;
  sizeOnDiskBytes: number;
}

// ---------------------------------------------------------------------------
// Install-state reconciliation (once per process).
//
// A journal record left in "downloading"/"verifying" means the previous
// process died mid-install — reconcile discards the staging file and marks
// the install failed/interrupted (honest restart-from-zero), so a crash can
// never leave NIDO believing a half-written file is usable. "paused"
// records (intentional pause + resume token persisted) keep their staging
// file for genuine resume. The final installed path is never touched here.
// ---------------------------------------------------------------------------

let reconcilePromise: Promise<void> | null = null;

/** Test hook: allow the next ensureInstallReconciled() to run again. */
export function resetInstallReconcileForTests(): void {
  reconcilePromise = null;
}

async function reconcileInstallState(catalog: CatalogModel[]): Promise<void> {
  const state = await loadInstallState();
  for (const asset of catalog) {
    const rec = state.records[asset.id];
    const stagingInfo = await FileSystem.getInfoAsync(stagingPathFor(asset)).catch(() => null);
    const stagingExists = !!stagingInfo?.exists && !stagingInfo?.isDirectory;
    const tokenInfo = await FileSystem.getInfoAsync(resumeTokenPathFor(asset)).catch(() => null);
    const tokenExists = !!tokenInfo?.exists && !tokenInfo?.isDirectory;

    if (rec?.status === "paused" && stagingExists && tokenExists) {
      dlog(
        asset.id,
        `reconcile: keeping paused staging (${stagingInfo?.size ?? 0} bytes) + resume token for genuine resume`
      );
      continue;
    }
    if (stagingExists) {
      dlog(asset.id, "reconcile: discarding staging file from a dead install attempt");
      await FileSystem.deleteAsync(stagingPathFor(asset), { idempotent: true }).catch(() => {});
    }
    if (tokenExists) {
      await FileSystem.deleteAsync(resumeTokenPathFor(asset), { idempotent: true }).catch(() => {});
    }
    if (rec && (rec.status === "downloading" || rec.status === "verifying" || rec.status === "paused")) {
      await recordInstall(asset.id, {
        status: "failed",
        sizeBytes: rec.sizeBytes,
        sha256: rec.sha256,
        failureCode: "interrupted",
        failureKind: "transient",
        bytesWritten: rec.bytesWritten ?? 0,
      });
    }
  }
}

/**
 * Runs reconcileInstallState() once per process, before any trust or
 * install work. Never throws: reconciliation must not break startup.
 */
export async function ensureInstallReconciled(
  catalog: CatalogModel[] = MODEL_CATALOG
): Promise<void> {
  if (!reconcilePromise) {
    reconcilePromise = reconcileInstallState(catalog).catch((e) => {
      console.warn(`[modelTrust] install reconcile failed: ${e}`);
    });
  }
  await reconcilePromise;
}

// ---------------------------------------------------------------------------
// Streaming SHA-256 over a file's raw bytes.
// ---------------------------------------------------------------------------

export interface Sha256OfFileOptions {
  signal?: AbortSignal;
  onProgress?: (hashedBytes: number, totalBytes: number) => void;
  /** For error messages only. */
  assetId?: string;
  /** For error messages only. */
  filename?: string;
}

/**
 * Computes SHA-256 over the file's RAW BYTES (never the base64 text),
 * streaming from disk in ~1 MiB chunks with O(chunk) peak memory.
 *
 * Fail-closed: a missing/empty file or a missing expected hash can never
 * produce a digest that matches — use `verifyBytesAgainstSha256` when the
 * comparison itself must also be fail-closed.
 *
 * Throws DownloadFailure("cancelled") on abort (the file is left untouched;
 * verification can simply be retried).
 */
export async function sha256OfFile(
  path: string,
  opts?: Sha256OfFileOptions
): Promise<string> {
  const info = await FileSystem.getInfoAsync(path);
  const totalBytes = info.exists && !info.isDirectory ? info.size ?? 0 : 0;
  // A missing/empty file can never match a declared checksum.
  if (totalBytes === 0) {
    throw new ModelNotTrustedError(
      "missing",
      `cannot hash ${opts?.filename ?? path}: file is missing or empty`
    );
  }
  const hasher = createSha256();
  let hashedBytes = 0;
  const label = opts?.assetId ?? opts?.filename ?? path;
  while (hashedBytes < totalBytes) {
    if (opts?.signal?.aborted) {
      throw new DownloadFailure({
        code: "cancelled",
        kind: "transient",
        canResume: true, // nothing was deleted; verification can simply be retried
        assetId: label,
        bytesReceived: hashedBytes,
        bytesExpected: totalBytes,
        detail: `sha256OfFile cancelled by signal after ${hashedBytes}/${totalBytes} bytes`,
      });
    }
    const length = Math.min(VERIFY_CHUNK_BYTES, totalBytes - hashedBytes);
    const chunkB64 = await FileSystem.readAsStringAsync(path, {
      encoding: FileSystem.EncodingType.Base64,
      position: hashedBytes,
      length,
    });
    hasher.update(decodeBase64(chunkB64));
    hashedBytes += length;
    opts?.onProgress?.(hashedBytes, totalBytes);
  }
  return Array.from(hasher.digest(), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Falsy-safe SHA comparison: a missing hash on either side never matches. */
export function sameSha(a: string | undefined | null, b: string | undefined | null): boolean {
  if (!a || !b) return false;
  return a.toLowerCase() === b.toLowerCase();
}

/** expo-file-system reports modificationTime in whole seconds (when available). */
function mtimeMsOf(info: unknown): number | null {
  const s = (info as { modificationTime?: unknown } | null | undefined)?.modificationTime;
  return typeof s === "number" && Number.isFinite(s) ? s * 1000 : null;
}

/** Current mtime of a path, or null when the FS doesn't report one. */
export async function currentMtimeMs(path: string): Promise<number | null> {
  const info = await FileSystem.getInfoAsync(path).catch(() => null);
  return mtimeMsOf(info);
}

// ---------------------------------------------------------------------------
// The trust gate.
// ---------------------------------------------------------------------------

/**
 * The single trust decision for a model file. Never throws for untrusted
 * files — it returns a verdict; `assertTrustedModelFile` is the throwing
 * variant used on the inference path.
 *
 * On a slow-path success the journal is updated (installed + fresh mtime)
 * so the next check takes the fast path. On proof of corruption the verdict
 * carries deleteFile=true.
 */
export async function checkModelTrust(asset: CatalogModel): Promise<TrustVerdict> {
  await ensureInstallReconciled();
  const path = assetPath(asset);
  const info = await FileSystem.getInfoAsync(path).catch(() => null);
  if (!info?.exists || info.isDirectory) {
    return { trusted: false, reason: "missing", deleteFile: false, sizeOnDiskBytes: 0 };
  }
  const sizeOnDisk = info.size ?? 0;
  if (sizeOnDisk !== asset.sizeBytes) {
    // Exists but wrong size: interrupted/truncated/stale — can never be
    // trusted as-is; the caller deletes it so it can't be mistaken for a
    // valid install later.
    dlog(asset.id, `checkModelTrust: size mismatch (${sizeOnDisk} != ${asset.sizeBytes}) — untrusted`);
    return { trusted: false, reason: "size-mismatch", deleteFile: true, sizeOnDiskBytes: sizeOnDisk };
  }
  if (!asset.sha256) {
    // No integrity metadata: fail closed. The file is left alone (the
    // catalog is what's broken) but it is never trusted.
    dlog(asset.id, "checkModelTrust: asset declares no SHA-256 — refusing trust");
    return { trusted: false, reason: "no-expected-sha256", deleteFile: false, sizeOnDiskBytes: sizeOnDisk };
  }
  const rec = await getInstallRecord(asset.id);
  const mtime = mtimeMsOf(info);
  if (
    rec?.status === "installed" &&
    rec.sizeBytes === asset.sizeBytes &&
    sameSha(rec.sha256, asset.sha256) &&
    rec.mtimeMs != null &&
    mtime != null &&
    rec.mtimeMs === mtime
  ) {
    // Fast path: these exact bytes were verified before, and the file has
    // not been rewritten since. No re-hash.
    return { trusted: true, reason: "ok", deleteFile: false, sizeOnDiskBytes: sizeOnDisk };
  }

  // Slow path: size matches but there is no valid cached verification
  // (first sight, lost/corrupt journal, rewritten file, or a changed
  // expected hash). Verify the bytes before trusting them — one-time cost;
  // the journal adoption below prevents repeats.
  dlog(asset.id, "checkModelTrust: no valid cached verification — hashing bytes");
  let digest: string;
  try {
    digest = await sha256OfFile(path, { assetId: asset.id, filename: asset.filename });
  } catch (e) {
    if (e instanceof DownloadFailure && e.code === "cancelled") throw e;
    dlog(asset.id, `checkModelTrust: file unreadable during verification — untrusted (${e})`);
    return { trusted: false, reason: "unverifiable", deleteFile: false, sizeOnDiskBytes: sizeOnDisk };
  }
  if (!sameSha(digest, asset.sha256)) {
    dlog(asset.id, "checkModelTrust: checksum mismatch — untrusted, file must be deleted");
    return { trusted: false, reason: "checksum-mismatch", deleteFile: true, sizeOnDiskBytes: sizeOnDisk };
  }
  await recordInstall(asset.id, {
    status: "installed",
    sizeBytes: asset.sizeBytes,
    sha256: asset.sha256,
    mtimeMs: mtime ?? undefined,
  });
  return { trusted: true, reason: "ok", deleteFile: false, sizeOnDiskBytes: sizeOnDisk };
}

/**
 * Inference-path gate: resolves only when the file at the catalog's final
 * path is proven to be the verified bytes. Anything else throws
 * ModelNotTrustedError — a file merely existing at the expected path is
 * NEVER enough to reach inference.
 */
export async function assertTrustedModelFile(asset: CatalogModel): Promise<void> {
  const verdict = await checkModelTrust(asset);
  if (verdict.trusted) return;
  if (verdict.deleteFile) {
    await FileSystem.deleteAsync(assetPath(asset), { idempotent: true }).catch(() => {});
    await clearInstallRecord(asset.id);
  }
  // verdict.reason is "ok" only when trusted — unreachable here; the
  // fallback keeps the type honest without hiding the real reason.
  const reason: TrustFailureReason = verdict.reason === "ok" ? "unverifiable" : verdict.reason;
  throw new ModelNotTrustedError(
    reason,
    `"${asset.filename}" (${verdict.sizeOnDiskBytes} bytes on disk, expected ${asset.sizeBytes})`
  );
}

/**
 * Filename → catalog asset for the engine load path. A filename that is
 * not a curated catalog entry is fail-closed: it can never be loaded,
 * no matter what sits at that path.
 */
export function trustedAssetForFilename(modelFilename: string): CatalogModel {
  const asset = MODEL_CATALOG.find((m) => m.filename === modelFilename);
  if (!asset) {
    throw new ModelNotTrustedError(
      "unknown-model-file",
      `"${modelFilename}" is not a curated catalog model — refusing to load`
    );
  }
  return asset;
}

/**
 * Combined gate for the engine load path: catalog resolution +
 * byte-trust verification, in one call.
 */
export async function assertTrustedModelFileByName(modelFilename: string): Promise<void> {
  return assertTrustedModelFile(trustedAssetForFilename(modelFilename));
}
