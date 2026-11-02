/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { acquireDownloadWakeLock, releaseDownloadWakeLock } from "download-wake-lock";

/**
 * Keeps the CPU awake (PARTIAL_WAKE_LOCK, screen may turn off) while at
 * least one model download is running. Concurrent downloads share the one
 * native lock; it's released when the last of them ends.
 *
 * B-08 (completada): los agarres se cuentan POR ACTIVO y en total. El
 * nativo es único y compartido: se adquiere solo cuando el total de
 * handles vivos pasa de 0 a 1 y se libera solo cuando vuelve a 0. Dos
 * handles del mismo activo ya no se pisan: soltar uno no libera el
 * nativo mientras el otro siga vivo (la semántica anterior contaba
 * activos en un Set, no handles, y el primer release dejaba caer el
 * bloqueo a media descarga del gemelo).
 */
const counts = new Map<string, number>();
let total = 0;

/**
 * Marks a download as active and returns its release function, which is
 * idempotent. A wake lock failure is logged, never thrown: it must not
 * affect the download itself.
 */
export function holdWakeLockForDownload(assetId: string): () => void {
  counts.set(assetId, (counts.get(assetId) ?? 0) + 1);
  total += 1;
  if (total === 1) {
    try {
      acquireDownloadWakeLock();
    } catch (e: any) {
      console.warn("[downloadWakeLock] acquire failed:", e?.message ?? e);
    }
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const remaining = (counts.get(assetId) ?? 0) - 1;
    if (remaining > 0) {
      counts.set(assetId, remaining);
    } else {
      counts.delete(assetId);
    }
    total -= 1;
    if (total === 0) {
      try {
        releaseDownloadWakeLock();
      } catch (e: any) {
        console.warn("[downloadWakeLock] release failed:", e?.message ?? e);
      }
    }
  };
}
