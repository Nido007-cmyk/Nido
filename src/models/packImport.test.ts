/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * packImport.test.ts — the signed-pack door's trust core, proven against
 * REAL pack bytes: the store's SALVORA pack 1 (both editions, signed with
 * the SALVORA key) and NIDO's Esencial (both editions, attested by the
 * signed catalog pin), read from the store zips in the workspace. The
 * pack-1 zip resolves from the SALVORA_PACK1_ZIP environment variable
 * when set, else from the house default path below. The real-bytes
 * blocks run only when those zips are present (they are not part of the
 * repo — packs are never committed); everywhere else the pure-helper
 * tests still run — including synthetic-signature acceptance against a
 * fixture key generated in memory — and the real-bytes cases skip
 * visibly instead of passing silently.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { DatabaseSync } from "node:sqlite";
import nacl from "tweetnacl";
import { describe, expect, it } from "vitest";
import {
  canonicalPackManifestJSON,
  isCatalogCorpusPin,
  parsePackManifest,
  summarizePackMeta,
  verifyPackOrigin,
  verifySalvoraManifestSignature,
  type PackManifest,
} from "./packImport";

const PACKS_DIR = join(homedir(), "workspace/your_files/salvora-packs");
const SALVORA_ZIP =
  process.env.SALVORA_PACK1_ZIP ?? join(PACKS_DIR, "salvora-emergencias-casa-edicion-2026-11.zip");
const ESENCIAL_ZIP = join(PACKS_DIR, "salvora-esencial-edicion-2026-11.zip");
const REAL_ZIPS_PRESENT = existsSync(SALVORA_ZIP) && existsSync(ESENCIAL_ZIP);
if (!REAL_ZIPS_PRESENT) {
  // Declared skip, never a failure: the real-bytes suites below are
  // skipped by describe.runIf and this line is the visible notice.
  console.warn(
    `[packImport.test] real store zips NOT found (pack 1: ${SALVORA_ZIP}; esencial: ${ESENCIAL_ZIP})` +
      " — real-bytes cases SKIPPED. Set SALVORA_PACK1_ZIP to the pack-1 zip to run them."
  );
}

/** Minimal read-only ZIP reader (stored + deflate entries) for fixtures. */
function zipEntries(zipPath: string): Map<string, Buffer> {
  const buf = readFileSync(zipPath);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65536); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error(`no end-of-central-directory in ${zipPath}`);
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, Buffer>();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error("bad central directory");
    const method = buf.readUInt16LE(off + 10);
    const csize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.toString("utf8", off + 46, off + 46 + nameLen);
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(dataStart, dataStart + csize);
    out.set(name, method === 8 ? inflateRawSync(raw) : Buffer.from(raw));
    off += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function readMeta(sqliteBytes: Buffer): Record<string, string> {
  const tmp = join(PACKS_DIR, `.packimport-test-${process.pid}.sqlite`);
  const { writeFileSync, unlinkSync } = require("node:fs") as typeof import("node:fs");
  writeFileSync(tmp, sqliteBytes);
  try {
    const db = new DatabaseSync(tmp, { readOnly: true });
    const rows = db.prepare("SELECT key, value FROM meta").all() as Array<{
      key: string;
      value: string;
    }>;
    db.close();
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  } finally {
    unlinkSync(tmp);
  }
}

