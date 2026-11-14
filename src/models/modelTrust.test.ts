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
  // M-37: tamaños de cada lectura base64 por ruta — la vía rápida nueva
  // lee SOLO la cabecera; los tests distinguen «leyó la cabecera» de
  // «re-hasheó el fichero entero» por los tamaños, no por el conteo.
  const base64ReadSizes = new Map<string, number[]>();
  const copiedSubPaths: string[] = []; // APK asset paths copyBundledAssetToFile was asked for
  let apkBytes: Uint8Array = new Uint8Array(0);
  let apkMtimeSec = 2000;
  const writeFile = (path: string, bytes: Uint8Array, mtimeSec = 1000): void => {
    files.set(path, { bytes: bytes.slice(), mtimeSec });
  };
  return {
    copiedSubPaths,
    td,
    te,
    DOCS,
    JOURNAL,
    files,
    base64Reads,
    base64ReadSizes,
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
      const sizes = hoisted.base64ReadSizes.get(path) ?? [];
      sizes.push(len);
      hoisted.base64ReadSizes.set(path, sizes);
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
  copyBundledAssetToFile: async (subPath: string, destPath: string) => {
    hoisted.copiedSubPaths.push(subPath);
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
// M-37: el «modelo bueno» es un GGUF de verdad — cabecera recorrible por
// el parser de ggufHeader.ts y datos de tensor de relleno detrás —
// porque la puerta ahora valida la estructura además del SHA: un patrón
// de bytes cualquiera ya no es un modelo válido ni como fixture.
function buildGgufBytes(totalSize: number): Uint8Array {
  const bytes: number[] = [];
  const push = (...bs: number[]) => {
    bytes.push(...bs);
  };
  const u32 = (v: number) => {
    for (let i = 0; i < 4; i++) push((v >>> (8 * i)) & 0xff);
  };
  const u64 = (v: number) => {
    let x = BigInt(v);
    for (let i = 0; i < 8; i++) {
      push(Number(x & 0xffn));
      x >>= 8n;
    }
  };
  const str = (s: string) => {
    const e = new TextEncoder().encode(s);
    u64(e.length);
    push(...e);
  };
  push(0x47, 0x47, 0x55, 0x46); // "GGUF"
  u32(3); // versión
  u64(1); // tensores
  u64(2); // metadatos
  str("general.name");
  u32(8); // STRING
  str("modelo de prueba");
  str("general.sampling.temp");
  u32(8);
  str("0.7");
  str("token_embd.weight");
  u32(2); // n_dims
  u64(4);
  u64(8);
  u32(0); // tipo ggml f32
  u64(0); // offset
  const out = new Uint8Array(totalSize);
  out.set(bytes);
  for (let i = bytes.length; i < totalSize; i++) out[i] = (i * 7 + 3) & 0xff;
  return out;
}
const GOOD_BYTES = buildGgufBytes(300_000);
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
  hoisted.base64ReadSizes.clear();
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

    // Second call is idempotent. M-37: el diario del instalador aún no
    // trae hechos GGUF, así que esta llamada paga la adopción por la
    // vía lenta (verificación completa, una vez) y el diario queda con
    // los hechos anotados.
    await mgr.installBundled(asset);
    const { loadInstallState } = await import("./installState");
    expect((await loadInstallState()).records[asset.id]?.gguf).toBeDefined();
    // Third call: now the fast path applies — it reads only the header
    // region to compare it against the journal facts (no re-hash).
    hoisted.base64Reads.length = 0;
    hoisted.base64ReadSizes.clear();
    await mgr.installBundled(asset);
    const sizes = hoisted.base64ReadSizes.get(modelPath) ?? [];
    expect(sizes.reduce((a, b) => a + b, 0)).toBeLessThan(1024);
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

  it("0.1.95: copies from assets/models/ by default and from the subfolder it is given", async () => {
    hoisted.copiedSubPaths.length = 0;
    const mgr = makeManager();
    await mgr.installBundled(asset);
    hoisted.files.clear();
    resetInstallReconcileForTests();
    await makeManager().installBundled(asset, "packs");
    const file = asset.filename.split("/").pop();
    expect(hoisted.copiedSubPaths).toEqual([`models/${file}`, `packs/${file}`]);
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
    const mgr2 = makeManager();

    // M-37: el diario del instalador no trae hechos GGUF — la primera
    // comprobación adopta por la vía lenta (verificación completa).
    await mgr2.assertTrustedForLoad(asset);
    const { loadInstallState } = await import("./installState");
    expect((await loadInstallState()).records[asset.id]?.gguf).toBeDefined();

    hoisted.base64Reads.length = 0;
    hoisted.base64ReadSizes.clear();
    await mgr2.assertTrustedForLoad(asset); // must resolve
    // From here on, trust comes from the journal + unchanged mtime +
    // the compared HEADER (fast path), not from re-hashing the file:
    // the reads add up to the header region only.
    const sizes = hoisted.base64ReadSizes.get(modelPath) ?? [];
    expect(sizes.length).toBeGreaterThan(0);
    expect(sizes.reduce((a, b) => a + b, 0)).toBeLessThan(1024);
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
    // M-35/F-03: a pack with no pin (no catalog entry, no import
    // record) is never "current" for merely existing — the assertion
    // this replaces ("current") sealed the audited defect.
    expect(await packFileState({ ...oldPack, id: "local-x", sizeBytes: 0, sha256: "" })).toBe("unusable");
  });

  // -------------------------------------------------------------------------
  // M-35 (auditoría 2026-11-13, carril 07: B1/B2/F-03) — la integridad de un
  // pack no puede agotarse el día de la instalación: la puerta de apertura
  // (packFileState, la que usa packs.ts) exige los bytes verificados contra
  // el pin (catálogo o registro de importación), con el diario como vía
  // rápida y el re-hash como adopción, igual que los GGUF.
  // -------------------------------------------------------------------------

  it("M-35/B1: un pack de catálogo sustituido por otros bytes del mismo tamaño no se abre", async () => {
    const { packFileState } = await import("./modelTrust");
    await installOld();
    const tampered = OLD_PACK.slice();
    tampered[10] ^= 0xff; // same size, different bytes, new mtime
    hoisted.writeFile(packPath, tampered, 9999);
    resetInstallReconcileForTests();
    expect(await packFileState(oldPack)).toBe("unusable");
    // And the tampered file is not silently deleted by a state query either:
    // deletion belongs to the manager's status path, not to opening.
    expect(hoisted.fileExists(packPath)).toBe(true);
  });

  it("M-35/B1: sin diario, los bytes correctos se adoptan con un re-hash y quedan en el diario", async () => {
    const { packFileState } = await import("./modelTrust");
    const { getInstallRecord } = await import("./installState");
    await installOld();
    hoisted.files.delete(hoisted.JOURNAL); // journal lost (reinstall, corruption…)
    resetInstallReconcileForTests();
    expect(await getInstallRecord(oldPack.id)).toBeNull();
    expect(await packFileState(oldPack)).toBe("current");
    const rec = await getInstallRecord(oldPack.id);
    expect(rec?.status).toBe("installed");
    expect(rec?.sha256).toBe(oldPack.sha256);
  });

  it("M-35/F-03: un fichero sin pin (ni catálogo ni registro) nunca es «current» por existir", async () => {
    const { packFileState } = await import("./modelTrust");
    hoisted.writeFile(packPath, OLD_PACK.slice(), 4242);
    expect(await packFileState({ ...oldPack, id: "local-suelto", sizeBytes: 0, sha256: "" })).toBe("unusable");
  });

  it("M-35/B2: un pack importado (pin del registro) se verifica al abrir; manipulado, no se abre", async () => {
    const { packFileState } = await import("./modelTrust");
    const IMP = new Uint8Array(1200);
    for (let i = 0; i < IMP.length; i++) IMP[i] = (i * 7 + 3) & 0xff;
    const imported = {
      ...oldPack,
      id: "local-tienda",
      filename: "corpus/tienda.sqlite",
      sizeBytes: IMP.length,
      sha256: sha256Of(IMP),
    };
    const impPath = `${hoisted.DOCS}${imported.filename}`;
    hoisted.writeFile(impPath, IMP.slice(), 3000);
    resetInstallReconcileForTests();
    // First open: no journal yet — the bytes are hashed against the
    // registry pin and adopted (the migration path for pre-0.1.99 imports).
    expect(await packFileState(imported)).toBe("current");
    const tampered = IMP.slice();
    tampered[5] ^= 0xff;
    hoisted.writeFile(impPath, tampered, 4000); // same size, new mtime
    expect(await packFileState(imported)).toBe("unusable");
  });
});

