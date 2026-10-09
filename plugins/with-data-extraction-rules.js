// MIT License
// Copyright (c) 2026 NIDO contributors
// See LICENSE file for details.

/**
 * with-data-extraction-rules.js
 *
 * NIDO es privacy-first: NINGÚN dato de la app debe acabar en backups cloud
 * ni en transferencias device-to-device. Esto incluye:
 *  - bases SQLCipher (aunque cifradas: la DEK vive en el Keystore del
 *    dispositivo origen y no se puede restaurar en otro),
 *  - SecureStore/Keystore (material criptográfico),
 *  - exports, cachés y ficheros temporales con contenido sensible.
 *
 * app.json ya fija android:allowBackup=false, pero en API 31+ el mecanismo
 * moderno son las data extraction rules (también cubren device transfer).
 * Este plugin:
 *  1. genera res/xml/data_extraction_rules.xml con <exclude> EXPLÍCITOS para
 *     los nueve dominios en <cloud-backup> y <device-transfer>;
 *  2. fija android:dataExtractionRules="@xml/data_extraction_rules" en
 *     <application>.
 *
 * NOTA: secciones vacías NO excluyen nada (aplican la política por
 * defecto, que incluye datos). Por eso cada sección lleva los nueve
 * <exclude domain="..." path="."/> explícitos. allowBackup=false ya
 * desactiva el backup cloud en todas las API, pero el device-transfer
 * (D2D) de API 31+ se rige por estas reglas: de ahí la defensa en
 * profundidad.
 *
 * Verificación: npx expo prebuild -p android --clean y comprobar
 * android/app/src/main/res/xml/data_extraction_rules.xml y el atributo en
 * AndroidManifest.xml.
 */
const { withAndroidManifest, withDangerousMod } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

const EXCLUDE_DOMAINS = [
  "root",
  "file",
  "database",
  "sharedpref",
  "external",
  "device_root",
  "device_file",
  "device_database",
  "device_sharedpref",
];

function excludesXml() {
  return EXCLUDE_DOMAINS.map((d) => `    <exclude domain="${d}" path="."/>`).join("\n");
}

const RULES_XML = `<?xml version="1.0" encoding="utf-8"?>
<!-- Generado por plugins/with-data-extraction-rules.js — NIDO no respalda ni transfiere nada. -->
<!-- Secciones vacías aplicarían la política por defecto (incluye datos): -->
<!-- por eso cada sección excluye explícitamente los nueve dominios. -->
<data-extraction-rules>
  <cloud-backup>
${excludesXml()}
  </cloud-backup>
  <device-transfer>
${excludesXml()}
  </device-transfer>
</data-extraction-rules>
`;

function withDataExtractionRulesXml(config) {
  return withDangerousMod(config, [
    "android",
    (config) => {
      const resDir = path.join(
        config.modRequest.platformProjectRoot,
        "app",
        "src",
        "main",
        "res",
        "xml"
      );
      fs.mkdirSync(resDir, { recursive: true });
      fs.writeFileSync(path.join(resDir, "data_extraction_rules.xml"), RULES_XML);
      return config;
    },
  ]);
}

function withDataExtractionRulesAttr(config) {
  return withAndroidManifest(config, (config) => {
    const app = config.modResults.manifest.application?.[0];
    if (app && app.$) {
      app.$["android:dataExtractionRules"] = "@xml/data_extraction_rules";
    }
    return config;
  });
}

module.exports = function withDataExtractionRules(config) {
  config = withDataExtractionRulesXml(config);
  config = withDataExtractionRulesAttr(config);
  return config;
};
