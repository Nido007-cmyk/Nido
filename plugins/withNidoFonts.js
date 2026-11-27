// MIT License
// Copyright (c) 2026 NIDO contributors
// See LICENSE file for details.

/**
 * withNidoFonts.js (0.1.117, UI nueva)
 *
 * Copia las tipografías de assets/fonts/ a android/app/src/main/assets/fonts/
 * en cada prebuild. React Native en Android las encuentra por su nombre de
 * fichero, con la convención de familia + sufijo: "AtkinsonHyperlegibleNext"
 * (normal) y "AtkinsonHyperlegibleNext_bold" (negrita) forman una familia,
 * y fontWeight elige. No hay carga en tiempo de ejecución: nada que esperar
 * al abrir la app y nada que descargar.
 *
 * Cada fichero se comprueba con su SHA-256 antes de copiarlo; uno que falte
 * o no coincida hace FALLAR el prebuild (se ve en la CI, no en el teléfono).
 * Licencia: SIL Open Font License 1.1 (assets/fonts/OFL-*.txt).
 */
const { withDangerousMod } = require("@expo/config-plugins");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const SOURCE_DIR = path.join(__dirname, "..", "assets", "fonts");

const FONTS = {
  "AtkinsonHyperlegibleNext.ttf": "60f8c1a1b2e7da47ff7af95c3e5b5b1232ca5b3771e93eb587784f08fb1e6650",
  "AtkinsonHyperlegibleNextSemiBold.ttf": "896483629d2c885e6786284a65b07e85ef1a56ed56945e34194ccd579d5bdad6",
  "AtkinsonHyperlegibleNext_bold.ttf": "4ba7415b7095e546720446b6d47daa95d6f482d9fd40c729793e21d67cc9f366",
  "SourceSerif4.ttf": "f8ca116c25700ca7aafe73ca5c9939b48420d32c0dd8192dcac042c7373cbfd8",
};

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

/** Verifica y copia las fuentes a destDir. Lanza si falta o no coincide alguna. */
function copyFonts(sourceDir, destDir) {
  const bad = Object.entries(FONTS)
    .filter(([name, hash]) => {
      const file = path.join(sourceDir, name);
      return !fs.existsSync(file) || sha256(file) !== hash;
    })
    .map(([name]) => name);
  if (bad.length > 0) {
    throw new Error(`[withNidoFonts] fuentes que faltan o no coinciden con su SHA-256: ${bad.join(", ")}`);
  }
  fs.mkdirSync(destDir, { recursive: true });
  for (const name of Object.keys(FONTS)) {
    fs.copyFileSync(path.join(sourceDir, name), path.join(destDir, name));
  }
  return Object.keys(FONTS);
}

function withNidoFonts(config) {
  return withDangerousMod(config, [
    "android",
    async (cfg) => {
      const destDir = path.join(cfg.modRequest.platformProjectRoot, "app", "src", "main", "assets", "fonts");
      const copied = copyFonts(SOURCE_DIR, destDir);
      console.log(`[withNidoFonts] ${copied.length} fuentes copiadas a ${destDir}`);
      return cfg;
    },
  ]);
}

module.exports = withNidoFonts;
module.exports.copyFonts = copyFonts;
module.exports.FONTS = FONTS;
module.exports.SOURCE_DIR = SOURCE_DIR;
