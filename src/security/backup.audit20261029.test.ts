/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Auditoría 2026-10-29 sobre los respaldos:
 * - el hash del manifest ahora es el SHA-256 real de los bytes, y los
 *   respaldos de 0.1.61 o antes se siguen aceptando;
 * - extractPortableBundle aplica el tope de 100 MB por sí misma;
 * - un respaldo de un formato más nuevo se rechaza, y la validación devuelve
 *   la fecha para avisar antes de restaurar.
 */
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fsx = vi.hoisted(() => ({ files: new Map<string, string>(), sizes: new Map<string, number>() }));

vi.mock("expo-file-system/legacy", () => ({
  documentDirectory: "/mock/",
  EncodingType: { UTF8: "utf8", Base64: "base64" },
  getInfoAsync: async (uri: string) =>
    fsx.files.has(uri) ? { exists: true, size: fsx.sizes.get(uri) ?? fsx.files.get(uri)!.length } : { exists: false },
  readAsStringAsync: async (uri: string) => {
    if (!fsx.files.has(uri)) throw new Error("no file");
    return fsx.files.get(uri)!;
  },
  writeAsStringAsync: async (uri: string, data: string) => {
    fsx.files.set(uri, data);
  },
  copyAsync: async () => {},
  deleteAsync: async () => {},
}));
vi.mock("expo-crypto", () => ({
  default: {
    CryptoDigestAlgorithm: { SHA256: "SHA-256" },
    CryptoEncoding: { HEX: "hex" },
    digest: async (_a: string, data: Uint8Array) => {
      const d = createHash("sha256").update(data).digest();
      return d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength);
    },
    // Como el módulo nativo: la cadena se codifica en UTF-8.
    digestStringAsync: async (_a: string, s: string) => createHash("sha256").update(s, "utf8").digest("hex"),
  },
}));
vi.mock("../privacy/keyManager", () => ({
  // Sin clave en el teléfono: la validación del .db se apoya en el manifest.
  getDatabaseKeyHex: async () => null,
  applyDatabaseKey: async () => {},
}));
vi.mock("expo-sqlite", () => ({ openDatabaseAsync: async () => undefined }));
vi.mock("./secureDatabase", () => ({ WAL_CHECKPOINT_SQL: "PRAGMA wal_checkpoint(TRUNCATE);" }));
vi.mock("./databaseManager", () => ({ getDatabase: async () => ({}), closeDatabase: async () => {} }));

import {
  backupManifestInfo,
  extractPortableBundle,
  hexOfBytes,
  MAX_BUNDLE_BYTES,
  SHA256_KIND_BYTES,
  validateBackup,
} from "./backup";

// Bytes con valores ≥ 0x80: ahí es donde el cálculo viejo se separaba del real.
const BYTES = new Uint8Array(4096).map((_, i) => (i * 37 + 200) % 256);
const B64 = Buffer.from(BYTES).toString("base64");
const REAL = createHash("sha256").update(BYTES).digest("hex");
const LEGACY = createHash("sha256").update(Buffer.from(BYTES).toString("latin1"), "utf8").digest("hex");

function putDb(manifest: Record<string, unknown>) {
  fsx.files.set("/mock/r.db", B64);
  fsx.sizes.set("/mock/r.db", BYTES.length);
  fsx.files.set("/mock/r.db.manifest.json", JSON.stringify(manifest));
}

beforeEach(() => {
  fsx.files.clear();
  fsx.sizes.clear();
});