describe("packImport · pure helpers (always run)", () => {
  it("parsePackManifest rejects non-JSON, non-objects and bad hashes", () => {
    expect(parsePackManifest("not json")).toBeNull();
    expect(parsePackManifest("[1,2]")).toBeNull();
    expect(parsePackManifest("{}")).toBeNull();
    expect(parsePackManifest('{"sha256":"xyz"}')).toBeNull();
    expect(parsePackManifest('{"sha256":"' + "a".repeat(64) + '"}')).not.toBeNull();
  });

  it("canonical form drops the signing fields and sorts the rest", () => {
    const m = {
      b: 2,
      a: 1,
      signedBy: "X",
      signingPublicKey: "Y",
      signature: "Z",
      signedAt: "T",
    } as PackManifest;
    expect(canonicalPackManifestJSON(m)).toBe('{"a":1,"b":2}');
  });

  it("the Esencial's real hash is a signed-catalog corpus pin; a random one is not", () => {
    expect(isCatalogCorpusPin("e44bc41d732d70165d555443006490d93fb0593b8b2990e5be82e4c37abd24ad")).toBe(true);
    expect(isCatalogCorpusPin("8ff39bd09059fa8321664eba2461091071c00e2fce45395d89e90c18af6b30ea")).toBe(true);
    expect(isCatalogCorpusPin("0".repeat(64))).toBe(false);
  });

  it("summarizePackMeta accepts only the pack formats openPack accepts", () => {
    expect(summarizePackMeta({})).toBeNull();
    expect(summarizePackMeta({ format: "something-else" })).toBeNull();
    const ok = summarizePackMeta({
      format: "nido-knowledge-pack",
      formatVersion: "2",
      embeddingModelSha256: "ec38",
      name: "Pack",
    });
    expect(ok).toMatchObject({ formatVersion: 2, embeddingModelSha256: "ec38", name: "Pack" });
    expect(summarizePackMeta({ format: "boar-knowledge-pack" })).not.toBeNull();
  });

  it("a manifest signed by a foreign key never verifies, in either disguise", () => {
    const foreign = nacl.sign.keyPair();
    const foreignB64 = Buffer.from(foreign.publicKey).toString("base64");
    const base: PackManifest = { id: "fake", sha256: "a".repeat(64), sizeBytes: 3 };
    const signWith = (kp: nacl.SignKeyPair, declaredKey: string): PackManifest => {
      const m: PackManifest = { ...base, signedBy: "SALVORA PACKS", signingPublicKey: declaredKey, signedAt: "2026-11-07T00:00:00.000Z" };
      const sig = nacl.sign.detached(new TextEncoder().encode(canonicalPackManifestJSON(m)), kp.secretKey);
      return { ...m, signature: Buffer.from(sig).toString("base64") };
    };
    // Disguise 1: declares its own key honestly — still not ours.
    expect(verifySalvoraManifestSignature(signWith(foreign, foreignB64))).toBe(false);
    // Disguise 2: declares OUR key but was signed by the foreign one.
    expect(
      verifySalvoraManifestSignature(
        signWith(foreign, "HfH4rO39agZVzybigFmWW1PPjqwb9bAFZBHkMqz/sHQ=")
      )
    ).toBe(false);
    // And at the door: right hash, foreign signature → not-signed-by-us.
    expect(verifyPackOrigin(signWith(foreign, foreignB64), "a".repeat(64))).toEqual({
      ok: false,
      reason: "not-signed-by-us",
    });
  });

  it("an unsigned manifest for bytes that are not a catalog pin is not ours", () => {
    const m: PackManifest = { id: "third-party", sha256: "b".repeat(64) };
    expect(verifyPackOrigin(m, "b".repeat(64))).toEqual({ ok: false, reason: "not-signed-by-us" });
    expect(verifyPackOrigin(m, "c".repeat(64))).toEqual({ ok: false, reason: "hash-mismatch" });
  });

  it("a manifest signed by a fixture key verifies when that key is injected (synthetic pack)", () => {
    // Acceptance coverage that runs everywhere, without the store zips:
    // a minimal manifest over synthetic bytes, signed in this test with
    // an Ed25519 pair generated in memory, accepted only through the
    // injected-key seam of the pure core.
    const fixture = nacl.sign.keyPair();
    const fixtureB64 = Buffer.from(fixture.publicKey).toString("base64");
    const bytes = Buffer.from("synthetic pack bytes for the door's trust core");
    const hash = sha256Hex(bytes);
    const unsigned: PackManifest = {
      id: "synthetic-fixture",
      sha256: hash,
      sizeBytes: bytes.length,
      signedBy: "FIXTURE",
      signingPublicKey: fixtureB64,
      signedAt: "2026-11-07T00:00:00.000Z",
    };
    const sig = nacl.sign.detached(
      new TextEncoder().encode(canonicalPackManifestJSON(unsigned)),
      fixture.secretKey
    );
    const signed: PackManifest = { ...unsigned, signature: Buffer.from(sig).toString("base64") };

    expect(verifySalvoraManifestSignature(signed, fixtureB64)).toBe(true);
    expect(verifyPackOrigin(signed, hash, fixtureB64)).toEqual({ ok: true, origin: "salvora" });
    // The very same manifest does NOT pass against the embedded
    // production key (no injection): the seam changes nothing in
    // production, it only lets tests name their own trust anchor.
    expect(verifySalvoraManifestSignature(signed)).toBe(false);
    expect(verifyPackOrigin(signed, hash)).toEqual({ ok: false, reason: "not-signed-by-us" });
    // And step 2 still binds first: a wrong file hash fails before the
    // signature is even judged, injected key or not.
    expect(verifyPackOrigin(signed, "0".repeat(64), fixtureB64)).toEqual({
      ok: false,
      reason: "hash-mismatch",
    });
  });

  it("with a fixture key injected, a signature made by a different key still fails", () => {
    const declared = nacl.sign.keyPair();
    const declaredB64 = Buffer.from(declared.publicKey).toString("base64");
    const signer = nacl.sign.keyPair();
    const m: PackManifest = {
      id: "synthetic-mismatch",
      sha256: "d".repeat(64),
      signedBy: "FIXTURE",
      signingPublicKey: declaredB64,
      signedAt: "2026-11-07T00:00:00.000Z",
    };
    const sig = nacl.sign.detached(
      new TextEncoder().encode(canonicalPackManifestJSON(m)),
      signer.secretKey
    );
    const forged: PackManifest = { ...m, signature: Buffer.from(sig).toString("base64") };
    expect(verifySalvoraManifestSignature(forged, declaredB64)).toBe(false);
    expect(verifyPackOrigin(forged, "d".repeat(64), declaredB64)).toEqual({
      ok: false,
      reason: "not-signed-by-us",
    });
  });
});

