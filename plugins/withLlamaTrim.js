// MIT License
// Copyright (c) 2026 NIDO contributors
// See LICENSE file for details.

/**
 * withLlamaTrim.js — P-02 + P-04 + P-05 (auditoría de rendimiento
 * 2026-11-01): los recortes de empaquetado del APK. Este primer
 * bloque es P-02: el escalón prudente de llama.rn no se empaqueta.
 * Las listas de P-04 (tablas PQC de BouncyCastle) y P-05 (mapas CJK
 * de fontbox) viven más abajo, junto a PACKAGING_EXCLUDES, con su
 * porqué cada una.
 *
 * El APK llevaba 7 parejas de variantes de llama.rn. La app fija
 * `n_gpu_layers: 0` (src/inference/LlamaEngine.ts) y nunca pide el
 * backend Hexagon, así que la pareja hexagon_opencl (la principal y su
 * JNI, 14.449.672 B) y los 4 assets HTP de `assets/ggml-hexagon/`
 * (3.717.792 B) son peso muerto en todos los aparatos: 18.167.464 B,
 * medidos con rc.7. La rc.9 añade un quinto asset HTP (v85) en el
 * mismo directorio, y el mismo patrón lo saca. La rc.11 (tanda T-22,
 * 2026-11-14) trae el censo idéntico — las mismas 7 variantes arm64
 * en jniLibs, la misma pareja x86_64 y los mismos 5 assets HTP
 * (v73/v75/v79/v81/v85) — verificado sobre su node_modules: las
 * listas de este plugin no cambian.
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
 * carpeta a mano no sobrevive ni a un build. La exclusión va en
 * capas (la cuarta es la que cierra los assets en el binario real;
 * su párrafo va tras el del juez):
 *  1. `packagingOptions.jniLibs.excludes` para la pareja .so.
 *  2. `packagingOptions.resources.excludes` para los assets HTP.
 *  3. `sourceSets.main.assets.exclude` para que mergeAssets ni los
 *     recoja de la carpeta que la tarea de sincronía rellena.
 *  4. La poda del intermedio fusionado, en el `doLast` de
 *     `merge<Variant>Assets` (P-02 assets + P-05 enteros).
 * El juez final no es este fichero: es el diff de listado del APK
 * reconstruido, cableado en CI (paso «Recortes de APK en el listado»
 * de android-apk.yml), porque un error tipográfico en una lista de
 * exclusiones elimina una variante EN SILENCIO — la escalera cubre
 * al usuario y nadie lo notaría sin la comprobación.
 *
 * CUARTA CAPA (tanda del mecanismo, 2026-11-01; cargo de la corrida
 * 41375422202): en el binario real, las capas 2 y 3 NO alcanzan a los
 * assets. La corrida lo midió: la pareja JNI salió (capa 1) y las
 * tablas PQC salieron (la propiedad, porque son recursos Java dentro
 * de un jar), pero los 4 `.so` HTP y los ~100 mapas cmap/ entraron
 * enteros. Los cmap llegan fusionados desde el AAR de fontbox y los
 * HTP los copia `syncRNLlamaHtpAssets` a `src/main/assets` en tiempo
 * de build; las tareas de fusión de assets de AGP no consultan ni
 * `packagingOptions.resources.excludes` ni el `sourceSets` de la app
 * para ese material. La cura actúa donde ya no hay origen que
 * distinga: el intermedio de assets YA fusionados. El bloque gradle
 * engancha `merge<Variant>Assets` y, en su `doLast` — antes de que
 * `compress<Variant>Assets` y `package<Variant>` lo consuman — borra
 * el directorio `ggml-hexagon/` entero y todo fichero de `cmap/` que
 * no sea uno de los 4 supervivientes. La tarea se declara nunca
 * al día (`upToDateWhen { false }`): si la fusión se saltara por
 * incremental, el `doLast` no correría y el intermedio sin podar
 * llegaría al APK en silencio; la fusión es una copia barata y se
 * repite siempre. Si el asiento no aparece o un borrado falla, la
 * build cae en voz alta (GradleException), nunca pasa sin podar.
 */
const { withAppBuildGradle, withGradleProperties } = require("@expo/config-plugins");

/** La pareja que sale (principal + JNI), con su ruta dentro del APK. */
const TRIMMED_JNI_LIBS = [
  "lib/arm64-v8a/librnllama_v8_2_dotprod_i8mm_hexagon_opencl.so",
  "lib/arm64-v8a/librnllama_jni_v8_2_dotprod_i8mm_hexagon_opencl.so",
];

