/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * contactSearch.ts — piezas PURAS de la búsqueda de contactos y de la
 * comprobación de permisos (sin módulos nativos: testeables en Node).
 * handlers.ts las usa con expo-contacts / expo-calendar reales.
 */

import { withPermissionRequest } from "../../p2p/permissionGuard";
import type { ContactMatch } from "../loop/contactRouter";

/**
 * TOOLS-AUDIT 2026-10-11 (bug del lock screen tras pedir permisos).
 *
 * Causa raíz, verificada en el código de expo-modules-core (SDK 57,
 * PermissionsService.askForPermissions → delegateRequestToActivity):
 * `request*Permissions` SIEMPRE llama a Activity.requestPermissions, aunque
 * el permiso ya esté concedido. Android lanza entonces la actividad del
 * sistema (aunque se cierre al instante), NIDO pasa a "background" y el
 * gate de App.tsx bloquea al volver. Por eso CADA búsqueda de contacto
 * mandaba a "NIDO locked".
 *
 * Arreglo: (1) consultar primero con get*Permissions (no abre nada) y
 * pedir solo si falta y Android aún deja preguntar; (2) la petición real
 * va dentro de withPermissionRequest, la misma bandera que ya usa el P2P,
 * para que App.tsx sepa que la pausa la causó un diálogo propio.
 */
export type PermissionCheck =
  | { ok: true }
  | { ok: false; reason: "denied" | "blocked" | "unavailable" };

export async function ensureRuntimePermission(api: {
  get: () => Promise<{ granted: boolean; canAskAgain?: boolean }>;
  request: () => Promise<{ granted: boolean; canAskAgain?: boolean }>;
}): Promise<PermissionCheck> {
  try {
    const current = await api.get();
    if (current.granted) return { ok: true };
    if (current.canAskAgain === false) return { ok: false, reason: "blocked" };
    const asked = await withPermissionRequest(() => api.request());
    if (asked.granted) return { ok: true };
    return { ok: false, reason: asked.canAskAgain === false ? "blocked" : "denied" };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

/** Normaliza para comparar nombres sin mayúsculas ni acentos ("Rubén" = "ruben"). */
export function normalizeForContactSearch(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Filtro puro de la agenda (exportado para tests): coincide por nombre
 * (sin mayúsculas ni acentos) o por número. Nunca devuelve la agenda
 * completa. Acepta el registro de la API nueva de expo-contacts
 * (`fullName`, `phones`) y, por compatibilidad, el de la antigua
 * (`name`, `phoneNumbers`).
 */
export function filterContacts(all: readonly any[], query: string, limit = 5): ContactMatch[] {
  const q = normalizeForContactSearch(query);
  if (!q) return [];
  const qDigits = q.replace(/\D/g, "");
  const phonesOf = (c: any): string[] =>
    ((c?.phones ?? c?.phoneNumbers ?? []) as any[])
      .map((p: any) => String(p?.number ?? "").trim())
      .filter((n: string) => n.length > 0);
  const nameOf = (c: any): string =>
    String(
      c?.fullName ??
        c?.name ??
        [c?.givenName ?? c?.firstName, c?.familyName ?? c?.lastName].filter(Boolean).join(" "),
    ).trim();
  return all
    .filter((c: any) => {
      const names = normalizeForContactSearch(
        [nameOf(c), c?.nickname, c?.middleName].filter(Boolean).join(" "),
      );
      if (names.includes(q)) return true;
      if (qDigits.length >= 4 && qDigits.length === q.replace(/[\s+\-().]/g, "").length) {
        return phonesOf(c).some((n) => n.replace(/\D/g, "").includes(qDigits));
      }
      return false;
    })
    .slice(0, limit)
    .map((c: any) => ({ name: nameOf(c) || "(sin nombre)", phones: phonesOf(c) }));
}
