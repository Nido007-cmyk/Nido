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
    expect(deps["llama.rn"]).toBe("0.13.0-rc.12"); // native .so binary — revisada 2026-11-27 (etapa 2, 0.1.122). La 0.1.102 volvió a rc.9 por orden del dueño junto con toda la ruta de carga; la lentitud de la 0.1.101 era de la puerta de confianza (re-hash en el hilo de JS), no del motor, y la ruta de carga NO cambia aquí. rc.12 trae el arreglo #426 (contexto bloqueado tras un throw), #427 (bench() desde estado limpio tras una completion), #430 (mensaje de error real) y llama.cpp b12445. Re-verificado sobre su código: censo binario idéntico a rc.9 (7 variantes arm64, incluida v8_2_dotprod para el Snapdragon 695 de la Tab A9+), M-38 sigue descartada (find_common_prefix_length + llama_memory_seq_rm antes de decodificar; checkpoint o clear si falla), retención de muestreo en parseCompletionParams, salto UTF-8 y STOP_PARTIAL en llamaCompletion, timings, n_keep, ctx_shift, state_cache_budget_mb, bench y loadSession/saveSession (JSISession.h byte a byte igual).
    expect(deps["expo-secure-store"]).toBe("57.0.4"); // Keystore DEK wrapper
    expect(deps["expo-sqlite"]).toBe("57.0.5"); // SQLCipher storage (fix concurrencia #49796; 57.0.5 revisada en REV-SQLITE-5705: motor SQLCipher/SQLite byte-idéntico a 57.0.4, el parche solo resetea el statement tras SQLITE_BUSY, PRs #51413/#53339)
    expect(deps["expo-crypto"]).toBe("57.0.4"); // RNG/hash
    expect(deps["expo-local-authentication"]).toBe("57.0.3"); // biometric gate
    expect(deps["tweetnacl"]).toBe("1.0.3"); // P2P crypto primitives
    expect(deps["react-native"]).toBe("0.86.3"); // native framework
    expect(deps["react"]).toBe("19.2.3"); // bundler framework
  });
});
