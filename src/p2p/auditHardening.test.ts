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
 * - M3: SessionManager / grants / espejo de revocación (código antes
 *   desconectado y con fallos latentes).
 */

import { describe, it, expect, beforeEach } from "vitest";
import nacl from "tweetnacl";
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
import { SessionManager } from "./sessionManager";
import { issueGrant } from "./negotiation";
import { consumeGrantUse, validateGrantForExecution } from "./p2pAuthorization";

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
    const BASE = 1_800_000_000_000;
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

describe("M3: SessionManager y revocación", () => {
  beforeEach(() => globalRevocationRegistry.clear());

  const PEER = "a".repeat(64);

  it("revocar al PEER cierra sus sesiones activas", () => {
    const sm = new SessionManager();
    const s = sm.createSession(PEER);
    expect(sm.activateSession(s.sessionId)).toBe(true);
    expect(sm.heartbeat(s.sessionId)).toBe(true);

    globalRevocationRegistry.revokePeer(PEER, "usuario");
    expect(sm.heartbeat(s.sessionId)).toBe(false);
    expect(sm.getActiveSession(s.sessionId)).toBeNull();
    expect(s.state).toBe("REVOKED");
  });

  it("SUSPENDED no se reactiva si el peer fue revocado", () => {
    const sm = new SessionManager({ heartbeatTimeoutMs: 1_000 });
    const s = sm.createSession(PEER, 0);
    sm.activateSession(s.sessionId);
    sm.checkHealth(5_000);
    expect(s.state).toBe("SUSPENDED");
    globalRevocationRegistry.revokePeer(PEER, "usuario");
    expect(sm.heartbeat(s.sessionId, 6_000)).toBe(false);
    expect(s.state).toBe("REVOKED");
  });

  it("no se puede activar una sesión de un peer revocado", () => {
    const sm = new SessionManager();
    globalRevocationRegistry.revokePeer(PEER, "usuario");
    const s = sm.createSession(PEER);
    expect(sm.activateSession(s.sessionId)).toBe(false);
  });

  it("sessionId usa PRNG criptográfico (16 hex) y no se repite", () => {
    const sm = new SessionManager();
    const a = sm.createSession(PEER, 1).sessionId;
    const b = sm.createSession(PEER, 1).sessionId;
    expect(a).toMatch(/^sess_1_[0-9a-f]{16}$/);
    expect(a === b).toBe(false);
  });

  it("contador entrante estrictamente creciente", () => {
    const sm = new SessionManager();
    const s = sm.createSession(PEER);
    sm.activateSession(s.sessionId);
    expect(sm.acceptIncomingCounter(s.sessionId, 1)).toBe(true);
    expect(sm.acceptIncomingCounter(s.sessionId, 1)).toBe(false); // replay
    expect(sm.acceptIncomingCounter(s.sessionId, 5)).toBe(true);
    expect(sm.acceptIncomingCounter(s.sessionId, 3)).toBe(false); // reorden
    expect(sm.acceptIncomingCounter(s.sessionId, 1.5)).toBe(false);
  });

  it("las sesiones terminales vencidas se podan", () => {
    const sm = new SessionManager({ sessionTtlMs: 1_000 });
    const s = sm.createSession(PEER, 0);
    sm.activateSession(s.sessionId);
    sm.closeSession(s.sessionId);
    sm.checkHealth(500);
    expect(sm.size).toBe(1);
    sm.checkHealth(10_000); // > expiresAt + ttl
    expect(sm.size).toBe(0);
  });

  it("RevocationRegistry.unrevokePeer levanta la revocación", () => {
    const r = new RevocationRegistry();
    r.revokePeer(PEER, "x");
    expect(r.isPeerRevoked(PEER)).toBe(true);
    r.unrevokePeer(PEER.toUpperCase());
    expect(r.isPeerRevoked(PEER)).toBe(false);
  });
});

describe("M3: un grant válido sobre un scope ASK exige aprobación humana", () => {
  beforeEach(() => globalRevocationRegistry.clear());

  const mk = (scopes: string[]) => {
    const bob = nacl.sign.keyPair();
    const alice = nacl.sign.keyPair();
    const bobPk = toHex(bob.publicKey);
    const alicePk = toHex(alice.publicKey);
    const grant = issueGrant(bob.secretKey, bobPk, alicePk, scopes, "prop-1", 300_000, 5);
    return { grant, bobPk };
  };

  it("send:message (ASK): válido pero requiresHumanApproval; no se consume sin aprobación", () => {
    const { grant, bobPk } = mk(["send:message"]);
    const v = validateGrantForExecution(grant, bobPk, "send:message");
    expect(v.valid).toBe(true);
    expect(v.requiresHumanApproval).toBe(true);

    expect(consumeGrantUse(grant, bobPk, "send:message")).toBe(false);
    expect(grant.usesConsumed).toBe(0);
    expect(consumeGrantUse(grant, bobPk, "send:message", Date.now(), true)).toBe(true);
    expect(grant.usesConsumed).toBe(1);
  });

  it("read:notes (AUTO): sin cambios", () => {
    const { grant, bobPk } = mk(["read:notes"]);
    const v = validateGrantForExecution(grant, bobPk, "read:notes");
    expect(v.valid).toBe(true);
    expect(v.requiresHumanApproval).toBe(undefined);
    expect(consumeGrantUse(grant, bobPk, "read:notes")).toBe(true);
  });
});
