/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * 0.1.46 — fuzzing de todo lo que lee datos de otro teléfono o de un QR.
 *
 * Invariantes:
 * - Ningún parser lanza un TypeError/RangeError crudo ni algo que no sea
 *   Error: o devuelve un resultado válido, o rechaza con su error propio.
 * - Un frame cifrado al que se le cambia cualquier cosa NUNCA abre, y el
 *   intento no altera la sesión (el original sigue abriendo después).
 * - El reensamblador nunca lanza ni entrega frames fuera de tamaño.
 *
 * Semilla y cantidad: FUZZ_SEED / FUZZ_ITERATIONS (300 por defecto; el job
 * semanal de CI usa muchas más).
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../store", () => ({
  getIdentity: async () => null,
  getSigningKeypair: async () => null,
  findContactByPk: async () => null,
  listContacts: async () => [],
}));

import { FUZZ_ITERATIONS, FUZZ_SEED, Rng, mutate, randomJson, expectOnlyErrors } from "./fuzzKit";
import { buildHello, parseHello } from "../nativeTransport";
import { parseConfirm } from "../handshakeV3";
import { derivePairKey, isSealedFrame, parseSealed, sealHandshakeFrame } from "../sealedHandshake";
import { decodePairingPayload, encodePairingPayload } from "../pairing";
import { validateTaskMessage } from "../taskProtocol";
import { decodeBase64, encodeBase64 } from "../base64";
import { parseV5Body } from "../ratchet";
import { FrameReassembler, P2PSession, makeEnvelope } from "../protocol";
import {
  generateEphemeral,
  generateIdentity,
  generateSigningKeypair,
  randomNonce,
  toHex,
  utf8DecodeLossy,
  HANDSHAKE_NONCE_BYTES,
} from "../crypto";

const enc = (s: string) => new TextEncoder().encode(s);
const equal = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

function sessions(v5: boolean) {
  let a = generateIdentity();
  let b = generateIdentity();
  if (toHex(a.publicKey) > toHex(b.publicKey)) [a, b] = [b, a];
  const lowPk = toHex(a.publicKey);
  const highPk = toHex(b.publicKey);
  const eL = generateEphemeral();
  const eH = generateEphemeral();
  const nL = randomNonce(HANDSHAKE_NONCE_BYTES);
  const nH = randomNonce(HANDSHAKE_NONCE_BYTES);
  const L = P2PSession.fromHandshakeV2(eL.secretKey, eH.publicKey, highPk, nL, nH);
  const H = P2PSession.fromHandshakeV2(eH.secretKey, eL.publicKey, lowPk, nH, nL);
  L.expectRecipient(lowPk);
  H.expectRecipient(highPk);
  L.enableV5(v5);
  H.enableV5(v5);
  let n = 0;
  const fromH = (text: string) => makeEnvelope("chat", `h-${n++}`, b.publicKey, lowPk, { text });
  if (v5) {
    const fL = L.pack(makeEnvelope("session_confirm", "cL", a.publicKey, highPk, L.confirmPayload()));
    const fH = H.pack(makeEnvelope("session_confirm", "cH", b.publicKey, lowPk, H.confirmPayload()));
    H.unpack(fL);
    L.unpack(fH);
  }
  return { L, H, fromH };
}

