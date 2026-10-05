import { requireNativeModule } from "expo-modules-core";

export interface MemoryInfo {
  /** Resident set size in bytes (includes resident mmap'd pages, e.g. the loaded GGUF model). */
  rssBytes: number;
  /** Proportional set size in bytes, via ActivityManager (cross-check figure). */
  totalPssBytes: number;
}

interface RamMonitorNativeModule {
  getMemoryInfo(): MemoryInfo;
  getDeviceTotalRamBytes(): number;
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
