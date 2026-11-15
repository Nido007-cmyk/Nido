/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

// resumeStatusGate.test.ts — T-09 (0.1.99), asientos M-33 (F-01),
// m-67 (F-06), m-71 (F-10) y P-31 (P-03) del acta de auditoría
// 2026-11-14.
//
// M-33: el token de reanudación guardaba la URL y las opciones de la
// sesión anterior y restorePausedResumable las usaba tal cual: el
// token mandaba sobre la puerta de fuente. La cura: la restauración
// ignora url/options del token y reconstruye siempre con la fetchUrl
// validada por la puerta y opciones vacías.
// m-67: el token no estaba ligado a la identidad del asset; un prefijo
// viejo podía empalmar con contenido nuevo. La cura: el token anota
// {assetId, sha256, sizeBytes, fetchUrl} al persistirse y la
// restauración exige coincidencia; si no, se descarga de cero. Los
// tokens legados (sin ligadura, escritos por la 0.1.98 o anterior) se
// adoptan SOLO bajo la regla estricta de M-33.
// m-71: statusOf (una consulta) borraba el archivo cuando la
// verificación de confianza pedía deleteFile. La cura: la consulta no
// destruye; el borrado vive en las vías de acción (carga y promoción
// de una descarga recién verificada).
// P-31: ModelManager no tenía guarda propia de una descarga por
// asset; dos instancias podían descargar el mismo asset a la vez
// sobre el mismo staging.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("ram-monitor", () => ({
  getDeviceTotalRamBytes: () => 8 * 1024 ** 3,
  getMemoryInfo: () => ({ rssBytes: 0 }),
}));

import { createHash } from "crypto";

// ---------- GGUF-shaped server bytes (same builder as installReliability) ----------
function ggufHeaderPrefix(): Uint8Array {
  const bytes: number[] = [];
  const push = (...bs: number[]) => bytes.push(...bs);
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
  u32(3);
  u64(1); // tensores
  u64(1); // metadatos
  str("general.name");
  u32(8); // STRING
  str("modelo de prueba");
  str("token_embd.weight");
  u32(2);
  u64(4);
  u64(8);
  u32(0);
  u64(0);
  return new Uint8Array(bytes);
}
function serverBytes(size: number, seed: number): Uint8Array {
  const b = new Uint8Array(size);
  const header = ggufHeaderPrefix();
  b.set(header.slice(0, size));
  for (let i = Math.min(header.length, size); i < size; i++) b[i] = (i * 31 + seed) % 251;
  return b;
}
const shaOf = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

// ---------- controllable server + fault injection ----------
let serverSize = 0;
let serverSeed = 7;
type Behavior = { kind: "ok" } | { kind: "stallAfter"; bytes: number };
let behavior: Behavior = { kind: "ok" };
const callLog: Array<"downloadAsync" | "resumeAsync" | "pauseAsync" | "createResumable"> = [];
let resumablesCreated = 0;
const createdResumableUrls: string[] = [];
const createdResumableOptions: unknown[] = [];

const files = new Map<string, Uint8Array>();
const te = new TextEncoder();
const td = new TextDecoder();

class FakeResumable {
  private paused = false;
  private stallGate: (() => void) | null = null;
  private resumeData?: string;
  constructor(
    private url: string,
    private fileUri: string,
    private options: any,
    private cb: ((d: { totalBytesWritten: number; totalBytesExpectedToWrite: number }) => void) | undefined,
    resumeData?: string
  ) {
    this.resumeData = resumeData;
    resumablesCreated++;
    callLog.push("createResumable");
    createdResumableUrls.push(url);
    createdResumableOptions.push(options);
  }
  async pauseAsync() {
    callLog.push("pauseAsync");
    this.paused = true;
    this.resumeData = "resume" + "-token-for:" + this.fileUri;
    this.stallGate?.();
  }
  savable() {
    return {
      url: this.url,
      fileUri: this.fileUri,
      options: this.options ?? {},
      resumeData: this.resumeData,
    };
  }
  async resumeAsync(): Promise<{ uri: string; status: number } | undefined> {
    callLog.push("resumeAsync");
    return this.run(true);
  }
  async downloadAsync(): Promise<{ uri: string; status: number } | undefined> {
    callLog.push("downloadAsync");
    return this.run(false);
  }
  private async run(isResume: boolean): Promise<{ uri: string; status: number } | undefined> {
    const b = behavior;
    this.paused = false;
    const totalSize = serverSize;
    const content = serverBytes(totalSize, serverSeed);
    let written = 0;
    if (isResume && this.resumeData) {
      written = files.get(this.fileUri)?.length ?? 0;
    } else {
      files.set(this.fileUri, new Uint8Array(0));
    }
    const CHUNK = 256;
    const stallAt = b.kind === "stallAfter" ? b.bytes : Infinity;
    while (written < totalSize) {
      if (this.paused) return undefined;
      if (written >= stallAt) {
        await new Promise<void>((resolve) => {
          this.stallGate = () => resolve();
        });
        return undefined;
      }
      const step = Math.min(CHUNK, totalSize - written);
      const cur = files.get(this.fileUri) ?? new Uint8Array(0);
      const next = new Uint8Array(written + step);
      next.set(cur.subarray(0, Math.min(cur.length, written + step)));
      next.set(content.subarray(written, written + step), written);
      files.set(this.fileUri, next);
      written += step;
      this.cb?.({ totalBytesWritten: written, totalBytesExpectedToWrite: serverSize });
      await new Promise((r) => setTimeout(r, 0));
    }
    return { uri: this.fileUri, status: isResume && this.resumeData ? 206 : 200 };
  }
}

