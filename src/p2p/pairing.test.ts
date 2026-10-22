/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, it, expect } from "vitest";
import { decodePairingPayload, encodePairingPayload } from "./pairing";
import { generateIdentity, generateSigningKeypair, toHex } from "./crypto";

describe("pairing QR", () => {
  it("codifica y decodifica el payload v2 (con clave de firma)", () => {
    const kp = generateIdentity();
    const skp = generateSigningKeypair();
    const code = encodePairingPayload("Ana 📱", kp.publicKey, skp.publicKey);
    expect(code.startsWith("NIDO1:")).toBe(true);
    const payload = decodePairingPayload(code);
    expect(payload.v).toBe(2);
    expect(payload.app).toBe("nido");
    expect(payload.name).toBe("Ana 📱");
    expect(payload.pk).toBe(toHex(kp.publicKey));
    expect(payload.spk).toBe(toHex(skp.publicKey));
  });

  it("v1 legacy se sigue decodificando (spk ausente)", () => {
    const kp = generateIdentity();
    const code = `NIDO1:{"v":1,"app":"nido","name":"Viejo","pk":"${toHex(kp.publicKey)}"}`;
    const payload = decodePairingPayload(code);
    expect(payload.v).toBe(1);
    expect(payload.spk).toBeUndefined();
  });

  it("v2 sin spk se rechaza", () => {
    const kp = generateIdentity();
    expect(() =>
      decodePairingPayload(
        `NIDO1:{"v":2,"app":"nido","name":"x","pk":"${toHex(kp.publicKey)}"}`,
      ),
    ).toThrow(/firma/);
  });

  it("v2 con spk inválida se rechaza", () => {
    const kp = generateIdentity();
    expect(() =>
      decodePairingPayload(
        `NIDO1:{"v":2,"app":"nido","name":"x","pk":"${toHex(kp.publicKey)}","spk":"zzzz"}`,
      ),
    ).toThrow(/firma/);
  });

  it("el nombre se recorta a 40 caracteres", () => {
    const kp = generateIdentity();
    const skp = generateSigningKeypair();
    const code = encodePairingPayload("x".repeat(100), kp.publicKey, skp.publicKey);
    expect(decodePairingPayload(code).name.length).toBe(40);
  });

  it("rechaza QR que no es de NIDO", () => {
    expect(() => decodePairingPayload("https://example.com")).toThrow("no es de NIDO");
  });

  it("rechaza QR dañado", () => {
    expect(() => decodePairingPayload("NIDO1:{no json")).toThrow("dañado");
    expect(() => decodePairingPayload("NIDO1:[]")).toThrow("dañado");
  });

  it("rechaza versión o app distintas", () => {
    expect(() => decodePairingPayload('NIDO1:{"v":3,"app":"nido","name":"x","pk":"00"}')).toThrow(
      "no soportada",
    );
    expect(() => decodePairingPayload('NIDO1:{"v":1,"app":"otro","name":"x","pk":"00"}')).toThrow(
      "no soportada",
    );
  });

  it("rechaza clave inválida", () => {
    expect(() =>
      decodePairingPayload('NIDO1:{"v":1,"app":"nido","name":"x","pk":"zzzz"}'),
    ).toThrow("no es válida");
    expect(() =>
      decodePairingPayload(`NIDO1:{"v":1,"app":"nido","name":"x","pk":"${"00".repeat(16)}"}`),
    ).toThrow("no es válida");
  });

  it("rechaza nombre vacío al codificar", () => {
    const kp = generateIdentity();
    const skp = generateSigningKeypair();
    expect(() => encodePairingPayload("   ", kp.publicKey, skp.publicKey)).toThrow();
    expect(() => encodePairingPayload("x", kp.publicKey, new Uint8Array(16))).toThrow();
  });
});

describe("blindaje 2026-10-21: tamaño del código de emparejamiento", () => {
  it("un texto enorme se rechaza antes de parsearlo", () => {
    const huge = "NIDO1:" + JSON.stringify({ v: 2, app: "nido", name: "x".repeat(5000) });
    expect(() => decodePairingPayload(huge)).toThrow(/no es de NIDO/);
  });

  it("un código real (más espacios alrededor) sigue funcionando", () => {
    const id = generateIdentity();
    const sk = generateSigningKeypair();
    const code = encodePairingPayload("Ana", id.publicKey, sk.publicKey);
    expect(code.length).toBeLessThan(400);
    expect(decodePairingPayload(`  ${code}\n`).name).toBe("Ana");
  });
});

describe("0.1.49: capacidades en el QR", () => {
  const kp = generateIdentity();
  const skp = generateSigningKeypair();
  const base = `"v":2,"app":"nido","name":"Ana","pk":"${toHex(kp.publicKey)}","spk":"${toHex(skp.publicKey)}"`;

  it("el QR propio anuncia saludo sellado (c4) y CONFIRM v2 (cf2)", () => {
    const p = decodePairingPayload(encodePairingPayload("Ana", kp.publicKey, skp.publicKey));
    expect(p.caps).toEqual(["c4", "cf2"]);
  });

  it("un QR viejo sin caps se sigue aceptando (sin caps)", () => {
    expect(decodePairingPayload(`NIDO1:{${base}}`).caps).toBeUndefined();
  });

  it("caps mal formadas → QR dañado", () => {
    for (const bad of ['"c4"', "[1]", '["C4"]', '["muy-largo-de-verdad"]', "{}", `[${'"a",'.repeat(16)}"a"]`]) {
      expect(() => decodePairingPayload(`NIDO1:{${base},"caps":${bad}}`)).toThrow(/dañado/);
    }
  });

  it("capacidades desconocidas se aceptan (versiones futuras) y se quitan duplicados", () => {
    expect(decodePairingPayload(`NIDO1:{${base},"caps":["c4","zz9","c4"]}`).caps).toEqual(["c4", "zz9"]);
  });
});
