/**
 * permissionGuard.ts — bandera de flujo de permiso del sistema.
 *
 * T-permiso-2026-10-06: cuando Android muestra el diálogo de permiso de
 * Bluetooth, la Activity se pausa → React Native emite AppState "inactive"
 * → el gate de bloqueo de App.tsx re-bloqueaba, y al cerrarse el diálogo
 * ("active") mandaba a la pantalla "locked", sacando al usuario del P2P
 * hasta el bloqueo inicial. Esta bandera se activa alrededor de
 * `requestPermissions()` para que el gate la respete.
 *
 * Módulo PURO y sin dependencias nativas: App.tsx puede importarlo sin
 * arrastrar expo ni el módulo nido-p2p.
 */

/** Ventana de gracia tras resolverse la solicitud (ms). */
export const PERMISSION_FLOW_GRACE_MS = 5_000;

let inFlight = false;
let lastEndedAt = 0;

/** True mientras el diálogo de permiso del sistema puede estar visible. */
export function isPermissionRequestInFlight(): boolean {
  return inFlight;
}

/**
 * True si hay (o hubo hace muy poco) un flujo de permiso del sistema en
 * curso. La ventana de gracia cubre la carrera entre la resolución de la
 * promesa nativa y el evento AppState "active": el diálogo ya se cerró
 * pero el evento aún no llegó. La ventana es corta y está ligada a una
 * interacción explícita del usuario, así que el impacto en la postura de
 * seguridad es mínimo.
 */
export function isPermissionFlowActive(): boolean {
  if (inFlight) return true;
  return Date.now() - lastEndedAt < PERMISSION_FLOW_GRACE_MS;
}

/**
 * Ejecuta `fn` con la bandera de permiso en curso. Siempre se limpia,
 * incluso si `fn` lanza.
 */
export async function withPermissionRequest<T>(fn: () => Promise<T>): Promise<T> {
  inFlight = true;
  try {
    return await fn();
  } finally {
    inFlight = false;
    lastEndedAt = Date.now();
  }
}

/** Solo para tests: restablece el estado del módulo. */
export function __resetPermissionGuardForTests(): void {
  inFlight = false;
  lastEndedAt = 0;
}
