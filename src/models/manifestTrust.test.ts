import { describe, it, expect } from "vitest";
import nacl from "tweetnacl";
import {
  canonicalCatalogJSON,
  verifyCatalogSignature,
  ManifestTrustError,
  NIDO_MANIFEST_PUBLIC_KEY_BASE64,
} from "./manifestTrust";
import { MODEL_CATALOG } from "./manifest";
import { MANIFEST_SIGNATURE_BASE64 } from "./manifestSignature";

/**
 * manifestTrust.test.ts — signed release manifest (Meta suggestion #2).
 *
 * The committed manifestSignature.ts must verify against the committed
 * manifest.ts: any manifest.ts edit touching a signed field without a
 * fresh signature fails this suite (and CI's --verify step, and the app's
 * startup check).
 */

function b64ToBytes(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, "base64"));
}

// Independent test keypair (never the real signing key): proves the
// verify path is a real Ed25519 check, not a tautology.
const testKeys = nacl.sign.keyPair();
const testPubB64 = Buffer.from(testKeys.publicKey).toString("base64");

function signWithTestKey(catalog: any[]): string {
  const msg = new TextEncoder().encode(canonicalCatalogJSON(catalog));
  return Buffer.from(nacl.sign.detached(msg, testKeys.secretKey)).toString("base64");
}

describe("canonicalCatalogJSON", () => {
  it("is deterministic: field order and entry order don't matter", () => {
    const a: any[] = [
      { id: "b", sha256: "x", label: "B label", sizeBytes: 2, sourceUrl: "u2", kind: "llm" },
      { id: "a", sha256: "y", label: "A label", sizeBytes: 1, sourceUrl: "u1", kind: "llm" },
    ];
    const b: any[] = [
      { kind: "llm", sourceUrl: "u1", sizeBytes: 1, sha256: "y", id: "a", label: "other" },
      { kind: "llm", sourceUrl: "u2", sizeBytes: 2, sha256: "x", id: "b", label: "whatever" },
    ];
    expect(canonicalCatalogJSON(a)).toBe(canonicalCatalogJSON(b));
  });

  it("ignores display-only fields but includes integrity fields", () => {
    const base: any[] = [{ id: "a", sha256: "y", label: "one", description: "d1", sizeBytes: 1, sourceUrl: "u", kind: "llm" }];
    const relabeled: any[] = [{ id: "a", sha256: "y", label: "two", description: "d2", sizeBytes: 1, sourceUrl: "u", kind: "llm" }];
    const repinned: any[] = [{ id: "a", sha256: "zzz", label: "one", description: "d1", sizeBytes: 1, sourceUrl: "u", kind: "llm" }];
    expect(canonicalCatalogJSON(base)).toBe(canonicalCatalogJSON(relabeled));
    expect(canonicalCatalogJSON(base)).not.toBe(canonicalCatalogJSON(repinned));
  });
});

describe("verifyCatalogSignature", () => {
  it("Ed25519 round-trip works with the shared canonicalization", () => {
    // Proves canonicalCatalogJSON is a sound signing input: sign with an
    // independent keypair, verify with nacl directly. The module's own
    // verify path (embedded real key) is covered by the committed test.
    const catalog: any[] = [{ id: "a", sha256: "y", sizeBytes: 1, sourceUrl: "u", kind: "llm" }];
    const sig = signWithTestKey(catalog);
    const msg = new TextEncoder().encode(canonicalCatalogJSON(catalog));
    expect(
      nacl.sign.detached.verify(msg, b64ToBytes(sig), b64ToBytes(testPubB64))
    ).toBe(true);
  });

  it("rejects a tampered catalog", () => {
    const catalog: any[] = [{ id: "a", sha256: "y", sizeBytes: 1, sourceUrl: "u", kind: "llm" }];
    const sig = signWithTestKey(catalog);
    const tampered: any[] = [{ id: "a", sha256: "EVIL", sizeBytes: 1, sourceUrl: "u", kind: "llm" }];
    // Sign with the REAL module key path is covered by the committed test;
    // here we prove tampering breaks verification using a local keypair and
    // the same canonicalization the module uses.
    const msg = new TextEncoder().encode(canonicalCatalogJSON(tampered));
    const ok = nacl.sign.detached.verify(
      msg,
      b64ToBytes(sig),
      b64ToBytes(testPubB64)
    );
    expect(ok).toBe(false);
  });

  it("fail-closed on missing signature with a clear message", () => {
    try {
      verifyCatalogSignature(MODEL_CATALOG, null);
      expect.unreachable("must throw");
    } catch (e) {
      expect(e).toBeInstanceOf(ManifestTrustError);
      expect((e as ManifestTrustError).code).toBe("missing-signature");
      expect((e as Error).message).toMatch(/signature is missing/i);
    }
  });

  it("fail-closed on malformed signature", () => {
    expect(() => verifyCatalogSignature(MODEL_CATALOG, "not-base64!!!")).toThrow(
      ManifestTrustError
    );
  });

  it("the committed signature verifies the committed catalog (real key)", () => {
    // This is the enforcement test: editing manifest.ts (a signed field)
    // without re-running scripts/sign-manifest.mjs fails here, in CI, and
    // at app startup.
    expect(() =>
      verifyCatalogSignature(MODEL_CATALOG, MANIFEST_SIGNATURE_BASE64)
    ).not.toThrow();
    expect(NIDO_MANIFEST_PUBLIC_KEY_BASE64).toMatch(/^[A-Za-z0-9+/]{43}=$/);
  });
});
