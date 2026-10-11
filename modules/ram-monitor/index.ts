/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { requireNativeModule } from "expo-modules-core";

export interface MemoryInfo {
  /** Resident set size in bytes (includes resident mmap'd pages, e.g. the loaded GGUF model). */
  rssBytes: number;
  /** Proportional set size in bytes, via ActivityManager (cross-check figure). */
  totalPssBytes: number;
}

/** Un cierre del proceso registrado por Android (ApplicationExitInfo, 11+). */
export interface ExitInfo {
  timestamp: number;
  /** LOW_MEMORY, CRASH, CRASH_NATIVE, ANR, USER_REQUESTED, … */
  reason: string;
  description: string | null;
  status: number;
  importance: number;
  pssKb: number;
  rssKb: number;
  /** Fragmento de la traza del sistema (ANR o fallo nativo), si existe. */
  trace: string | null;
}

export interface CrashReport {
  /** Traza del último fallo Java/JS no capturado (archivo privado), o null. */
  lastCrash: string | null;
  /** Últimos cierres del proceso según Android, del más reciente al más viejo. */
  exits: ExitInfo[];
  sdkInt: number;
  device: string;
}

interface RamMonitorNativeModule {
  getMemoryInfo(): MemoryInfo;
  getDeviceTotalRamBytes(): number;
  installCrashRecorder?(): boolean;
  getCrashReport?(): CrashReport;
  clearCrashReport?(): boolean;
}

const RamMonitor = requireNativeModule<RamMonitorNativeModule>("RamMonitor");

export function getMemoryInfo(): MemoryInfo {
  return RamMonitor.getMemoryInfo();
}

/** Total physical RAM on this device (not this app's usage) — 0 if unavailable. */
export function getDeviceTotalRamBytes(): number {
  try {
    return RamMonitor.getDeviceTotalRamBytes();
  } catch {
    return 0;
  }
}

/**
 * Instala el registro de fallos (idempotente). Llamar al arrancar la app.
 * Builds nativos anteriores no lo tienen: devuelve false sin fallar.
 */
export function installCrashRecorder(): boolean {
  try {
    return RamMonitor.installCrashRecorder?.() ?? false;
  } catch {
    return false;
  }
}

/** Informe de cierres, o null si el build nativo no lo soporta. */
export function getCrashReport(): CrashReport | null {
  try {
    return RamMonitor.getCrashReport?.() ?? null;
  } catch {
    return null;
  }
}

/** Borra la traza guardada del último fallo Java/JS. */
export function clearCrashReport(): void {
  try {
    RamMonitor.clearCrashReport?.();
  } catch {
    /* noop */
  }
}