describe(`fuzzing (semilla ${FUZZ_SEED}, ${FUZZ_ITERATIONS} casos por objetivo)`, () => {
  it("HELLO y CONFIRM del handshake", () => {
    const rng = new Rng(FUZZ_SEED);
    const hello = buildHello("a".repeat(64), "b".repeat(64), "c".repeat(32), 1_780_000_000, "d".repeat(128));
    const confirm = enc(
      JSON.stringify({ t: "nido-confirm", v: 1, pk: "a".repeat(64), cn: "c".repeat(32), pn: "e".repeat(32), sig: "d".repeat(128) }),
    );
    const corpus = [hello, confirm, enc("null"), enc("[]"), enc("{}")];
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const input = mutate(rng, rng.pick(corpus), corpus);
      const h = expectOnlyErrors(() => parseHello(input));
      if (!h.threw) {
        const v = h.value as { pk: string; eph: string; nonce: string; sig: string };
        expect(/^[0-9a-f]{64}$/.test(v.pk) && /^[0-9a-f]{64}$/.test(v.eph)).toBe(true);
        expect(/^[0-9a-f]{32}$/.test(v.nonce) && /^[0-9a-f]{128}$/.test(v.sig)).toBe(true);
      }
      expectOnlyErrors(() => parseConfirm(input));
    }
  });

  it("saludo sellado (v4)", () => {
    const rng = new Rng(FUZZ_SEED + 1);
    const me = generateIdentity();
    const peer = generateIdentity();
    const key = derivePairKey(me.secretKey, toHex(me.publicKey), toHex(peer.publicKey));
    const sealed = sealHandshakeFrame(key, "hello", enc('{"t":"nido-hello","v":3}'));
    const corpus = [sealed];
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const input = mutate(rng, sealed, corpus);
      expectOnlyErrors(() => isSealedFrame(input));
      expectOnlyErrors(() => parseSealed(input));
    }
  });

  it("código de emparejamiento (QR)", () => {
    const rng = new Rng(FUZZ_SEED + 2);
    const id = generateIdentity();
    const sign = generateSigningKeypair();
    const qr = enc(encodePairingPayload("Ana", id.publicKey, sign.publicKey));
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const text = utf8DecodeLossy(mutate(rng, qr));
      const r = expectOnlyErrors(() => decodePairingPayload(text));
      if (!r.threw) {
        const p = r.value as { pk?: string };
        expect(/^[0-9a-f]{64}$/i.test(p.pk ?? "")).toBe(true);
      }
    }
  });

  it("mensajes de tareas delegadas", () => {
    const rng = new Rng(FUZZ_SEED + 3);
    const types = ["TASK_REQUEST", "TASK_STATUS", "TASK_RESULT", "TASK_CANCEL", "TASK_REJECT", "OTRO"] as const;
    for (let i = 0; i < FUZZ_ITERATIONS * 3; i++) {
      const raw = randomJson(rng);
      const r = expectOnlyErrors(() => validateTaskMessage(rng.pick(types) as never, raw));
      expect(r.threw).toBe(false); // los validadores devuelven null, nunca lanzan
    }
  });

  it("base64", () => {
    const rng = new Rng(FUZZ_SEED + 4);
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const data = rng.bytes(rng.int(64));
      const text = encodeBase64(data);
      expect(equal(decodeBase64(text), data)).toBe(true);
      expectOnlyErrors(() => decodeBase64(utf8DecodeLossy(mutate(rng, enc(text)))));
    }
  });

  it("cabecera v5", () => {
    const rng = new Rng(FUZZ_SEED + 5);
    const { H, fromH } = sessions(true);
    const corpus = [H.pack(fromH("x")).slice(4), H.pack(fromH("y")).slice(4)];
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      expectOnlyErrors(() => parseV5Body(mutate(rng, rng.pick(corpus), corpus)));
      expectOnlyErrors(() => parseV5Body(rng.bytes(rng.int(1500))));
    }
  });

  for (const v5 of [false, true]) {
    it(`frames cifrados ${v5 ? "v5" : "clásicos"}: cualquier cambio se rechaza sin tocar la sesión`, () => {
      const rng = new Rng(FUZZ_SEED + (v5 ? 7 : 6));
      const { L, H, fromH } = sessions(v5);
      const rounds = Math.max(5, Math.floor(FUZZ_ITERATIONS / 20));
      for (let r = 0; r < rounds; r++) {
        const good = H.pack(fromH(`m${r}`));
        for (let i = 0; i < 20; i++) {
          const bad = mutate(rng, good);
          if (equal(bad, good)) continue;
          const out = expectOnlyErrors(() => L.unpack(bad));
          expect(out.threw).toBe(false);
          expect(out.value).toBeNull();
        }
        const env = L.unpack(good);
        expect(env?.payload).toEqual({ text: `m${r}` });
      }
    });
  }

  it("v5 en los dos sentidos, con turnos, pérdidas, desorden y frames alterados", () => {
    const rng = new Rng(FUZZ_SEED + 9);
    let a = generateIdentity();
    let b = generateIdentity();
    if (toHex(a.publicKey) > toHex(b.publicKey)) [a, b] = [b, a];
    const lowPk = toHex(a.publicKey);
    const highPk = toHex(b.publicKey);
    const eL = generateEphemeral();
    const eH = generateEphemeral();
    const nL = randomNonce(HANDSHAKE_NONCE_BYTES);
    const nH = randomNonce(HANDSHAKE_NONCE_BYTES);
    const L = P2PSession.fromHandshakeV2(eL.secretKey, eH.publicKey, highPk, nL, nH);
    const H = P2PSession.fromHandshakeV2(eH.secretKey, eL.publicKey, lowPk, nH, nL);
    L.expectRecipient(lowPk);
    H.expectRecipient(highPk);
    L.enableV5(true);
    H.enableV5(true);
    H.unpack(L.pack(makeEnvelope("session_confirm", "cL", a.publicKey, highPk, L.confirmPayload())));
    L.unpack(H.pack(makeEnvelope("session_confirm", "cH", b.publicKey, lowPk, H.confirmPayload())));
    // Arranque en orden (como en un socket real): a partir de aquí los dos
    // sentidos van en v5 y el desorden ya no puede mezclar un clásico.
    L.unpack(H.pack(makeEnvelope("chat", "w1", b.publicKey, lowPk, { text: "w1" })));
    H.unpack(L.pack(makeEnvelope("chat", "w2", a.publicKey, highPk, { text: "w2" })));
    expect(L.usesV5 && H.usesV5).toBe(true);
    let n = 0;
    // Cola por sentido: [frame, texto]. Se entregan en desorden, algunos se
    // pierden y a veces llega antes una versión alterada.
    const toL: Array<[Uint8Array, string]> = [];
    const toH: Array<[Uint8Array, string]> = [];
    const rounds = Math.max(60, FUZZ_ITERATIONS);
    for (let r = 0; r < rounds; r++) {
      const fromHigh = rng.int(3) !== 0;
      const text = `t${n++}`;
      const frame = fromHigh
        ? H.pack(makeEnvelope("chat", text, b.publicKey, lowPk, { text }))
        : L.pack(makeEnvelope("chat", text, a.publicKey, highPk, { text }));
      (fromHigh ? toL : toH).push([frame, text]);
      for (const [queue, recv] of [
        [toL, L],
        [toH, H],
      ] as const) {
        if (queue.length === 0 || rng.int(2) === 0) continue;
        const [f, t] = queue.splice(rng.int(Math.min(queue.length, 4)), 1)[0];
        if (rng.int(10) === 0) continue; // perdido
        if (rng.int(4) === 0) {
          const bad = mutate(rng, f);
          if (!equal(bad, f)) {
            const out = expectOnlyErrors(() => recv.unpack(bad));
            expect(out.threw).toBe(false);
            expect(out.value).toBeNull();
          }
        }
        const env = recv.unpack(f);
        // Un frame auténtico siempre abre, salvo que su cadena ya se cerró
        // por desorden extremo (más de MAX_SKIP): aquí el desorden es <= 4.
        expect((env?.payload as { text?: string } | undefined)?.text).toBe(t);
      }
    }
  });

  it("reensamblador de frames con trozos y basura", () => {
    const rng = new Rng(FUZZ_SEED + 8);
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const re = new FrameReassembler();
      for (let c = 0; c < 6; c++) {
        const chunk = rng.int(3) === 0 ? rng.bytes(rng.int(64)) : (() => {
          const len = rng.int(80);
          const f = new Uint8Array(4 + len);
          f[2] = (len >>> 8) & 0xff;
          f[3] = len & 0xff;
          f.set(rng.bytes(len), 4);
          return f;
        })();
        const r = expectOnlyErrors(() => re.push(chunk));
        expect(r.threw).toBe(false);
        for (const f of r.value as Uint8Array[]) {
          const len = (f[0] << 24) | (f[1] << 16) | (f[2] << 8) | f[3];
          expect(len).toBe(f.length - 4);
          expect(len).toBeLessThanOrEqual(256 * 1024);
        }
      }
    }
  });
});
