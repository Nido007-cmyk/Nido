/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * packImport.ts — the trust core of the signed-pack importer (Pieza A).
 *
 * The owner decided on 2026-11-07 that the app may only accept knowledge
 * packs signed by us: «Porque si no pueden meter cualquier cosa a la app».
 * A pack offered from a file (e.g. bought at SALVORA PACKS) therefore has to
 * prove, BEFORE a single byte is copied into corpus/, that it is ours and
 * untouched. This module is that proof, kept pure (no expo imports) so the
 * whole decision is unit-testable with real pack bytes.
 *
 * Two proofs of origin exist, one per key the app carries:
 *
 * - SALVORA PACKS: the pack's companion manifest (`<pack>.sqlite.json`)
 *   declares the file's SHA-256 and carries an Ed25519 signature over the
 *   canonical form of the manifest (the store's signer:
 *   sign-salvora-manifest.mjs — JSON of the manifest without the signing
 *   fields, keys sorted). The signature must verify against the SALVORA
 *   public key embedded HERE, and the key the manifest declares for itself
 *   must be that same key: a manifest never gets to choose its own trust
 *   anchor.
 *
 * - NIDO: NIDO's own packs carry no per-file signature; they are attested
 *   the way the app already attests them — their SHA-256 is a pin inside
 *   MODEL_CATALOG, whose signature App.tsx verifies at startup against the
 *   NIDO manifest key (manifestTrust.ts). A file whose hash is exactly a
 *   catalog corpus pin is, byte for byte, a pack NIDO signed into its
 *   catalog. Any other unsigned manifest proves nothing.
 *
 * What a signature does NOT do (PI-5, said plainly): it proves origin and
 * integrity, never quality. The house signs only what it has already
 * verified line by line; no third-party key is on the list, ever, and there
 * is no trust-on-first-use path — a pack signed by anyone else is rejected,
 * not asked about.
 */
import nacl from "tweetnacl";
import { CORPUS_CATALOG } from "./manifest";
import { b64ToBytes } from "./manifestTrust";

/** Ed25519 public key of SALVORA PACKS (32 bytes, base64). PUBLIC — safe to embed. */
export const SALVORA_PACKS_PUBLIC_KEY_BASE64 =
  "HfH4rO39agZVzybigFmWW1PPjqwb9bAFZBHkMqz/sHQ=";

/** Display name of each origin, exactly as the interface names it (A.3). */
export type PackOrigin = "nido" | "salvora";
export const PACK_ORIGIN_LABEL: Record<PackOrigin, string> = {
  nido: "NIDO",
  salvora: "SALVORA PACKS",
};

/**
 * Size cap for a pack offered from a file (PI-2 / RI-2). The largest pack
 * this house has ever shipped is the Wikipedia Vital pack at ~156 MB and
 * the store's packs are ~1 MB; 512 MB leaves more than 3x headroom over
 * anything we sign today while still stopping a multi-GB file from filling
 * the phone on a single tap. The document importer's caps (25/100 MB)
 * are for documents, not packs, so they don't govern here.
 */
export const PACK_IMPORT_MAX_BYTES = 512 * 1024 * 1024;

/** The subset of a pack manifest the door reads. Extra fields are allowed
 *  (they are covered by the signature's canonical form) but never trusted
 *  beyond what verifyPackOrigin checks. */
export interface PackManifest {
  id?: unknown;
  file?: unknown;
  sizeBytes?: unknown;
  sha256?: unknown;
  signedBy?: unknown;
  signingPublicKey?: unknown;
  signature?: unknown;
  signedAt?: unknown;
  [key: string]: unknown;
}

const SHA256_HEX = /^[0-9a-fA-F]{64}$/;

/**
 * Parses a companion manifest. Returns null when the text is not a JSON
 * object with a well-formed sha256 — for the door, an unreadable manifest
 * is the same as a missing one (PI-2, step 1: without a legible manifest
 * the app cannot check any signature).
 */
export function parsePackManifest(text: string): PackManifest | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const m = parsed as PackManifest;
  if (typeof m.sha256 !== "string" || !SHA256_HEX.test(m.sha256)) return null;
  return m;
}

/** Fields the store's signer adds; excluded from its canonical form. */
const SIGN_FIELDS = ["signedBy", "signingPublicKey", "signature", "signedAt"];

/**
 * Canonical form of a SALVORA PACKS manifest, byte-identical to the
 * store's signer (sign-salvora-manifest.mjs): the manifest without the
 * signing fields, top-level keys sorted, JSON.stringify with no
 * whitespace. If this ever drifts from the signer, every real store pack
 * stops verifying — the real-bytes tests pin it.
 */
