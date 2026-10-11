/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * launchActions.ts — NIDO desde fuera de la app (0.1.10).
 *
 * El módulo nativo nido-launch guarda una "acción pendiente" cuando NIDO se
 * abre desde "Compartir", un atajo del icono o el acceso rápido de la barra
 * de ajustes. El chat la recoge cuando ya está visible (después del bloqueo
 * y de la bóveda) y la aplica.
 *
 * Regla de seguridad: el texto compartido viene de OTRA app y no es de
 * confianza. Solo se coloca en el campo de texto; el usuario lo revisa y
 * decide si lo envía. Nunca se envía ni se ejecuta solo.
 */

export type LaunchAction =
  | { action: "new_chat" }
  | { action: "p2p" }
  | { action: "share"; text: string };

const MAX_SHARED_CHARS = 4000;

/** Valida lo que entrega el módulo nativo (puro, testeable). */
export function parseLaunchAction(raw: unknown): LaunchAction | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { action?: unknown; text?: unknown };
  if (r.action === "new_chat" || r.action === "p2p") return { action: r.action };
  if (r.action === "share" && typeof r.text === "string") {
    // Quita caracteres de control (salvo saltos de línea y tabulador).
    const text = r.text
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
      .trim()
      .slice(0, MAX_SHARED_CHARS);
    return text ? { action: "share", text } : null;
  }
  return null;
}

interface NativeLaunch {
  getPendingAction(): unknown;
  setShortcuts(items: Array<{ id: string; label: string }>): boolean;
  addListener(event: "onLaunchAction", listener: () => void): { remove(): void };
}

function native(): NativeLaunch | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const m = require("nido-launch") as { default?: NativeLaunch };
    return m?.default && typeof m.default.getPendingAction === "function" ? m.default : null;
  } catch {
    return null;
  }
}

/** Recoge (y borra) la acción pendiente, si la hay. Nunca lanza. */
export function takeLaunchAction(): LaunchAction | null {
  try {
    return parseLaunchAction(native()?.getPendingAction());
  } catch {
    return null;
  }
}

/** Avisa cuando llega una acción con NIDO ya abierto. Devuelve la baja. */
export function onLaunchAction(listener: () => void): () => void {
  try {
    const sub = native()?.addListener("onLaunchAction", listener);
    return () => sub?.remove();
  } catch {
    return () => {};
  }
}

/** Registra los atajos del icono con los textos en el idioma actual. */
export function registerShortcuts(labels: { newChat: string; p2p: string }): void {
  try {
    native()?.setShortcuts([
      { id: "new_chat", label: labels.newChat },
      { id: "p2p", label: labels.p2p },
    ]);
  } catch {
    /* sin atajos: no es crítico */
  }
}
