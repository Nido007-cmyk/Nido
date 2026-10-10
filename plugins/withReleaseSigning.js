// MIT License
// Copyright (c) 2026 NIDO contributors
// See LICENSE file for details.

const { withAppBuildGradle } = require("@expo/config-plugins");

/**
 * Signs release builds with the key named by these Gradle properties, when
 * they're set (e.g. in ~/.gradle/gradle.properties, never in the repo):
 *
 *   NIDO_UPLOAD_STORE_FILE, NIDO_UPLOAD_KEY_ALIAS,
 *   NIDO_UPLOAD_STORE_PASSWORD, NIDO_UPLOAD_KEY_PASSWORD
 *
 * In CI these come from the NIDO_UPLOAD_* GitHub Secrets (see
 * .github/workflows/android-apk.yml and docs/SIGNING.md).
 *
 * Without them, release builds keep Expo's default debug signing, so anyone
 * can still build the app from source.
 */
function withReleaseSigning(config) {
  return withAppBuildGradle(config, (config) => {
    let gradle = config.modResults.contents;
    if (gradle.includes("NIDO_UPLOAD_STORE_FILE")) return config;

    gradle = gradle.replace(
      /signingConfigs \{\n/,
      `signingConfigs {
        if (project.hasProperty('NIDO_UPLOAD_STORE_FILE')) {
            release {
                storeFile file(NIDO_UPLOAD_STORE_FILE)
                storePassword NIDO_UPLOAD_STORE_PASSWORD
                keyAlias NIDO_UPLOAD_KEY_ALIAS
                keyPassword NIDO_UPLOAD_KEY_PASSWORD
            }
        }
`
    );
    gradle = gradle.replace(
      /(release \{\n(?:\s*\/\/.*\n)*\s*)signingConfig signingConfigs\.debug/,
      "$1signingConfig project.hasProperty('NIDO_UPLOAD_STORE_FILE') ? signingConfigs.release : signingConfigs.debug"
    );
    // A9 (auditoría 2026-10-10): si la plantilla de Expo cambia y los
    // reemplazos no encajan, fallar aquí. En silencio, el APK "release"
    // saldría con firma debug.
    if (
      !gradle.includes("storeFile file(NIDO_UPLOAD_STORE_FILE)") ||
      !gradle.includes("? signingConfigs.release : signingConfigs.debug")
    ) {
      throw new Error(
        "withReleaseSigning: no se pudo inyectar la firma de release en build.gradle " +
          "(¿cambió la plantilla de Expo?). Se aborta para no producir un APK con firma debug."
      );
    }
    config.modResults.contents = gradle;
    return config;
  });
}

module.exports = withReleaseSigning;
