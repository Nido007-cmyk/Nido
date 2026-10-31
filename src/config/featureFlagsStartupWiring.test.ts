/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * featureFlagsStartupWiring.test.ts — auditoría completa 2026-10-31
 * (F1 B-9).
 *
 * INVARIANTE: la hidratación de los interruptores (feature flags) se
 * ESPERA antes de entrar en la app. El comentario de App.tsx promete
 * que se cargan «antes de cualquier reconexión P2P» porque un
 * handshake lee p2p.ratchetV5 de forma síncrona, pero la llamada era
 * `void loadFeatureFlags()`: nadie esperaba la promesa y un handshake
 * temprano podía leer los valores por defecto en vez de los del
 * usuario (p. ej. p2p.privateHelloOnly apagado en memoria aunque el
 * usuario lo hubiera encendido).
 *
 * App.tsx no se renderiza en esta batería (misma restricción que
 * keyLossRecovery.test.ts), así que la prueba fija el cableado sobre
 * el código fuente: la promesa se guarda y finishStartup la espera.
 */
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const repoRoot = path.resolve(__dirname, "..", "..");
const appSrc = fs.readFileSync(path.join(repoRoot, "App.tsx"), "utf-8");

describe("F1 B-9: la carga de interruptores se espera en el arranque", () => {
  it("la promesa de carga se conserva, no se descarta con void", () => {
    expect(appSrc).toContain("const featureFlagsReady: Promise<void> = loadFeatureFlags();");
    expect(appSrc).not.toContain("void loadFeatureFlags();");
  });

  it("finishStartup espera la promesa antes de verificar el catálogo", () => {
    const start = appSrc.indexOf("const finishStartup = async () => {");
    expect(start).toBeGreaterThanOrEqual(0);
    const body = appSrc.slice(start, start + 2500);
    const awaited = body.indexOf("await featureFlagsReady;");
    const verify = body.indexOf("verifyCatalogSignature(");
    expect(awaited, "finishStartup debe esperar featureFlagsReady").toBeGreaterThanOrEqual(0);
    expect(verify).toBeGreaterThan(awaited);
  });
});
