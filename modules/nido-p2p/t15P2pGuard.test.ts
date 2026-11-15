/*
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * T-15 · Guardas estructurales del módulo nido-p2p (Kotlin).
 *
 * Como las de nido-notify: sondas sobre el texto fuente real; el
 * comportamiento en aparato queda declarado como no probado en la tanda.
 *
 *  - m-59: el wake lock del servicio en primer plano tenía un tope de
 *    10 min y un comentario que prometía una renovación inexistente. La
 *    cura instala la renovación temporizada y la ata al ciclo de vida.
 *  - m-61: el timeout de saludo LAN solo lo ponía el aceptador; las
 *    conexiones salientes nacían sin `soTimeout` y un par mudo podía
 *    dejarlas colgadas para siempre ocupando un hueco.
 *  - P-26: el comentario que decía que el módulo «aún no se ha compilado»
 *    era falso desde hace muchas versiones.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MOD = join(ROOT, "modules", "nido-p2p", "android", "src", "main", "java/expo/modules/nidop2p");
const service = readFileSync(join(MOD, "NidoP2PService.kt"), "utf8");
const lan = readFileSync(join(MOD, "NidoLanManager.kt"), "utf8");
const moduleKt = readFileSync(join(MOD, "NidoP2PModule.kt"), "utf8");

describe("m-59 · el wake lock se renueva mientras el servicio vive", () => {
  it("hay una segunda adquisición: la renovación re-adquiere al vencer el tope", () => {
    const acquires = service.split("acquire(").length - 1;
    expect(acquires).toBeGreaterThanOrEqual(2);
  });

  it("la renovación es temporizada (postDelayed) y se cancela al destruir el servicio", () => {
    expect(service).toContain("postDelayed");
    expect(service).toContain("removeCallbacks");
  });
});

describe("m-61 · las conexiones LAN salientes también nacen con timeout de saludo", () => {
  it("el cuerpo de connect() fija el mismo HANDSHAKE_READ_TIMEOUT_MS que el aceptador", () => {
    const start = lan.indexOf("fun connect(address: String)");
    const end = lan.indexOf("private fun onSocket", start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(lan.slice(start, end)).toContain("soTimeout = HANDSHAKE_READ_TIMEOUT_MS");
  });

  it("hay al menos dos asignaciones del timeout de saludo (aceptador y cliente)", () => {
    const n = lan.split("soTimeout = HANDSHAKE_READ_TIMEOUT_MS").length - 1;
    expect(n).toBeGreaterThanOrEqual(2);
  });

  it("CONTROL · la parte de T-12 en este fichero sigue en pie (tarifa, gracia y señal de autenticado)", () => {
    expect(lan).toContain("acceptRateAllows");
    expect(lan).toContain("AUTH_GRACE_TIMEOUT_MS");
    expect(lan).toContain("markAuthenticated");
  });
});

describe("P-26 · el comentario caducado del módulo desaparece", () => {
  it("ya no afirma que el módulo no se ha compilado", () => {
    expect(moduleKt).not.toContain("aún no se ha compilado");
  });
});
