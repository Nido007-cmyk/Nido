const { withDangerousMod, withAppBuildGradle } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

const SOURCE_DIR = path.join(__dirname, "..", "assets", "models");

/**
 * Copies the verified GGUF model files from assets/models/ (produced by
 * scripts/setup-models.sh) into the generated native Android project's
 * android/app/src/main/assets/models/, so they get baked into the APK
 * itself. Also marks .gguf as uncompressed in the APK (aaptOptions
 * noCompress) — these files are already dense quantized binaries, so
 * deflate compression just wastes build time and install-time CPU for no
 * size benefit.
 *
 * Requires scripts/setup-models.sh to have been run first; if the source
 * files are missing, this plugin is a no-op (with a warning) rather than
 * failing the build, so the app can still be built without the bundled
 * default (falling back to the in-app download catalog).
 */
function withBundledModels(config) {
  config = withDangerousMod(config, [
    "android",
    async (config) => {
      const destDir = path.join(
        config.modRequest.platformProjectRoot,
        "app",
        "src",
        "main",
        "assets",
        "models"
      );

      if (!fs.existsSync(SOURCE_DIR)) {
        console.warn(
          "[withBundledModels] assets/models/ not found — run scripts/setup-models.sh " +
            "before prebuild to bundle the default models. Skipping."
        );
        return config;
      }

      fs.mkdirSync(destDir, { recursive: true });

      const files = fs.readdirSync(SOURCE_DIR).filter((f) => f.endsWith(".gguf"));
      if (files.length === 0) {
        console.warn(
          "[withBundledModels] assets/models/ has no .gguf files — run scripts/setup-models.sh first."
        );
        return config;
      }

      for (const file of files) {
        const src = path.join(SOURCE_DIR, file);
        const dest = path.join(destDir, file);
        console.log(`[withBundledModels] bundling ${file} (${(fs.statSync(src).size / 1e9).toFixed(2)}GB)`);
        fs.copyFileSync(src, dest);
      }

      return config;
    },
  ]);

  config = withAppBuildGradle(config, (config) => {
    if (!config.modResults.contents.includes("noCompress")) {
      config.modResults.contents = config.modResults.contents.replace(
        /android\s*\{/,
        `android {\n    aaptOptions {\n        noCompress "gguf"\n    }\n`
      );
    }
    return config;
  });

  return config;
}

module.exports = withBundledModels;
