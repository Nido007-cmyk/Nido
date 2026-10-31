// MIT License
// Copyright (c) 2026 NIDO contributors
// See LICENSE file for details.

/**
 * Auditoría 2026-10-29: el APK 0.1.61 declaraba 15 permisos de insignias de
 * lanzadores de fabricantes (los trae ShortcutBadger con expo-notifications).
 * NIDO no pone números en el icono, así que se bloquean. Y nada de lo que
 * NIDO sí necesita puede acabar bloqueado por error.
 *
 * Auditoría profesional 2026-10-31: el APK 0.1.65 declaraba un decimosexto
 * permiso de la misma familia, android.permission.READ_APP_BADGE, que no
 * estaba en la lista de bloqueados ni lo declara ningún fichero de la casa:
 * entra solo por el manifiesto de la AAR de ShortcutBadger al fusionarse.
 * Se bloquea también y la cuenta de la familia pasa a 16.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const app = JSON.parse(readFileSync(fileURLToPath(new URL("../app.json", import.meta.url)), "utf8"));
const blocked = new Set(app.expo.android.blockedPermissions);
const declared = app.expo.android.permissions;

describe("permisos bloqueados", () => {
  it("bloquea los 16 permisos de insignias de fabricantes", () => {
    const badges = [...blocked].filter((p) => /launcher|badge|badger|home\.permission/i.test(p));
    expect(badges).toHaveLength(16);
  });

  it("no bloquea ningún permiso que NIDO declara", () => {
    for (const p of declared) expect(blocked.has(p)).toBe(false);
  });

  it("sigue bloqueando lo de antes (push de Firebase, superposiciones, escribir contactos)", () => {
    for (const p of [
      "android.permission.SYSTEM_ALERT_WINDOW",
      "android.permission.WRITE_CONTACTS",
      "com.google.android.c2dm.permission.RECEIVE",
      "com.google.android.finsky.permission.BIND_GET_INSTALL_REFERRER_SERVICE",
    ]) {
      expect(blocked.has(p)).toBe(true);
    }
  });

  it("NIDO no pone insignias en el icono (si algún día lo hace, este bloqueo debe revisarse)", () => {
    const root = fileURLToPath(new URL("../src", import.meta.url));
    const hits = [];
    const walk = (dir) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name)) {
          if (/setBadgeCount/.test(readFileSync(full, "utf8"))) hits.push(full);
        }
      }
    };
    walk(root);
    expect(hits).toEqual([]);
  });
});