export function canonicalPackManifestJSON(manifest: PackManifest): string {
  const clean: Record<string, unknown> = {};
  for (const k of Object.keys(manifest).filter((k) => !SIGN_FIELDS.includes(k)).sort()) {
    clean[k] = manifest[k];
  }
  return JSON.stringify(clean);
}

/**
 * True when the manifest carries a SALVORA PACKS signature that verifies
 * against the key embedded in the app. The key is ALWAYS the embedded one;
 * the manifest's declared `signingPublicKey` must equal it too (a manifest
 * naming some other key as its signer is not ours, however it is signed).
 */
export function verifySalvoraManifestSignature(manifest: PackManifest): boolean {
  if (typeof manifest.signature !== "string" || typeof manifest.signingPublicKey !== "string") {
    return false;
  }
  if (manifest.signingPublicKey !== SALVORA_PACKS_PUBLIC_KEY_BASE64) return false;
  let sig: Uint8Array;
  let pub: Uint8Array;
  try {
    sig = b64ToBytes(manifest.signature);
    pub = b64ToBytes(SALVORA_PACKS_PUBLIC_KEY_BASE64);
  } catch {
    return false;
  }
  if (sig.length !== nacl.sign.signatureLength || pub.length !== nacl.sign.publicKeyLength) {
    return false;
  }
  const msg = new TextEncoder().encode(canonicalPackManifestJSON(manifest));
  return nacl.sign.detached.verify(msg, sig, pub);
}

/** True when `sha256` is the pin of a corpus pack in the signed catalog. */
export function isCatalogCorpusPin(sha256: string): boolean {
  return CORPUS_CATALOG.some(
    (m) => m.format === "sqlite-pack" && m.sha256.toLowerCase() === sha256.toLowerCase()
  );
}

export type PackOriginRejection = "hash-mismatch" | "not-signed-by-us";
export type PackOriginResult =
  | { ok: true; origin: PackOrigin }
  | { ok: false; reason: PackOriginRejection };

/**
 * Steps 2 and 3 of PI-2, in the package's order: first the file's hash must
 * be exactly the one the manifest declares (a single changed byte fails
 * here), then the manifest must prove one of our two origins. A manifest
 * that carries signing fields is judged by the signature alone — NIDO's
 * real manifests carry none, so the catalog pin is their only path, and a
 * third party cannot borrow it by stapling a catalog hash onto a manifest
 * for different bytes (step 2 already bound the hash to THIS file).
 */
export function verifyPackOrigin(manifest: PackManifest, fileSha256: string): PackOriginResult {
  const declared = typeof manifest.sha256 === "string" ? manifest.sha256 : "";
  if (!SHA256_HEX.test(declared) || declared.toLowerCase() !== fileSha256.toLowerCase()) {
    return { ok: false, reason: "hash-mismatch" };
  }
  if (typeof manifest.signature === "string" || typeof manifest.signingPublicKey === "string") {
    return verifySalvoraManifestSignature(manifest)
      ? { ok: true, origin: "salvora" }
      : { ok: false, reason: "not-signed-by-us" };
  }
  return isCatalogCorpusPin(declared)
    ? { ok: true, origin: "nido" }
    : { ok: false, reason: "not-signed-by-us" };
}

export interface PackMetaSummary {
  format: string;
  formatVersion: number;
  /** meta.embeddingModelSha256; "" when the pack declares none. */
  embeddingModelSha256: string;
  /** meta.name: the pack's own display name, when it declares one. */
  name: string | null;
}

/**
 * Step 4 of PI-2: the same format acceptance openPack applies when it
 * opens a pack in corpus/ (src/rag/packs.ts) — meta table present, format
 * "nido-knowledge-pack" (or the legacy "boar-knowledge-pack"), and the
 * declared embedding model read for the caller. Anything else is not a
 * knowledge pack, whatever its signature says.
 */
export function summarizePackMeta(meta: Record<string, string>): PackMetaSummary | null {
  const format = meta.format;
  if (format !== "nido-knowledge-pack" && format !== "boar-knowledge-pack") return null;
  const name = typeof meta.name === "string" && meta.name.trim().length > 0 ? meta.name : null;
  return {
    format,
    formatVersion: Number(meta.formatVersion) > 0 ? Number(meta.formatVersion) : 1,
    embeddingModelSha256: String(meta.embeddingModelSha256 ?? ""),
    name,
  };
}
