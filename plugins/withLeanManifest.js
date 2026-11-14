// MIT License
// Copyright (c) 2026 NIDO contributors
// See LICENSE file for details.

/**
 * withLeanManifest.js — 0.1.47 (auditoría del manifiesto final).
 *
 * Compilación reproducible: el plugin de Gradle de React Native guarda en
 * los recursos la IP de la máquina que compila (react_native_dev_server_ip,
 * para el servidor de desarrollo). En release no se usa, pero hacía que dos
 * compilaciones del mismo código en máquinas distintas salieran con un
 * resources.arsc diferente. En el tipo de compilación release se fija a
 * "localhost" (los valores del buildType tienen prioridad sobre los de
 * defaultConfig).
 *
 * Hasta la 0.1.95 este plugin también quitaba del manifiesto final los
 * componentes de Firebase que traía expo-notifications (receptor y
 * servicio push, FirebaseInitProvider, ComponentDiscoveryService). Desde
 * la 0.1.96 (paquete NIDO-SIN-GOOGLE-2026-11-13) expo-notifications ya no
 * está y Firebase no entra en la compilación: no queda nada que quitar.
 * Que no vuelva lo vigila el censo del binario de cada compilación
 * (scripts/check-google-free.py en android-apk.yml). Los permisos de
 * Google siguen en `android.blockedPermissions` de app.json como cerrojo.
 */
const { withAppBuildGradle } = require("@expo/config-plugins");

const MARKER = "NIDO: IP fija del servidor de desarrollo en release (plugins/withLeanManifest.js)";

/**
 * Añade al final de app/build.gradle un bloque propio que vuelve a
 * configurar buildTypes.release (Gradle combina las dos configuraciones).
 * No se toca el bloque release original: otros plugins (withReleaseSigning)
 * buscan su forma exacta. Idempotente.
 */
function applyStableDevServerIp(gradle) {
  if (gradle.includes(MARKER)) return gradle;
  if (!/\bandroid\s*\{/.test(gradle)) {
    throw new Error("[withLeanManifest] app/build.gradle sin bloque android { }");
  }
  return (
    gradle.replace(/\s*$/, "\n") +
    `\n// ${MARKER}\nandroid {\n    buildTypes {\n        release {\n            resValue "string", "react_native_dev_server_ip", "localhost"\n        }\n    }\n}\n`
  );
}

function withLeanManifest(config) {
  return withAppBuildGradle(config, (c) => {
    c.modResults.contents = applyStableDevServerIp(c.modResults.contents);
    return c;
  });
}

module.exports = withLeanManifest;
module.exports.applyStableDevServerIp = applyStableDevServerIp;
