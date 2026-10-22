/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * 0.1.46 — relleno de mensajes y protocolo v5 (Double Ratchet + ML-KEM-768).
 */
import { describe, expect, it } from "vitest";
import { generateEphemeral, generateIdentity, randomNonce, toHex, HANDSHAKE_NONCE_BYTES } from "./crypto";
import { makeEnvelope, P2PSession, paddedLength, padPlaintext } from "./protocol";
import { V5_MARKER, MAX_SKIP } from "./ratchet";

function pair(opts: { lowV5: boolean; highV5: boolean }) {
  let a = generateIdentity();
  let b = generateIdentity();
  if (toHex(a.publicKey) > toHex(b.publicKey)) [a, b] = [b, a];
  const low = a;
  const high = b;
  const lowPk = toHex(low.publicKey);
  const highPk = toHex(high.publicKey);
  const eL = generateEphemeral();
  const eH = generateEphemeral();
  const nL = randomNonce(HANDSHAKE_NONCE_BYTES);
  const nH = randomNonce(HANDSHAKE_NONCE_BYTES);
  const sL = P2PSession.fromHandshakeV2(eL.secretKey, eH.publicKey, highPk, nL, nH);
  const sH = P2PSession.fromHandshakeV2(eH.secretKey, eL.publicKey, lowPk, nH, nL);
  sL.expectRecipient(lowPk);
  sH.expectRecipient(highPk);
  sL.enableV5(opts.lowV5);
  sH.enableV5(opts.highV5);
  let n = 0;
  const env = (from: "L" | "H", type: "chat" | "session_confirm" = "chat", payload: Record<string, unknown> = { text: "hola" }) =>
    makeEnvelope(
      type,
      `id-${from}-${n++}`,
      from === "L" ? low.publicKey : high.publicKey,
      from === "L" ? highPk : lowPk,
      payload,
    );
  return { sL, sH, env, lowPk, highPk };
}

/** Handshake v5 completo: confirm de L con oferta → H arranca → kick de H → L arranca. */
function bootV5() {
  const p = pair({ lowV5: true, highV5: true });
  // Los dos confirms salen a la vez (cada lado al terminar el handshake).
  const fL = p.sL.pack(p.env("L", "session_confirm", p.sL.confirmPayload()));
  const fH = p.sH.pack(p.env("H", "session_confirm", p.sH.confirmPayload()));
  expect(p.sH.unpack(fL)).not.toBeNull();
  expect(p.sL.unpack(fH)).not.toBeNull();
  return p;
}

const body = (frame: Uint8Array) => frame.slice(4);

describe("relleno de mensajes", () => {
  it("tamaños fijos", () => {
    expect(paddedLength(1)).toBe(512);
    expect(paddedLength(512)).toBe(512);
    expect(paddedLength(513)).toBe(1024);
    expect(paddedLength(3000)).toBe(4096);
    expect(paddedLength(16 * 1024)).toBe(16 * 1024);
    expect(paddedLength(16 * 1024 + 1)).toBe(32 * 1024);
    expect(paddedLength(40_000)).toBe(48 * 1024);
  });

  it("rellena con espacios que JSON.parse ignora", () => {
    const raw = new TextEncoder().encode(JSON.stringify({ a: 1 }));
    const padded = padPlaintext(raw);
    expect(padded.length).toBe(512);
    expect(JSON.parse(new TextDecoder().decode(padded))).toEqual({ a: 1 });
  });

  it("un 'sí' y un párrafo corto dan frames del mismo tamaño", () => {
    const p = pair({ lowV5: false, highV5: false });
    const short = p.sL.pack(p.env("L", "chat", { text: "sí" }));
    const longer = p.sL.pack(p.env("L", "chat", { text: "x".repeat(200) }));
    expect(short.length).toBe(longer.length);
    expect(p.sH.unpack(short)).not.toBeNull();
    expect(p.sH.unpack(longer)).not.toBeNull();
  });
});

