// 0.1.92: borrar la parte descargada de un modelo en rojo (ya no ofrece descargar).
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("download-wake-lock", () => ({
  acquireDownloadWakeLock: () => true,
  releaseDownloadWakeLock: () => {},
}));

const calls: string[] = [];
vi.mock("../models/ModelManager", () => ({
  ModelManager: class {
    downloadCatalogModel() {
      calls.push("download");
      return Promise.resolve();
    }
    async signalCancelDownload() {
      calls.push("cancel");
    }
    async deletePartialDownload() {
      calls.push("deletePartial");
    }
  },
}));

const records = new Map<string, { status: string }>();
vi.mock("../models/installState", () => ({
  getInstallRecord: async (id: string) => records.get(id) ?? null,
  clearInstallRecord: async (id: string) => {
    calls.push("clearRecord");
    records.delete(id);
  },
}));

import { discardPartialDownload, getDownloadState, resetDownloadState } from "./downloadManager";

const asset = (id: string) => ({ id, sizeBytes: 100 }) as never;

beforeEach(() => {
  resetDownloadState();
  calls.length = 0;
  records.clear();
});

describe("discardPartialDownload", () => {
  it("cancela, borra la parte y limpia el asiento «en pausa»; no arranca otra descarga", async () => {
    records.set("pesado", { status: "paused" });
    await discardPartialDownload(asset("pesado"));
    expect(calls).toEqual(["cancel", "deletePartial", "clearRecord"]);
    expect(records.has("pesado")).toBe(false);
    expect(getDownloadState("pesado")).toBeUndefined();
  });

  it("nunca borra el asiento de un modelo instalado", async () => {
    records.set("instalado", { status: "installed" });
    await discardPartialDownload(asset("instalado"));
    expect(calls).toEqual(["cancel", "deletePartial"]);
    expect(records.get("instalado")?.status).toBe("installed");
  });
});
