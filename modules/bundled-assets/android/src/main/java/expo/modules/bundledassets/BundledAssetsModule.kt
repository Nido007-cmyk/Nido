package expo.modules.bundledassets

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

/**
 * Copies large model files that were baked into the APK's compiled assets
 * (android/app/src/main/assets/models/, populated at build time by
 * plugins/withBundledModels.js) out to the app's regular document
 * directory, so the rest of the app can treat bundled and downloaded models
 * identically via plain file paths. This copy is purely local — reading
 * from the APK's own assets, writing to internal storage — and never
 * touches the network, which is what lets the app work fully offline
 * immediately after install.
 */
class BundledAssetsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("BundledAssets")

    // Lists files under the APK's assets/<subdir>/ (e.g. "models"), or an
    // empty list if the directory doesn't exist (no bundled models built in).
    AsyncFunction("list") { subdir: String ->
      val assetManager = appContext.reactContext?.assets
        ?: return@AsyncFunction emptyArray<String>()
      try {
        assetManager.list(subdir) ?: emptyArray<String>()
      } catch (e: Exception) {
        emptyArray<String>()
      }
    }

    // Streams android/app/src/main/assets/<assetPath> to destAbsolutePath,
    // overwriting any existing file. Runs off the main thread (AsyncFunction
    // default) since this copies up to a few GB.
    AsyncFunction("copyToFile") { assetPath: String, destAbsolutePath: String ->
      val context = appContext.reactContext
        ?: throw IllegalStateException("BundledAssets: no react context")

      val destFile = File(destAbsolutePath)
      destFile.parentFile?.mkdirs()

      val tmpFile = File(destFile.parentFile, "${destFile.name}.part")

      context.assets.open(assetPath).use { input ->
        tmpFile.outputStream().use { output ->
          val buffer = ByteArray(1 shl 20) // 1MB chunks
          while (true) {
            val read = input.read(buffer)
            if (read == -1) break
            output.write(buffer, 0, read)
          }
          output.flush()
        }
      }

      if (destFile.exists()) destFile.delete()
      if (!tmpFile.renameTo(destFile)) {
        throw IllegalStateException("BundledAssets: failed to finalize $destAbsolutePath")
      }

      destFile.length()
    }
  }
}
