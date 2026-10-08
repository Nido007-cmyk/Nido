/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Delegation tokens — Biscuit-style Ed25519 capability chains (v1).
 *
 * NIDO-A issues a token bound to: its identity key (issuer), NIDO-B's
 * public key (audience), one negotiationId, one taskId, a scope subset,
 * and an expiry. NIDO-B verifies offline against A's known public key.
 *
 * SECURITY INVARIANTS (threat model section 6):
 * - All crypto uses tweetnacl (existing audited primitive). No new crypto.
 * - Caveats are signed; tampering breaks the chain (fail-closed).
 * - No home-grown randomness: nonces via nacl.randomBytes.
 *
 * Token wire format (base64url of canonical JSON):
 *   { v: 1, chain: [ { payload, sig }, ... ] }
 * Each link signs the canonical serialization of (prevSig + payload),
 * so links cannot be reordered or removed without breaking verification.
 */

import nacl from "tweetnacl";
import { toHex as bytesToHex, fromHex as hexToBytes } from "./crypto";
import {
  TASK_LIMITS,
  TASK_SCOPES_V1,
  allScopesValid,
  type TaskScope,
} from "./taskProtocol";

export interface TokenRootPayload {
  issuer: string; // A_pk hex (lowercase)
  audience: string; // B_pk hex (lowercase)
  negotiationId: string;
  taskId: string; // UUID v4
  scopes: TaskScope[];
  issuedAt: number; // unix ms
  expiresAt: number; // unix ms
  /**
   * Optional binding to the transport session that will carry the
   * TASK_REQUEST (the `ackSessionTag` derived in the handshake, 128 hex
   * chars). When present, the verifier MUST supply the tag of its live
   * session and it must match, or verification fails closed. This
   * prevents a token captured at rest from being replayed against a
   * *different* session with the same peer inside its 15-minute window.
   * (Security review 2026-10-08, §3.2: cross-session replay.)
   */
  sessionTag?: string;
}

export interface TokenCaveat {
  /** Optional: token not valid before this time. */
  notBefore?: number;
  /** Optional: max tool calls the executor may make. */
  maxToolCalls?: number;
  /** Optional: result size cap override (bytes, <= TASK_LIMITS.resultMaxBytes). */
  resultSizeLimit?: number;
}

interface ChainLink {
  payload: TokenRootPayload | TokenCaveat;
  sig: string; // hex Ed25519 signature
}

interface WireToken {
  v: 1;
  chain: ChainLink[];
}

const HEX64_RE = /^[0-9a-f]{64}$/i;
const HEX128_RE = /^[0-9a-f]{128}$/i;
const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function canonical(v: unknown): string {
  return JSON.stringify(sortKeys(v));
}

/** Recursively sorts object keys for deterministic serialization. */
function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v !== null && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v).sort()) {
      out[k] = sortKeys((v as Record<string, unknown>)[k]);
    }
    return out;
  }
  return v;
}

