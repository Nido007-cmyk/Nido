/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * packImporter.test.ts — the signed-pack door, end to end over an
 * in-memory filesystem, with the REAL bytes of the store's SALVORA pack 1
 * and of NIDO's Esencial (read from the store zips in the workspace; the
 * blocks skip visibly when the zips are absent, since packs are never
 * committed to the repo).
 *
 * The invariant under test is PI-2's: a rejection — for signature, for
 * hash, for format, for a missing manifest — copies NOTHING into corpus/
 * and writes NO origin record. Only a fully verified pack is promoted,
 * and only after the caller's confirmation.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("ram-monitor", () => ({
  getDeviceTotalRamBytes: () => 8 * 1024 ** 3,
  getMemoryInfo: () => ({ rssBytes: 0 }),
}));

// ---------------------------------------------------------------------------
// In-memory filesystem + native-module mocks (shared via vi.hoisted).
// ---------------------------------------------------------------------------

const h = vi.hoisted(() => {
  const DOCS = "file:///docs/";
  const CACHE = "file:///cache/";
  const files = new Map<string, Uint8Array>();
  const metas = new Map<string, Record<string, string>>();
  const state = {
    pickerResult: null as null | { canceled: boolean; assets: Array<{ uri: string; name: string; size?: number }> },
    moves: 0,
    closePackCalls: [] as string[],
  };
  return { DOCS, CACHE, files, metas, state };
});

vi.mock("expo-file-system/legacy", () => ({
  documentDirectory: h.DOCS,
  cacheDirectory: h.CACHE,
  EncodingType: { Base64: "base64", UTF8: "utf8" },
  getInfoAsync: async (uri: string) => {
    const f = h.files.get(uri);
    return f
      ? { exists: true, isDirectory: false, size: f.length, modificationTime: 1000 }
      : { exists: false, isDirectory: false, size: 0 };
  },
  readAsStringAsync: async (
    uri: string,
    opts?: { encoding?: string; position?: number; length?: number }
  ) => {
    const f = h.files.get(uri);
    if (!f) throw new Error(`ENOENT ${uri}`);
    if (opts?.encoding === "base64") {
      const start = opts.position ?? 0;
      const len = opts.length ?? f.length - start;
      return Buffer.from(f.subarray(start, start + len)).toString("base64");
    }
    return Buffer.from(f).toString("utf8");
  },
  writeAsStringAsync: async (uri: string, text: string) => {
    h.files.set(uri, new TextEncoder().encode(text));
  },
  deleteAsync: async (uri: string, opts?: { idempotent?: boolean }) => {
    if (!h.files.delete(uri) && !opts?.idempotent) throw new Error(`ENOENT ${uri}`);
  },
  moveAsync: async ({ from, to }: { from: string; to: string }) => {
    const f = h.files.get(from);
    if (!f) throw new Error(`ENOENT ${from}`);
    h.files.set(to, f);
    h.files.delete(from);
    h.state.moves++;
  },
  makeDirectoryAsync: async () => {},
  readDirectoryAsync: async (uri: string) =>
    [...h.files.keys()].filter((k) => k.startsWith(uri)).map((k) => k.slice(uri.length)),
}));

vi.mock("expo-sqlite", () => ({
  openDatabaseAsync: async (name: string, _opts: unknown, dir: string) => {
    const uri = `file://${dir}/${name}`;
    const meta = h.metas.get(uri);
    if (!meta) throw new Error("file is not a database");
    return {
      getAllAsync: async () => Object.entries(meta).map(([key, value]) => ({ key, value })),
      closeAsync: async () => {},
    };
  },
}));

vi.mock("expo-document-picker", () => ({
  getDocumentAsync: async () => h.state.pickerResult,
}));

vi.mock("../rag/packs", () => ({
  closePack: async (id: string) => {
    h.state.closePackCalls.push(id);
  },
}));
vi.mock("../rag/vectorIndex", () => ({ deletePackIndexes: async () => {} }));

import { importPackFromFile, listImportedPacks, removeImportedPack } from "./packImporter";

// ---------------------------------------------------------------------------
// Real store fixtures
// ---------------------------------------------------------------------------

