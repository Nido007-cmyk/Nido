import { acquireDownloadWakeLock, releaseDownloadWakeLock } from "download-wake-lock";

/**
 * Keeps the CPU awake (PARTIAL_WAKE_LOCK, screen may turn off) while at
 * least one model download is running. Concurrent downloads share the one
 * native lock; it's released when the last of them ends.
 */
const active = new Set<string>();

/**
 * Marks a download as active and returns its release function, which is
 * idempotent. A wake lock failure is logged, never thrown: it must not
 * affect the download itself.
 */
export function holdWakeLockForDownload(assetId: string): () => void {
  if (!active.has(assetId)) {
    active.add(assetId);
    if (active.size === 1) {
      try {
        acquireDownloadWakeLock();
      } catch (e: any) {
        console.warn("[downloadWakeLock] acquire failed:", e?.message ?? e);
      }
    }
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (!active.delete(assetId)) return;
    if (active.size === 0) {
      try {
        releaseDownloadWakeLock();
      } catch (e: any) {
        console.warn("[downloadWakeLock] release failed:", e?.message ?? e);
      }
    }
  };
}