/** El peldaño final de la escalera: jamás en una lista de exclusión. */
const KEPT_LLAMA_LIBS = ["librnllama.so", "librnllama_jni.so"];

/** Los 4 assets HTP viven bajo este prefijo dentro del APK. */
const HTP_ASSET_PATTERN = "assets/ggml-hexagon/**";

/**
 * P-04: las 5 tablas de parámetros PQC de BouncyCastle (Picnic/SIKE,
 * 4.138.070 B deflactados en el APK) no tienen ningún consumidor —
 * grep de BouncyCastle|bcprov|addProvider|Picnic|SIKE en el árbol:
 * cero — y el portador (pdfbox-android, vía su manejador JCE) registra
 * los algoritmos perezosamente: sin tablas, un uso hipotético fallaría
 * en voz alta, nunca en silencio. Las CLASES se quedan (viven en el
 * dex) y los dos ficheros x509/ también: el patrón es solo `pqc/**`.
 */
const PQC_PATTERN = "org/bouncycastle/pqc/**";

/**
 * P-05: los mapas CJK de fontbox (88 ficheros, 1.201.763 B
 * almacenados) son inalcanzables para un producto es/en/pt. Es la
 * regla ENMENDADA de la preparación: su lista literal dejaba dentro
 * los prefijos reales `GBpc-`, `KSCms-`, `KSCpc-`, `B5pc-` (29.497 B,
 * los diez ficheros que el anexo de corrección del encargo enumera),
 * porque pedía `GB-`, `KSC-` y `*B5-*`, que no casa con `B5pc-`.
 * Aquí van las familias de la preparación MÁS esos 4 prefijos. El
 * juez no es esta lista sino el listado: tras la exclusión, en
 * `cmap/` quedan exactamente Identity-H, Identity-V, H, V — los
 * genéricos H y V sobreviven a cualquier versión de la regla y se
 * conservan como Identity-* (el juez original de la preparación no
 * los contaba y por eso también quedó enmendado).
 */
const CMAP_DIR = "assets/com/tom_roush/fontbox/resources/cmap";
const CMAP_PATTERNS = [
  `${CMAP_DIR}/Adobe-*`,
  `${CMAP_DIR}/Uni*`,
  `${CMAP_DIR}/*RKSJ-*`,
  `${CMAP_DIR}/*B5*`,
  `${CMAP_DIR}/CNS-*`,
  `${CMAP_DIR}/EUC-*`,
  `${CMAP_DIR}/GB*`,
  `${CMAP_DIR}/KSC*`,
];

/** Los únicos ficheros que quedan en cmap/ tras la exclusión. */
const CMAP_KEPT = ["Identity-H", "Identity-V", "H", "V"];

/**
 * Las rutas de P-02/P-05 DENTRO del intermedio de assets fusionados
 * (la cuarta capa): el intermedio no lleva el prefijo `assets/` del
 * APK — es el árbol que luego se empaqueta bajo `assets/` — así que
 * se derivan de las constantes de arriba quitando ese prefijo, para
 * que una sola fuente mande en las dos formas de la misma ruta.
 */
