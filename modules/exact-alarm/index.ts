/*
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Estado de las alarmas exactas (Android 12+).
 *
 * 0.1.32: el módulo nativo se resuelve al USARLO, no al importar. Antes
 * `requireNativeModule` se llamaba al cargar el archivo: sin la parte
 * nativa compilada lanzaba en ese momento (así cayó el aviso de la 0.1.x
 * que se quitó por cerrar la app). Si el nativo no está, se devuelve
 * `null` («no se sabe») y la pantalla no muestra nada.
 */
import { requireOptionalNativeModule } from "expo-modules-core";

interface ExactAlarmNative {
  canScheduleExactAlarms(): boolean;
  openExactAlarmSettings(): boolean;
}

function native(): ExactAlarmNative | null {
  try {
    return requireOptionalNativeModule<ExactAlarmNative>("ExactAlarm");
  } catch {
    return null;
  }
}

/** true/false si se sabe; null si el módulo nativo no está disponible. */
export async function canScheduleExactAlarms(): Promise<boolean | null> {
  const m = native();
  if (!m) return null;
  try {
    return Boolean(await m.canScheduleExactAlarms());
  } catch {
    return null;
  }
}

/** Abre la pantalla del sistema para permitir alarmas exactas. */
export async function openExactAlarmSettings(): Promise<boolean> {
  const m = native();
  if (!m) return false;
  try {
    return Boolean(await m.openExactAlarmSettings());
  } catch {
    return false;
  }
}
