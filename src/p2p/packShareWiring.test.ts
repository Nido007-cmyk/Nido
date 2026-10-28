/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * 0.1.55: compartir packs NIDO↔NIDO. Solo viajan e instalan packs del
 * catálogo, byte a byte iguales a los que NIDO descargaría.
 */
import { describe, expect, it } from "vitest";
import { createHash } from "crypto";
import type { CatalogModel } from "../models/manifest";
import { encodeBase64 } from "./base64";
import {
  isAcceptableOffer,
  makePackDataProvider,
  makePackImporter,
  shareablePack,
  type PackShareDeps,
} from "./packShareWiring";
import type { PackAdvertisement } from "./packSharing";

const BYTES = new TextEncoder().encode("SQLite format 3\u0000 guía de primeros auxilios");
const SHA = createHash("sha256").update(BYTES).digest("hex");
const DOC = "file:///doc/";

const pack = (over: Partial<CatalogModel> = {}): CatalogModel =>
  ({
    id: "nido-esencial",
    kind: "corpus",
    format: "sqlite-pack",
    label: "NIDO Essentials",
    filename: "corpus/nido-esencial.sqlite",
    sizeBytes: BYTES.length,
    sha256: SHA,
    sourceUrl: "https://example.invalid/nido-esencial.sqlite",
    license: "CC BY-SA 4.0",
    description: "first aid",
    required: false,
    ...over,
  }) as CatalogModel;

function makeDeps(packs: CatalogModel[], files: Record<string, string> = {}) {
  const log: string[] = [];
  const imported: string[] = [];
  const deps: PackShareDeps = {
    listPacks: async () => packs,
    docDir: DOC,
    readBase64: async (p) => {
      if (!(p in files)) throw new Error("no existe");
      return files[p];
    },
    writeBase64: async (p, d) => {
      files[p] = d;
      log.push(`write ${p}`);
    },
    move: async (a, b) => {
      if (!(a in files)) throw new Error("no existe");
      files[b] = files[a];
      delete files[a];
      log.push(`move ${a} -> ${b}`);
    },
    remove: async (p) => {
      delete files[p];
      log.push(`remove ${p}`);
    },
    closePack: async (id) => {
      log.push(`close ${id}`);
    },
    afterImport: async (p) => {
      imported.push(p.id);
    },
  };
  return { deps, files, log, imported };
}

describe("shareablePack", () => {
  it("solo packs del catálogo con SHA-256 y tamaño", () => {
    expect(shareablePack([pack()], "nido-esencial")?.id).toBe("nido-esencial");
    expect(shareablePack([pack({ id: "local-mio", sha256: "" })], "local-mio")).toBeNull();
    expect(shareablePack([pack({ sha256: "" })], "nido-esencial")).toBeNull();
    expect(shareablePack([pack({ format: "gguf" as CatalogModel["format"] })], "nido-esencial")).toBeNull();
    expect(shareablePack([pack({ sizeBytes: 200 * 1024 * 1024 })], "nido-esencial")).toBeNull();
    expect(shareablePack([pack()], "otro")).toBeNull();
  });
});

describe("isAcceptableOffer", () => {
  const adv = (over: Partial<PackAdvertisement> = {}): PackAdvertisement => ({
    id: "nido-esencial",
    name: "lo que diga el otro",
    description: "",
    sizeBytes: BYTES.length,
    hash: "0".repeat(64),
    chunkCount: 1,
    senderId: "a".repeat(64),
    ...over,
  });
  it("acepta el pack del catálogo con su tamaño (y el redondeo del base64)", () => {
    expect(isAcceptableOffer([pack()], adv())).toBe(true);
    expect(isAcceptableOffer([pack()], adv({ sizeBytes: BYTES.length + 2 }))).toBe(true);
  });
  it("rechaza packs desconocidos o con otro tamaño", () => {
    expect(isAcceptableOffer([pack()], adv({ id: "pack-falso" }))).toBe(false);
    expect(isAcceptableOffer([pack()], adv({ sizeBytes: BYTES.length + 1000 }))).toBe(false);
    expect(isAcceptableOffer([pack()], adv({ sizeBytes: BYTES.length - 1 }))).toBe(false);
  });
});

