// MIT License
// Copyright (c) 2026 NIDO contributors
// See LICENSE file for details.

/**
 * Auditoría completa 2026-10-31 (F2-09): el agente pide permisos de
 * calendario y contactos en tiempo de ejecución y PRIVACY.md los
 * promete, pero ni app.json ni los manifiestos de las librerías los
 * declaran: expo-calendar y expo-contacts NO traen los permisos en
 * su AndroidManifest, los inyecta su plugin de configuración en el
 * prebuild, y esos plugins no estaban en app.json. Sin declaración,
 * el sistema no tiene permiso que conceder y la función muere en
 * silencio en un teléfono real.
 *
 * El arreglo declara los dos plugins con su texto de permiso y los
 * tres permisos de lectura/escritura de calendario y lectura de
 * contactos. WRITE_CONTACTS sigue bloqueado a propósito (la casa
 * lee contactos, no los escribe): el plugin de expo-contacts lo
 * añadiría y blockedPermissions lo vuelve a quitar en el prebuild.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const app = JSON.parse(readFileSync(fileURLToPath(new URL("../app.json", import.meta.url)), "utf8"));
const plugins = app.expo.plugins.map((p) => (Array.isArray(p) ? p : [p]));
const byName = new Map(plugins.map((p) => [p[0], p[1] ?? {}]));
const declared = new Set(app.expo.android.permissions);
const blocked = new Set(app.expo.android.blockedPermissions);

describe("permisos de calendario y contactos (F2-09)", () => {
  it("los plugins de configuración están en app.json con su texto", () => {
    expect(byName.get("expo-calendar")?.calendarPermission).toBeTruthy();
    expect(byName.get("expo-contacts")?.contactsPermission).toBeTruthy();
  });

  it("los permisos que el agente pide están declarados", () => {
    for (const p of [
      "android.permission.READ_CALENDAR",
      "android.permission.WRITE_CALENDAR",
      "android.permission.READ_CONTACTS",
    ]) {
      expect(declared.has(p)).toBe(true);
      expect(blocked.has(p)).toBe(false);
    }
  });

  it("WRITE_CONTACTS sigue sin declararse y sigue bloqueado", () => {
    expect(declared.has("android.permission.WRITE_CONTACTS")).toBe(false);
    expect(blocked.has("android.permission.WRITE_CONTACTS")).toBe(true);
  });
});
