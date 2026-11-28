/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const fs = vi.hoisted(() => ({ deleted: [] as string[], dirs: new Map<string, string[]>() }));
vi.mock("expo-file-system/legacy", () => ({
  documentDirectory: "file:///docs/",
  cacheDirectory: "file:///cache/",
  getInfoAsync: async (p: string) => ({ exists: fs.dirs.has(p) }),
  readDirectoryAsync: async (p: string) => fs.dirs.get(p) ?? [],
  deleteAsync: async (p: string) => {
    fs.deleted.push(p);
  },
}));

import { MODEL_CATALOG, type CatalogModel } from "../models/manifest";
import {
  NoPhotoModelError,
  askAboutPhoto,
  chooseVisionRoute,
  deletePhotoCopy,
  isImageCopy,
  photoModel,
  photoSystemPrompt,
  projectorFor,
  sweepStalePhotoCopies,
  type PhotoEngine,
} from "./photoQuestion";

const byId = (id: string) => MODEL_CATALOG.find((m) => m.id === id)!;
const GEMMA = byId("gemma-4-e4b-it-q4_0");
const QWEN = byId("qwen2.5-0.5b-instruct-q4km");
const VLM = byId("lfm2-vl-450m-q4_0");

beforeEach(() => {
  fs.deleted.length = 0;
  fs.dirs.clear();
});

describe("0.1.126 — catálogo de fotos", () => {
  it("cada proyector apunta a un modelo que existe; el modelo de fotos tiene el suyo", () => {
    const projectors = MODEL_CATALOG.filter((m) => m.kind === "projector");
    expect(projectors.map((p) => p.id).sort()).toEqual(["gemma-4-e4b-it-mmproj", "lfm2-vl-450m-mmproj-q8_0"]);
    for (const p of projectors) expect(MODEL_CATALOG.some((m) => m.id === p.projectorFor && m.kind !== "projector")).toBe(true);
    expect(photoModel()?.id).toBe("lfm2-vl-450m-q4_0");
    expect(projectorFor("lfm2-vl-450m-q4_0")?.id).toBe("lfm2-vl-450m-mmproj-q8_0");
    expect(projectorFor("gemma-4-e4b-it-q4_0")?.id).toBe("gemma-4-e4b-it-mmproj");
    expect(projectorFor(QWEN.id)).toBeUndefined();
    // El modelo de fotos no es un modelo de chat.
    expect(VLM.kind).toBe("vision");
  });
});

describe("0.1.126 — qué modelo contesta la foto", () => {
  const presentSet = (...ids: string[]) => (a: CatalogModel) => ids.includes(a.id);

  it("si el modelo activo tiene su proyector descargado, se le adjunta", () => {
    const r = chooseVisionRoute(GEMMA, presentSet(GEMMA.id, "gemma-4-e4b-it-mmproj", VLM.id, "lfm2-vl-450m-mmproj-q8_0"));
    expect(r).toMatchObject({ kind: "attach", model: { id: GEMMA.id }, projector: { id: "gemma-4-e4b-it-mmproj" } });
  });

  it("si no, el modelo de fotos con su proyector", () => {
    expect(chooseVisionRoute(QWEN, presentSet(QWEN.id, VLM.id, "lfm2-vl-450m-mmproj-q8_0"))).toMatchObject({
      kind: "swap",
      model: { id: VLM.id },
    });
    // Gemma sin su proyector → modelo de fotos.
    expect(chooseVisionRoute(GEMMA, presentSet(GEMMA.id, VLM.id, "lfm2-vl-450m-mmproj-q8_0"))?.kind).toBe("swap");
  });

  it("sin modelo de fotos completo (falta el modelo o su proyector), no hay ruta", () => {
    expect(chooseVisionRoute(QWEN, presentSet(QWEN.id, VLM.id))).toBeNull();
    expect(chooseVisionRoute(QWEN, presentSet(QWEN.id, "lfm2-vl-450m-mmproj-q8_0"))).toBeNull();
    expect(chooseVisionRoute(undefined, presentSet())).toBeNull();
  });

  it("la instrucción va en el idioma de la interfaz y pide no adivinar ni nombrar personas", () => {
    expect(photoSystemPrompt("es")).toMatch(/en español/);
    expect(photoSystemPrompt("en")).toMatch(/in English/);
    expect(photoSystemPrompt("pt")).toMatch(/em português/);
    for (const l of ["es", "en", "pt"] as const) expect(photoSystemPrompt(l)).toMatch(/adivinar|guessing|adivinhar/);
  });
});