function b64urlEncode(s: string): string {
  return Buffer.from(s, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function b64urlDecode(s: string): string {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(b64, "base64").toString("utf8");
}

function signLink(
  secretKey: Uint8Array,
  prevSigHex: string,
  payload: TokenRootPayload | TokenCaveat
): ChainLink {
  const body = canonical({ prev: prevSigHex, payload });
  const sig = nacl.sign.detached(new TextEncoder().encode(body), secretKey);
  return { payload, sig: bytesToHex(sig) };
}

/**
 * Issue a root delegation token. Called by NIDO-A.
 * Throws on invalid input (fail-closed at issuance).
 */
export function issueDelegationToken(
  signerSecretKey: Uint8Array,
  root: TokenRootPayload
): string {
  const issuer = root.issuer.toLowerCase();
  const audience = root.audience.toLowerCase();
  if (!HEX64_RE.test(issuer)) throw new Error("bad issuer key");
  if (!HEX64_RE.test(audience)) throw new Error("bad audience key");
  if (issuer === audience) throw new Error("issuer == audience");
  if (!UUID_V4_RE.test(root.taskId)) throw new Error("bad taskId");
  if (!allScopesValid(root.scopes)) throw new Error("bad scopes");
  const now = Date.now();
  if (
    typeof root.expiresAt !== "number" ||
    root.expiresAt <= now ||
    root.expiresAt - now > TASK_LIMITS.tokenLifetimeMs + TASK_LIMITS.clockSkewMs
  )
    throw new Error("bad expiry");
  const clean: TokenRootPayload = {
    issuer,
    audience,
    negotiationId: root.negotiationId,
    taskId: root.taskId.toLowerCase(),
    scopes: [...root.scopes],
    issuedAt: now,
    expiresAt: root.expiresAt,
  };
  // Session binding is opt-in at issuance; when bound, the tag is part
  // of the signed root payload (canonical JSON), so it cannot be
  // stripped or swapped without breaking the chain.
  if (root.sessionTag !== undefined) {
    if (!HEX128_RE.test(root.sessionTag)) throw new Error("bad sessionTag");
    clean.sessionTag = root.sessionTag.toLowerCase();
  }
  const link = signLink(signerSecretKey, "GENESIS", clean);
  const wire: WireToken = { v: 1, chain: [link] };
  return b64urlEncode(canonical(wire));
}

/**
 * Append an attenuation caveat. Called by NIDO-A before sending.
 * Caveats can only NARROW (smaller limits, later notBefore).
 *
 * Verify-first: the chain is verified against the signer's key BEFORE
 * extending it. Without this, a caller passing an attacker-crafted (or
 * corrupted) token would get back a "validly signed" extension of
 * garbage. Fail-closed: any verification failure throws.
 */
export function attenuateToken(
  signerSecretKey: Uint8Array,
  token: string,
  caveat: TokenCaveat
): string {
  const wire = parseWire(token);
  if (!wire) throw new Error("unparseable token");
  let issuerPk: Uint8Array;
  try {
    issuerPk = nacl.sign.keyPair.fromSecretKey(signerSecretKey).publicKey;
  } catch {
    throw new Error("bad signer key");
  }
  // Verify the existing chain (using the token's own claimed audience
  // and session tag as expectations — the signature check itself
  // authenticates them; a mismatch fails closed here).
  const rootClaim = wire.chain[0].payload as TokenRootPayload;
  const verified = verifyDelegationToken(
    token,
    bytesToHex(issuerPk),
    typeof rootClaim.audience === "string" ? rootClaim.audience : "",
    Date.now(),
    typeof rootClaim.sessionTag === "string" ? rootClaim.sessionTag : undefined
  );
  if (!verified) throw new Error("token chain does not verify");
  if (caveat.notBefore !== undefined && !Number.isFinite(caveat.notBefore))
    throw new Error("bad notBefore");
  if (
    caveat.maxToolCalls !== undefined &&
    (!Number.isInteger(caveat.maxToolCalls) || caveat.maxToolCalls <= 0)
  )
    throw new Error("bad maxToolCalls");
  if (
    caveat.resultSizeLimit !== undefined &&
    (!Number.isInteger(caveat.resultSizeLimit) ||
      caveat.resultSizeLimit <= 0 ||
      caveat.resultSizeLimit > TASK_LIMITS.resultMaxBytes)
  )
    throw new Error("bad resultSizeLimit");
  const prevSig = wire.chain[wire.chain.length - 1].sig;
  const clean: TokenCaveat = { ...caveat };
  wire.chain.push(signLink(signerSecretKey, prevSig, clean));
  return b64urlEncode(canonical(wire));
}

function parseWire(token: string): WireToken | null {
  try {
    const raw = JSON.parse(b64urlDecode(token)) as WireToken;
    if (raw?.v !== 1 || !Array.isArray(raw.chain) || raw.chain.length === 0)
      return null;
    for (const link of raw.chain) {
      if (!link || typeof link.sig !== "string" || !/^[0-9a-f]{128}$/i.test(link.sig))
        return null;
      if (typeof link.payload !== "object" || link.payload === null) return null;
    }
    return raw;
  } catch {
    return null;
  }
}

export interface VerifiedToken {
  root: TokenRootPayload;
  caveats: TokenCaveat[];
  /** Effective limits after caveat attenuation. */
  effective: { maxToolCalls: number; resultSizeLimit: number; notBefore: number };
}

const DEFAULT_MAX_TOOL_CALLS = 10;

/**
 * Verify a token offline against A's known public key.
 * Returns the verified claims or null (fail-closed, no exceptions).
 *
 * @param expectedSessionTag when the verifier runs on a live transport
 *   session, pass its `ackSessionTag`. Strict rule: if either side binds
 *   a tag and the other does not (or the values differ), verification
 *   fails. A bound token is only valid inside its session.
 */
export function verifyDelegationToken(
  token: string,
  expectedIssuerPkHex: string,
  expectedAudiencePkHex: string,
  nowMs: number = Date.now(),
  expectedSessionTag?: string
): VerifiedToken | null {
  const wire = parseWire(token);
  if (!wire) return null;
  const issuer = expectedIssuerPkHex.toLowerCase();
  const audience = expectedAudiencePkHex.toLowerCase();

  let issuerPk: Uint8Array;
  try {
    issuerPk = hexToBytes(issuer);
  } catch {
    return null;
  }
  if (issuerPk.length !== 32) return null;

  // Verify the signature chain link by link.
  let prevSig = "GENESIS";
  for (const link of wire.chain) {
    const body = canonical({ prev: prevSig, payload: link.payload });
    let sig: Uint8Array;
    try {
      sig = hexToBytes(link.sig);
    } catch {
      return null;
    }
    const ok = nacl.sign.detached.verify(
      new TextEncoder().encode(body),
      sig,
      issuerPk
    );
    if (!ok) return null;
    prevSig = link.sig;
  }

  // First link must be a valid root payload.
  const root = wire.chain[0].payload as TokenRootPayload;
  if (
    typeof root.issuer !== "string" ||
    root.issuer.toLowerCase() !== issuer ||
    typeof root.audience !== "string" ||
    root.audience.toLowerCase() !== audience ||
    !UUID_V4_RE.test(root.taskId ?? "") ||
    !allScopesValid(root.scopes) ||
    typeof root.expiresAt !== "number"
  )
    return null;

  // Session binding (strict, fail-closed): a token bound to a session
  // tag is only valid when the verifier presents the SAME tag from its
  // live session. If the verifier demands binding but the token has
  // none (or vice versa), reject.
  const tokenTag =
    typeof root.sessionTag === "string" ? root.sessionTag.toLowerCase() : undefined;
  if (tokenTag !== undefined && !HEX128_RE.test(tokenTag)) return null;
  const wantTag =
    expectedSessionTag !== undefined ? expectedSessionTag.toLowerCase() : undefined;
  if (tokenTag !== wantTag) return null;

  // Expiry with clock-skew tolerance (fail-closed on the far side).
  if (root.expiresAt + TASK_LIMITS.clockSkewMs < nowMs) return null;
  if (root.issuedAt - TASK_LIMITS.clockSkewMs > nowMs) return null;

  // Fold caveats (only narrowing is meaningful; widening is ignored
  // because the root scopes are the ceiling).
  const caveats = wire.chain.slice(1).map((l) => l.payload as TokenCaveat);
  let maxToolCalls = DEFAULT_MAX_TOOL_CALLS;
  let resultSizeLimit = TASK_LIMITS.resultMaxBytes;
  let notBefore = 0;
  for (const c of caveats) {
    if (typeof c.notBefore === "number" && c.notBefore > notBefore)
      notBefore = c.notBefore;
    if (
      typeof c.maxToolCalls === "number" &&
      c.maxToolCalls < maxToolCalls
    )
      maxToolCalls = c.maxToolCalls;
    if (
      typeof c.resultSizeLimit === "number" &&
      c.resultSizeLimit < resultSizeLimit
    )
      resultSizeLimit = c.resultSizeLimit;
  }
  if (notBefore - TASK_LIMITS.clockSkewMs > nowMs) return null;

  return {
    root: {
      ...root,
      issuer: root.issuer.toLowerCase(),
      audience: root.audience.toLowerCase(),
      taskId: root.taskId.toLowerCase(),
      ...(tokenTag !== undefined ? { sessionTag: tokenTag } : {}),
    },
    caveats,
    effective: { maxToolCalls, resultSizeLimit, notBefore },
  };
}

/** Re-export for tests. */
export { TASK_SCOPES_V1 };
