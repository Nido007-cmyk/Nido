// MIT License
// Copyright (c) 2026 NIDO contributors
// See LICENSE file for details.

/**
 * withBundledPacks.js (0.1.95)
 *
 * Copia los packs de primer arranque de assets/bundled-packs/ a
 * android/app/src/main/assets/packs/ en cada `expo prebuild --clean`, para
 * que viajen dentro del APK. src/models/firstRunPacks.ts los instala desde
 * ahí con ModelManager.installBundled, que verifica tamaño y SHA-256 contra
 * el catálogo firmado antes de marcarlos instalados.
 *
 * A diferencia de withBundledModels.js (los GGUF, opcional y sin usar), aquí
 * la falta de un archivo esperado hace FALLAR el prebuild: un APK sin estos
 * packs saldría sin números de emergencia hasta la primera descarga, y eso
 * tiene que verse en el CI, no en el teléfono de alguien.
 *
 * Verificación física PENDIENTE (Tab A9+, build publicada): instalación
 * limpia en modo avión, la pestaña de Emergencia del asistente muestra los
 * números del país y la biblioteca abre las guías.
 */
const { withDangerousMod } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

const SOURCE_DIR = path.join(__dirname, "..", "assets", "bundled-packs");

/** Los cuatro archivos: dos packs × dos modelos de búsqueda. */
const EXPECTED_FILES = [
  "nido-esencial.sqlite",
  "nido-esencial-e5.sqlite",
  "nido-local.sqlite",
  "nido-local-e5.sqlite",
];

/** Copia los packs esperados a destDir. Lanza si falta alguno. Devuelve los copiados. */
function copyBundledPacks(sourceDir, destDir) {
  const missing = EXPECTED_FILES.filter((f) => !fs.existsSync(path.join(sourceDir, f)));
  if (missing.length > 0) {
    throw new Error(
      `[withBundledPacks] faltan packs de primer arranque en ${sourceDir}: ${missing.join(", ")}`
    );
  }
  fs.mkdirSync(destDir, { recursive: true });
  for (const file of EXPECTED_FILES) {
    fs.copyFileSync(path.join(sourceDir, file), path.join(destDir, file));
  }
  return [...EXPECTED_FILES];
}

function withBundledPacks(config) {
  return withDangerousMod(config, [
    "android",
    async (cfg) => {
      const destDir = path.join(cfg.modRequest.platformProjectRoot, "app", "src", "main", "assets", "packs");
      const copied = copyBundledPacks(SOURCE_DIR, destDir);
      console.log(`[withBundledPacks] ${copied.length} packs copiados a ${destDir}`);
      return cfg;
    },
  ]);
}

module.exports = withBundledPacks;
module.exports.copyBundledPacks = copyBundledPacks;
module.exports.EXPECTED_FILES = EXPECTED_FILES;
module.exports.SOURCE_DIR = SOURCE_DIR;