describe("M-37 (auditoría 2026-11-13, F2-M2): estructura GGUF y cabecera en la vía rápida", () => {
  const readSizesOfModel = () => hoisted.base64ReadSizes.get(modelPath) ?? [];
  const totalRead = () => readSizesOfModel().reduce((a, b) => a + b, 0);

  it("la vía lenta anota los hechos GGUF verificados en el diario", async () => {
    // Sin diario previo: la comprobación va por la vía lenta (SHA +
    // recorrido estructural) y el diario queda con los hechos.
    hoisted.writeFile(modelPath, GOOD_BYTES.slice(), 1000);
    const verdict = await checkModelTrust(asset);
    expect(verdict.trusted).toBe(true);
    const { loadInstallState } = await import("./installState");
    const gguf = (await loadInstallState()).records[asset.id]?.gguf;
    expect(gguf?.version).toBe(3);
    expect(gguf?.tensorCount).toBe(1);
    expect(gguf?.metadataCount).toBe(2);
    expect(gguf?.dataOffset).toBeGreaterThan(24);
    expect(gguf?.dataOffset).toBeLessThan(GOOD_BYTES.length);
    expect(gguf?.headerSha256).toBe(sha256Of(GOOD_BYTES.subarray(0, gguf?.dataOffset ?? 0)));
  });

  it("mismo tamaño y mismo mtime, un byte de la cabecera cambiado: no cuela", async () => {
    const mgr = makeManager();
    await mgr.installBundled(asset); // fichero con mtime 2000 (el del APK)
    // Sustitución con el mismo tamaño y el MISMO mtime: hasta la 0.1.98
    // la vía rápida la fiaba sin mirar un byte. El byte 60 cae dentro
    // de los metadatos de la cabecera (el nombre del modelo).
    const forged = GOOD_BYTES.slice();
    forged[60] = forged[60] ^ 0xff;
    hoisted.writeFile(modelPath, forged, 2000);
    const mgr2 = makeManager();
    const err = await mgr2.assertTrustedForLoad(asset).catch((e) => e);
    expect(err).toBeInstanceOf(ModelNotTrustedError);
    expect(err.reason).toBe("checksum-mismatch"); // la vía lenta corrió y juzgó
    expect(hoisted.fileExists(modelPath)).toBe(false);
  });

  it("mismo tamaño y mismo mtime, otro conteo de tensores en el prefijo: no cuela", async () => {
    const mgr = makeManager();
    await mgr.installBundled(asset);
    const forged = GOOD_BYTES.slice();
    forged[8] = 2; // tensor_count (u64 en el offset 8): 1 → 2
    hoisted.writeFile(modelPath, forged, 2000);
    const mgr2 = makeManager();
    const err = await mgr2.assertTrustedForLoad(asset).catch((e) => e);
    expect(err).toBeInstanceOf(ModelNotTrustedError);
    expect(err.reason).toBe("checksum-mismatch");
  });

  it("SHA del catálogo correcto pero estructura que no es GGUF: invalid-structure y NO se borra", async () => {
    const garbage = new Uint8Array(4096);
    for (let i = 0; i < garbage.length; i++) garbage[i] = (i * 7 + 3) & 0xff;
    const badAsset = {
      ...asset,
      id: "trust-test-bad-structure",
      filename: "models/bad-structure.gguf",
      sizeBytes: garbage.length,
      sha256: sha256Of(garbage),
    };
    const badPath = `${hoisted.DOCS}${badAsset.filename}`;
    hoisted.writeFile(badPath, garbage, 1000);
    const verdict = await checkModelTrust(badAsset);
    expect(verdict).toMatchObject({ trusted: false, reason: "invalid-structure", deleteFile: false });
    // Los bytes SON los del catálogo: borrarlos solo re-descargaría los mismos.
    expect(hoisted.fileExists(badPath)).toBe(true);
  });

  it("diario sin hechos (anterior a la 0.1.99): la vía lenta adopta y la siguiente ya es rápida", async () => {
    const mgr = makeManager();
    await mgr.installBundled(asset);
    // Se borran los hechos del diario, como quedaría un registro viejo.
    const raw = hoisted.td.decode(hoisted.files.get(hoisted.JOURNAL)?.bytes ?? new Uint8Array(0));
    const parsed = JSON.parse(raw) as { records: Record<string, { gguf?: unknown }> };
    delete parsed.records[asset.id].gguf;
    hoisted.writeFile(hoisted.JOURNAL, hoisted.te.encode(JSON.stringify(parsed)), 1000);

    hoisted.base64ReadSizes.clear();
    const mgr2 = makeManager();
    await mgr2.assertTrustedForLoad(asset); // resuelve, pero hasheando entero
    expect(totalRead()).toBeGreaterThanOrEqual(GOOD_BYTES.length);
    const { loadInstallState } = await import("./installState");
    expect((await loadInstallState()).records[asset.id]?.gguf).toBeDefined();

    hoisted.base64ReadSizes.clear();
    const mgr3 = makeManager();
    await mgr3.assertTrustedForLoad(asset); // ahora: solo la cabecera anotada
    expect(totalRead()).toBeGreaterThan(0);
    expect(totalRead()).toBeLessThan(1024);
  });
});