describe.runIf(REAL_ZIPS_PRESENT)("packImport · real store bytes", () => {
  // The zips load lazily, on first use inside a test — never in this
  // suite body. Vitest executes the body at collection time even when
  // runIf skips the suite, and reading the files here is what failed CI
  // with ENOENT on machines without the store fixtures.
  let salvoraCache: Map<string, Buffer> | undefined;
  let esencialCache: Map<string, Buffer> | undefined;
  const salvora = () => (salvoraCache ??= zipEntries(SALVORA_ZIP));
  const esencial = () => (esencialCache ??= zipEntries(ESENCIAL_ZIP));

  const cases: Array<{
    zip: () => Map<string, Buffer>;
    sqlite: string;
    origin: "nido" | "salvora";
  }> = [
    { zip: salvora, sqlite: "salvora-emergencias-casa.sqlite", origin: "salvora" },
    { zip: salvora, sqlite: "salvora-emergencias-casa-e5.sqlite", origin: "salvora" },
    { zip: esencial, sqlite: "nido-esencial.sqlite", origin: "nido" },
    { zip: esencial, sqlite: "nido-esencial-e5.sqlite", origin: "nido" },
  ];

  for (const c of cases) {
    it(`accepts ${c.sqlite} with origin ${c.origin}`, () => {
      const bytes = c.zip().get(c.sqlite);
      const manifestText = c.zip().get(`${c.sqlite}.json`)?.toString("utf8");
      expect(bytes).toBeDefined();
      expect(manifestText).toBeDefined();
      const manifest = parsePackManifest(manifestText!);
      expect(manifest).not.toBeNull();
      expect(verifyPackOrigin(manifest!, sha256Hex(bytes!))).toEqual({ ok: true, origin: c.origin });
      const meta = summarizePackMeta(readMeta(bytes!));
      expect(meta).not.toBeNull();
      expect(meta!.format).toBe("nido-knowledge-pack");
      expect(meta!.name).toBeTruthy();
    });
  }

  it("rejects the SALVORA pack with a single changed byte (hash-mismatch)", () => {
    const bytes = Buffer.from(salvora().get("salvora-emergencias-casa.sqlite")!);
    const manifest = parsePackManifest(salvora().get("salvora-emergencias-casa.sqlite.json")!.toString("utf8"))!;
    bytes[Math.floor(bytes.length / 2)] ^= 0xff;
    expect(verifyPackOrigin(manifest, sha256Hex(bytes))).toEqual({
      ok: false,
      reason: "hash-mismatch",
    });
  });

  it("rejects a truncated copy of the SALVORA pack (hash-mismatch)", () => {
    const bytes = salvora().get("salvora-emergencias-casa.sqlite")!.subarray(0, 100_000);
    const manifest = parsePackManifest(salvora().get("salvora-emergencias-casa.sqlite.json")!.toString("utf8"))!;
    expect(verifyPackOrigin(manifest, sha256Hex(bytes))).toEqual({
      ok: false,
      reason: "hash-mismatch",
    });
  });

  it("rejects the SALVORA manifest re-signed with a foreign key (not-signed-by-us)", () => {
    const bytes = salvora().get("salvora-emergencias-casa.sqlite")!;
    const manifest = parsePackManifest(salvora().get("salvora-emergencias-casa.sqlite.json")!.toString("utf8"))!;
    const foreign = nacl.sign.keyPair();
    const forged: PackManifest = {
      ...manifest,
      signingPublicKey: Buffer.from(foreign.publicKey).toString("base64"),
    };
    const sig = nacl.sign.detached(
      new TextEncoder().encode(canonicalPackManifestJSON(forged)),
      foreign.secretKey
    );
    forged.signature = Buffer.from(sig).toString("base64");
    expect(verifyPackOrigin(forged, sha256Hex(bytes))).toEqual({
      ok: false,
      reason: "not-signed-by-us",
    });
  });

  it("rejects a manifest whose declared hash belongs to a different real file", () => {
    // The Esencial's manifest stapled onto the SALVORA pack's bytes.
    const manifest = parsePackManifest(esencial().get("nido-esencial.sqlite.json")!.toString("utf8"))!;
    const bytes = salvora().get("salvora-emergencias-casa.sqlite")!;
    expect(verifyPackOrigin(manifest, sha256Hex(bytes))).toEqual({
      ok: false,
      reason: "hash-mismatch",
    });
  });
});
