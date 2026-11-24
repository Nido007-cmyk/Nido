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

import { backupErrorCode, backupInvalidReason, type BackupInvalidReason } from "../security/backupErrors";

// Forma de dos sobrecargas (sin segundo parámetro opcional): desde i18next 27
// el TFunction real ya no es asignable a `(key, options?) => string`, porque
// sus sobrecargas exigen las opciones presentes o ausentes, nunca `undefined`.
export type TranslateFn = {
  (key: string): string;
  (key: string, options: Record<string, unknown>): string;
};

/**
 * Auditoría 0.1.112, bloque 8: el motivo concreto de un respaldo
 * inválido, en el idioma de la app. Sin motivo conocido, el genérico.
 */
export function invalidBackupText(reason: BackupInvalidReason | null | undefined, t: TranslateFn): string {
  const base = t("backup.errors.invalid");
  if (!reason) return base;
  const key = `backup.invalidReasons.${reason}`;
  const why = t(key);
  return why === key ? base : `${base} ${why}`;
}

export function backupErrorText(e: unknown, t: TranslateFn, fallbackKey: string): string {
  const code = backupErrorCode(e);
  if (code === "invalid") return invalidBackupText(backupInvalidReason(e), t);
  if (code) {
    const key = `backup.errors.${code}`;
    const text = t(key);
    // t devuelve la propia clave cuando no existe traducción:
    // en ese caso manda el genérico localizado, nunca la clave.
    if (text !== key) return text;
  }
  return t(fallbackKey);
}