describe("makePackDataProvider", () => {
  it("entrega el archivo instalado si es el del catálogo", async () => {
    const { deps } = makeDeps([pack()], { [`${DOC}corpus/nido-esencial.sqlite`]: encodeBase64(BYTES) });
    const out = await makePackDataProvider(deps)("nido-esencial");
    expect(out?.base64Data).toBe(encodeBase64(BYTES));
    expect(out?.name).toBe("NIDO Essentials");
  });
  it("no reparte un archivo cambiado ni uno que no está instalado", async () => {
    const changed = new Uint8Array(BYTES);
    changed[20] ^= 1;
    const a = makeDeps([pack()], { [`${DOC}corpus/nido-esencial.sqlite`]: encodeBase64(changed) });
    expect(await makePackDataProvider(a.deps)("nido-esencial")).toBeNull();
    const b = makeDeps([pack()]);
    expect(await makePackDataProvider(b.deps)("nido-esencial")).toBeNull();
  });
});

describe("makePackImporter", () => {
  it("instala el pack idéntico al del catálogo: temporal → cierre → sustitución → índice", async () => {
    const { deps, files, log, imported } = makeDeps([pack()]);
    const ok = await makePackImporter(deps)("nido-esencial", "x", encodeBase64(BYTES));
    expect(ok).toBe(true);
    expect(files[`${DOC}corpus/nido-esencial.sqlite`]).toBe(encodeBase64(BYTES));
    expect(files[`${DOC}corpus/nido-esencial.sqlite.p2p-part`]).toBeUndefined();
    expect(log[0]).toBe(`write ${DOC}corpus/nido-esencial.sqlite.p2p-part`);
    expect(log).toContain("close nido-esencial");
    expect(imported).toEqual(["nido-esencial"]);
  });
  it("rechaza un pack con un solo byte cambiado (p. ej. un consejo médico alterado)", async () => {
    const changed = new Uint8Array(BYTES);
    changed[25] ^= 1;
    const { deps, files, imported } = makeDeps([pack()]);
    expect(await makePackImporter(deps)("nido-esencial", "x", encodeBase64(changed))).toBe(false);
    expect(Object.keys(files)).toHaveLength(0);
    expect(imported).toEqual([]);
  });
  it("rechaza packs que no son del catálogo", async () => {
    const { deps } = makeDeps([pack({ id: "local-mio", sha256: "" })]);
    expect(await makePackImporter(deps)("local-mio", "x", encodeBase64(BYTES))).toBe(false);
  });
  it("si falla la sustitución, el pack que había vuelve a su sitio y no queda temporal", async () => {
    const target = `${DOC}corpus/nido-esencial.sqlite`;
    const { deps, files } = makeDeps([pack()], { [target]: "viejo" });
    const realMove = deps.move;
    deps.move = async (a, b) => {
      if (a.endsWith(".p2p-part")) throw new Error("sin espacio");
      await realMove(a, b);
    };
    expect(await makePackImporter(deps)("nido-esencial", "x", encodeBase64(BYTES))).toBe(false);
    expect(files[`${target}.p2p-part`]).toBeUndefined();
    expect(files[`${target}.p2p-old`]).toBeUndefined();
    expect(files[target]).toBe("viejo");
  });

  it("sustituye un pack anterior y borra la copia apartada", async () => {
    const target = `${DOC}corpus/nido-esencial.sqlite`;
    const { deps, files } = makeDeps([pack()], { [target]: "viejo" });
    expect(await makePackImporter(deps)("nido-esencial", "x", encodeBase64(BYTES))).toBe(true);
    expect(files[target]).toBe(encodeBase64(BYTES));
    expect(files[`${target}.p2p-old`]).toBeUndefined();
  });
});
