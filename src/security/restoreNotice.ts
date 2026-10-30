/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * restoreNotice.ts — auditoría 2026-10-29: el aviso antes de restaurar.
 *
 * Restaurar devuelve los datos tal como estaban el día del respaldo: lo
 * borrado después vuelve. Antes la pantalla solo decía «reemplazará todos tus
 * datos», sin fecha. Ahora dice de cuándo es y qué vuelve. Los contactos
 * revocados siguen revocados (esa lista vive fuera de la base y restaurar no
 * la toca), y el aviso lo dice para que nadie revoque otra vez por miedo.
 *
 * Puro: sin React ni módulos nativos.
 */
import type { BackupManifestInfo } from "./backup";

type T = (key: string, vars?: Record<string, string>) => string;

/** Fecha legible del respaldo; la parte ISO si el teléfono no sabe formatear. */
export function formatBackupDate(iso: string, lang: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
    return d.toLocaleDateString(lang, { day: "numeric", month: "long", year: "numeric" });
  } catch {
    return iso.slice(0, 10);
  }
}

export function restoreConfirmText(t: T, info: BackupManifestInfo | undefined, lang: string): string {
  if (!info?.createdAt) return t("backup.restoreConfirm");
  const made = info.appVersion ? t("backup.restoreMadeWith", { version: info.appVersion }) : "";
  return t("backup.restoreConfirmDated", { date: formatBackupDate(info.createdAt, lang), made });
}
