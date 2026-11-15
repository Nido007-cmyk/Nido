// MIT License
// Copyright (c) 2026 NIDO contributors
// See LICENSE file for details.

/**
 * registeredPlugins.test.js (T-15 · P-27): ningún plugin huérfano.
 *
 * Un fichero en plugins/ que app.json no registra es código muerto que
 * nadie ejecuta… hasta que alguien lo registra sin mirar dentro. Eso era
 * withBundledModels.js: copiaría cualquier .gguf de assets/models al APK
 * sin verificarlo en el propio plugin. La tanda lo retira y esta prueba
 * fija el invariante en los dos sentidos:
 *
 *  1. todo fichero plugins/*.js (que no sea un test) está registrado en
 *     app.json;
 *  2. toda entrada "./plugins/…" de app.json existe en disco.
 *
 * Si un día se quiere un plugin dormido a propósito, la decisión se
 * escribe aquí como excepción nombrada, no como olvido.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLUGINS_DIR = path.join(ROOT, "plugins");

const appJson = JSON.parse(fs.readFileSync(path.join(ROOT, "app.json"), "utf8"));
const registered = (appJson.expo?.plugins ?? appJson.plugins ?? [])
  .flatMap((p) => (typeof p === "string" ? [p] : Array.isArray(p) && typeof p[0] === "string" ? [p[0]] : []))
  .filter((p) => p.startsWith("./plugins/"))
  .map((p) => p.replace("./plugins/", "").replace(/\.js$/, ""));

const onDisk = fs
  .readdirSync(PLUGINS_DIR)
  .filter((f) => f.endsWith(".js") && !f.endsWith(".test.js"))
  .map((f) => f.replace(/\.js$/, ""));

describe("plugins registrados", () => {
  it("todo plugin en disco está registrado en app.json (sin huérfanos dormidos)", () => {
    expect(onDisk.filter((name) => !registered.includes(name))).toEqual([]);
  });

  it("toda entrada ./plugins/ de app.json existe en disco", () => {
    expect(registered.filter((name) => !onDisk.includes(name))).toEqual([]);
  });
});
