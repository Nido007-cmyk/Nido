// MIT License
// Copyright (c) 2026 NIDO contributors
// See LICENSE file for details.

/**
 * withLlamaTrim.test.js — P-02 (auditoría de rendimiento 2026-11-01).
 *
 * El peligro de una lista de exclusiones es el error tipográfico: la
 * escalera de RNLlama degrada en silencio y un nombre mal escrito
 * recortaría la variante equivocada (o ninguna) sin que nadie lo
 * notara en el aparato. Estos tests juzgan las listas del plugin
 * contra el censo real de nombres del APK publicado de la 0.1.68:
 * la pareja hexagon_opencl sale, las otras seis parejas y la
 * genérica se quedan, y los 4 assets HTP salen por su patrón.
 */
import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const withLlamaTrim = require("./withLlamaTrim.js");
const { applyLlamaTrimBlock, isExcluded, TRIMMED_JNI_LIBS, KEPT_LLAMA_LIBS, HTP_ASSET_PATTERN } =
  withLlamaTrim;

// Las 14 librnllama del espécimen (lib/arm64-v8a/), tal como las
// lista el APK publicado de la 0.1.68: la genérica + 6 parejas.
const LLAMA_LIBS = [
  "librnllama.so",
  "librnllama_jni.so",
  "librnllama_v8.so",
  "librnllama_jni_v8.so",
  "librnllama_v8_2.so",
  "librnllama_jni_v8_2.so",
  "librnllama_v8_2_dotprod.so",
  "librnllama_jni_v8_2_dotprod.so",
  "librnllama_v8_2_dotprod_i8mm.so",
  "librnllama_jni_v8_2_dotprod_i8mm.so",
  "librnllama_v8_2_i8mm.so",
  "librnllama_jni_v8_2_i8mm.so",
  "librnllama_v8_2_dotprod_i8mm_hexagon_opencl.so",
  "librnllama_jni_v8_2_dotprod_i8mm_hexagon_opencl.so",
].map((n) => `lib/arm64-v8a/${n}`);

const HTP_ASSETS = ["v73", "v75", "v79", "v81"].map((v) => `assets/ggml-hexagon/libggml-htp-${v}.so`);

describe("withLlamaTrim · P-02", () => {
  it("excluye exactamente la pareja hexagon_opencl de las 14 del censo", () => {
    const excluded = LLAMA_LIBS.filter((p) => isExcluded(TRIMMED_JNI_LIBS, p));
    expect(excluded).toEqual([
      "lib/arm64-v8a/librnllama_v8_2_dotprod_i8mm_hexagon_opencl.so",
      "lib/arm64-v8a/librnllama_jni_v8_2_dotprod_i8mm_hexagon_opencl.so",
    ]);
  });

  it("no excluye la pareja genérica ni ninguna otra variante", () => {
    for (const kept of KEPT_LLAMA_LIBS) {
      expect(isExcluded(TRIMMED_JNI_LIBS, `lib/arm64-v8a/${kept}`)).toBe(false);
    }
    const keptCount = LLAMA_LIBS.filter((p) => !isExcluded(TRIMMED_JNI_LIBS, p)).length;
    expect(keptCount).toBe(12);
  });

  it("el patrón HTP casa los 4 assets y nada fuera de ggml-hexagon/", () => {
    for (const p of HTP_ASSETS) expect(isExcluded([HTP_ASSET_PATTERN], p)).toBe(true);
    expect(isExcluded([HTP_ASSET_PATTERN], "assets/ggml-hexagon2/libggml-htp-v73.so")).toBe(false);
    expect(isExcluded([HTP_ASSET_PATTERN], "assets/models/embedding.gguf")).toBe(false);
    expect(isExcluded([HTP_ASSET_PATTERN], "lib/arm64-v8a/libggml-htp-v73.so")).toBe(false);
  });

  it("el bloque gradle lleva la pareja, los HTP y el suelo genérico fuera", () => {
    const gradle = "android {\n    buildTypes {}\n}\n";
    const out = applyLlamaTrimBlock(gradle);
    expect(out.startsWith(gradle)).toBe(true); // el original queda intacto
    for (const p of TRIMMED_JNI_LIBS) expect(out).toContain(`"${p}"`);
    expect(out).toContain(`"${HTP_ASSET_PATTERN}"`);
    expect(out).toContain('exclude "ggml-hexagon/**"');
    for (const kept of KEPT_LLAMA_LIBS) expect(out).not.toContain(kept);
  });

  it("es idempotente y fail-closed sin bloque android", () => {
    const gradle = "android {\n}\n";
    const once = applyLlamaTrimBlock(gradle);
    expect(applyLlamaTrimBlock(once)).toBe(once);
    expect(() => applyLlamaTrimBlock("plugins {}\n")).toThrow(/android/);
  });
});
