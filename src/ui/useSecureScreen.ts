/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * 0.1.79: mientras `active`, la ventana no admite capturas aunque la
 * persona las haya permitido en Ajustes (src/security/screenCapture.ts).
 */
import { useEffect } from "react";
import { screenCapture } from "../security/screenCapture";

export function useSecureScreen(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    return screenCapture().hold();
  }, [active]);
}
