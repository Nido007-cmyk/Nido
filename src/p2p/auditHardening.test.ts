/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * auditHardening.test.ts — regresiones de la auditoría 2026-10-10 (M1-M3).
 *
 * - M1: replay de un frame tras 10 000 mensajes posteriores en la sesión.
 * - M2: ReplayProtection falla CERRADO al llenarse (antes expulsaba el más
 *   antiguo y reabría su nonce vigente).
 * - M3: espejo de revocación. Las partes de SessionManager y de grants
 *   que vivían aquí se retiraron con esa superficie en T-12 (m-45,
 *   0.1.99): no tenían ningún llamador de producción.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  generateEphemeral,
  generateIdentity,
  randomNonce,
  toHex,
  HANDSHAKE_NONCE_BYTES,
} from "./crypto";
import { P2PSession, makeEnvelope } from "./protocol";
import {
  ReplayProtection,
  RevocationRegistry,
  globalRevocationRegistry,
} from "./replayProtection";

function twoSessions() {
  const aliceId = generateIdentity();
  const bobId = generateIdentity();
  const aEph = generateEphemeral();
  const bEph = generateEphemeral();
  const n1 = randomNonce(HANDSHAKE_NONCE_BYTES);
  const n2 = randomNonce(HANDSHAKE_NONCE_BYTES);
  const aSession = P2PSession.fromHandshakeV2(aEph.secretKey, bEph.publicKey, toHex(bobId.publicKey), n1, n2);
  const bSession = P2PSession.fromHandshakeV2(bEph.secretKey, aEph.publicKey, toHex(aliceId.publicKey), n2, n1);
  return { aliceId, bobId, aSession, bSession };
}

describe("M1: replay dentro de la sesión tras la evicción del conjunto de ids", () => {
  it("un frame capturado NO se acepta de nuevo tras 10 000 mensajes posteriores", () => {
    const { aliceId, bobId, aSession, bSession } = twoSessions();
    // T-12 (m-46): la base se ancla al reloj real. Antes era una constante
    // de 2027 porque el `ts` no tenía ninguna cota de pared; desde m-46 el
    // receptor descarta sobres con `ts` a más de 24 h en el futuro, así que
    // el tiempo simulado tiene que vivir cerca del real.
    const BASE = Date.now();
    const send = (i: number) => {
      const env = makeEnvelope("chat", `m-${i}`, aliceId.publicKey, toHex(bobId.publicKey), { text: `n${i}` });
      env.ts = BASE + i;
      return aSession.pack(env);
    };

    const first = send(0);
    expect(bSession.unpack(first)).not.toBeNull();
    // Replay inmediato: ya lo bloqueaba el conjunto de ids.
    expect(bSession.unpack(first)).toBeNull();

    // 10 001 mensajes más: el id de `first` sale del conjunto (FIFO).
    let lastFrame = first;
    for (let i = 1; i <= 10_001; i++) {
      lastFrame = send(i);
      expect(bSession.unpack(lastFrame)).not.toBeNull();
    }

    // Antes del arreglo esto devolvía el envelope (replay aceptado).
    expect(bSession.unpack(first)).toBeNull();
    // Los recientes siguen bloqueados por id y los nuevos siguen entrando.
    expect(bSession.unpack(lastFrame)).toBeNull();
    expect(bSession.unpack(send(10_002))).not.toBeNull();
  }, 60_000);
});

describe("M2: ReplayProtection falla cerrado al llenarse", () => {
  it("lleno: rechaza nonces nuevos y NO expulsa uno vigente", () => {
    const rp = new ReplayProtection(600_000, 3);
    const t = 1_000_000;
    expect(rp.checkAndRecord("n1", t)).toBe(true);
    expect(rp.checkAndRecord("n2", t)).toBe(true);
    expect(rp.checkAndRecord("n3", t)).toBe(true);
    // Lleno y todo dentro de la ventana: el nuevo se rechaza...
    expect(rp.checkAndRecord("n4", t + 1)).toBe(false);
    expect(rp.hasSeen("n4")).toBe(false);
    // ...y n1 (vigente) sigue siendo replay (antes se re-aceptaba).
    expect(rp.checkAndRecord("n1", t + 2)).toBe(false);
  });

  it("al vencer la ventana vuelve a haber espacio", () => {
    const rp = new ReplayProtection(1_000, 2);
    expect(rp.checkAndRecord("a", 0)).toBe(true);
    expect(rp.checkAndRecord("b", 0)).toBe(true);
    expect(rp.checkAndRecord("c", 10)).toBe(false);
    expect(rp.checkAndRecord("c", 2_000)).toBe(true);
  });
});

describe("M3: espejo de revocación", () => {
  beforeEach(() => globalRevocationRegistry.clear());

  const PEER = "a".repeat(64);

  it("RevocationRegistry.unrevokePeer levanta la revocación", () => {
    const r = new RevocationRegistry();
    r.revokePeer(PEER, "x");
    expect(r.isPeerRevoked(PEER)).toBe(true);
    r.unrevokePeer(PEER.toUpperCase());
    expect(r.isPeerRevoked(PEER)).toBe(false);
  });
});
