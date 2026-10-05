import { requireOptionalNativeModule } from "expo-modules-core";

interface DownloadWakeLockNativeModule {
  acquire(): boolean;
  release(): void;
}

// Optional: a JS bundle reloaded onto an older build without this module
// must keep downloading, just without the wake lock.
const native = requireOptionalNativeModule<DownloadWakeLockNativeModule>("DownloadWakeLock");

/** Acquires the PARTIAL_WAKE_LOCK "NIDO:ModelDownload". No-op if already held. */
export function acquireDownloadWakeLock(): boolean {
  return native?.acquire() ?? false;
}

/** Releases it. Safe to call when not held. */
export function releaseDownloadWakeLock(): void {
  native?.release();
}
