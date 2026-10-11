// MIT License
// Copyright (c) 2026 NIDO contributors
// See LICENSE file for details.

/**
 * with-bluetooth-never-for-location.js
 *
 * Marca BLUETOOTH_SCAN con android:usesPermissionFlags="neverForLocation".
 *
 * NIDO usa discovery Bluetooth clásico solo para encontrar otros NIDOs
 * cercanos; nunca deriva ubicación física de los resultados. Sin este flag,
 * Android 12+ puede exigir además el permiso de ubicación para escanear.
 * Con el flag, en API 31+ NO se pide ubicación (privacidad: la app no
 * quiere saber dónde estás, solo quién está cerca hablando NIDO).
 *
 * En API < 31 el discovery clásico sí exige ACCESS_FINE_LOCATION a nivel
 * de plataforma: ese permiso se sigue declarando y pidiendo solo ahí.
 */
const { withAndroidManifest } = require("@expo/config-plugins");

const SCAN = "android.permission.BLUETOOTH_SCAN";
const FINE_LOCATION = "android.permission.ACCESS_FINE_LOCATION";
const COARSE_LOCATION = "android.permission.ACCESS_COARSE_LOCATION";

/**
 * Transformación pura del manifiesto (testeable sin Expo).
 * - BLUETOOTH_SCAN → neverForLocation (API 31+).
 * - ACCESS_FINE/COARSE_LOCATION → maxSdkVersion="30": solo se piden en
 *   API < 31 (NidoP2PManager.missingPermissions), así que en Android 12+
 *   la app ni siquiera declara ubicación (auditoría 2026-10-10, L7).
 *   No se pisa un maxSdkVersion ya fijado si es menor.
 */
function applyBluetoothLocationFlags(manifest) {
  const perms = manifest["uses-permission"] || [];
  for (const p of perms) {
    if (!p || !p.$) continue;
    const name = p.$["android:name"];
    if (name === SCAN) {
      p.$["android:usesPermissionFlags"] = "neverForLocation";
    } else if (name === FINE_LOCATION || name === COARSE_LOCATION) {
      const current = Number(p.$["android:maxSdkVersion"]);
      if (!Number.isInteger(current) || current > 30) {
        p.$["android:maxSdkVersion"] = "30";
      }
    }
  }
  return manifest;
}

function withBluetoothNeverForLocation(config) {
  return withAndroidManifest(config, (config) => {
    applyBluetoothLocationFlags(config.modResults.manifest);
    return config;
  });
}

module.exports = withBluetoothNeverForLocation;
module.exports.applyBluetoothLocationFlags = applyBluetoothLocationFlags;
