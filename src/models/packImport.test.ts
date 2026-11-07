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
 * blocks run only when those zips are present (they are not part of the
 * repo — packs are never committed); everywhere else the pure-helper
 * tests still run and the acceptance cases skip visibly instead of
 * passing silently.
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
const SALVORA_ZIP = join(PACKS_DIR, "salvora-emergencias-casa-edicion-2026-11.zip");
const ESENCIAL_ZIP = join(PACKS_DIR, "salvora-esencial-edicion-2026-11.zip");
const REAL_ZIPS_PRESENT = existsSync(SALVORA_ZIP) && existsSync(ESENCIAL_ZIP);

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
    expect(isCatalogCorpusPin("977dcab59844343c573c13c921ca4b6647ccc9c36a19e009fcf7b527a2f5a24e")).toBe(true);
    expect(isCatalogCorpusPin("3d40f766eb4fa99e3a2bc3acbb0c6f490f377f3168f0f84d7d03c21f30b31f19")).toBe(true);
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
});

describe.runIf(REAL_ZIPS_PRESENT)("packImport · real store bytes", () => {
  const salvora = zipEntries(SALVORA_ZIP);
  const esencial = zipEntries(ESENCIAL_ZIP);

  const cases: Array<{ zip: Map<string, Buffer>; sqlite: string; origin: "nido" | "salvora" }> = [
    { zip: salvora, sqlite: "salvora-emergencias-casa.sqlite", origin: "salvora" },
    { zip: salvora, sqlite: "salvora-emergencias-casa-e5.sqlite", origin: "salvora" },
    { zip: esencial, sqlite: "nido-esencial.sqlite", origin: "nido" },
    { zip: esencial, sqlite: "nido-esencial-e5.sqlite", origin: "nido" },
  ];

  for (const c of cases) {
    it(`accepts ${c.sqlite} with origin ${c.origin}`, () => {
      const bytes = c.zip.get(c.sqlite);
      const manifestText = c.zip.get(`${c.sqlite}.json`)?.toString("utf8");
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
    const bytes = Buffer.from(salvora.get("salvora-emergencias-casa.sqlite")!);
    const manifest = parsePackManifest(salvora.get("salvora-emergencias-casa.sqlite.json")!.toString("utf8"))!;
    bytes[Math.floor(bytes.length / 2)] ^= 0xff;
    expect(verifyPackOrigin(manifest, sha256Hex(bytes))).toEqual({
      ok: false,
      reason: "hash-mismatch",
    });
  });

  it("rejects a truncated copy of the SALVORA pack (hash-mismatch)", () => {
    const bytes = salvora.get("salvora-emergencias-casa.sqlite")!.subarray(0, 100_000);
    const manifest = parsePackManifest(salvora.get("salvora-emergencias-casa.sqlite.json")!.toString("utf8"))!;
    expect(verifyPackOrigin(manifest, sha256Hex(bytes))).toEqual({
      ok: false,
      reason: "hash-mismatch",
    });
  });

  it("rejects the SALVORA manifest re-signed with a foreign key (not-signed-by-us)", () => {
    const bytes = salvora.get("salvora-emergencias-casa.sqlite")!;
    const manifest = parsePackManifest(salvora.get("salvora-emergencias-casa.sqlite.json")!.toString("utf8"))!;
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
    const manifest = parsePackManifest(esencial.get("nido-esencial.sqlite.json")!.toString("utf8"))!;
    const bytes = salvora.get("salvora-emergencias-casa.sqlite")!;
    expect(verifyPackOrigin(manifest, sha256Hex(bytes))).toEqual({
      ok: false,
      reason: "hash-mismatch",
    });
  });
});