const PACKS_DIR = join(homedir(), "workspace/your_files/salvora-packs");
const SALVORA_ZIP = join(PACKS_DIR, "salvora-emergencias-casa-edicion-2026-11.zip");
const ESENCIAL_ZIP = join(PACKS_DIR, "salvora-esencial-edicion-2026-11.zip");
const REAL_ZIPS_PRESENT = existsSync(SALVORA_ZIP) && existsSync(ESENCIAL_ZIP);

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
    const method = buf.readUInt16LE(off + 10);
    const csize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.toString("utf8", off + 46, off + 46 + nameLen);
    const dataStart = localOff + 30 + buf.readUInt16LE(localOff + 26) + buf.readUInt16LE(localOff + 28);
    const raw = buf.subarray(dataStart, dataStart + csize);
    out.set(name, method === 8 ? inflateRawSync(raw) : Buffer.from(raw));
    off += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function realMeta(sqliteBytes: Buffer): Record<string, string> {
  const tmp = join(PACKS_DIR, `.packimporter-test-${process.pid}.sqlite`);
  const fs = require("node:fs") as typeof import("node:fs");
  fs.writeFileSync(tmp, sqliteBytes);
  try {
    const db = new DatabaseSync(tmp, { readOnly: true });
    const rows = db.prepare("SELECT key, value FROM meta").all() as Array<{ key: string; value: string }>;
    db.close();
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  } finally {
    fs.unlinkSync(tmp);
  }
}

const corpusFiles = () =>
  [...h.files.keys()].filter((k) => k.startsWith(`${h.DOCS}corpus/`)).sort();

/** Stages a picked pair in the mock cache and points the picker at it. */
function stagePick(sqliteName: string, sqliteBytes: Uint8Array, manifestText: string | null, meta?: Record<string, string>) {
  const sqliteUri = `${h.CACHE}picked/${sqliteName}`;
  h.files.set(sqliteUri, sqliteBytes);
  if (meta) h.metas.set(sqliteUri, meta);
  const assets: Array<{ uri: string; name: string; size?: number }> = [
    { uri: sqliteUri, name: sqliteName, size: sqliteBytes.length },
  ];
  if (manifestText !== null) {
    const manifestUri = `${sqliteUri}.json`;
    h.files.set(manifestUri, new TextEncoder().encode(manifestText));
    assets.push({ uri: manifestUri, name: `${sqliteName}.json`, size: manifestText.length });
  }
  h.state.pickerResult = { canceled: false, assets };
  return sqliteUri;
}