describe("SHA-256 del respaldo", () => {
  it("el cálculo viejo NO era el SHA-256 de los bytes (el hallazgo)", () => {
    expect(LEGACY).not.toBe(REAL);
  });

  it("un manifest nuevo (sha256Kind bytes) se comprueba con el SHA-256 real", async () => {
    putDb({ version: 1, sha256: REAL, sha256Kind: SHA256_KIND_BYTES, createdAt: "2026-10-29T10:00:00.000Z", appVersion: "0.1.62-alpha" });
    const r = await validateBackup("/mock/r.db");
    expect(r).toMatchObject({ valid: true, info: { createdAt: "2026-10-29T10:00:00.000Z", appVersion: "0.1.62-alpha", tooNew: false } });
  });

  it("un respaldo de 0.1.61 o anterior (sin sha256Kind) se sigue aceptando", async () => {
    putDb({ version: 1, sha256: LEGACY, createdAt: "2026-10-01T10:00:00.000Z" });
    expect((await validateBackup("/mock/r.db")).valid).toBe(true);
  });

  it("los dos cálculos no se mezclan: el hash viejo marcado como nuevo no pasa", async () => {
    putDb({ version: 1, sha256: LEGACY, sha256Kind: SHA256_KIND_BYTES });
    expect((await validateBackup("/mock/r.db")).valid).toBe(false);
  });

  it("un archivo cambiado no pasa", async () => {
    putDb({ version: 1, sha256: REAL, sha256Kind: SHA256_KIND_BYTES });
    const changed = new Uint8Array(BYTES);
    changed[10] ^= 1;
    fsx.files.set("/mock/r.db", Buffer.from(changed).toString("base64"));
    expect((await validateBackup("/mock/r.db")).valid).toBe(false);
  });

  it("hexOfBytes", () => {
    expect(hexOfBytes(new Uint8Array([0, 15, 16, 255]))).toBe("000f10ff");
  });
});

describe("versión del manifest", () => {
  it("un formato más nuevo que el que esta versión sabe leer se rechaza", async () => {
    putDb({ version: 2, sha256: REAL, sha256Kind: SHA256_KIND_BYTES });
    const r = await validateBackup("/mock/r.db");
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/más nueva/);
  });

  it("también en un respaldo portable", async () => {
    const bundle = { format: "nidobackup", version: 1, manifest: { version: 9, sha256: "a", dekFingerprint: "b" }, db: "A".repeat(200) };
    fsx.files.set("/mock/p.nidobackup.json", JSON.stringify(bundle));
    const r = await validateBackup("/mock/p.nidobackup.json");
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/más nueva/);
  });

  it("backupManifestInfo no se fía de campos raros", () => {
    expect(backupManifestInfo(null)).toEqual({ createdAt: null, appVersion: null, version: null, tooNew: false });
    expect(backupManifestInfo({ createdAt: "ayer", appVersion: 3, version: "1" })).toEqual({
      createdAt: null,
      appVersion: null,
      version: null,
      tooNew: false,
    });
    expect(backupManifestInfo({ version: 1 }).tooNew).toBe(false);
    expect(backupManifestInfo({ version: 2 }).tooNew).toBe(true);
  });

  it("un portable válido devuelve su fecha para el aviso", async () => {
    const bundle = {
      format: "nidobackup",
      version: 1,
      manifest: { version: 1, sha256: "a", dekFingerprint: "b", createdAt: "2026-09-01T08:00:00.000Z" },
      db: "A".repeat(200),
    };
    fsx.files.set("/mock/p.nidobackup.json", JSON.stringify(bundle));
    const r = await validateBackup("/mock/p.nidobackup.json");
    expect(r).toMatchObject({ valid: true, info: { createdAt: "2026-09-01T08:00:00.000Z" } });
  });
});

describe("tope de extractPortableBundle", () => {
  it("rechaza un bundle de más de 100 MB sin leerlo", async () => {
    fsx.files.set("/mock/big.nidobackup.json", "{}");
    fsx.sizes.set("/mock/big.nidobackup.json", MAX_BUNDLE_BYTES + 1);
    await expect(extractPortableBundle("/mock/big.nidobackup.json", "/mock/")).rejects.toMatchObject({ code: "invalid" });
    expect(fsx.files.has("/mock/restored.db")).toBe(false);
  });

  it("un bundle normal se extrae", async () => {
    const bundle = { format: "nidobackup", version: 1, manifest: { sha256: "a" }, db: "QUJD", knowledge: null };
    fsx.files.set("/mock/ok.nidobackup.json", JSON.stringify(bundle));
    expect(await extractPortableBundle("/mock/ok.nidobackup.json", "/mock/")).toBe("/mock/restored.db");
  });
});
