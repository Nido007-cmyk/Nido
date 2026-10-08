/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import * as FileSystem from "expo-file-system/legacy";
import {
  INSTALL_JOURNAL_VERSION,
  InstallJournalVersionError,
  checkFormatVersion,
} from "../security/formatVersion";

/**
 * installState.ts — durable per-asset install records.
 *
 * Why this exists: before this module, "is the model installed?" was
 * answered purely from file existence + size (`statusOf`). That cannot
 * distinguish:
 *
 * - a file that finished downloading AND passed SHA-256 (safe to use),
 * - a file that finished downloading but was never hash-verified,
 * - a file whose download was killed mid-transfer (partial),
 * - a file left behind by a crash during promotion.
 *
 * This journal records every install transition (downloading → verifying →
 * installed, or failed with a classified code) to
 * `${documentDirectory}nido-install-state.json`, written atomically
 * (write temp + rename). On process start, ModelManager reconciles the
 * journal against the files on disk: any record left in `downloading` or
 * `verifying` means the previous process died mid-install, and the state
 * is reconstructed honestly (never "installed").
 *
 * Design rules:
 * - A record is written BEFORE each risky step (download start, verify
 *   start) and AFTER each completed step (promoted, failed).
 * - `installed` is recorded only AFTER the file is at its final path.
 * - If the journal itself can't be read, treat it as empty (re-verify).
 * - If the journal can't be written, log and continue — a missing record
 *   degrades to "unverified, re-check", never to a false "installed".
 * - Pure file I/O; no native modules beyond expo-file-system, so this is
 *   unit-testable with a mocked filesystem.
 */

export type InstallRecordStatus =
  | "downloading"
  | "verifying"
  | "installed"
  | "failed"
  | "paused"; // intentional pause: staging + resume token kept for genuine resume

export interface InstallRecord {
  assetId: string;
  status: InstallRecordStatus;
  /** Expected size (bytes) of the asset at install time. */
  sizeBytes: number;
  /** Expected SHA-256 (hex) of the asset at install time. */
  sha256: string;
  /**
   * mtime of the installed file (ms since epoch) at the moment its bytes
   * were verified. The load-time trust gate compares this against the
   * file's current mtime: any rewrite changes mtime and forces a
   * re-verification, so same-size tampering cannot ride on a stale record.
   * Absent when the FS doesn't report mtime — then every load re-verifies
   * (slower, never less safe).
   */
  mtimeMs?: number;
  /** Last known transfer progress, for honest resume decisions. */
  bytesWritten?: number;
  /** Machine-readable failure code when status === "failed". */
  failureCode?: string;
  /** "permanent" | "transient" | "resource" when status === "failed". */
  failureKind?: string;
  updatedAt: number;
}

export interface InstallStateFile {
  version: 1;
  records: Record<string, InstallRecord>;
}

const JOURNAL_FILENAME = "nido-install-state.json";

export function installStatePath(): string {
  return `${FileSystem.documentDirectory}${JOURNAL_FILENAME}`;
}

function emptyState(): InstallStateFile {
  return { version: 1, records: {} };
}

/**
 * Loads the journal. Fail-closed on version: a missing file is treated as
 * empty (nothing installed yet — honest), a corrupt/JSON-unreadable file is
 * treated as empty (degrades to "re-verify what's on disk", never a false
 * installed claim), but a readable journal whose `version` is missing,
 * unknown, or corrupt THROWS InstallJournalVersionError: the model-trust
 * gate must never parse a future/foreign format as "empty" and then
 * re-trust files on a slow path it doesn't understand.
 */
export async function loadInstallState(): Promise<InstallStateFile> {
  try {
    const info = await FileSystem.getInfoAsync(installStatePath());
    if (!info.exists || info.isDirectory) return emptyState();
    const raw = await FileSystem.readAsStringAsync(installStatePath(), {
      encoding: FileSystem.EncodingType.UTF8,
    });
    // JSON.parse succeeded but the body may be a scalar or null: read the
    // version defensively (no property access on null) so a non-object
    // body fails closed as "missing version field" instead of throwing a
    // TypeError that the catch below would misread as "unreadable JSON".
    const parsed: unknown = JSON.parse(raw);
    const version =
      typeof parsed === "object" && parsed !== null
        ? (parsed as Partial<InstallStateFile>).version
        : undefined;
    // F1: version MUST be validated before the records-shape guard below.
    // A readable journal whose version is missing, unknown, or corrupt
    // throws InstallJournalVersionError — the guard may only degrade
    // records SHAPE (not version) to empty, and only after the version
    // is proven to be one this reader understands.
    checkFormatVersion({
      formatId: "nido-install-state.json",
      found: version,
      supportedMajor: INSTALL_JOURNAL_VERSION,
      ErrorClass: InstallJournalVersionError,
    });
    const records = (parsed as Partial<InstallStateFile>).records;
    if (typeof records !== "object" || records === null) {
      return emptyState();
    }
    return { version: 1, records };
  } catch (err) {
    // El error de versión es fail-closed y debe propagarse; todo lo demás
    // (JSON corrupto, E/S) degrada a vacío como antes.
    if (err instanceof InstallJournalVersionError) throw err;
    return emptyState();
  }
}

/**
 * Saves the journal atomically: write to a temp file, then rename over
 * the journal. A crash mid-write leaves either the old or the new
 * journal — never a half-written one.
 */
export async function saveInstallState(state: InstallStateFile): Promise<void> {
  const path = installStatePath();
  const tmp = `${path}.tmp`;
  await FileSystem.writeAsStringAsync(tmp, JSON.stringify(state), {
    encoding: FileSystem.EncodingType.UTF8,
  });
  await FileSystem.moveAsync({ from: tmp, to: path });
}

export async function getInstallRecord(assetId: string): Promise<InstallRecord | null> {
  const state = await loadInstallState();
  return state.records[assetId] ?? null;
}

/**
 * Merges a patch into the asset's record (creating it if absent) and
 * persists the journal. Best-effort: a journal write failure is logged,
 * not thrown — the caller continues, and the missing record degrades to
 * "unverified" on the next read rather than a false "installed".
 */
export async function recordInstall(
  assetId: string,
  patch: Partial<Omit<InstallRecord, "assetId" | "updatedAt">> &
    Pick<InstallRecord, "status" | "sizeBytes" | "sha256">
): Promise<void> {
  try {
    const state = await loadInstallState();
    const prev = state.records[assetId];
    const merged: InstallRecord = {
      ...prev,
      ...patch,
      assetId,
      updatedAt: Date.now(),
    };
    // A transition away from "failed" clears stale failure info unless the
    // patch explicitly carries new failure details.
    if (merged.status !== "failed" && patch.failureCode === undefined) {
      merged.failureCode = undefined;
      merged.failureKind = undefined;
    }
    state.records[assetId] = merged;
    await saveInstallState(state);
  } catch (e) {
    console.warn(`[installState] journal write failed for ${assetId}: ${e}`);
  }
}

export async function clearInstallRecord(assetId: string): Promise<void> {
  try {
    const state = await loadInstallState();
    delete state.records[assetId];
    await saveInstallState(state);
  } catch (e) {
    console.warn(`[installState] journal clear failed for ${assetId}: ${e}`);
  }
}