describe.runIf(REAL_ZIPS_PRESENT)("packImporter · the door with real store bytes", () => {
  const salvora = zipEntries(SALVORA_ZIP);
  const esencial = zipEntries(ESENCIAL_ZIP);
  const STD = "salvora-emergencias-casa.sqlite";
  const E5 = "salvora-emergencias-casa-e5.sqlite";
  const ES = "nido-esencial.sqlite";
  const stdBytes = salvora.get(STD)!;
  const stdManifest = salvora.get(`${STD}.json`)!.toString("utf8");
  const stdMeta = realMeta(stdBytes);
  const yes = async () => true;

  beforeEach(() => {
    h.files.clear();
    h.metas.clear();
    h.state.moves = 0;
    h.state.closePackCalls = [];
    h.state.pickerResult = null;
  });

  it("imports the SALVORA pack after confirmation: file promoted, origin recorded", async () => {
    stagePick(STD, stdBytes, stdManifest, stdMeta);
    const out = await importPackFromFile(yes);
    expect(out.status).toBe("imported");
    if (out.status !== "imported") return;
    expect(out.item.origin).toBe("salvora");
    expect(out.item.name).toBe(stdMeta.name);
    expect(h.files.get(`${h.DOCS}corpus/${STD}`)).toEqual(stdBytes);
    expect(await listImportedPacks()).toMatchObject([{ filename: STD, origin: "salvora" }]);
  });

  it("without confirmation it cancels and copies nothing", async () => {
    stagePick(STD, stdBytes, stdManifest, stdMeta);
    expect(await importPackFromFile(async () => false)).toEqual({ status: "cancelled" });
    expect(corpusFiles()).toEqual([]);
  });

  it("rejects a byte-changed pack (hash-mismatch) and copies nothing", async () => {
    const tampered = Buffer.from(stdBytes);
    tampered[12345] ^= 0x01;
    stagePick(STD, tampered, stdManifest, stdMeta);
    expect(await importPackFromFile(yes)).toEqual({ status: "rejected", reason: "hash-mismatch" });
    expect(corpusFiles()).toEqual([]);
    expect(await listImportedPacks()).toEqual([]);
  });

  it("rejects the pack without its manifest (missing-manifest) and copies nothing", async () => {
    stagePick(STD, stdBytes, null, stdMeta);
    expect(await importPackFromFile(yes)).toEqual({ status: "rejected", reason: "missing-manifest" });
    expect(corpusFiles()).toEqual([]);
  });

  it("rejects a pack whose meta is not a knowledge pack (not-a-pack)", async () => {
    stagePick(STD, stdBytes, stdManifest, { format: "something-else" });
    expect(await importPackFromFile(yes)).toEqual({ status: "rejected", reason: "not-a-pack" });
    expect(corpusFiles()).toEqual([]);
  });

  it("rejects an unreadable database (damaged) once origin checks passed", async () => {
    stagePick(STD, stdBytes, stdManifest); // no meta seeded → sqlite open fails
    expect(await importPackFromFile(yes)).toEqual({ status: "rejected", reason: "damaged" });
    expect(corpusFiles()).toEqual([]);
  });

  it("importing the same verified bytes twice is already-imported, not a second copy", async () => {
    stagePick(STD, stdBytes, stdManifest, stdMeta);
    await importPackFromFile(yes);
    const movesAfterFirst = h.state.moves;
    stagePick(STD, stdBytes, stdManifest, stdMeta);
    expect((await importPackFromFile(yes)).status).toBe("already-imported");
    expect(h.state.moves).toBe(movesAfterFirst);
  });

  it("different verified bytes under the same name replace the old pack (updated edition)", async () => {
    stagePick(STD, stdBytes, stdManifest, stdMeta);
    await importPackFromFile(yes);
    const e5Bytes = salvora.get(E5)!;
    const e5Manifest = salvora.get(`${E5}.json`)!.toString("utf8");
    // The e5 edition offered under the standard edition's file name.
    stagePick(STD, e5Bytes, e5Manifest, realMeta(e5Bytes));
    const out = await importPackFromFile(yes);
    expect(out.status).toBe("imported");
    expect(h.files.get(`${h.DOCS}corpus/${STD}`)).toEqual(e5Bytes);
    const items = await listImportedPacks();
    expect(items).toHaveLength(1);
    expect(items[0].sha256).toBe(createHash("sha256").update(e5Bytes).digest("hex"));
  });

  it("imports NIDO's Esencial with origin nido; it presents as its catalog item, not in the added list", async () => {
    const esBytes = esencial.get(ES)!;
    stagePick(ES, esBytes, esencial.get(`${ES}.json`)!.toString("utf8"), realMeta(esBytes));
    const out = await importPackFromFile(yes);
    expect(out.status).toBe("imported");
    if (out.status !== "imported") return;
    expect(out.item.origin).toBe("nido");
    expect(h.files.get(`${h.DOCS}corpus/${ES}`)).toEqual(esBytes);
    expect(await listImportedPacks()).toEqual([]);
    // …but the door remembers it verified it: offering it again is already-imported.
    stagePick(ES, esBytes, esencial.get(`${ES}.json`)!.toString("utf8"), realMeta(esBytes));
    expect((await importPackFromFile(yes)).status).toBe("already-imported");
  });

  it("remove deletes the file, drops the record, and re-adding works", async () => {
    stagePick(STD, stdBytes, stdManifest, stdMeta);
    await importPackFromFile(yes);
    await removeImportedPack(STD);
    expect(h.files.has(`${h.DOCS}corpus/${STD}`)).toBe(false);
    expect(await listImportedPacks()).toEqual([]);
    expect(h.state.closePackCalls).toContain("local-salvora-emergencias-casa");
    stagePick(STD, stdBytes, stdManifest, stdMeta);
    expect((await importPackFromFile(yes)).status).toBe("imported");
  });

  it("a cancelled picker is a cancellation, not an error", async () => {
    h.state.pickerResult = { canceled: true, assets: [] };
    expect(await importPackFromFile(yes)).toEqual({ status: "cancelled" });
  });

  it("a pick with no .sqlite at all is not-a-pack", async () => {
    h.state.pickerResult = {
      canceled: false,
      assets: [{ uri: `${h.CACHE}notes.txt`, name: "notes.txt", size: 4 }],
    };
    h.files.set(`${h.CACHE}notes.txt`, new TextEncoder().encode("hola"));
    expect(await importPackFromFile(yes)).toEqual({ status: "rejected", reason: "not-a-pack" });
    expect(corpusFiles()).toEqual([]);
  });
});
