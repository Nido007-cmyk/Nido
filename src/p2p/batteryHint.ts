/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * 0.1.15 — "keep NIDO running in the background" hint for P2P.
 *
 * Android's battery saver (Samsung tablets especially) freezes apps in the
 * background after a while, even with NIDO's foreground service, and the
 * Bluetooth / local Wi-Fi link drops until NIDO is opened again. The fix is
 * a system setting only the user can change, so once they use P2P (have a
 * contact) and NIDO is still optimized, the NIDO screen offers to open it.
 *
 * Without the native module (tests, older build) nothing is shown.
 */
import { getP2PBatteryHintDismissed, setP2PBatteryHintDismissed } from "../models/settings";

interface BatteryNative {
  isIgnoringBatteryOptimizations(): boolean;
  openBatterySettings(): boolean;
}

let native: BatteryNative | null | undefined;
function nativeP2P(): BatteryNative | null {
  if (native === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const m = require("nido-p2p") as Partial<BatteryNative>;
      native =
        typeof m.isIgnoringBatteryOptimizations === "function" && typeof m.openBatterySettings === "function"
          ? (m as BatteryNative)
          : null;
    } catch {
      native = null;
    }
  }
  return native;
}

/** Test hook. */
export function __setBatteryNativeForTest(n: BatteryNative | null | undefined): void {
  native = n;
}

/** NIDO is exempt from battery optimization (or we can't tell). */
export function batteryUnrestricted(): boolean {
  const n = nativeP2P();
  return n ? n.isIgnoringBatteryOptimizations() : true;
}

/** Show the hint: P2P in use, NIDO still optimized, not dismissed. */
export async function shouldShowBatteryHint(contactCount: number): Promise<boolean> {
  if (contactCount <= 0) return false;
  if (batteryUnrestricted()) return false;
  return !(await getP2PBatteryHintDismissed().catch(() => false));
}

export function openBatterySettings(): boolean {
  return nativeP2P()?.openBatterySettings() ?? false;
}

export async function dismissBatteryHint(): Promise<void> {
  await setP2PBatteryHintDismissed(true);
}
