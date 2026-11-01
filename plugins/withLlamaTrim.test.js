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
const {
  applyLlamaTrimBlock,
  applyPackagingProperty,
  isExcluded,
  TRIMMED_JNI_LIBS,
  KEPT_LLAMA_LIBS,
  HTP_ASSET_PATTERN,
  PACKAGING_EXCLUDES,
  PACKAGING_PROPERTY_KEY,
} = withLlamaTrim;

const CMAP_DIR = "assets/com/tom_roush/fontbox/resources/cmap";

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

// El censo cmap del espécimen: los 92 nombres tal como los lista el
// APK publicado de la 0.1.68 (generado desde su listado, no transcrito).
const CMAP_CENSUS = [
  "83pv-RKSJ-H",
  "90ms-RKSJ-H",
  "90ms-RKSJ-V",
  "90msp-RKSJ-H",
  "90msp-RKSJ-V",
  "90pv-RKSJ-H",
  "90pv-RKSJ-V",
  "Add-RKSJ-H",
  "Add-RKSJ-V",
  "Adobe-CNS1-0",
  "Adobe-CNS1-1",
  "Adobe-CNS1-2",
  "Adobe-CNS1-3",
  "Adobe-CNS1-4",
  "Adobe-CNS1-5",
  "Adobe-CNS1-6",
  "Adobe-CNS1-UCS2",
  "Adobe-GB1-0",
  "Adobe-GB1-1",
  "Adobe-GB1-2",
  "Adobe-GB1-3",
  "Adobe-GB1-4",
  "Adobe-GB1-5",
  "Adobe-GB1-UCS2",
  "Adobe-Japan1-0",
  "Adobe-Japan1-1",
  "Adobe-Japan1-2",
  "Adobe-Japan1-3",
  "Adobe-Japan1-4",
  "Adobe-Japan1-5",
  "Adobe-Japan1-6",
  "Adobe-Japan1-7",
  "Adobe-Japan1-UCS2",
  "Adobe-Japan2-0",
  "Adobe-Korea1-0",
  "Adobe-Korea1-1",
  "Adobe-Korea1-2",
  "Adobe-Korea1-UCS2",
  "B5pc-H",
  "B5pc-V",
  "CNS-EUC-H",
  "CNS-EUC-V",
  "ETen-B5-H",
  "ETen-B5-V",
  "ETenms-B5-H",
  "ETenms-B5-V",
  "EUC-H",
  "EUC-V",
  "Ext-RKSJ-H",
  "Ext-RKSJ-V",
  "GB-EUC-H",
  "GB-EUC-V",
  "GBK-EUC-H",
  "GBK-EUC-V",
  "GBK2K-H",
  "GBK2K-V",
  "GBKp-EUC-H",
  "GBKp-EUC-V",
  "GBpc-EUC-H",
  "GBpc-EUC-V",
  "H",
  "HKscs-B5-H",
  "HKscs-B5-V",
  "Identity-H",
  "Identity-V",
  "KSC-EUC-H",
  "KSC-EUC-V",
  "KSCms-UHC-H",
  "KSCms-UHC-HW-H",
  "KSCms-UHC-HW-V",
  "KSCms-UHC-V",
  "KSCpc-EUC-H",
  "KSCpc-EUC-V",
  "UniCNS-UCS2-H",
  "UniCNS-UCS2-V",
  "UniCNS-UTF16-H",
  "UniCNS-UTF16-V",
  "UniGB-UCS2-H",
  "UniGB-UCS2-V",
  "UniGB-UTF16-H",
  "UniGB-UTF16-V",
  "UniJIS-UCS2-H",
  "UniJIS-UCS2-HW-H",
  "UniJIS-UCS2-HW-V",
  "UniJIS-UCS2-V",
  "UniJIS-UTF16-H",
  "UniJIS-UTF16-V",
  "UniKS-UCS2-H",
  "UniKS-UCS2-V",
  "UniKS-UTF16-H",
  "UniKS-UTF16-V",
  "V"
];

describe("withLlamaTrim · P-04/P-05", () => {
  it("P-04: el patrón pqc casa las 5 tablas y deja los dos x509 y todo lo demás", () => {
    const pqc = [
      "org/bouncycastle/pqc/crypto/picnic/lowmc.properties",
      "org/bouncycastle/pqc/crypto/sike/p434.properties",
      "org/bouncycastle/pqc/crypto/sike/p503.properties",
      "org/bouncycastle/pqc/crypto/sike/p610.properties",
      "org/bouncycastle/pqc/crypto/sike/p751.properties",
    ];
    for (const p of pqc) expect(isExcluded(PACKAGING_EXCLUDES, p)).toBe(true);
    // Los que se quedan: los dos x509 y cualquier otro recurso de BC.
    expect(isExcluded(PACKAGING_EXCLUDES, "org/bouncycastle/x509/CertPathReviewerMessages.properties")).toBe(false);
    expect(isExcluded(PACKAGING_EXCLUDES, "org/bouncycastle/x509/CertPathReviewerMessages_de.properties")).toBe(false);
  });

  it("P-05: tras la exclusión quedan en cmap/ exactamente Identity-H, Identity-V, H, V", () => {
    const kept = CMAP_CENSUS.filter((n) => !isExcluded(PACKAGING_EXCLUDES, `${CMAP_DIR}/${n}`));
    expect(kept).toEqual(["H", "Identity-H", "Identity-V", "V"]);
    const gone = CMAP_CENSUS.filter((n) => isExcluded(PACKAGING_EXCLUDES, `${CMAP_DIR}/${n}`));
    expect(gone).toHaveLength(88);
  });

  it("P-05: los diez del anexo de corrección salen — los prefijos que la regla literal dejaba dentro", () => {
    const ten = [
      "GBpc-EUC-H", "GBpc-EUC-V", "KSCms-UHC-H", "KSCms-UHC-V", "KSCms-UHC-HW-H",
      "KSCms-UHC-HW-V", "KSCpc-EUC-H", "KSCpc-EUC-V", "B5pc-H", "B5pc-V",
    ];
    for (const n of ten) expect(isExcluded(PACKAGING_EXCLUDES, `${CMAP_DIR}/${n}`)).toBe(true);
  });

  it("la propiedad de gradle.properties nace con la lista entera, una sola vez", () => {
    const items = applyPackagingProperty([{ type: "property", key: "org.gradle.jvmargs", value: "-Xmx4g" }]);
    const prop = items.find((it) => it.key === PACKAGING_PROPERTY_KEY);
    expect(prop).toBeDefined();
    expect(prop.value.split(",")).toEqual(PACKAGING_EXCLUDES);
    const again = applyPackagingProperty(items);
    expect(again.find((it) => it.key === PACKAGING_PROPERTY_KEY).value).toBe(prop.value);
  });

  it("la propiedad conserva lo que ya hubiera y no duplica", () => {
    const items = applyPackagingProperty([
      { type: "property", key: PACKAGING_PROPERTY_KEY, value: "**/picasa.ini" },
    ]);
    const parts = items[0].value.split(",");
    expect(parts[0]).toBe("**/picasa.ini");
    expect(parts).toHaveLength(1 + PACKAGING_EXCLUDES.length);
    expect(new Set(parts).size).toBe(parts.length);
  });

  it("el bloque gradle lleva la lista plana entera en resources", () => {
    const out = applyLlamaTrimBlock("android {\n}\n");
    for (const p of PACKAGING_EXCLUDES) expect(out).toContain(`"${p}"`);
  });
});
