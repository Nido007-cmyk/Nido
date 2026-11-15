/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * t13Carry.test.ts — Tanda T-13 (red y relay II) · 0.1.99.
 *
 * Sondas de M-27 (ruta B: acotar, cero cambio de cable). El exterior del
 * sobre no está autenticado: un portador podía copiar un sobre con otro
 * `eid`, `exp` fresca y `hops` a 3 y este teléfono lo guardaba OTRA VEZ.
 * La cura deduplica por la huella del núcleo inmutable
 * (tag|eph|kct|nonce|box), con memoria de huellas de 14 días que
 * sobrevive a la entrega y a los reinicios (snapshot/restore).
 * Lo que NO cierra, y queda como control honesto: un teléfono que nunca
 * vio el sobre lo sigue aceptando una vez.
 */

import { describe, expect, it } from "vitest";
import nacl from "tweetnacl";
import { randomNonce, toHex } from "../crypto";
import { generateCarryPrekey, sealCarry, type CarryEnvelope } from "./carryCrypto";
import { CarryStore } from "./carryStore";

const NOW = 1_800_000_000_000;
const H = 3600_000;

function person() {
  const id = nacl.box.keyPair();
  const sign = nacl.sign.keyPair();
  return { pk: toHex(id.publicKey), sigPk: toHex(sign.publicKey), signSk: sign.secretKey, idSk: id.secretKey };
}
const ana = person();
const beto = person();
const caro = person();
const caroKey = generateCarryPrekey(caro.pk, caro.signSk, NOW);

const sealToCaro = (text: string, id = "m-1"): CarryEnvelope =>
  sealCarry({ recipient: caroKey.pub, senderPkHex: ana.pk, senderSecretKey: ana.idSk, id, kind: "chat", text, now: NOW });

/** El mismo sobre físico con el exterior reetiquetado, como hace un portador. */
const rebadged = (e: CarryEnvelope): CarryEnvelope => ({
  ...e,
  eid: toHex(randomNonce(16)),
  exp: NOW + 72 * H,
  hops: 3,
});

describe("T-13 · M-27 deduplicación por huella del núcleo inmutable", () => {
  it("el mismo sobre con otro eid, exp fresca y hops a 3 es duplicado en ESTE teléfono", () => {
    const st = new CarryStore();
    const e = sealToCaro("hola");
    expect(st.accept(e, beto.pk, NOW)).toBe("stored");
    expect(st.accept(rebadged(e), beto.pk, NOW)).toBe("duplicate");
    expect(st.size()).toBe(1);
  });

  it("resurrección tras la entrega: entregado y olvidado por eid, reinyectado reetiquetado → duplicado", () => {
    const st = new CarryStore();
    const e = sealToCaro("hola");
    expect(st.accept(e, beto.pk, NOW)).toBe("stored");
    // Se entrega a su destinataria (Caro) y sale del almacén.
    const plan = st.planHandoff(caro.pk, new Set([e.tag]), true, NOW);
    expect(plan.deliver).toHaveLength(1);
    st.commitHandoff(caro.pk, plan.deliver.map((x) => x.eid), []);
    expect(st.size()).toBe(0);
    // El portador lo reinyecta con otra etiqueta: la huella lo reconoce.
    expect(st.accept(rebadged(e), beto.pk, NOW)).toBe("duplicate");
    expect(st.size()).toBe(0);
  });

  it("la memoria de huellas sobrevive a snapshot/restore (reinicio)", () => {
    const st = new CarryStore();
    const e = sealToCaro("hola");
    expect(st.accept(e, beto.pk, NOW)).toBe("stored");
    const snap = st.snapshot();
    const st2 = new CarryStore();
    st2.restore(snap.held, snap.seen, NOW, snap.seenFp);
    expect(st2.accept(rebadged(e), beto.pk, NOW)).toBe("duplicate");
  });

  it("un sobre DISTINTO del mismo remitente no es duplicado (control)", () => {
    const st = new CarryStore();
    expect(st.accept(sealToCaro("hola", "m-1"), beto.pk, NOW)).toBe("stored");
    expect(st.accept(sealToCaro("otro mensaje", "m-2"), beto.pk, NOW)).toBe("stored");
    expect(st.size()).toBe(2);
  });

  it("un teléfono que nunca lo vio lo acepta una vez (límite honesto, control)", () => {
    const e = sealToCaro("hola");
    const st = new CarryStore();
    expect(st.accept(rebadged(e), beto.pk, NOW)).toBe("stored");
  });

  it("pasada la ventana de memoria de 14 días, la huella se olvida (mandan los topes y la caducidad interior)", () => {
    const st = new CarryStore();
    const e = sealToCaro("hola");
    expect(st.accept(e, beto.pk, NOW)).toBe("stored");
    const later = NOW + 15 * 24 * H;
    st.sweep(later);
    // Reetiquetado con caducidad de fuera fresca a los 15 días: la memoria
    // ya no lo reconoce como duplicado (ventana cumplida). El destinatario
    // lo rechazaría de todos modos por la caducidad autenticada de dentro.
    const relabeled = { ...e, eid: toHex(randomNonce(16)), exp: later + 72 * H, hops: 3 };
    expect(st.accept(relabeled, beto.pk, later)).toBe("stored");
  });
});
