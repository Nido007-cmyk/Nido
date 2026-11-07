/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * 0.1.79 — «Permitir capturas de pantalla» (petición del dueño: quería
 * capturas reales de la app para sus publicaciones y FLAG_SECURE las
 * bloqueaba todas).
 *
 * Reglas:
 *  - Apagado por defecto. MainActivity arranca SIEMPRE protegida
 *    (plugins/withFlagSecure.js); solo se quita si la persona lo activa.
 *  - Aunque esté activado, las pantallas con secretos (la clave del
 *    respaldo, escribir la clave al restaurar, el código QR para
 *    emparejar) vuelven a proteger la ventana mientras están a la vista
 *    («retenciones»). Los diálogos seguros tienen su propia ventana
 *    protegida y no dependen de esto.
 *  - Borrar todos los datos lo vuelve a apagar.
 *  - Si algo falla (sin módulo nativo, sin actividad), la ventana se
 *    queda como estaba al arrancar: protegida.
 */

export type SecureWindowBackend = (secure: boolean) => Promise<boolean | null>;

/** ¿Debe estar protegida la ventana? */
export function windowShouldBeSecure(allowed: boolean, holds: number): boolean {
  return !allowed || holds > 0;
}

export interface ScreenCaptureController {
  /** Aplica la preferencia guardada (al arrancar). */
  setAllowed(allowed: boolean): Promise<void>;
  /** Una pantalla con secretos a la vista: protege hasta que se suelte. */
  hold(): () => void;
  /** Estado aplicado a la ventana (true = protegida). */
  applied(): boolean;
  /** Espera a que se apliquen los cambios pendientes. */
  settled(): Promise<void>;
}

export function createScreenCaptureController(backend: SecureWindowBackend): ScreenCaptureController {
  let allowed = false;
  let holds = 0;
  // La ventana nace protegida (FLAG_SECURE en onCreate).
  let applied = true;
  // Los cambios se aplican en orden: el último pedido es el que queda.
  let chain: Promise<void> = Promise.resolve();

  const sync = (): Promise<void> => {
    chain = chain.then(async () => {
      const want = windowShouldBeSecure(allowed, holds);
      if (want === applied) return;
      const got = await backend(want).catch(() => null);
      // Sin confirmación del nativo, no se sabe: se asume protegida para
      // volver a intentarlo la próxima vez que haga falta quitarla.
      applied = got === null ? true : got;
    });
    return chain;
  };

  return {
    setAllowed(next) {
      allowed = next;
      return sync();
    },
    hold() {
      holds++;
      void sync();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        holds--;
        void sync();
      };
    },
    applied: () => applied,
    settled: () => chain,
  };
}

let shared: ScreenCaptureController | null = null;

/** El controlador de la app, sobre el módulo nativo NidoSecureDialog. */
export function screenCapture(): ScreenCaptureController {
  if (!shared) {
    shared = createScreenCaptureController(async (secure) => {
      const { setWindowSecure } = await import("nido-secure-dialog");
      return setWindowSecure(secure);
    });
  }
  return shared;
}

/** Al arrancar: lee la preferencia y la aplica. Nunca lanza. */
export async function initScreenCapture(): Promise<void> {
  try {
    const { getScreenCaptureAllowed } = await import("../models/settings");
    await screenCapture().setAllowed(await getScreenCaptureAllowed());
  } catch {
    // Fallo leyendo la preferencia: la ventana sigue protegida.
  }
}

/** Desde Ajustes: guarda y aplica. */
export async function setScreenCaptureAllowed(allowed: boolean): Promise<void> {
  const { setScreenCaptureAllowedSetting } = await import("../models/settings");
  await setScreenCaptureAllowedSetting(allowed);
  await screenCapture().setAllowed(allowed);
}
