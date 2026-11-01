// MIT License
// Copyright (c) 2026 NIDO contributors
// See LICENSE file for details.

/**
 * withLlamaTrim.js — P-02 (auditoría de rendimiento 2026-11-01): el
 * escalón prudente de llama.rn no se empaqueta.
 *
 * El APK llevaba 7 parejas de variantes de llama.rn. La app fija
 * `n_gpu_layers: 0` (src/inference/LlamaEngine.ts) y nunca pide el
 * backend Hexagon, así que la pareja hexagon_opencl (la principal y su
 * JNI, 14.449.672 B) y los 4 assets HTP de `assets/ggml-hexagon/`
 * (3.717.792 B) son peso muerto en todos los aparatos: 18.167.464 B.
 *
 * Por qué es seguro: el despacho vive en `RNLlama.loadNative()` como
 * una escalera con respaldo — cada peldaño se intenta con
 * `tryLoadLibrary` y un `UnsatisfiedLinkError` nunca es fatal. Quien
 * hoy usa el peldaño 1 (solo los Snapdragon 8 de la puerta
 * `isHexagonSupported`) baja al peldaño 2, dotprod_i8mm, y pierde dos
 * backends que NIDO no activa jamás. Los assets HTP se extraen con
 * fallo blando por construcción (try/catch con `Log.w`): sin assets,
 * la extracción fracasa sin ruido y la carga sigue.
 *
 * Suelo intocable: la pareja genérica (`librnllama.so` +
 * `librnllama_jni.so`) es el peldaño final de la escalera y NO se
 * recorta; ver KEPT_LLAMA_LIBS y su test.
 *
 * Por qué un plugin y no borrar ficheros: `android/` se regenera con
 * prebuild y solo los plugins sobreviven; y los assets HTP los copia
 * la tarea `syncRNLlamaHtpAssets` del propio llama.rn en cada build
 * (desde node_modules a app/src/main/assets), así que borrar la
 * carpeta a mano no sobrevive ni a un build. La exclusión va en tres
 * capas, cada una suficiente donde aplica:
 *  1. `packagingOptions.jniLibs.excludes` para la pareja .so.
 *  2. `packagingOptions.resources.excludes` para los assets HTP.
 *  3. `sourceSets.main.assets.exclude` para que mergeAssets ni los
 *     recoja de la carpeta que la tarea de sincronía rellena.
 * El juez final no es este fichero: es el diff de listado del APK
 * reconstruido, cableado en CI (paso «Recortes de APK en el listado»
 * de android-apk.yml), porque un error tipográfico en una lista de
 * exclusiones elimina una variante EN SILENCIO — la escalera cubre
 * al usuario y nadie lo notaría sin la comprobación.
 */
const { withAppBuildGradle } = require("@expo/config-plugins");

/** La pareja que sale (principal + JNI), con su ruta dentro del APK. */
const TRIMMED_JNI_LIBS = [
  "lib/arm64-v8a/librnllama_v8_2_dotprod_i8mm_hexagon_opencl.so",
  "lib/arm64-v8a/librnllama_jni_v8_2_dotprod_i8mm_hexagon_opencl.so",
];

/** El peldaño final de la escalera: jamás en una lista de exclusión. */
const KEPT_LLAMA_LIBS = ["librnllama.so", "librnllama_jni.so"];

/** Los 4 assets HTP viven bajo este prefijo dentro del APK. */
const HTP_ASSET_PATTERN = "assets/ggml-hexagon/**";

const MARKER = "NIDO: recorte de llama.rn (plugins/withLlamaTrim.js)";

/**
 * Casación de patrones de empaquetado estilo Ant (`**` cruza
 * directorios, `*` no), la misma semántica que aplica AGP a
 * packagingOptions. Vive aquí para que el test del plugin juzgue las
 * listas contra el censo real de nombres del APK: si un patrón deja
 * de casar lo que debe salir — o empieza a casar lo que debe
 * quedarse — la batería cae antes que el APK.
 */
function matchPackagingPattern(pattern, path) {
  const seg = (s) => s.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*");
  const regex = new RegExp("^" + pattern.split("**").map(seg).join(".*") + "$");
  return regex.test(path);
}

/** ¿Queda `path` fuera del APK según esta lista de exclusiones? */
function isExcluded(patterns, path) {
  return patterns.some((p) => matchPackagingPattern(p, path));
}

/**
 * Añade al final de app/build.gradle el bloque del recorte (Gradle
 * combina las dos configuraciones `android {}`). Idempotente por el
 * marcador; fail-closed si la plantilla deja de tener bloque android.
 */
function applyLlamaTrimBlock(gradle) {
  if (gradle.includes(MARKER)) return gradle;
  if (!/\bandroid\s*\{/.test(gradle)) {
    throw new Error("[withLlamaTrim] app/build.gradle sin bloque android { }");
  }
  const jniList = TRIMMED_JNI_LIBS.map((p) => `                "${p}"`).join(",\n");
  return (
    gradle.replace(/\s*$/, "\n") +
    `\n// ${MARKER}\nandroid {\n    packagingOptions {\n        jniLibs {\n            excludes += [\n${jniList}\n            ]\n        }\n        resources {\n            excludes += [\n                "${HTP_ASSET_PATTERN}"\n            ]\n        }\n    }\n    sourceSets {\n        main {\n            assets {\n                exclude "ggml-hexagon/**"\n            }\n        }\n    }\n}\n`
  );
}

function withLlamaTrim(config) {
  return withAppBuildGradle(config, (c) => {
    c.modResults.contents = applyLlamaTrimBlock(c.modResults.contents);
    return c;
  });
}

module.exports = withLlamaTrim;
module.exports.applyLlamaTrimBlock = applyLlamaTrimBlock;
module.exports.matchPackagingPattern = matchPackagingPattern;
module.exports.isExcluded = isExcluded;
module.exports.TRIMMED_JNI_LIBS = TRIMMED_JNI_LIBS;
module.exports.KEPT_LLAMA_LIBS = KEPT_LLAMA_LIBS;
module.exports.HTP_ASSET_PATTERN = HTP_ASSET_PATTERN;
module.exports.MARKER = MARKER;
