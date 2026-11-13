/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { requireNativeModule, EventEmitter } from "expo-modules-core";

/** Lo que el sistema tiene libre ahora (ActivityManager.MemoryInfo). */
export interface AvailableMemory {
  /** Memoria disponible del sistema, incluida la caché que puede soltar. */
  availBytes: number;
  /** Por debajo de este nivel Android empieza a cerrar apps. */
  thresholdBytes: number;
  /** El sistema ya se considera con poca memoria. */
  lowMemory: boolean;
}

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

/** Batería del aparato (optimización 2026-11-08, fase 3). */
export interface BatteryStatus {
  /** Nivel 0-100; -1 si el sistema no lo reporta. */
  levelPct: number;
  /** Cargando o lleno (enchufado y en carga, o al 100 %). */
  charging: boolean;
  /** Modo de ahorro de batería activo (PowerManager). */
  powerSave: boolean;
}

/**
 * Evento de presión de memoria del sistema (optimización 2026-11-08,
 * fase 5): Android avisa con onTrimMemory; la app descarga los
 * motores antes de que el sistema la cierre.
 */
export interface MemoryPressureEvent {
  /** Nivel de onTrimMemory (10, 15, 20, 40, 60, 80); 15 = RUNNING_CRITICAL. */
  level: number;
}

interface RamMonitorNativeModule {
  getMemoryInfo(): MemoryInfo;
  getDeviceTotalRamBytes(): number;
  getProcessorCount?(): number;
  getAvailableMemory?(): AvailableMemory;
  installCrashRecorder?(): boolean;
  getCrashReport?(): CrashReport;
  clearCrashReport?(): boolean;
  // Optimización 2026-11-08 (fases 3 y 5): opcionales, como el resto
  // de sondas tardías — builds nativos anteriores no las tienen y
  // los envoltorios devuelven null/sin suscripción.
  getBatteryStatus?(): BatteryStatus;
  getThermalStatus?(): number;
  addListener?(eventName: string): void;
  removeListeners?(count: number): void;
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

/** Memoria libre del sistema ahora; null en builds nativos anteriores o sin lectura. */
export function getAvailableMemory(): AvailableMemory | null {
  try {
    const m = RamMonitor.getAvailableMemory?.();
    return m && m.availBytes > 0 ? m : null;
  } catch {
    return null;
  }
}

/** Logical cores on this device (P-03) — null if the native build predates the probe. */
export function getProcessorCount(): number | null {
  try {
    return RamMonitor.getProcessorCount?.() ?? null;
  } catch {
    return null;
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

/**
 * Batería del aparato (fase 3): nivel, carga y modo de ahorro.
 * Null en builds nativos anteriores o si la lectura falla: sin
 * sonda no hay topes, como siempre.
 */
export function getBatteryStatus(): BatteryStatus | null {
  try {
    const b = RamMonitor.getBatteryStatus?.();
    return b && typeof b.levelPct === "number" ? b : null;
  } catch {
    return null;
  }
}

/**
 * Estado térmico del sistema (fase 3): escala de
 * PowerManager.getCurrentThermalStatus — 0 (ninguno) a 6
 * (apagado). -1 o null cuando el aparato o el build no lo reportan.
 */
export function getThermalStatus(): number | null {
  try {
    const t = RamMonitor.getThermalStatus?.();
    return typeof t === "number" ? t : null;
  } catch {
    return null;
  }
}

/**
 * Suscripción al evento de presión de memoria (fase 5). Devuelve
 * una suscripción anulable ({ remove }) o una anulable vacía en
 * builds sin el evento: nunca lanza, para que el abonado pueda
 * llamarla al montar sin envolverla.
 */
export function addMemoryPressureListener(
  listener: (event: MemoryPressureEvent) => void,
): { remove: () => void } {
  const noop = { remove: () => undefined };
  try {
    if (typeof RamMonitor.addListener !== "function") return noop;
    const emitter = new EventEmitter(RamMonitor as never);
    const sub = emitter.addListener("onMemoryPressure" as never, listener as never);
    return { remove: () => sub.remove() };
  } catch {
    return noop;
  }
}
/**
 * Borra la traza guardada del último fallo Java/JS. */
export function clearCrashReport(): void {
  try {
    RamMonitor.clearCrashReport?.();
  } catch {
    /* noop */
  }
}
