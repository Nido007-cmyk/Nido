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

function withBluetoothNeverForLocation(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;
    const perms = manifest["uses-permission"] || [];
    for (const p of perms) {
      if (p && p.$ && p.$["android:name"] === SCAN) {
        p.$["android:usesPermissionFlags"] = "neverForLocation";
      }
    }
    return config;
  });
}

module.exports = withBluetoothNeverForLocation;
