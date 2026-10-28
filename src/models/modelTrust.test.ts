/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * modelTrust.test.ts — integrity trust gate (NIDO INTEGRITY + RESIDUE lane).
 *
 * Proves the lane's core invariant:
 *
 *   NIDO MUST NEVER TRUST A MODEL BECAUSE A FILE SIMPLY EXISTS AT THE
 *   EXPECTED PATH.
 *
 * Covered here:
 *  1. bundled asset with correct SHA → accepted (installed + journaled)
 *  2. bundled asset with incorrect SHA → rejected (deleted, never installed)
 *  3. truncated bundled asset → rejected (deleted, never installed)
 *  4. trusted installed model survives legitimate restart (fast path: no re-hash)
 *  5. same-size tampered model cannot become trusted (mtime change → re-verify → fail)
 *  6. missing/corrupt integrity state cannot silently produce trusted status
 *  7. verifyChecksum fails closed when no SHA-256 is declared (no weaker path)
 *  8. unknown (non-catalog) filenames can never reach inference
 *
 * The catalog-wide "every production asset declares a 64-hex SHA-256"
 * invariant lives in manifest.test.ts ("every catalog entry has a
 * non-empty checksum, size, and source URL").
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ram-monitor is a native module: stub it so suites that reach the models
// layer transitively (via ModelManager -> defaultModel -> ramBudget) don't
// pull react-native's Flow sources into vitest. Same pattern as
// src/inference/LlamaEngine.test.ts.
vi.mock("ram-monitor", () => ({
  getDeviceTotalRamBytes: () => 8 * 1024 ** 3,
  getMemoryInfo: () => ({ rssBytes: 0 }),
}));
import { createHash } from "crypto";

// ---------------------------------------------------------------------------
// Mock filesystem. All vi.mock factories are hoisted, so the shared state
// lives in vi.hoisted() and the factories only touch that state.
// ---------------------------------------------------------------------------

const hoisted = vi.hoisted(() => {
  const td = new TextDecoder();
  const te = new TextEncoder();
  const DOCS = "file:///docs/";
  const JOURNAL = `${DOCS}nido-install-state.json`;
  interface MockFile {
    bytes: Uint8Array;
    mtimeSec: number;
  }
  const files = new Map<string, MockFile>();
  const base64Reads: string[] = []; // model-path chunk reads (i.e. hashing happened)
  let apkBytes: Uint8Array = new Uint8Array(0);
  let apkMtimeSec = 2000;
  const writeFile = (path: string, bytes: Uint8Array, mtimeSec = 1000): void => {
    files.set(path, { bytes: bytes.slice(), mtimeSec });
  };
  return {
    td,
    te,
    DOCS,
    JOURNAL,
    files,
    base64Reads,
    writeFile,
    fileExists: (path: string) => files.has(path),
    setMtime: (path: string, mtimeSec: number) => {
      const f = files.get(path);
      if (f) f.mtimeSec = mtimeSec;
    },
    setApkBytes: (b: Uint8Array) => {
      apkBytes = b;
    },
    getApkBytes: () => apkBytes,
    setApkMtimeSec: (s: number) => {
      apkMtimeSec = s;
    },
    getApkMtimeSec: () => apkMtimeSec,
  };
});

vi.mock("expo-file-system/legacy", () => ({
  default: undefined,
  documentDirectory: hoisted.DOCS,
  EncodingType: { Base64: "base64", UTF8: "utf8" },
  getInfoAsync: async (path: string) => {
    const f = hoisted.files.get(path);
    if (!f) return { exists: false, isDirectory: false, uri: path };
    return {
      exists: true,
      isDirectory: false,
      uri: path,
      size: f.bytes.length,
      modificationTime: f.mtimeSec,
    };
  },
  readAsStringAsync: async (
    path: string,
    opts?: { encoding?: string; position?: number; length?: number }
  ) => {
    const f = hoisted.files.get(path);
    if (!f) throw new Error(`mock FS: no such file ${path}`);
    if (opts?.encoding === "base64") {
      hoisted.base64Reads.push(path);
      const pos = opts?.position ?? 0;
      const len = opts?.length ?? f.bytes.length - pos;
      return Buffer.from(f.bytes.subarray(pos, pos + len)).toString("base64");
    }
    return hoisted.td.decode(f.bytes);
  },
  writeAsStringAsync: async (path: string, data: string) => {
    hoisted.writeFile(path, hoisted.te.encode(data), 1000);
  },
  moveAsync: async ({ from, to }: { from: string; to: string }) => {
    const f = hoisted.files.get(from);
    if (!f) throw new Error(`mock FS: cannot move missing ${from}`);
    hoisted.files.set(to, f);
    hoisted.files.delete(from);
  },
  deleteAsync: async (path: string) => {
    hoisted.files.delete(path);
  },
}));

// Bundled-assets native module: "copies" the APK asset into the mock FS.
vi.mock("bundled-assets", () => ({
  copyBundledAssetToFile: async (_subPath: string, destPath: string) => {
    hoisted.writeFile(destPath, hoisted.getApkBytes(), hoisted.getApkMtimeSec());
    return hoisted.getApkBytes().length;
  },
}));

vi.mock("./storageBudget", () => ({ checkStorageForDownload: async () => ({ ok: true }) }));
vi.mock("../privacy/networkAudit", () => ({
  networkAudit: { log: () => {} },
  sanitizeEndpoint: (u: string) => u,
}));

import { ModelManager } from "./ModelManager";
import {
  assertTrustedModelFile,
  assertTrustedModelFileByName,
  checkModelTrust,
  ModelNotTrustedError,
  resetInstallReconcileForTests,
  trustedAssetForFilename,
} from "./modelTrust";
import { MODEL_CATALOG } from "./manifest";

const sha256Of = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

// Small deterministic "model": 4 KiB. The streaming-hash logic itself is
// covered by verifyChecksum.test.ts; here we prove the trust decisions.
const GOOD_BYTES = new Uint8Array(4096);
for (let i = 0; i < GOOD_BYTES.length; i++) GOOD_BYTES[i] = (i * 7 + 3) & 0xff;
const GOOD_SHA = sha256Of(GOOD_BYTES);

const asset = {
  id: "trust-test-model",
  kind: "llm" as const,
  label: "Trust test model",
  filename: "models/trust-test.gguf",
  sizeBytes: GOOD_BYTES.length,
  sha256: GOOD_SHA,
  sourceUrl: "https://example.invalid/trust-test.gguf",
  license: "test",
  description: "test fixture",
  required: false,
};

const modelPath = `${hoisted.DOCS}${asset.filename}`;

function makeManager(): ModelManager {
  resetInstallReconcileForTests();
  return new ModelManager([asset]);
}

beforeEach(() => {
  hoisted.files.clear();
  hoisted.base64Reads.length = 0;
  hoisted.setApkBytes(GOOD_BYTES.slice());
  hoisted.setApkMtimeSec(2000);
  resetInstallReconcileForTests();
  vi.spyOn(console, "debug").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("installBundled integrity (same SHA-256 guarantee as downloads)", () => {
  it("1. bundled asset with correct SHA → accepted and journaled as installed", async () => {
    const mgr = makeManager();
    await mgr.installBundled(asset);

    const status = await mgr.statusOf(asset);
    expect(status.present).toBe(true);
    expect(status.sizeOnDiskBytes).toBe(asset.sizeBytes);
    expect(hoisted.fileExists(modelPath)).toBe(true);

    // Second call is idempotent and takes the fast path (no re-hash).
    hoisted.base64Reads.length = 0;
    await mgr.installBundled(asset);
    expect(hoisted.base64Reads.filter((p) => p === modelPath)).toEqual([]);
  });

  it("2. bundled asset with incorrect SHA → rejected, deleted, never installed", async () => {
    // Same size, different bytes: the APK asset is corrupt/tampered.
    const bad = GOOD_BYTES.slice();
    for (let i = 0; i < bad.length; i++) bad[i] = (bad[i] + 1) & 0xff;
    expect(sha256Of(bad)).not.toBe(GOOD_SHA);
    hoisted.setApkBytes(bad);

    const mgr = makeManager();
    await expect(mgr.installBundled(asset)).rejects.toThrow(/SHA-256 verification/);

    expect(hoisted.fileExists(modelPath)).toBe(false); // corrupt artifact deleted
    const status = await mgr.statusOf(asset);
    expect(status.present).toBe(false); // never marked installed
  });

  it("3. truncated bundled asset → rejected, deleted, never installed", async () => {
    hoisted.setApkBytes(GOOD_BYTES.slice(0, 1024)); // short copy

    const mgr = makeManager();
    await expect(mgr.installBundled(asset)).rejects.toThrow(/size mismatch/);

    expect(hoisted.fileExists(modelPath)).toBe(false);
    expect((await mgr.statusOf(asset)).present).toBe(false);
  });

  it("bundled asset without declared SHA-256 → install refused outright", async () => {
    const mgr = makeManager();
    const noSha = { ...asset, sha256: "" };
    await expect(mgr.installBundled(noSha)).rejects.toThrow(/no expected SHA-256/);
    expect(hoisted.fileExists(modelPath)).toBe(false);
  });
});

describe("load-time trust gate", () => {
  it("4. trusted installed model survives legitimate restart WITHOUT re-hashing", async () => {
    const mgr = makeManager();
    await mgr.installBundled(asset);

    // "Restart": drop all in-memory state; the journal + file persist.
    hoisted.base64Reads.length = 0;
    const mgr2 = makeManager();

    await mgr2.assertTrustedForLoad(asset); // must resolve
    // No byte reads of the model file: trust came from the journal +
    // unchanged mtime (fast path), not from re-hashing ~GBs.
    expect(hoisted.base64Reads.filter((p) => p === modelPath)).toEqual([]);
    expect((await mgr2.statusOf(asset)).present).toBe(true);
  });

  it("5. same-size tampered model cannot become trusted (rewritten file → re-verify → fail → delete)", async () => {
    const mgr = makeManager();
    await mgr.installBundled(asset);

    // Attacker/user replaces the file with same-size different bytes.
    // Any rewrite changes mtime — the fast path must not apply.
    const tampered = GOOD_BYTES.slice();
    for (let i = 0; i < tampered.length; i++) tampered[i] = (tampered[i] ^ 0xa5) & 0xff;
    expect(tampered.length).toBe(GOOD_BYTES.length);
    hoisted.writeFile(modelPath, tampered, 9999);

    const mgr2 = makeManager();
    const err = await mgr2.assertTrustedForLoad(asset).catch((e) => e);
    expect(err).toBeInstanceOf(ModelNotTrustedError);
    expect(err.reason).toBe("checksum-mismatch");

    // The tampered file is deleted so it can never be mistaken for valid.
    expect(hoisted.fileExists(modelPath)).toBe(false);
    expect((await mgr2.statusOf(asset)).present).toBe(false);
  });

  it("6a. missing journal cannot silently produce trusted status (re-verifies, then trusts)", async () => {
    const mgr = makeManager();
    await mgr.installBundled(asset);

    // Journal lost (fresh profile / deleted state file).
    hoisted.files.delete(hoisted.JOURNAL);
    hoisted.base64Reads.length = 0;

    const mgr2 = makeManager();
    await mgr2.assertTrustedForLoad(asset); // resolves — but ONLY after hashing
    expect(hoisted.base64Reads.filter((p) => p === modelPath).length).toBeGreaterThan(0);
    expect((await mgr2.statusOf(asset)).present).toBe(true); // journal re-adopted
  });

  it("6b. corrupt journal cannot silently produce trusted status", async () => {
    const mgr = makeManager();
    await mgr.installBundled(asset);

    hoisted.writeFile(hoisted.JOURNAL, hoisted.te.encode("{ not valid json"), 1000);
    hoisted.base64Reads.length = 0;

    const mgr2 = makeManager();
    await mgr2.assertTrustedForLoad(asset);
    expect(hoisted.base64Reads.filter((p) => p === modelPath).length).toBeGreaterThan(0);
  });

  it("6c. missing journal + tampered bytes → rejected, never silently trusted", async () => {
    const mgr = makeManager();
    await mgr.installBundled(asset);
    hoisted.files.delete(hoisted.JOURNAL);

    const tampered = GOOD_BYTES.slice();
    tampered[0] = (tampered[0] + 1) & 0xff;
    hoisted.writeFile(modelPath, tampered, 9999);

    const mgr2 = makeManager();
    await expect(mgr2.assertTrustedForLoad(asset)).rejects.toBeInstanceOf(ModelNotTrustedError);
    expect(hoisted.fileExists(modelPath)).toBe(false);
  });

  it("truncated file on disk is untrusted and cleaned up", async () => {
    const mgr = makeManager();
    await mgr.installBundled(asset);
    hoisted.writeFile(modelPath, GOOD_BYTES.slice(0, 512), 9999);

    const mgr2 = makeManager();
    const err = await mgr2.assertTrustedForLoad(asset).catch((e) => e);
    expect(err).toBeInstanceOf(ModelNotTrustedError);
    expect(err.reason).toBe("size-mismatch");
    expect(hoisted.fileExists(modelPath)).toBe(false);
  });

  it("checkModelTrust is non-throwing and reports the reason", async () => {
    const mgr = makeManager();
    void mgr;
    // Nothing on disk at all.
    const v = await checkModelTrust(asset);
    expect(v.trusted).toBe(false);
    expect(v.reason).toBe("missing");
    expect(v.deleteFile).toBe(false);
  });
});

describe("verifyChecksum fail-closed", () => {
  it("7. throws when the asset declares no SHA-256 (no weaker path)", async () => {
    const mgr = makeManager();
    await expect(mgr.verifyChecksum({ filename: asset.filename, sha256: "" })).rejects.toThrow(
      /no expected SHA-256/
    );
  });
});

describe("catalog filename gate (engine load path)", () => {
  it("8. curated catalog filenames resolve; unknown filenames fail closed", () => {
    const known = MODEL_CATALOG[0];
    expect(trustedAssetForFilename(known.filename)).toBe(known);
    expect(() => trustedAssetForFilename("models/evil.gguf")).toThrow(ModelNotTrustedError);
    expect(() => trustedAssetForFilename("models/evil.gguf")).toThrow(/not a curated catalog model/);
  });

  it("assertTrustedModelFileByName rejects unknown files before any FS access", async () => {
    const err = await assertTrustedModelFileByName("models/not-in-catalog.gguf").catch((e) => e);
    expect(err).toBeInstanceOf(ModelNotTrustedError);
    expect(err.reason).toBe("unknown-model-file");
  });

  it("assertTrustedModelFile (direct) enforces the same gate as the engines use", async () => {
    // No file on disk → the engine must never reach initLlama.
    const err = await assertTrustedModelFile(asset).catch((e) => e);
    expect(err).toBeInstanceOf(ModelNotTrustedError);
    expect(err.reason).toBe("missing");
  });
});

// ---------------------------------------------------------------------------
// 0.1.57 — outdated knowledge packs are kept, never deleted for being old.
// After an app update the catalog declares a new size/SHA-256 for a pack. The
// installed file is still exactly the bytes verified at its own install; it
// may be the only copy of the emergency numbers on a phone with no signal.
// ---------------------------------------------------------------------------

describe("packs desactualizados (0.1.57)", () => {
  const OLD_PACK = new Uint8Array(3000);
  for (let i = 0; i < OLD_PACK.length; i++) OLD_PACK[i] = (i * 13 + 1) & 0xff;
  const NEW_PACK = new Uint8Array(3500);
  for (let i = 0; i < NEW_PACK.length; i++) NEW_PACK[i] = (i * 5 + 9) & 0xff;

  const oldPack = {
    id: "trust-test-pack",
    kind: "corpus" as const,
    format: "sqlite-pack" as const,
    label: "Pack de prueba",
    filename: "corpus/trust-test.sqlite",
    sizeBytes: OLD_PACK.length,
    sha256: sha256Of(OLD_PACK),
    sourceUrl: "https://example.invalid/trust-test.sqlite",
    license: "test",
    description: "test fixture",
    required: false,
  };
  // The catalog shipped with the app update.
  const newPack = { ...oldPack, sizeBytes: NEW_PACK.length, sha256: sha256Of(NEW_PACK) };
  const packPath = `${hoisted.DOCS}${oldPack.filename}`;

  async function installOld(): Promise<void> {
    hoisted.setApkBytes(OLD_PACK.slice());
    resetInstallReconcileForTests();
    await new ModelManager([oldPack]).installBundled(oldPack);
    expect(hoisted.fileExists(packPath)).toBe(true);
  }

  it("con el catálogo nuevo, el pack viejo se queda, sin re-hash, marcado como desactualizado", async () => {
    await installOld();
    hoisted.base64Reads.length = 0;
    resetInstallReconcileForTests();
    const status = await new ModelManager([newPack]).statusOf(newPack);
    expect(status.present).toBe(false);
    expect(status.outdated).toBe(true);
    expect(status.sizeOnDiskBytes).toBe(OLD_PACK.length);
    expect(hoisted.fileExists(packPath)).toBe(true);
    expect(hoisted.base64Reads.filter((p) => p === packPath)).toEqual([]);
  });

  it("también con el mismo tamaño y otra huella", async () => {
    await installOld();
    const sameSize = { ...oldPack, sha256: sha256Of(GOOD_BYTES) };
    resetInstallReconcileForTests();
    const v = await checkModelTrust(sameSize);
    expect(v).toMatchObject({ trusted: false, reason: "outdated-pack", deleteFile: false, outdated: true });
    expect(hoisted.fileExists(packPath)).toBe(true);
  });

  it("un pack reescrito con otros bytes no pasa por viejo: se borra como antes", async () => {
    await installOld();
    const tampered = OLD_PACK.slice();
    tampered[10] ^= 0xff;
    hoisted.writeFile(packPath, tampered, 9999);
    resetInstallReconcileForTests();
    const status = await new ModelManager([newPack]).statusOf(newPack);
    expect(status.present).toBe(false);
    expect(status.outdated).toBeUndefined();
    expect(hoisted.fileExists(packPath)).toBe(false);
  });

  it("sin mtime comparable, solo un re-hash que coincide lo da por viejo", async () => {
    await installOld();
    hoisted.setMtime(packPath, 5555); // e.g. the file was touched; bytes unchanged
    hoisted.base64Reads.length = 0;
    resetInstallReconcileForTests();
    const status = await new ModelManager([newPack]).statusOf(newPack);
    expect(status.outdated).toBe(true);
    expect(hoisted.base64Reads.filter((p) => p === packPath).length).toBeGreaterThan(0);
  });

  it("los modelos no cambian: un modelo de un catálogo viejo sigue sin ser de confianza y se borra", async () => {
    const mgr = makeManager();
    await mgr.installBundled(asset);
    const newModel = { ...asset, sizeBytes: NEW_PACK.length, sha256: sha256Of(NEW_PACK) };
    resetInstallReconcileForTests();
    const status = await new ModelManager([newModel]).statusOf(newModel);
    expect(status.present).toBe(false);
    expect(status.outdated).toBeUndefined();
    expect(hoisted.fileExists(modelPath)).toBe(false);
  });

  it("una descarga nueva que falla o se corta no hace perder la prueba del pack viejo", async () => {
    const { recordInstall } = await import("./installState");
    await installOld();
    // The update starts (journal moves to "downloading" for the new version)…
    await recordInstall(newPack.id, { status: "downloading", sizeBytes: newPack.sizeBytes, sha256: newPack.sha256 });
    // …and fails.
    await recordInstall(newPack.id, {
      status: "failed",
      sizeBytes: newPack.sizeBytes,
      sha256: newPack.sha256,
      failureCode: "network",
      failureKind: "transient",
    });
    resetInstallReconcileForTests();
    expect((await new ModelManager([newPack]).statusOf(newPack)).outdated).toBe(true);
    expect(hoisted.fileExists(packPath)).toBe(true);

    // A crash mid-download: reconcile marks it interrupted; the proof survives too.
    await recordInstall(newPack.id, { status: "downloading", sizeBytes: newPack.sizeBytes, sha256: newPack.sha256 });
    resetInstallReconcileForTests();
    expect((await new ModelManager([newPack]).statusOf(newPack)).outdated).toBe(true);
  });

  it("cuando la versión nueva queda verificada, es la instalada y deja de estar desactualizada", async () => {
    await installOld();
    hoisted.setApkBytes(NEW_PACK.slice());
    hoisted.setApkMtimeSec(3000);
    resetInstallReconcileForTests();
    const mgr = new ModelManager([newPack]);
    await mgr.installBundled(newPack);
    const status = await mgr.statusOf(newPack);
    expect(status.present).toBe(true);
    expect(status.outdated).toBeUndefined();
  });

  it("packFileState: actual, desactualizado o inutilizable", async () => {
    const { packFileState } = await import("./modelTrust");
    expect(await packFileState(newPack)).toBe("unusable"); // nothing on disk
    await installOld();
    resetInstallReconcileForTests();
    expect(await packFileState(oldPack)).toBe("current");
    expect(await packFileState(newPack)).toBe("outdated");
    hoisted.writeFile(packPath, OLD_PACK.slice(0, 100), 9999); // truncated
    expect(await packFileState(newPack)).toBe("unusable");
    // A local pack (built by the user, no catalog size) opens as before.
    expect(await packFileState({ ...oldPack, id: "local-x", sizeBytes: 0, sha256: "" })).toBe("current");
  });
});