describe("protocolo v5", () => {
  it("solo L ofrece, y solo si tiene v5 activado", () => {
    const p = pair({ lowV5: true, highV5: true });
    expect(p.sH.confirmPayload()).toEqual({ r5cap: 1, cf2: 1 }); // H solo anuncia
    const offer = p.sL.confirmPayload() as { r5?: { v: number; dh: string; ek: string } };
    expect(offer.r5?.v).toBe(1);
    expect(offer.r5?.dh.length).toBe(64);
    expect(offer.r5?.ek.length).toBe(1184 * 2);
    const off = pair({ lowV5: false, highV5: true });
    expect(off.sL.confirmPayload()).toEqual({ cf2: 1 });
  });

  it("todos los session_confirm miden lo mismo (con oferta, con anuncio o vacíos)", () => {
    const p = pair({ lowV5: true, highV5: true });
    const withOffer = p.sL.pack(p.env("L", "session_confirm", p.sL.confirmPayload()));
    const withCap = p.sH.pack(p.env("H", "session_confirm", p.sH.confirmPayload()));
    const plain = pair({ lowV5: false, highV5: false });
    const empty = plain.sL.pack(plain.env("L", "session_confirm", {}));
    expect(withOffer.length).toBe(withCap.length);
    expect(withOffer.length).toBe(empty.length);
  });

  it("L retiene la cola mientras llega el primer v5 de H, y deja de retener al llegar", () => {
    const p = pair({ lowV5: true, highV5: true });
    const fL = p.sL.pack(p.env("L", "session_confirm", p.sL.confirmPayload()));
    const fH = p.sH.pack(p.env("H", "session_confirm", p.sH.confirmPayload()));
    expect(p.sL.holdForV5).toBe(false);
    expect(p.sL.unpack(fH)).not.toBeNull(); // confirm clásico de H con r5cap
    expect(p.sL.holdForV5).toBe(true);
    expect(p.sL.v5HoldRemainingMs).toBeGreaterThan(0);
    expect(p.sH.unpack(fL)).not.toBeNull(); // H arranca
    const kick = p.sH.pack(p.env("H", "session_confirm", {}));
    expect(p.sL.unpack(kick)).not.toBeNull();
    expect(p.sL.holdForV5).toBe(false);
    expect(p.sL.usesV5).toBe(true);
    // Sin anuncio de H (v5 apagado allí), L no retiene nada.
    const q = pair({ lowV5: true, highV5: false });
    q.sL.confirmPayload();
    expect(q.sL.unpack(q.sH.pack(q.env("H", "session_confirm", q.sH.confirmPayload())))).not.toBeNull();
    expect(q.sL.holdForV5).toBe(false);
  });

  it("arranca en los dos lados y cifra en v5", () => {
    const p = bootV5();
    expect(p.sH.usesV5).toBe(true);
    expect(p.sH.takeV5Kickoff()).toBe(true);
    expect(p.sH.takeV5Kickoff()).toBe(false);
    expect(p.sL.usesV5).toBe(false); // L todavía no oyó v5

    // L sigue en clásico hasta oír a H en v5; H lo acepta.
    const early = p.sL.pack(p.env("L"));
    expect(p.sH.unpack(early)?.payload).toEqual({ text: "hola" });

    const h1 = p.sH.pack(p.env("H", "chat", { text: "uno" }));
    expect(body(h1)[0]).toBe(V5_MARKER);
    expect(body(h1)[1] & 1).toBe(1); // lleva el cifrado ML-KEM
    expect(p.sL.unpack(h1)?.payload).toEqual({ text: "uno" });
    expect(p.sL.usesV5).toBe(true);

    const l1 = p.sL.pack(p.env("L", "chat", { text: "dos" }));
    expect(body(l1)[0]).toBe(V5_MARKER);
    expect(body(l1)[1] & 1).toBe(0);
    expect(p.sH.unpack(l1)?.payload).toEqual({ text: "dos" });

    // H ya sabe que L arrancó: deja de mandar el cifrado ML-KEM.
    const h2 = p.sH.pack(p.env("H", "chat", { text: "tres" }));
    expect(body(h2)[1] & 1).toBe(0);
    expect(p.sL.unpack(h2)?.payload).toEqual({ text: "tres" });
  });

  it("conversación larga alternando turnos", () => {
    const p = bootV5();
    for (let i = 0; i < 30; i++) {
      const fromH = i % 3 !== 0;
      const s = fromH ? p.sH : p.sL;
      const r = fromH ? p.sL : p.sH;
      const f = s.pack(p.env(fromH ? "H" : "L", "chat", { text: `m${i}` }));
      if (fromH || p.sL.usesV5) expect(body(f)[0]).toBe(V5_MARKER);
      expect(r.unpack(f)?.payload).toEqual({ text: `m${i}` });
    }
    expect(p.sL.usesV5).toBe(true);
  });

  it("cada mensaje usa una clave distinta (mismo texto, cifrado distinto)", () => {
    const p = bootV5();
    const a = body(p.sH.pack(p.env("H", "chat", { text: "igual" })));
    const b = body(p.sH.pack(p.env("H", "chat", { text: "igual" })));
    expect(toHex(a.slice(-64))).not.toBe(toHex(b.slice(-64)));
  });

  it("rechaza repeticiones", () => {
    const p = bootV5();
    const f = p.sH.pack(p.env("H"));
    expect(p.sL.unpack(f)).not.toBeNull();
    expect(p.sL.unpack(f)).toBeNull();
  });

  it("mensajes perdidos o desordenados se leen igual", () => {
    const p = bootV5();
    const f1 = p.sH.pack(p.env("H", "chat", { text: "1" }));
    const f2 = p.sH.pack(p.env("H", "chat", { text: "2" }));
    const f3 = p.sH.pack(p.env("H", "chat", { text: "3" }));
    expect(p.sL.unpack(f3)?.payload).toEqual({ text: "3" });
    expect(p.sL.unpack(f1)?.payload).toEqual({ text: "1" });
    expect(p.sL.unpack(f2)?.payload).toEqual({ text: "2" });
  });

  it("un frame manipulado no abre y no altera el estado", () => {
    const p = bootV5();
    const good = p.sH.pack(p.env("H", "chat", { text: "ok" }));
    for (const idx of [5, 10, 40, 200, good.length - 1]) {
      const bad = good.slice();
      bad[idx] ^= 0x01;
      expect(p.sL.unpack(bad)).toBeNull();
    }
    expect(p.sL.unpack(good)?.payload).toEqual({ text: "ok" });
  });

  it("un salto mayor que MAX_SKIP se rechaza", () => {
    const p = bootV5();
    const frames: Uint8Array[] = [];
    for (let i = 0; i < MAX_SKIP + 2; i++) frames.push(p.sH.pack(p.env("H")));
    expect(p.sL.unpack(frames[frames.length - 1])).toBeNull();
    expect(p.sL.unpack(frames[0])).not.toBeNull();
  });

  it("tras oír v5, ya no se aceptan frames clásicos (aunque sean auténticos)", () => {
    // Dos sesiones H con la MISMA clave clásica: hClassic sigue en clásico.
    let a = generateIdentity();
    let b = generateIdentity();
    if (toHex(a.publicKey) > toHex(b.publicKey)) [a, b] = [b, a];
    const lowPk = toHex(a.publicKey);
    const highPk = toHex(b.publicKey);
    const eL = generateEphemeral();
    const eH = generateEphemeral();
    const eHcopy = eH.secretKey.slice();
    const nL = randomNonce(HANDSHAKE_NONCE_BYTES);
    const nH = randomNonce(HANDSHAKE_NONCE_BYTES);
    const sL = P2PSession.fromHandshakeV2(eL.secretKey, eH.publicKey, highPk, nL, nH);
    const sH = P2PSession.fromHandshakeV2(eH.secretKey, eL.publicKey, lowPk, nH, nL);
    const hClassic = P2PSession.fromHandshakeV2(eHcopy, eL.publicKey, lowPk, nH, nL);
    sL.expectRecipient(lowPk);
    sH.expectRecipient(highPk);
    hClassic.expectRecipient(highPk);
    sL.enableV5(true);
    sH.enableV5(true);
    const env = (id: string) => makeEnvelope("chat", id, b.publicKey, lowPk, { text: id });
    expect(sH.unpack(sL.pack(makeEnvelope("session_confirm", "c", a.publicKey, highPk, sL.confirmPayload())))).not.toBeNull();
    // Antes de oír v5, L acepta un clásico auténtico.
    expect(sL.unpack(hClassic.pack(env("c1")))?.payload).toEqual({ text: "c1" });
    // L oye v5 de H…
    expect(sL.unpack(sH.pack(env("v1")))).not.toBeNull();
    expect(sL.usesV5).toBe(true);
    // …y desde ahí un clásico auténtico (mismo canal, id nuevo) se rechaza.
    expect(sL.unpack(hClassic.pack(env("c2")))).toBeNull();
  });

  it("un frame falso no borra claves guardadas aunque fuerce la expulsión (rollback completo)", () => {
    const p = bootV5();
    expect(p.sH.unpack(p.sL.pack(p.env("L")))).not.toBeNull();
    // Dos tandas de 250 mensajes retrasados: L guarda 500 claves saltadas.
    const batch1: Uint8Array[] = [];
    const batch2: Uint8Array[] = [];
    for (let i = 0; i < 250; i++) batch1.push(p.sH.pack(p.env("H", "chat", { text: `a${i}` })));
    const mid = p.sH.pack(p.env("H", "chat", { text: "mid" }));
    for (let i = 0; i < 250; i++) batch2.push(p.sH.pack(p.env("H", "chat", { text: `b${i}` })));
    const last = p.sH.pack(p.env("H", "chat", { text: "last" }));
    expect(p.sL.unpack(mid)?.payload).toEqual({ text: "mid" });
    expect(p.sL.unpack(last)?.payload).toEqual({ text: "last" });
    // Frame falso: dh nuevo, pn = 501 (cadena actual ya en 502 → nada que
    // saltar ahí) y n = 200: calcula 200 claves nuevas y, con 700 > 512,
    // expulsa ~188 de la primera tanda… dentro de la copia.
    const forged = last.slice();
    for (let i = 4 + 2; i < 4 + 34; i++) forged[i] ^= 0x5a;
    forged[4 + 34 + 2] = 0x01;
    forged[4 + 34 + 3] = 0xf5; // pn = 501
    forged[4 + 38 + 2] = 0x00;
    forged[4 + 38 + 3] = 200; // n = 200
    expect(p.sL.unpack(forged)).toBeNull();
    // Todas las claves guardadas siguen intactas.
    for (let i = 0; i < 250; i++) expect(p.sL.unpack(batch1[i])?.payload).toEqual({ text: `a${i}` });
    for (let i = 0; i < 250; i++) expect(p.sL.unpack(batch2[i])?.payload).toEqual({ text: `b${i}` });
  });

  it("rechaza sin calcular nada un frame que pediría más de MAX_SKIP claves en total", () => {
    const p = bootV5();
    expect(p.sH.unpack(p.sL.pack(p.env("L")))).not.toBeNull();
    const last = p.sH.pack(p.env("H", "chat", { text: "x" }));
    expect(p.sL.unpack(last)).not.toBeNull();
    const forged = last.slice();
    for (let i = 4 + 2; i < 4 + 34; i++) forged[i] ^= 0x33;
    forged[4 + 34 + 3] = 200; // pn: 199 claves viejas
    forged[4 + 38 + 3] = 100; // n: 100 nuevas → 299 > MAX_SKIP
    const t0 = Date.now();
    expect(p.sL.unpack(forged)).toBeNull();
    expect(Date.now() - t0).toBeLessThan(50);
  });

  it("si un lado no tiene v5, todo sigue en clásico", () => {
    for (const cfg of [
      { lowV5: true, highV5: false },
      { lowV5: false, highV5: true },
    ]) {
      const p = pair(cfg);
      const cL = p.env("L", "session_confirm", p.sL.confirmPayload());
      const cH = p.env("H", "session_confirm", p.sH.confirmPayload());
      expect(p.sH.unpack(p.sL.pack(cL))).not.toBeNull();
      expect(p.sL.unpack(p.sH.pack(cH))).not.toBeNull();
      expect(p.sH.usesV5).toBe(false);
      expect(p.sH.takeV5Kickoff()).toBe(false);
      for (let i = 0; i < 4; i++) {
        expect(p.sL.unpack(p.sH.pack(p.env("H", "chat", { text: `h${i}` })))?.payload).toEqual({ text: `h${i}` });
        expect(p.sH.unpack(p.sL.pack(p.env("L", "chat", { text: `l${i}` })))?.payload).toEqual({ text: `l${i}` });
      }
      expect(p.sL.usesV5).toBe(false);
    }
  });

  it("un cifrado ML-KEM alterado impide arrancar a L sin romper la sesión", () => {
    const p = bootV5();
    const h1 = p.sH.pack(p.env("H", "chat", { text: "pq" }));
    const bad = h1.slice();
    bad[4 + 42 + 100] ^= 0xff; // dentro del cifrado ML-KEM
    expect(p.sL.unpack(bad)).toBeNull();
    expect(p.sL.usesV5).toBe(false);
    expect(p.sL.unpack(h1)?.payload).toEqual({ text: "pq" });
  });

  it("una oferta malformada no arranca v5 en H", () => {
    const p = pair({ lowV5: true, highV5: true });
    for (const r5 of [null, 1, { v: 2 }, { v: 1, dh: "zz", ek: "00" }, { v: 1, dh: "00".repeat(32), ek: "00".repeat(10) }]) {
      const c = p.env("L", "session_confirm", { r5 });
      expect(p.sH.unpack(p.sL.pack(c))).not.toBeNull();
      expect(p.sH.usesV5).toBe(false);
    }
  });
});