vi.mock("expo-file-system/legacy", () => ({
  default: undefined,
  documentDirectory: "file:///docs/",
  EncodingType: { Base64: "base64", UTF8: "utf8" },
  getInfoAsync: vi.fn(async (path: string) => {
    const b = files.get(path);
    return b
      ? { exists: true, isDirectory: false, size: b.length }
      : { exists: false, isDirectory: false, size: 0 };
  }),
  readAsStringAsync: vi.fn(async (path: string, opts?: any) => {
    const b = files.get(path);
    if (!b) throw new Error(`not found: ${path}`);
    if (opts?.encoding === "base64") {
      const pos = opts.position ?? 0;
      const len = opts.length ?? b.length - pos;
      return Buffer.from(b.subarray(pos, pos + len)).toString("base64");
    }
    return td.decode(b);
  }),
  writeAsStringAsync: vi.fn(async (path: string, content: string) => {
    files.set(path, te.encode(content));
  }),
  deleteAsync: vi.fn(async (path: string) => {
    files.delete(path);
  }),
  moveAsync: vi.fn(async ({ from, to }: { from: string; to: string }) => {
    const b = files.get(from);
    if (!b) throw new Error(`move: not found ${from}`);
    files.delete(from);
    files.set(to, b);
  }),
  makeDirectoryAsync: vi.fn(async () => {}),
  getFreeDiskStorageAsync: vi.fn(async () => 8 * 1024 ** 3),
  readDirectoryAsync: vi.fn(async (dir: string) => {
    const prefix = dir.endsWith("/") ? dir : `${dir}/`;
    const names: string[] = [];
    for (const k of files.keys()) {
      if (k.startsWith(prefix)) {
        const rest = k.slice(prefix.length);
        if (rest && !rest.includes("/")) names.push(rest);
      }
    }
    return names;
  }),
  createDownloadResumable: (
    url: string,
    fileUri: string,
    options: any,
    cb: ((d: { totalBytesWritten: number; totalBytesExpectedToWrite: number }) => void) | undefined,
    resumeData?: string
  ) => new FakeResumable(url, fileUri, options, cb, resumeData),
}));

vi.mock("bundled-assets", () => ({ copyBundledAssetToFile: async () => 0 }));
vi.mock("../privacy/networkAudit", () => ({
  networkAudit: { log: () => {} },
  sanitizeEndpoint: (u: string) => u,
}));

import {
  ModelManager,
  stagingPathFor,
  resumeTokenPathFor,
  resetInstallReconcileForTests,
} from "./ModelManager";
import { getInstallRecord, recordInstall } from "./installState";
import { assetPath } from "./modelTrust";
import type { CatalogModel } from "./manifest";

const REV = "0123456789abcdef0123456789abcdef01234567";
const SOURCE_URL =
  "https://huggingface.co/bartowski/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/t09.gguf";
const PINNED_URL = `https://huggingface.co/bartowski/Qwen2.5-1.5B-Instruct-GGUF/resolve/${REV}/t09.gguf`;

