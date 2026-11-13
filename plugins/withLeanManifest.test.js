// MIT License
// Copyright (c) 2026 NIDO contributors
// See LICENSE file for details.
import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const plugin = require("./withLeanManifest.js");
const { applyStableDevServerIp } = plugin;

describe("withLeanManifest", () => {
  it("0.1.96: ya no toca el manifiesto ni nombra Firebase (no queda nada que quitar)", () => {
    // Sin expo-notifications, Firebase no entra en la compilación. Que no
    // vuelva lo vigila el censo del binario (scripts/check-google-free.py).
    expect(plugin.applyLeanManifest).toBeUndefined();
    expect(plugin.REMOVED_COMPONENTS).toBeUndefined();
    const src = readFileSync(fileURLToPath(new URL("./withLeanManifest.js", import.meta.url)), "utf8");
    expect(src).not.toMatch(/withAndroidManifest|tools:node/);
    expect(src).not.toMatch(/"com\.google\.firebase/);
  });

  it("fija la IP del servidor de desarrollo en release sin tocar el bloque original, una vez", () => {
    const gradle = `android {\n    buildTypes {\n        release {\n            // Caution!\n            signingConfig signingConfigs.debug\n        }\n    }\n}\n`;
    const out = applyStableDevServerIp(gradle);
    expect(out.startsWith(gradle)).toBe(true); // el bloque original queda intacto
    expect(out).toContain('resValue "string", "react_native_dev_server_ip", "localhost"');
    expect(applyStableDevServerIp(out)).toBe(out);
    // withReleaseSigning sigue encontrando su patrón.
    expect(/(release \{\n(?:\s*\/\/.*\n)*\s*)signingConfig signingConfigs\.debug/.test(out)).toBe(true);
  });

  it("falla en voz alta si la plantilla cambia", () => {
    expect(() => applyStableDevServerIp("plugins {}")).toThrow(/android/);
  });
});
