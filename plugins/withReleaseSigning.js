const { withAppBuildGradle } = require("@expo/config-plugins");

/**
 * Signs release builds with the key named by these Gradle properties, when
 * they're set (e.g. in ~/.gradle/gradle.properties, never in the repo):
 *
 *   BOAR_UPLOAD_STORE_FILE, BOAR_UPLOAD_KEY_ALIAS,
 *   BOAR_UPLOAD_STORE_PASSWORD, BOAR_UPLOAD_KEY_PASSWORD
 *
 * Without them, release builds keep Expo's default debug signing, so anyone
 * can still build the app from source.
 */
function withReleaseSigning(config) {
  return withAppBuildGradle(config, (config) => {
    let gradle = config.modResults.contents;
    if (gradle.includes("BOAR_UPLOAD_STORE_FILE")) return config;

    gradle = gradle.replace(
      /signingConfigs \{\n/,
      `signingConfigs {
        if (project.hasProperty('BOAR_UPLOAD_STORE_FILE')) {
            release {
                storeFile file(BOAR_UPLOAD_STORE_FILE)
                storePassword BOAR_UPLOAD_STORE_PASSWORD
                keyAlias BOAR_UPLOAD_KEY_ALIAS
                keyPassword BOAR_UPLOAD_KEY_PASSWORD
            }
        }
`
    );
    gradle = gradle.replace(
      /(release \{\n(?:\s*\/\/.*\n)*\s*)signingConfig signingConfigs\.debug/,
      "$1signingConfig project.hasProperty('BOAR_UPLOAD_STORE_FILE') ? signingConfigs.release : signingConfigs.debug"
    );
    config.modResults.contents = gradle;
    return config;
  });
}

module.exports = withReleaseSigning;
