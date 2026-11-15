/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

// F-8 build gate, wired into the unit suite.
//
// Runs scripts/verify-dep-pins.mjs against the REAL repo package.json +
// package-lock.json and asserts PASS. This makes the "no floating native /
// security-sensitive dependency ranges" invariant part of the full test
// suite: any future `^`/`~` reintroduction or manifest↔lock divergence
// turns the suite red. Negative proof (the gate catching a floater) is
// exercised ad-hoc via /tmp fixtures, not committed here.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

// src/deps/depPins.test.ts -> repo ROOT is three levels up.
const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const GATE = join(ROOT, "scripts", "verify-dep-pins.mjs");

describe("F-8 dependency pins", () => {
  it("gate passes on the repo manifest + lockfile", () => {
    const out = execFileSync(process.execPath, [GATE], {
      encoding: "utf8",
      timeout: 30_000,
      cwd: ROOT,
    });
    expect(out).toMatch(/^PASS:/m);
  });

  it("security-sensitive native deps are pinned to exact reviewed versions", () => {
    // Guard the freeze targets explicitly: a future author must consciously
    // update BOTH this list and the gate's classification comment.
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    const deps = pkg.dependencies;
    expect(deps["llama.rn"]).toBe("0.13.0-rc.9"); // native .so binary — la de la 0.1.98. La reversa de la carga de la 0.1.102 (orden del dueño, 2026-11-15) la bajó desde rc.11: se declara lo que se deja atrás — el arreglo #426 de rc.11 (contexto bloqueado tras un throw) y su sync de llama.cpp a b12292; la sospecha M-38, re-verificada sobre el código de rc.11 en T-22, NO se traslada a rc.9 y queda por rehacer. rc.9 no es imprescindible para nada ajeno a la carga: todos los símbolos que el código usa existen ya en sus declaraciones (verificado contra una instalación real de rc.9), y la recuperación de contexto tras una generación fallida vive en la app (recreateContext), como en la 0.1.98.
    expect(deps["expo-secure-store"]).toBe("57.0.4"); // Keystore DEK wrapper
    expect(deps["expo-sqlite"]).toBe("57.0.4"); // SQLCipher storage (fix concurrencia #49796)
    expect(deps["expo-crypto"]).toBe("57.0.4"); // RNG/hash
    expect(deps["expo-local-authentication"]).toBe("57.0.3"); // biometric gate
    expect(deps["tweetnacl"]).toBe("1.0.3"); // P2P crypto primitives
    expect(deps["react-native"]).toBe("0.86.3"); // native framework
    expect(deps["react"]).toBe("19.2.3"); // bundler framework
  });
});
