/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { requireNativeModule, type EventSubscription } from "expo-modules-core";

export interface NidoLaunchNative {
  /** Acción pendiente ({action, text?}) y la borra; null si no hay. */
  getPendingAction(): { action: string; text?: string } | null;
  /** Atajos del icono con etiquetas ya traducidas. */
  setShortcuts(items: Array<{ id: string; label: string }>): boolean;
  addListener(event: "onLaunchAction", listener: () => void): EventSubscription;
}

const NidoLaunch = requireNativeModule<NidoLaunchNative>("NidoLaunch");
export default NidoLaunch;
