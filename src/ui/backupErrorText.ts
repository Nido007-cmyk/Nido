/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

// Auditoría completa 2026-10-31 (F9-03): el texto de error que ve el
// usuario nunca es el mensaje interno crudo. Los errores internos
// nacen en un solo idioma (español en el subsistema de respaldo,
// inglés en otros) y un usuario en otro idioma recibía el cuerpo
// sin traducir. La regla: si el error trae código conocido, su
// texto localizado (backup.errors.<código>); si no, el genérico
// localizado de la operación. El detalle interno se queda en el
// registro del servicio que lo lanzó, no en la alerta.

import { backupErrorCode } from "../security/backupErrors";

export type TranslateFn = (key: string, options?: Record<string, unknown>) => string;

export function backupErrorText(e: unknown, t: TranslateFn, fallbackKey: string): string {
  const code = backupErrorCode(e);
  if (code) {
    const key = `backup.errors.${code}`;
    const text = t(key);
    // t devuelve la propia clave cuando no existe traducción:
    // en ese caso manda el genérico localizado, nunca la clave.
    if (text !== key) return text;
  }
  return t(fallbackKey);
}
