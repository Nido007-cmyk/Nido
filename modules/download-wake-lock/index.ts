/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { requireOptionalNativeModule } from "expo-modules-core";

interface DownloadWakeLockNativeModule {
  acquire(): boolean;
  release(): void;
  startAnswering?(title: string, text: string, channelName: string): boolean;
  stopAnswering?(): void;
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

/**
 * 0.1.55: «NIDO está respondiendo…» (servicio en primer plano) mientras la IA
 * escribe. false si no se pudo (build viejo sin la función, sin contexto).
 */
export function startAnsweringKeepAlive(title: string, text: string, channelName: string): boolean {
  return native?.startAnswering?.(title, text, channelName) ?? false;
}

/** Lo para. Seguro aunque no esté activo. */
export function stopAnsweringKeepAlive(): void {
  native?.stopAnswering?.();
}
