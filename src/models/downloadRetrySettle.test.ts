/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

// downloadRetrySettle.test.ts — 0.1.90, tercera familia.
//
// La secuencia del dueño en su tableta (2026-11-09, reconstruida por
// él mismo): (1) descarga en modo avión → interrumpida a 0 bytes,
// diario «failed/interrupted», tarjeta en «Reintentar descarga»;
// (2) con red, REINTENTAR → se bajó entero pero la tarjeta NO pasó a
// descargado; (3) una descarga nueva de cero sí asentó y ofreció
// «Seleccionar y usar».
//
// Esta suite reproduce la secuencia en el arnés: el intento 2
// transfiere, verifica sobre staging y promueve; la comprobación de
// estado posterior cae en la vía lenta de primera vista (el FS no
// dio mtime al registrar la instalación) y su PRIMERA lectura del
// archivo recién promovido falla una vez (la condición transitoria
// del aparato). El asentado debe absorber ese fallo: presente tras
// el reintento, sin tercer toque — y como la tarjeta solo ofrece
// «Descargar» cuando statusOf dice no-presente, asentado el estado
// la tocada que arrancó la re-descarga ya no existe en la UI (la
// regresión de componente lo fija: presente → «Seleccionar y usar»).
//
// Nota de alcance: una primera versión de la cura añadió una guarda
// de ya-instalado en downloadCatalogModel y se RETIRÓ: la
// re-descarga explícita de un modelo instalado es un comportamiento
// sellado de la casa (la suite installReliability, Meta #1, fija que
// corre y que su fallo nunca destruye la instalación válida). El
// defecto del dueño era el estado que no asentaba, no la existencia
// de la operación.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("ram-monitor", () => ({
  getDeviceTotalRamBytes: () => 8 * 1024 ** 3,
  getMemoryInfo: () => ({ rssBytes: 0 }),
}));

import { createHash } from "crypto";

const hoisted = vi.hoisted(() => {
  const td = new TextDecoder();
  const te = new TextEncoder();
  const DOCS = "file:///docs/";
  interface MockFile {
    bytes: Uint8Array;
    mtimeSec: number;
  }
  const files = new Map<string, MockFile>();
  return {
    td,
    te,
    DOCS,
    files,
    // Comportamiento del «servidor»: "throw" (sin red) u "ok".
    behavior: { kind: "throw" } as { kind: "throw" | "ok" },
    serverBytes: new Uint8Array(0),
    resumablesCreated: 0,
    // Cuántas veces puede fallar aún la primera lectura base64 de la
    // ruta final (la condición transitoria de primera vista).
    destReadFailuresLeft: 0,
    // Llamadas getInfoAsync sobre la ruta final: la primera (la del
    // registro de instalación) no devuelve modificationTime.
    destInfoCalls: 0,
    destPath: "",
    writeFile: (path: string, bytes: Uint8Array, mtimeSec = 1000): void => {
      files.set(path, { bytes: bytes.slice(), mtimeSec });
    },
  };
});