function makeAsset(id: string, size: number, seed = 7): CatalogModel {
  return {
    id,
    kind: "llm",
    label: id,
    filename: `models/${id}.gguf`,
    sizeBytes: size,
    sha256: shaOf(serverBytes(size, seed)),
    sourceUrl: SOURCE_URL,
    revision: REV,
    license: "test",
    description: "test",
    required: false,
  };
}
function newManager(catalog: CatalogModel[]) {
  return new ModelManager(catalog, { inactivityTimeoutMs: 150 });
}
async function expectFailure(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error("expected download to fail, but it succeeded");
}
/** Stall a download so the pause path persists a genuine resume token. */
async function stallAndPersistToken(mgr: ModelManager, asset: CatalogModel) {
  behavior = { kind: "stallAfter", bytes: 1024 };
  const f = (await expectFailure(mgr.downloadCatalogModel(asset))) as { code?: string };
  expect(f.code).toBe("stalled");
  expect(files.has(resumeTokenPathFor(asset))).toBe(true);
  expect((await getInstallRecord(asset.id))?.status).toBe("paused");
}

beforeEach(() => {
  files.clear();
  callLog.length = 0;
  resumablesCreated = 0;
  createdResumableUrls.length = 0;
  createdResumableOptions.length = 0;
  behavior = { kind: "ok" };
  serverSeed = 7;
  resetInstallReconcileForTests();
});

describe("M-33: el token de reanudación no manda sobre la puerta", () => {
  it("token persistido y manipulado (url y options ajenas): la restauración usa la URL de la puerta y opciones vacías", async () => {
    const asset = makeAsset("t09-m33-tampered", 4096);
    serverSize = 4096;
    const mgr = newManager([asset]);
    await stallAndPersistToken(mgr, asset);

    // Manipulación del token en disco: origen y opciones que la app
    // nunca aprobó (el escenario F-01 del acta).
    const token = JSON.parse(td.decode(files.get(resumeTokenPathFor(asset))!));
    token.url = "https://evil.example/steal.gguf";
    token.options = { headers: { "X-Evil": "1" } };
    files.set(resumeTokenPathFor(asset), te.encode(JSON.stringify(token)));

    resetInstallReconcileForTests();
    const mgr2 = newManager([asset]);
    callLog.length = 0;
    createdResumableUrls.length = 0;
    createdResumableOptions.length = 0;
    behavior = { kind: "ok" };
    await mgr2.downloadCatalogModel(asset);

    // La reanudación es genuina (resumeAsync) pero el resumable se creó
    // con la URL fijada por la puerta y SIN las opciones del token.
    expect(callLog).toContain("resumeAsync");
    expect(createdResumableUrls).toEqual([PINNED_URL]);
    expect(createdResumableOptions).toEqual([{}]);
    expect(shaOf(files.get(assetPath(asset))!)).toBe(asset.sha256);
  });

  it("token legado escrito a mano con URL ajena: se adopta solo bajo la URL de la puerta", async () => {
    const asset = makeAsset("t09-m33-legacy", 4096);
    serverSize = 4096;
    // Estado pausado sembrado a mano, como lo dejaría la 0.1.98:
    // staging parcial + diario «paused» + token sin ligadura con una
    // URL que la app nunca aprobó.
    files.set(stagingPathFor(asset), serverBytes(4096, 7).subarray(0, 1024));
    await recordInstall(asset.id, {
      status: "paused",
      sizeBytes: asset.sizeBytes,
      sha256: asset.sha256,
      bytesWritten: 1024,
    });
    files.set(
      resumeTokenPathFor(asset),
      te.encode(
        JSON.stringify({
          url: "http://descargas-gratis.example/modelo.gguf",
          fileUri: stagingPathFor(asset),
          options: { headers: { "X-Evil": "1" } },
          resumeData: "resume" + "-token-for:" + stagingPathFor(asset),
        })
      )
    );

    const mgr = newManager([asset]);
    await mgr.statusOf(asset); // dispara la reconciliación: el estado pausado se conserva
    expect(files.has(resumeTokenPathFor(asset))).toBe(true);
    callLog.length = 0;
    createdResumableUrls.length = 0;
    createdResumableOptions.length = 0;
    await mgr.downloadCatalogModel(asset);

    expect(callLog).toContain("resumeAsync");
    expect(createdResumableUrls).toEqual([PINNED_URL]);
    expect(createdResumableOptions).toEqual([{}]);
    expect(shaOf(files.get(assetPath(asset))!)).toBe(asset.sha256);
  });
});