function fakeEngine(loadedFile: string | null, generateResult: string | Error = "Se ve un cartel.") {
  const log: string[] = [];
  let loaded = loadedFile;
  const engine: PhotoEngine = {
    get isLoaded() {
      return loaded !== null;
    },
    getModelInfo: () => (loaded ? { filename: loaded } : null),
    load: async (f, o) => {
      log.push(`load:${f}:${o?.extraResidentBytes ?? 0}`);
      loaded = f;
    },
    unload: async () => {
      log.push("unload");
      loaded = null;
    },
    attachProjector: async (f) => {
      log.push(`attach:${f}`);
    },
    detachProjector: async () => {
      log.push("detach");
    },
    generate: async (o) => {
      log.push(`generate:${o.imagePath}:${o.messages[1].content}`);
      if (generateResult instanceof Error) throw generateResult;
      o.onToken?.(generateResult);
      return generateResult;
    },
  };
  return { engine, log };
}

describe("0.1.126 — askAboutPhoto", () => {
  const PHOTO = "file:///cache/DocumentPicker/abc.jpg";

  it("ruta adjuntar: no descarga el modelo de chat; adjunta, pregunta con la imagen, suelta y BORRA la foto", async () => {
    const { engine, log } = fakeEngine(GEMMA.filename);
    const text = await askAboutPhoto({
      imageUri: PHOTO,
      question: "¿Qué dice?",
      lang: "es",
      activeLlm: GEMMA,
      engine,
      present: async (a) => [GEMMA.id, "gemma-4-e4b-it-mmproj"].includes(a.id),
    });
    expect(text).toBe("Se ve un cartel.");
    expect(log).toEqual([`attach:models/gemma-4-e4b-it-mmproj.gguf`, `generate:${PHOTO}:¿Qué dice?`, "detach"]);
    expect(fs.deleted).toEqual([PHOTO]);
  });

  it("ruta cambiar: descarga el chat, carga el modelo de fotos contando su proyector, y lo descarga al acabar", async () => {
    const { engine, log } = fakeEngine(QWEN.filename);
    await askAboutPhoto({
      imageUri: PHOTO,
      question: "¿Qué es?",
      lang: "es",
      activeLlm: QWEN,
      engine,
      present: async (a) => [QWEN.id, VLM.id, "lfm2-vl-450m-mmproj-q8_0"].includes(a.id),
    });
    const extra = 103890016 + 128 * 1024 * 1024;
    expect(log).toEqual([
      "unload",
      `load:models/lfm2-vl-450m-q4_0.gguf:${extra}`,
      "attach:models/lfm2-vl-450m-mmproj-q8_0.gguf",
      `generate:${PHOTO}:¿Qué es?`,
      "detach",
      "unload",
    ]);
    expect(fs.deleted).toEqual([PHOTO]);
  });

  it("si la respuesta falla: suelta el proyector, descarga el modelo de fotos y borra la foto igual", async () => {
    const { engine, log } = fakeEngine(null, new Error("boom"));
    await expect(
      askAboutPhoto({
        imageUri: PHOTO,
        question: "x",
        lang: "en",
        activeLlm: QWEN,
        engine,
        present: async (a) => [VLM.id, "lfm2-vl-450m-mmproj-q8_0"].includes(a.id),
      }),
    ).rejects.toThrow("boom");
    expect(log.slice(-2)).toEqual(["detach", "unload"]);
    expect(fs.deleted).toEqual([PHOTO]);
  });

  it("sin modelo de fotos: NoPhotoModelError, no toca el motor, y la foto se borra", async () => {
    const { engine, log } = fakeEngine(QWEN.filename);
    await expect(
      askAboutPhoto({ imageUri: PHOTO, question: "x", lang: "es", activeLlm: QWEN, engine, present: async () => false }),
    ).rejects.toBeInstanceOf(NoPhotoModelError);
    expect(log).toEqual([]);
    expect(fs.deleted).toEqual([PHOTO]);
  });
});

describe("0.1.126 — borrado de las copias de fotos", () => {
  it("borra por URI file:// aunque llegue una ruta desnuda", async () => {
    await deletePhotoCopy("/data/user/0/team.nido.app/cache/DocumentPicker/a.jpg");
    expect(fs.deleted).toEqual(["file:///data/user/0/team.nido.app/cache/DocumentPicker/a.jpg"]);
  });

  it("barre las imágenes que dejó el selector, salvo la que está elegida, y nada más", async () => {
    fs.dirs.set("file:///cache/DocumentPicker/", ["a.jpg", "b.PNG", "keep.jpg", "doc.pdf", "c.heic"]);
    await sweepStalePhotoCopies("file:///cache/DocumentPicker/keep.jpg");
    expect(fs.deleted).toEqual([
      "file:///cache/DocumentPicker/a.jpg",
      "file:///cache/DocumentPicker/b.PNG",
      "file:///cache/DocumentPicker/c.heic",
    ]);
    expect(isImageCopy("doc.pdf")).toBe(false);
  });
});
