/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * downloadErrors.ts — honest error taxonomy for model/corpus downloads.
 *
 * Two promises this module enforces, in code and in user-facing copy:
 *
 * 1. Every download failure is classified as PERMANENT (retrying the same
 *    request cannot succeed — e.g. checksum mismatch, HTTP 404) or
 *    TRANSIENT (it may succeed later — e.g. stalled connection, HTTP 503).
 * 2. `canResume` is true ONLY when the partial file AND the resume token
 *    are actually kept on disk. Code paths that delete the partial file
 *    and start over must surface canResume=false, and the user message
 *    must say the retry starts from the beginning — never claim "resume"
 *    for a restart-from-zero.
 *
 * Pure module: no native imports, no i18n import at the top level (the
 * i18n/settings chain pulls native modules that unit tests cannot load —
 * see notifications.ts). User-message resolution goes through
 * downloadFailureUserMessage(), which require()s i18n lazily and falls
 * back to English (NIDO is English-first) if resolution fails.
 */

export type DownloadErrorCode =
  | "checksumMismatch" // file failed SHA-256 → deleted (permanent)
  | "sizeMismatch" // wrong byte count, e.g. an error page served as 200 (permanent)
  | "notFound" // HTTP 404 (permanent)
  | "httpError" // other non-200/206 status; kind depends on status (see classifyHttpStatus)
  | "unpinnedSource" // catalog entry declares no pinned revision → no network request made (permanent)
  | "unknownSourceContract" // source URL matches no known immutable-source contract → no network request made (permanent)
  | "stalled" // no progress for the inactivity timeout; partial KEPT (transient)
  | "interrupted" // transfer threw; partial DELETED, retry restarts at 0 (transient)
  | "insufficientStorage" // not enough free space, pre-flight or mid-install (local resource)
  | "cancelled"; // user/system cancelled an in-flight verification (transient)

/**
 * Failure classes. "resource" is deliberately distinct from transient/
 * permanent: it means the phone itself can't hold the file (disk full),
 * not that the network or the server is at fault — the user message must
 * say "free up space", never "network error".
 */
export type FailureKind = "permanent" | "transient" | "resource";

/**
 * HTTP statuses that mean the transfer itself completed and the staging
 * file is a candidate for verification — NOT a failure:
 * - 200: full body (fresh download)
 * - 206: Partial Content (the server honored a byte-range resume,
 *   RFC 9110 §15.3.7 — this is what a resumed download looks like when
 *   the server cooperates; expo-file-system passes the raw status through)
 *
 * Everything else is a genuine failure and goes through classifyHttpStatus.
 * 206 must NEVER be classified as a failure: treating it as one turned an
 * honest resume into a permanent error and deleted the valid staging file
 * (C/F1). Trust is not placed in the status — promotion stays gated on the
 * exact size check and mandatory SHA-256 verification.
 */
export function isSuccessfulDownloadStatus(status: number): boolean {
  return status === 200 || status === 206;
}

/**
 * HTTP status → failure taxonomy. Only call this for statuses that are NOT
 * successful (see isSuccessfulDownloadStatus): 200/206 never reach here.
 * 404 is its own code because "the file moved" is actionable differently
 * from a generic server error. 408/429/5xx are transient (back off and
 * retry); other 4xx are permanent (the request itself is wrong — retrying
 * identically cannot help). 416 (Range Not Satisfiable) is permanent: the
 * server cannot honor the requested byte range, so repeating the same
 * resume request cannot succeed.
 */
export function classifyHttpStatus(status: number): {
  code: DownloadErrorCode;
  kind: FailureKind;
} {
  if (status === 404) return { code: "notFound", kind: "permanent" };
  if (status === 408 || status === 429 || status >= 500) {
    return { code: "httpError", kind: "transient" };
  }
  return { code: "httpError", kind: "permanent" };
}

export interface DownloadFailureParams {
  code: DownloadErrorCode;
  kind: FailureKind;
  /**
   * True ONLY if the partial file and its resume token were kept and the
   * next attempt continues from bytesReceived. NEVER set this true on a
   * path that deletes the partial file.
   */
  canResume: boolean;
  assetId: string;
  bytesReceived: number;
  bytesExpected: number;
  httpStatus?: number;
  /** Extra interpolation vars for the user message (e.g. { seconds: 60 }). */
  extraVars?: Record<string, string | number>;
  /** Technical detail for logs/audit; never shown to the user directly. */
  detail?: string;
}

