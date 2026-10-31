/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * manifestTrust.ts — signed release manifest (Meta suggestion #2: update integrity).
 *
 * Threat model (honest): the SHA-256 pins in manifest.ts are baked into the
 * APK, so they're already as trustworthy as the APK signature itself. What
 * signing the manifest adds is *maintainer attestation as an independent
 * artifact*: the signature proves the exact signed catalog fields (ids,
 * kinds, filenames, URLs, revisions, pins, sizes, licenses, routing
 * capabilities, architecture profiles, default context lengths and
 * bundled flags) were reviewed and signed by the holder of the NIDO
 * manifest signing key. A PR or compromised step that edits any of
 * those fields in manifest.ts without re-signing fails CI and fails
 * closed at app startup. Only the two display texts (label,
 * description) sit outside the signature, deliberately, and tests pin
 * that boundary field by field.
 *
 * Design:
 * - Ed25519. Private key lives ONLY in ~/workspace/user/keystores/
 *   (nido-manifest-sign.key, mode 600) — never in the repo, never in CI.
 * - `scripts/sign-manifest.mjs` canonicalizes the catalog and writes the
 *   detached signature to `src/models/manifestSignature.ts` (committed).
 * - The app verifies at startup (App.tsx → assertCatalogTrusted()): the
 *   in-memory catalog must verify against the embedded public key.
 * - Fail-closed: invalid/missing signature → ManifestTrustError with a
 *   clear message surfaced on the startup-error screen. Never a silent
 *   crash, never "trust anyway".
 *
 * Pure module: tweetnacl is pure JS (no native modules), so this is fully
 * unit-testable.
 */
import nacl from "tweetnacl";
import type { CatalogModel } from "./manifest";

/** Ed25519 public key (32 bytes, base64). PUBLIC — safe to embed. */
export const NIDO_MANIFEST_PUBLIC_KEY_BASE64 =
  "C13ur7mfREYSjJKOE0RS5YISBVtupxxaHpmomeBa+Co=";

/** Fields the signature covers. Until the full audit of 2026-10-31
 *  (F5-01) this list stopped at the download integrity fields and
 *  the comment here implied only label and description sat outside;
 *  in fact license, capabilities, arch, defaultNCtx and bundled
 *  were outside too, and they are not display text: license is the
 *  legal attribution the app shows, capabilities decide which
 *  model serves each routing role and which prompt template runs,
 *  arch feeds the RAM pre-flight. By the owner's order of
 *  2026-10-31 the signed surface now covers every field with a
 *  behavioral or legal effect. The only fields outside are label
 *  and description, the two display texts: rewording them must not
 *  invalidate the signature, and changing anything else must. */
const SIGNED_FIELDS = [
  "id",
  "kind",
  "filename",
  "sizeBytes",
  "sha256",
  "sourceUrl",
  "revision",
  "format",
  "required",
  "license",
  "capabilities",
  "arch",
  "defaultNCtx",
  "bundled",
] as const;

/**
 * Deterministic canonicalization of the catalog. Entries sorted by id,
 * keys sorted, no whitespace. The sign script and the app MUST produce
 * byte-identical output — this function is the single shared
 * implementation (the script transpiles and imports it; no drift).
 */
export function canonicalCatalogJSON(catalog: CatalogModel[]): string {
  const entries = catalog.map((a) => {
    const obj: Record<string, unknown> = {};
    for (const k of SIGNED_FIELDS) {
      const v = (a as unknown as Record<string, unknown>)[k];
      if (v !== undefined) obj[k] = v;
    }
    return obj;
  });
  // Auditoría completa 2026-10-31 (F5-06): el orden entre entradas
  // lo decide una comparación por puntos de código, no localeCompare.
  // localeCompare depende de la configuración regional del motor
  // (Node con ICU frente a Hermes en el teléfono): con un id futuro
  // que hiciera diverger el orden, la app rechazaría un catálogo
  // bien firmado. Con los ids actuales ambas dan el mismo orden y
  // la forma canónica no cambia ni un byte (la firma comiteada
  // sigue verificando sin re-firmar).
  entries.sort((x, y) => {
    const a = String(x.id);
    const b = String(y.id);
    return a < b ? -1 : a > b ? 1 : 0;
  });
  return JSON.stringify(entries);
}

export type ManifestTrustCode =
  | "missing-signature"
  | "invalid-signature"
  | "tampered-catalog";

export class ManifestTrustError extends Error {
  readonly code: ManifestTrustCode;
  constructor(code: ManifestTrustCode, detail?: string) {
    super(
      code === "missing-signature"
        ? "NIDO manifest signature is missing — refusing to trust the download catalog"
        : code === "invalid-signature"
          ? "NIDO manifest signature is INVALID — the catalog may have been tampered with"
          : "NIDO manifest catalog does not match its signature — refusing to trust download URLs/pins" +
            (detail ? `: ${detail}` : "")
    );
    this.name = "ManifestTrustError";
    this.code = code;
  }
}

function b64ToBytes(b64: string): Uint8Array {
  // Works in both Node (tests/scripts) and React Native (Hermes has Buffer
  // via the RN polyfill used elsewhere in the app; fall back to manual).
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(b64, "base64"));
  }
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Verifies that `catalog` is exactly what the manifest signing key signed.
 * Throws ManifestTrustError (fail-closed) on any problem. Pure and
 * synchronous — safe to call at startup before any network I/O.
 */
export function verifyCatalogSignature(
  catalog: CatalogModel[],
  signatureBase64: string | null | undefined
): void {
  if (!signatureBase64) {
    throw new ManifestTrustError("missing-signature");
  }
  let sig: Uint8Array;
  let pub: Uint8Array;
  try {
    sig = b64ToBytes(signatureBase64);
    pub = b64ToBytes(NIDO_MANIFEST_PUBLIC_KEY_BASE64);
  } catch {
    throw new ManifestTrustError("invalid-signature");
  }
  if (sig.length !== nacl.sign.signatureLength || pub.length !== nacl.sign.publicKeyLength) {
    throw new ManifestTrustError("invalid-signature");
  }
  const msg = new TextEncoder().encode(canonicalCatalogJSON(catalog));
  const ok = nacl.sign.detached.verify(msg, sig, pub);
  if (!ok) {
    throw new ManifestTrustError("tampered-catalog");
  }
}
