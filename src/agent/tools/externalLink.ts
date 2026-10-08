/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * externalLink.ts — P-F1: safe classification of `open_app` targets.
 *
 * `open_app` is an external-effect tool: it hands a URL to the OS
 * (browser, dialer, messaging, mail), which switches the user out of
 * NIDO. Two rules keep it honest:
 *
 * 1. Never silently — the handler is wrapped in `withConfirmation`
 *    (see confirm.ts / handlers.ts); no confirmation, no `openURL`.
 * 2. Allowlist only — exactly https, http, tel, sms, mailto. Anything
 *    else fails closed, including tricks against the scheme check.
 *
 * The classifier is pure and synchronous so it can be unit-tested
 * deterministically; both the confirm-dialog `describe` and the inner
 * handler run it (defense in depth — the handler never trusts that the
 * dialog path already validated).
 */

/** Schemes an agent may hand to the OS. Nothing else reaches Linking. */
export const OPEN_APP_ALLOWED_SCHEMES = [
  "https",
  "http",
  "tel",
  "sms",
  "mailto",
] as const;

export type OpenAppScheme = (typeof OPEN_APP_ALLOWED_SCHEMES)[number];

/** Machine-readable rejection reasons (localized at the call site). */
export type OpenAppRejectReason =
  | "empty"
  | "no-scheme"
  | "scheme-not-allowed"
  | "unsafe-chars";

export type OpenAppClassification =
  | {
      ok: true;
      /** Safe normalized target: scheme lowercased, rest untouched. */
      normalized: string;
      scheme: OpenAppScheme;
    }
  | {
      ok: false;
      reason: OpenAppRejectReason;
    };

/** ASCII control characters (plus DEL) — never appear in a safe target. */
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/** Raw-whitespace anywhere inside the target (leading/trailing is trimmed first). */
const INNER_WHITESPACE = /\s/;

/** Strict scheme extraction: `<scheme>:` with the RFC 3986 scheme charset. */
const SCHEME_RE = /^([A-Za-z][A-Za-z0-9+.-]*):/;

/**
 * Classify a raw `open_app` argument.
 *
 * Bypass coverage:
 * - case: `HTTPS://x` → scheme lowercased before the allowlist check.
 * - whitespace: trimmed; raw whitespace inside the target → rejected.
 * - encoding tricks: a percent-encoded scheme (`%68ttps://x`) never
 *   matches SCHEME_RE (no decoding is ever applied to the scheme).
 * - nested schemes: `https:javascript:…` is still just scheme `https`
 *   (allowed as a link — the OS/browser owns the rest); `javascript:` as
 *   the outer scheme is rejected.
 * - malformed prefixes: no `:`-terminated scheme → rejected (this also
 *   covers bare Android package names, which are NOT openable here).
 * - control characters (tab/newline/NUL smuggling) → rejected.
 */
export function classifyOpenAppTarget(
  raw: unknown,
): OpenAppClassification {
  const target = typeof raw === "string" ? raw.trim() : "";
  if (!target) return { ok: false, reason: "empty" };
  if (CONTROL_CHARS.test(target) || INNER_WHITESPACE.test(target)) {
    return { ok: false, reason: "unsafe-chars" };
  }
  const m = SCHEME_RE.exec(target);
  if (!m) return { ok: false, reason: "no-scheme" };
  const scheme = m[1].toLowerCase();
  if (!(OPEN_APP_ALLOWED_SCHEMES as readonly string[]).includes(scheme)) {
    return { ok: false, reason: "scheme-not-allowed" };
  }
  return {
    ok: true,
    normalized: scheme + target.slice(m[1].length),
    scheme: scheme as OpenAppScheme,
  };
}