export class DownloadFailure extends Error {
  readonly code: DownloadErrorCode;
  readonly kind: FailureKind;
  readonly canResume: boolean;
  readonly assetId: string;
  readonly bytesReceived: number;
  readonly bytesExpected: number;
  readonly httpStatus?: number;
  readonly extraVars: Record<string, string | number>;
  /** Technical detail for logs/audit; never shown to the user directly. */
  readonly detail?: string;

  constructor(p: DownloadFailureParams) {
    super(p.detail ?? `${p.code} (${p.bytesReceived}/${p.bytesExpected} bytes, asset ${p.assetId})`);
    this.name = "DownloadFailure";
    this.code = p.code;
    this.kind = p.kind;
    this.canResume = p.canResume;
    this.assetId = p.assetId;
    this.bytesReceived = p.bytesReceived;
    this.bytesExpected = p.bytesExpected;
    this.httpStatus = p.httpStatus;
    this.extraVars = p.extraVars ?? {};
    this.detail = p.detail;
  }

  /** i18n key for the user-facing message. httpError splits by kind. */
  messageKey(): string {
    if (this.code === "httpError") {
      return `downloadErrors.httpError${this.kind === "transient" ? "Transient" : "Permanent"}`;
    }
    return `downloadErrors.${this.code}`;
  }

  /** Interpolation variables for i18n.t(key, vars). */
  messageVars(): Record<string, string | number> {
    return {
      received: formatBytes(this.bytesReceived),
      expected: formatBytes(this.bytesExpected),
      status: this.httpStatus ?? "?",
      ...this.extraVars,
    };
  }
}

/** "1536" → "1.5 KB"; keeps user messages readable for multi-GB files. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "?";
  const units = ["bytes", "KB", "MB", "GB", "TB"];
  let v = bytes;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return u === 0 ? `${Math.round(v)} ${units[u]}` : `${v.toFixed(1)} ${units[u]}`;
}

function interpolate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => String(vars[k] ?? `{{${k}}}`));
}

/** English-first fallback if i18n resolution fails (mirrors en.json). */
const EN_FALLBACK: Record<string, string> = {
  "downloadErrors.checksumMismatch":
    "The integrity check failed (SHA-256 mismatch), so the file was deleted. Retrying downloads it again from the start.",
  "downloadErrors.sizeMismatch":
    "The download failed verification: received {{received}} of {{expected}}. The incomplete file was deleted, so retrying starts from the beginning.",
  "downloadErrors.notFound":
    "The file is no longer available on the server (HTTP {{status}}). Retrying won't fix this.",
  "downloadErrors.httpErrorTransient":
    "The server returned an error (HTTP {{status}}) after {{received}} of {{expected}}. You can retry — it may succeed later.",
  "downloadErrors.httpErrorPermanent":
    "The server returned an error (HTTP {{status}}) after {{received}} of {{expected}}. Retrying the same request won't help.",
  "downloadErrors.unpinnedSource":
    "This model entry is missing a pinned download revision, so no network request was made. Retrying won't help until the catalog entry is fixed.",
  "downloadErrors.unknownSourceContract":
    "This entry's download source is not a recognized safe source, so no network request was made. Retrying won't help until the catalog entry is fixed.",
  "downloadErrors.stalled":
    "The download stalled (no progress for {{seconds}}s). Your progress ({{received}} of {{expected}}) is kept — retrying resumes where it stopped.",
  "downloadErrors.interrupted":
    "The download was interrupted after {{received}} of {{expected}}. The partial file was discarded, so retrying starts from the beginning.",
  "downloadErrors.insufficientStorage":
    "There isn't enough free space on this phone for this download — it needs {{needed}} but only {{free}} is available. Free up space and try again.",
  "downloadErrors.cancelled":
    "Verification was cancelled after {{received}} of {{expected}}. Nothing was deleted — you can verify again.",
};

/**
 * User-facing message for a DownloadFailure, in the user's language.
 * Lazy-requires i18n (never a top-level import — see module doc comment);
 * falls back to the English strings above when resolution fails, so the UI
 * never renders a raw key or crashes.
 */
export function downloadFailureUserMessage(f: DownloadFailure): string {
  const key = f.messageKey();
  const vars = f.messageVars();
  try {
    const i18n = require("../i18n").default as {
      t(k: string, v?: Record<string, string | number>): string;
    };
    const s = i18n.t(key, vars);
    if (s && s !== key) return s;
  } catch {
    // fall through to English
  }
  return interpolate(EN_FALLBACK[key] ?? key, vars);
}
