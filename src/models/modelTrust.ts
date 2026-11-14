/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

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
  verifiedProofOf,
  type GgufJournalFacts,
  type InstallRecord,
} from "./installState";
import { parseGgufHeader, ggufPrefixMatches } from "./ggufHeader";
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
  | "invalid-structure"
  | "unverifiable"
  | "unknown-model-file"
  | "outdated-pack";

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
  /**
   * 0.1.57: a knowledge pack that is exactly the bytes verified at an earlier
   * install, from an older catalog. Not trusted as the current version (so an
   * update is offered), but never deleted: it stays usable until the new
   * download is verified and promoted over it.
   */
  outdated?: boolean;
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
// M-37 (auditoría 2026-11-13, F2-M2): validación estructural GGUF.
//
// El SHA-256 del catálogo prueba que los bytes son los publicados; no
// prueba que sean un GGUF bien formado, y la vía rápida de abajo ni
// siquiera lo miraba: fiaba tamaño + SHA del diario + mtime, y el propio
// encabezado de este módulo lleva años diciendo que reescribir dentro
// del mismo segundo o falsificar el mtime es invisible para esa vía.
// Ahora, para los assets GGUF (kind llm/embedding sin format — los packs
// declaran sqlite-pack y no pasan por aquí):
//
//  - La vía lenta, tras casar el SHA, recorre la cabecera entera con el
//    parser puro de ggufHeader.ts. Una cabecera que no se puede recorrer
//    es «invalid-structure» y no se fía (deleteFile: false — los bytes
//    SÍ son los del catálogo; borrarlos solo re-descargaría los mismos).
//    Los hechos del recorrido quedan en el diario.
//  - La vía rápida exige además que la cabecera actual sea la
//    verificada: prefijo de 24 bytes + recorrido + SHA-256 de la región
//    de cabecera [0, dataOffset) contra lo anotado. Leer la cabecera
//    (KB–MB) no es re-hashear el fichero (cientos de MB), y un fichero
//    sustituido con el mismo tamaño y el mismo mtime ya no cuela si su
//    cabecera difiere. Si el diario aún no trae hechos (lo escribió el
//    instalador o una versión anterior a la 0.1.99), NO hay vía rápida:
//    la adopción la hace la vía lenta (re-hash + recorrido + anotación),
//    una sola vez por instalación — el mismo coste que la instalación
//    ya pagó al verificar, y el que este módulo siempre llamó «adopción
//    del diario». Adoptar los hechos desde el fichero actual sin
//    re-hashear convertiría la primera comprobación en notario de lo
//    que haya en el disco en ese momento, que es justo el hueco que
//    M-37 cierra. Residuo declarado: una sustitución que conserve
//    cabecera, tamaño y mtime byte a byte y solo cambie los PESOS pasa
//    la vía rápida — cerrarla del todo exigiría re-hashear cada carga,
//    el coste que la vía rápida existe para evitar.
// ---------------------------------------------------------------------------

/** Primera lectura de cabecera; se multiplica hasta el tope si hace falta. */
const GGUF_HEADER_READ_START = 256 * 1024;
/** Las cabeceras reales (con vocabulario del tokenizador) quedan muy por debajo. */
const GGUF_HEADER_READ_MAX = 32 * 1024 * 1024;

function isGgufAsset(asset: CatalogModel): boolean {
  return (asset.kind === "llm" || asset.kind === "embedding") && asset.format === undefined;
}

async function readRangeBytes(path: string, position: number, length: number): Promise<Uint8Array> {
  const b64 = await FileSystem.readAsStringAsync(path, {
    encoding: FileSystem.EncodingType.Base64,
    position,
    length,
  });
  return decodeBase64(b64);
}

function sha256HexOf(bytes: Uint8Array): string {
  const hasher = createSha256();
  hasher.update(bytes);
  return Array.from(hasher.digest(), (b) => b.toString(16).padStart(2, "0")).join("");
}

type GgufWalk =
  | { kind: "ok"; facts: GgufJournalFacts }
  | { kind: "invalid"; reason: string }
  | { kind: "unknown" };

/**
 * Recorre la cabecera GGUF del fichero, leyendo por tramos crecientes.
 * «unknown» = la cabecera pasa del tope de lectura o no se pudo leer:
 * con el SHA ya casado no es motivo de rechazo (ver checkModelTrust).
 */
