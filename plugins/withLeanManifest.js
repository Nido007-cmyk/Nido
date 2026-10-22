// MIT License
// Copyright (c) 2026 NIDO contributors
// See LICENSE file for details.

/**
 * withLeanManifest.js — 0.1.47 (auditoría del manifiesto final).
 *
 * 1. Quita del manifiesto FINAL lo que traen librerías y NIDO no usa:
 *    - el receptor y el servicio de notificaciones push de Firebase
 *      (expo-notifications los incluye; NIDO no usa push ni servidores);
 *    - sus permisos (c2dm RECEIVE) y el "install referrer" de Google Play.
 *    Los permisos se quitan con `android.blockedPermissions` en app.json;
 *    aquí, los componentes, con tools:node="remove".
 *
 * 2. Compilación reproducible: el plugin de Gradle de React Native guarda
 *    en los recursos la IP de la máquina que compila
 *    (react_native_dev_server_ip, para el servidor de desarrollo). En
 *    release no se usa, pero hacía que dos compilaciones del mismo código
 *    en máquinas distintas salieran con un resources.arsc diferente. En el
 *    tipo de compilación release se fija a "localhost" (los valores del
 *    buildType tienen prioridad sobre los de defaultConfig).
 */
const { withAndroidManifest, withAppBuildGradle } = require("@expo/config-plugins");

const REMOVED_COMPONENTS = [
  ["receiver", "com.google.firebase.iid.FirebaseInstanceIdReceiver"],
  ["service", "expo.modules.notifications.service.ExpoFirebaseMessagingService"],
  ["service", "com.google.firebase.messaging.FirebaseMessagingService"],
];

const MARKER = "NIDO: IP fija del servidor de desarrollo en release (plugins/withLeanManifest.js)";

/** Transformación pura del manifiesto (probada en withLeanManifest.test.js). */
function applyLeanManifest(manifest) {
  manifest.$ = manifest.$ || {};
  manifest.$["xmlns:tools"] = manifest.$["xmlns:tools"] || "http://schemas.android.com/tools";
  const app = (manifest.application && manifest.application[0]) || null;
  if (!app) return manifest;
  for (const [kind, name] of REMOVED_COMPONENTS) {
    const list = (app[kind] = app[kind] || []);
    const existing = list.find((c) => c && c.$ && c.$["android:name"] === name);
    if (existing) {
      existing.$["tools:node"] = "remove";
    } else {
      list.push({ $: { "android:name": name, "tools:node": "remove" } });
    }
  }
  return manifest;
}

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
  config = withAndroidManifest(config, (c) => {
    c.modResults.manifest = applyLeanManifest(c.modResults.manifest);
    return c;
  });
  return withAppBuildGradle(config, (c) => {
    c.modResults.contents = applyStableDevServerIp(c.modResults.contents);
    return c;
  });
}

module.exports = withLeanManifest;
module.exports.applyLeanManifest = applyLeanManifest;
module.exports.applyStableDevServerIp = applyStableDevServerIp;
module.exports.REMOVED_COMPONENTS = REMOVED_COMPONENTS;
