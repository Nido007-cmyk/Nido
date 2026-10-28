/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * 0.1.55: «NIDO está respondiendo…» mientras la IA escribe (servicio en primer
 * plano de Android, módulo download-wake-lock). Sin él, algunos fabricantes
 * cierran NIDO pocos segundos después de salir de la app y la respuesta se
 * pierde. Varias generaciones a la vez comparten el mismo servicio: se para
 * cuando termina la última. Nunca lanza. Diseño propio (la idea de un aviso
 * «respondiendo» la vimos en BOAR; el código es de NIDO).
 */
import { startAnsweringKeepAlive, stopAnsweringKeepAlive } from "download-wake-lock";
import i18n from "../i18n";

let active = 0;

/** Marca una generación en curso; devuelve su función de fin (idempotente). */
export function holdAnswerKeepAlive(): () => void {
  active += 1;
  if (active === 1) {
    try {
      startAnsweringKeepAlive(
        i18n.t("answering.title"),
        i18n.t("answering.text"),
        i18n.t("answering.channel"),
      );
    } catch (e: unknown) {
      console.warn("[answerKeepAlive] start failed:", (e as Error)?.message ?? e);
    }
  }
  let done = false;
  return () => {
    if (done) return;
    done = true;
    active = Math.max(0, active - 1);
    if (active === 0) {
      try {
        stopAnsweringKeepAlive();
      } catch (e: unknown) {
        console.warn("[answerKeepAlive] stop failed:", (e as Error)?.message ?? e);
      }
    }
  };
}

/** Solo pruebas. */
export function _activeAnswerKeepAlives(): number {
  return active;
}