async function walkGgufHeader(path: string, sizeBytes: number): Promise<GgufWalk> {
  let want = Math.min(sizeBytes, GGUF_HEADER_READ_START);
  for (;;) {
    let bytes: Uint8Array;
    try {
      bytes = await readRangeBytes(path, 0, want);
    } catch {
      return { kind: "unknown" };
    }
    const verdict = parseGgufHeader(bytes, sizeBytes);
    if (verdict.status === "invalid") return { kind: "invalid", reason: verdict.reason };
    if (verdict.status === "ok") {
      return {
        kind: "ok",
        facts: { ...verdict.facts, headerSha256: sha256HexOf(bytes.subarray(0, verdict.facts.dataOffset)) },
      };
    }
    if (want >= sizeBytes || want >= GGUF_HEADER_READ_MAX) return { kind: "unknown" };
    want = Math.min(sizeBytes, GGUF_HEADER_READ_MAX, want * 4);
  }
}

/**
 * ¿La cabecera actual es la que el diario dice que se verificó? Lee solo
 * la región de cabecera anotada. Cualquier desajuste o error devuelve
 * false y la decisión pasa a la vía lenta, que es la juez.
 */
async function fastPathHeaderMatches(
  path: string,
  sizeBytes: number,
  recorded: GgufJournalFacts,
): Promise<boolean> {
  try {
    if (recorded.dataOffset < 24 || recorded.dataOffset > sizeBytes) return false;
    const head = await readRangeBytes(path, 0, recorded.dataOffset);
    if (!ggufPrefixMatches(head, recorded)) return false;
    const verdict = parseGgufHeader(head, sizeBytes);
    if (verdict.status !== "ok") return false;
    if (
      verdict.facts.version !== recorded.version ||
      verdict.facts.tensorCount !== recorded.tensorCount ||
      verdict.facts.metadataCount !== recorded.metadataCount ||
      verdict.facts.dataOffset !== recorded.dataOffset
    ) {
      return false;
    }
    return sha256HexOf(head) === recorded.headerSha256;
  } catch {
    return false;
  }
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
  // Only packs read the journal this early: models keep the exact order of checks.
  if (isKnowledgePack(asset) && (await isProvenOutdatedPack(asset, path, sizeOnDisk, mtimeMsOf(info), await getInstallRecord(asset.id)))) {
    dlog(asset.id, "checkModelTrust: older verified pack — kept and usable, update available");
    return { trusted: false, reason: "outdated-pack", deleteFile: false, sizeOnDiskBytes: sizeOnDisk, outdated: true };
  }
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
    // M-37: para un GGUF eso ya no basta — la cabecera actual debe ser
    // la verificada (hechos del diario). Sin hechos anotados (diario del
    // instalador o anterior a la 0.1.99) no hay vía rápida: la vía lenta
    // de abajo verifica y adopta. Con hechos que no casan, también.
    if (!isGgufAsset(asset)) {
      return { trusted: true, reason: "ok", deleteFile: false, sizeOnDiskBytes: sizeOnDisk };
    }
    if (rec.gguf && (await fastPathHeaderMatches(path, sizeOnDisk, rec.gguf))) {
      return { trusted: true, reason: "ok", deleteFile: false, sizeOnDiskBytes: sizeOnDisk };
    }
    dlog(asset.id, "checkModelTrust: vía rápida denegada (cabecera GGUF sin hechos o distinta) — verificando bytes");
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
    // 0.1.90: ONE retry when the hash calculation itself throws. The
    // first sight of a just-promoted file is exactly where a transient
    // read failure was observed on a real device (owner's tablet,
    // 2026-11-09: a completed retry-download did not settle as
    // installed until a whole second download; the file was good all
    // along). A throw means "could not read", not "bytes are wrong":
    // a digest MISMATCH is never retried into trust (it returns
    // checksum-mismatch below and the file is deleted), so this retry
    // cannot weaken the gate — it only refuses to let one transient
    // read error masquerade as a durable "not installed".
    dlog(asset.id, `checkModelTrust: first hash attempt threw — retrying once (${e})`);
    try {
      digest = await sha256OfFile(path, { assetId: asset.id, filename: asset.filename });
    } catch (e2) {
      if (e2 instanceof DownloadFailure && e2.code === "cancelled") throw e2;
      dlog(asset.id, `checkModelTrust: file unreadable during verification — untrusted (${e2})`);
      return { trusted: false, reason: "unverifiable", deleteFile: false, sizeOnDiskBytes: sizeOnDisk };
    }
  }
  if (!sameSha(digest, asset.sha256)) {
    dlog(asset.id, "checkModelTrust: checksum mismatch — untrusted, file must be deleted");
    return { trusted: false, reason: "checksum-mismatch", deleteFile: true, sizeOnDiskBytes: sizeOnDisk };
  }
  // M-37: con el SHA casado, la estructura manda. Una cabecera GGUF que
  // no se puede recorrer no llega al parser nativo aunque los bytes sean
  // los del catálogo (deleteFile: false — borrarlos solo traería los
  // mismos bytes otra vez; lo que estaría mal es la entrada del catálogo).
  let ggufFacts: GgufJournalFacts | undefined;
  if (isGgufAsset(asset)) {
    const walk = await walkGgufHeader(path, sizeOnDisk);
    if (walk.kind === "invalid") {
      dlog(asset.id, `checkModelTrust: GGUF structure invalid (${walk.reason}) — untrusted`);
      return { trusted: false, reason: "invalid-structure", deleteFile: false, sizeOnDiskBytes: sizeOnDisk };
    }
    if (walk.kind === "ok") ggufFacts = walk.facts;
    // «unknown» (cabecera mayor que el tope o ilegible): los bytes ya son
    // los verificados por SHA; se acepta sin anotar hechos y la vía
    // rápida simplemente no se usará para este fichero.
  }
  await recordInstall(asset.id, {
    status: "installed",
    sizeBytes: asset.sizeBytes,
    sha256: asset.sha256,
    mtimeMs: mtime ?? undefined,
    ...(ggufFacts ? { gguf: ggufFacts } : {}),
  });
  return { trusted: true, reason: "ok", deleteFile: false, sizeOnDiskBytes: sizeOnDisk };
}

