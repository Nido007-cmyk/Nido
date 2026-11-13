/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

// 0.1.92 (auditoría del paquete 0.1.91, anexo B «observado y no
// curado»): una comprobación de estado que lanza ya no deja a la
// pantalla sin el estado de todos los modelos.
import { describe, it, expect, vi } from "vitest";

vi.mock("ram-monitor", () => ({
  getDeviceTotalRamBytes: () => 8 * 1024 ** 3,
  getMemoryInfo: () => ({ rssBytes: 0 }),
}));

vi.mock("expo-file-system/legacy", () => ({
  default: undefined,
  documentDirectory: "file:///docs/",
  EncodingType: { Base64: "base64", UTF8: "utf8" },
  getInfoAsync: async (path: string) => ({ exists: false, isDirectory: false, uri: path }),
  readAsStringAsync: async () => {
    throw new Error("mock FS: nothing to read");
  },
  writeAsStringAsync: async () => {},
  moveAsync: async () => {},
  deleteAsync: async () => {},
  makeDirectoryAsync: async () => {},
  readDirectoryAsync: async () => [],
  getFreeDiskStorageAsync: async () => 8 * 1024 ** 3,
}));

vi.mock("bundled-assets", () => ({ copyBundledAssetToFile: async () => 0 }));
vi.mock("../privacy/networkAudit", () => ({
  networkAudit: { log: () => {} },
  sanitizeEndpoint: (u: string) => u,
}));

import { ModelManager, type AssetStatus } from "./ModelManager";
import type { CatalogModel } from "./manifest";

const asset = (id: string): CatalogModel =>
  ({
    id,
    kind: "llm",
    name: id,
    filename: `models/${id}.gguf`,
    sizeBytes: 3000,
    sha256: "a".repeat(64),
    sourceUrl: `https://example.invalid/${id}.gguf`,
    revision: "r1",
    license: "Apache-2.0",
    description: "",
    required: false,
  }) as unknown as CatalogModel;

describe("statusAll: cada modelo responde por sí mismo", () => {
  it("si la comprobación de uno lanza, los demás conservan su estado y ese queda «no presente, sin veredicto»", async () => {
    const a = asset("a");
    const b = asset("b");
    const c = asset("c");
    const mm = new ModelManager([a, b, c]);
    const ok = (x: CatalogModel): AssetStatus => ({ asset: x, present: true, sizeOnDiskBytes: 3000, checksumOk: true });
    vi.spyOn(mm, "statusOf").mockImplementation(async (x: CatalogModel) => {
      if (x.id === "b") throw new Error("mock: el archivo no se deja leer");
      return ok(x);
    });

    const all = await mm.statusAll();

    expect(all.map((s) => s.asset.id)).toEqual(["a", "b", "c"]);
    expect(all[0].present).toBe(true);
    expect(all[2].present).toBe(true);
    // Nunca presente por error, y sin veredicto de integridad (no es
    // «huella mala»: no se borró nada ni se acusa al archivo).
    expect(all[1]).toEqual({ asset: b, present: false, sizeOnDiskBytes: 0, checksumOk: null });
  });
});