describe("m-67: el token está ligado a la identidad del asset", () => {
  it("el token persistido anota la identidad (assetId, sha256, sizeBytes, fetchUrl)", async () => {
    const asset = makeAsset("t09-m67-binding", 4096);
    serverSize = 4096;
    const mgr = newManager([asset]);
    await stallAndPersistToken(mgr, asset);
    const token = JSON.parse(td.decode(files.get(resumeTokenPathFor(asset))!));
    expect(token.nidoBinding).toEqual({
      assetId: asset.id,
      sha256: asset.sha256,
      sizeBytes: asset.sizeBytes,
      fetchUrl: PINNED_URL,
    });
  });

  it("el catálogo cambia tras persistir el token (otro sha, otro contenido): no se reanuda, se descarga de cero", async () => {
    const assetV1 = makeAsset("t09-m67-changed", 4096, 7);
    serverSize = 4096;
    serverSeed = 7;
    const mgr = newManager([assetV1]);
    await stallAndPersistToken(mgr, assetV1);

    // La entrada del catálogo ahora nombra otros bytes (mismo id,
    // mismo tamaño, otra semilla → otro sha): el prefijo pausado ya
    // no pertenece a esta descarga.
    const assetV2 = makeAsset("t09-m67-changed", 4096, 11);
    expect(assetV2.sha256).not.toBe(assetV1.sha256);
    serverSeed = 11;
    resetInstallReconcileForTests();
    const mgr2 = newManager([assetV2]);
    callLog.length = 0;
    behavior = { kind: "ok" };
    await mgr2.downloadCatalogModel(assetV2);

    expect(callLog).toContain("downloadAsync");
    expect(callLog).not.toContain("resumeAsync");
    expect(shaOf(files.get(assetPath(assetV2))!)).toBe(assetV2.sha256);
    expect((await mgr2.statusOf(assetV2)).present).toBe(true);
  });

  it("token con ligadura de OTRO asset: se rechaza y se descarga de cero", async () => {
    const asset = makeAsset("t09-m67-foreign", 4096);
    serverSize = 4096;
    const mgr = newManager([asset]);
    await stallAndPersistToken(mgr, asset);
    const token = JSON.parse(td.decode(files.get(resumeTokenPathFor(asset))!));
    token.nidoBinding = {
      assetId: "otro-asset",
      sha256: asset.sha256,
      sizeBytes: asset.sizeBytes,
      fetchUrl: PINNED_URL,
    };
    files.set(resumeTokenPathFor(asset), te.encode(JSON.stringify(token)));

    resetInstallReconcileForTests();
    const mgr2 = newManager([asset]);
    callLog.length = 0;
    behavior = { kind: "ok" };
    await mgr2.downloadCatalogModel(asset);
    expect(callLog).toContain("downloadAsync");
    expect(callLog).not.toContain("resumeAsync");
    expect(shaOf(files.get(assetPath(asset))!)).toBe(asset.sha256);
  });
});

describe("P-31: una sola descarga por asset dentro de ModelManager", () => {
  it("dos llamadas concurrentes desde dos instancias comparten una sola descarga", async () => {
    const asset = makeAsset("t09-p31", 4096);
    serverSize = 4096;
    const mgrA = newManager([asset]);
    const mgrB = newManager([asset]);
    const p1 = mgrA.downloadCatalogModel(asset);
    const p2 = mgrB.downloadCatalogModel(asset);
    const settled = await Promise.allSettled([p1, p2]);
    expect(settled.every((s) => s.status === "fulfilled")).toBe(true);
    expect(resumablesCreated).toBe(1);
    expect((await mgrA.statusOf(asset)).present).toBe(true);
  });
});

describe("m-71: statusOf es una consulta y no destruye", () => {
  it("archivo final con tamaño equivocado: statusOf dice no presente y el archivo sigue en disco", async () => {
    const asset = makeAsset("t09-m71-size", 4096);
    files.set(assetPath(asset), new Uint8Array(100).fill(3));
    const mgr = newManager([asset]);
    const st = await mgr.statusOf(asset);
    expect(st.present).toBe(false);
    expect(files.has(assetPath(asset))).toBe(true);
  });

  it("archivo final con SHA equivocado: statusOf no lo borra y la re-descarga lo reemplaza", async () => {
    const asset = makeAsset("t09-m71-sha", 4096, 7);
    serverSize = 4096;
    files.set(assetPath(asset), serverBytes(4096, 99)); // tamaño correcto, bytes ajenos
    const mgr = newManager([asset]);
    const st = await mgr.statusOf(asset);
    expect(st.present).toBe(false);
    expect(st.checksumOk).toBe(false);
    expect(files.has(assetPath(asset))).toBe(true);

    // La vía de acción (descargar de nuevo) sí sustituye el archivo:
    // la promoción borra el destino corrupto tras verificar staging.
    await mgr.downloadCatalogModel(asset);
    expect(shaOf(files.get(assetPath(asset))!)).toBe(asset.sha256);
    expect((await mgr.statusOf(asset)).present).toBe(true);
  });
});
