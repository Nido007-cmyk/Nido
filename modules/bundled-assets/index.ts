import { requireNativeModule } from "expo-modules-core";

interface BundledAssetsNativeModule {
  list(subdir: string): Promise<string[]>;
  copyToFile(assetPath: string, destAbsolutePath: string): Promise<number>;
}

const BundledAssets = requireNativeModule<BundledAssetsNativeModule>("BundledAssets");

/** Lists files under android/app/src/main/assets/<subdir>/ inside the APK. */
export function listBundledAssets(subdir: string): Promise<string[]> {
  return BundledAssets.list(subdir);
}

/**
 * Copies android/app/src/main/assets/<assetPath> to destAbsolutePath
 * (typically under FileSystem.documentDirectory), purely locally, no
 * network. Returns the copied file's size in bytes.
 */
export function copyBundledAssetToFile(assetPath: string, destAbsolutePath: string): Promise<number> {
  return BundledAssets.copyToFile(assetPath, destAbsolutePath);
}