// ---------------------------------------------------------------------------
// Outdated knowledge packs (0.1.57).
//
// When an app update ships a new catalog, an installed pack no longer matches
// the new size/SHA-256. It used to be deleted on the next status check — even
// offline, leaving the phone without the emergency numbers it had. A pack that
// is still exactly the bytes verified at its own install (journal proof: size +
// mtime, or a re-hash when the FS reports no mtime) is kept and used, shown as
// "update available". Anything else still fails closed as before. Models are
// not affected: they keep the strict gate.
// ---------------------------------------------------------------------------

export function isKnowledgePack(asset: Pick<CatalogModel, "kind" | "format">): boolean {
  return asset.kind === "corpus" && asset.format === "sqlite-pack";
}

async function isProvenOutdatedPack(
  asset: CatalogModel,
  path: string,
  sizeOnDisk: number,
  mtime: number | null,
  rec: InstallRecord | null
): Promise<boolean> {
  if (!isKnowledgePack(asset)) return false;
  const proof = verifiedProofOf(rec);
  if (!proof) return false;
  // Proof of the current catalog version: not outdated (the normal gate decides).
  if (proof.sizeBytes === asset.sizeBytes && sameSha(proof.sha256, asset.sha256)) return false;
  if (sizeOnDisk !== proof.sizeBytes) return false;
  if (proof.mtimeMs != null && mtime != null) {
    if (proof.mtimeMs === mtime) return true;
  }
  // Rewritten since (or no mtime to compare): only a re-hash can prove it.
  try {
    return sameSha(await sha256OfFile(path, { assetId: asset.id, filename: asset.filename }), proof.sha256);
  } catch (e) {
    if (e instanceof DownloadFailure && e.code === "cancelled") throw e;
    return false;
  }
}

export type PackFileState = "current" | "outdated" | "unusable";

/**
 * Whether a knowledge pack's file can be opened: "current" (complete for the
 * catalog, as before), "outdated" (older verified bytes, see above) or
 * "unusable". Local packs (sizeBytes 0, built by the user) have no catalog
 * entry to compare against and are "current" when present.
 */
export async function packFileState(asset: CatalogModel): Promise<PackFileState> {
  await ensureInstallReconciled();
  const path = assetPath(asset);
  const info = await FileSystem.getInfoAsync(path).catch(() => null);
  if (!info?.exists || info.isDirectory) return "unusable";
  const size = info.size ?? 0;
  if (asset.sizeBytes <= 0) return "current";
  if (await isProvenOutdatedPack(asset, path, size, mtimeMsOf(info), await getInstallRecord(asset.id))) return "outdated";
  return size === asset.sizeBytes ? "current" : "unusable";
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