const HTP_MERGED_DIR = HTP_ASSET_PATTERN.replace(/^assets\//, "").replace(/\/\*\*$/, "");
const CMAP_MERGED_DIR = CMAP_DIR.replace(/^assets\//, "");

/**
 * La lista plana de exclusiones de empaquetado (P-02 HTP + P-04 +
 * P-05). Viaja por DOS asientos a la vez: la propiedad
 * `android.packagingOptions.excludes` de gradle.properties — el
 * gancho que el propio android/app/build.gradle generado aplica
 * sobre `android.packagingOptions` — y el bloque `resources` del
 * gradle que este plugin añade. AGP no admite negaciones en
 * excludes: la lista enumera y el diff de listado juzga.
 */
const PACKAGING_EXCLUDES = [PQC_PATTERN, ...CMAP_PATTERNS, HTP_ASSET_PATTERN];

const MARKER = "NIDO: recorte de llama.rn (plugins/withLlamaTrim.js)";

/** La propiedad de gradle.properties que el gancho de la plantilla aplica. */
const PACKAGING_PROPERTY_KEY = "android.packagingOptions.excludes";

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
  const resList = PACKAGING_EXCLUDES.map((p) => `                "${p}"`).join(",\n");
  const cmapKeptList = CMAP_KEPT.map((n) => `"${n}"`).join(", ");
  // La cuarta capa (ver la cabecera): poda del intermedio de assets
  // ya fusionados en el doLast de merge<Variant>Assets. Sin `${` en
  // el Groovy generado salvo las literales inyectadas desde las
  // constantes de arriba: una sola fuente para cada ruta.
  const pruneBlock = `
// ${MARKER} · poda del intermedio fusionado (P-02 assets + P-05)
tasks.matching { t -> ["mergeReleaseAssets", "mergeDebugAssets"].contains(t.name) }.configureEach { t ->
    t.outputs.upToDateWhen { false }
    t.doLast {
        def mergedAssetsDir = t.outputs.files.files.find { f -> f.isDirectory() }
        if (mergedAssetsDir == null) {
            throw new GradleException("[withLlamaTrim] mergeAssets sin directorio de salida: la poda no tiene asiento")
        }
        def htpMergedDir = new File(mergedAssetsDir, "${HTP_MERGED_DIR}")
        if (htpMergedDir.isDirectory() && !htpMergedDir.deleteDir()) {
            throw new GradleException("[withLlamaTrim] no se pudo podar " + htpMergedDir)
        }
        def cmapKept = [${cmapKeptList}]
        def cmapMergedDir = new File(mergedAssetsDir, "${CMAP_MERGED_DIR}")
        if (cmapMergedDir.isDirectory()) {
            cmapMergedDir.listFiles().each { f ->
                if (f.isFile() && !cmapKept.contains(f.name) && !f.delete()) {
                    throw new GradleException("[withLlamaTrim] no se pudo podar " + f)
                }
            }
        }
    }
}
`;
  return (
    gradle.replace(/\s*$/, "\n") +
    `\n// ${MARKER}\nandroid {\n    packagingOptions {\n        jniLibs {\n            excludes += [\n${jniList}\n            ]\n        }\n        resources {\n            excludes += [\n${resList}\n            ]\n        }\n    }\n    sourceSets {\n        main {\n            assets {\n                exclude "ggml-hexagon/**"\n            }\n        }\n    }\n}\n` +
    pruneBlock
  );
}

/**
 * Fusiona PACKAGING_EXCLUDES en la propiedad
 * `android.packagingOptions.excludes` de gradle.properties (la lista
 * que el bucle de la plantilla en app/build.gradle vuelca sobre
 * `android.packagingOptions`). Conserva lo que ya hubiera, no duplica
 * y es idempotente. Función pura sobre los ítems del mod
 * (withGradleProperties), probada en el test del plugin.
 */
function applyPackagingProperty(items) {
  const out = items.slice();
  const idx = out.findIndex((it) => it && it.type === "property" && it.key === PACKAGING_PROPERTY_KEY);
  if (idx === -1) {
    out.push({ type: "property", key: PACKAGING_PROPERTY_KEY, value: PACKAGING_EXCLUDES.join(",") });
    return out;
  }
  const existing = String(out[idx].value || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const merged = existing.slice();
  for (const p of PACKAGING_EXCLUDES) if (!merged.includes(p)) merged.push(p);
  out[idx] = { ...out[idx], value: merged.join(",") };
  return out;
}

function withLlamaTrim(config) {
  config = withGradleProperties(config, (c) => {
    c.modResults = applyPackagingProperty(c.modResults);
    return c;
  });
  return withAppBuildGradle(config, (c) => {
    c.modResults.contents = applyLlamaTrimBlock(c.modResults.contents);
    return c;
  });
}

module.exports = withLlamaTrim;
module.exports.applyLlamaTrimBlock = applyLlamaTrimBlock;
module.exports.applyPackagingProperty = applyPackagingProperty;
module.exports.matchPackagingPattern = matchPackagingPattern;
module.exports.isExcluded = isExcluded;
module.exports.TRIMMED_JNI_LIBS = TRIMMED_JNI_LIBS;
module.exports.KEPT_LLAMA_LIBS = KEPT_LLAMA_LIBS;
module.exports.HTP_ASSET_PATTERN = HTP_ASSET_PATTERN;
module.exports.PQC_PATTERN = PQC_PATTERN;
module.exports.CMAP_PATTERNS = CMAP_PATTERNS;
module.exports.CMAP_KEPT = CMAP_KEPT;
module.exports.HTP_MERGED_DIR = HTP_MERGED_DIR;
module.exports.CMAP_MERGED_DIR = CMAP_MERGED_DIR;
module.exports.PACKAGING_EXCLUDES = PACKAGING_EXCLUDES;
module.exports.PACKAGING_PROPERTY_KEY = PACKAGING_PROPERTY_KEY;
module.exports.MARKER = MARKER;