vi.mock("expo-file-system/legacy", () => ({
  default: undefined,
  documentDirectory: hoisted.DOCS,
  EncodingType: { Base64: "base64", UTF8: "utf8" },
  getInfoAsync: async (path: string) => {
    const f = hoisted.files.get(path);
    if (!f) return { exists: false, isDirectory: false, uri: path };
    const base = { exists: true, isDirectory: false, uri: path, size: f.bytes.length };
    if (path === hoisted.destPath) {
      const call = hoisted.destInfoCalls++;
      // Primera vista: el FS aún no reporta mtime de lo recién renombrado.
      if (call === 0) return base;
    }
    return { ...base, modificationTime: f.mtimeSec };
  },
  readAsStringAsync: async (
    path: string,
    opts?: { encoding?: string; position?: number; length?: number }
  ) => {
    const f = hoisted.files.get(path);
    if (!f) throw new Error(`mock FS: no such file ${path}`);
    if (opts?.encoding === "base64") {
      if (path === hoisted.destPath && hoisted.destReadFailuresLeft > 0) {
        hoisted.destReadFailuresLeft--;
        throw new Error("mock FS: transient read failure on freshly promoted file");
      }
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
  makeDirectoryAsync: async () => {},
  readDirectoryAsync: async (dir: string) => {
    const prefix = dir.endsWith("/") ? dir : `${dir}/`;
    return [...hoisted.files.keys()]
      .filter((p) => p.startsWith(prefix))
      .map((p) => p.slice(prefix.length))
      .filter((n) => !n.includes("/"));
  },
  getFreeDiskStorageAsync: async () => 8 * 1024 ** 3,
  createDownloadResumable: (url: string, fileUri: string, _options: any, cb: any) => {
    hoisted.resumablesCreated++;
    return {
      savable: () => ({ url, fileUri, options: {}, resumeData: undefined }),
      pauseAsync: async () => {},
      downloadAsync: async () => {
        if (hoisted.behavior.kind === "throw") {
          throw new Error("mock network: airplane mode");
        }
        hoisted.writeFile(fileUri, hoisted.serverBytes, 1000);
        cb?.({
          totalBytesWritten: hoisted.serverBytes.length,
          totalBytesExpectedToWrite: hoisted.serverBytes.length,
        });
        return { uri: fileUri, status: 200 };
      },
      resumeAsync: async () => {
        throw new Error("mock: resume not used in this suite");
      },
    };
  },
}));

vi.mock("bundled-assets", () => ({
  copyBundledAssetToFile: async () => 0,
}));

vi.mock("./storageBudget", () => ({
  checkStorageForDownload: () => ({ ok: true }),
}));

vi.mock("../privacy/networkAudit", () => ({
  networkAudit: { log: () => {} },
  sanitizeEndpoint: (u: string) => u,
}));

import { ModelManager } from "./ModelManager";
import { getInstallRecord } from "./installState";
import { assetPath } from "./modelTrust";
import type { CatalogModel } from "./manifest";

const BYTES = (() => {
  // M-37 (0.1.99): cabecera GGUF válida + patrón detrás — la puerta de
  // confianza valida la estructura además del SHA y los bytes de un
  // modelo real son un GGUF.
  const header: number[] = [];
  const push = (...bs: number[]) => {
    header.push(...bs);
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
  u32(3);
  u64(1);
  u64(1);
  str("general.name");
  u32(8);
  str("modelo de prueba");
  str("token_embd.weight");
  u32(2);
  u64(4);
  u64(8);
  u32(0);
  u64(0);
  const b = new Uint8Array(3000);
  b.set(header);
  for (let i = header.length; i < b.length; i++) b[i] = (i * 31 + 7) % 251;
  return b;
})();
const SHA = createHash("sha256").update(BYTES).digest("hex");

const ASSET: CatalogModel = {
  id: "test-model-retry",
  kind: "llm",
  label: "Test Model (retry settle)",
  filename: "models/test-model-retry.gguf",
  sizeBytes: BYTES.length,
  sha256: SHA,
  // T-09 (M-34): la puerta exige un origen fijado; repo real fijado.
  sourceUrl: "https://huggingface.co/bartowski/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/test.gguf",
  revision: "0123456789abcdef0123456789abcdef01234567",
  license: "Apache-2.0",
  description: "test fixture",
  required: false,
} as CatalogModel;

describe("la secuencia del dueño: fallo sin red, reintento con red, asentado sin tercer toque", () => {
  beforeEach(() => {
    hoisted.files.clear();
    hoisted.behavior = { kind: "throw" };
    hoisted.serverBytes = BYTES;
    hoisted.resumablesCreated = 0;
    hoisted.destReadFailuresLeft = 0;
    hoisted.destInfoCalls = 0;
    hoisted.destPath = assetPath(ASSET);
  });

  it("el reintento que completa deja el modelo instalado y presente, sin tercer toque", async () => {
    const mm = new ModelManager([ASSET]);

    // (1) Modo avión: la transferencia muere a 0 bytes; el diario lo dice.
    await expect(mm.downloadCatalogModel(ASSET)).rejects.toThrow();
    const failed = await getInstallRecord(ASSET.id);
    expect(failed?.status).toBe("failed");
    expect(failed?.failureCode).toBe("interrupted");
    expect((await mm.statusOf(ASSET)).present).toBe(false);

    // (2) Con red, REINTENTAR: transfiere, verifica y promueve. La
    // comprobación de estado cae en primera vista (sin mtime al
    // registrar) y su primera lectura del archivo promovido falla
    // una vez: el asentado debe absorberlo.
    hoisted.behavior = { kind: "ok" };
    hoisted.destReadFailuresLeft = 1;
    await mm.downloadCatalogModel(ASSET);
    const afterRetry = await mm.statusOf(ASSET);
    expect(afterRetry.present).toBe(true);
    expect(afterRetry.checksumOk).toBe(true);
    // (3) El diario quedó en «installed»: el estado que la tarjeta
    // lee para ofrecer «Seleccionar y usar» en vez de «Descargar».
    expect((await getInstallRecord(ASSET.id))?.status).toBe("installed");
  });

  it("la integridad no se negocia: unos bytes que no coinciden jamás cuentan como instalados", async () => {
    const mm = new ModelManager([ASSET]);
    hoisted.behavior = { kind: "ok" };
    hoisted.serverBytes = new Uint8Array(BYTES.length).fill(9); // mismo tamaño, otra huella
    await expect(mm.downloadCatalogModel(ASSET)).rejects.toThrow();
    expect((await mm.statusOf(ASSET)).present).toBe(false);
  });
});
