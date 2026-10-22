/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * 0.1.52 — el messenger corta un "unknown key share" (hallazgo de la revisión
 * independiente). Escenario: un contacto malicioso C junta dos handshakes y
 * le quita a A la firma v2 del CONFIRM de B. A cree hablar con B, B cree
 * hablar con C, y comparten clave de sesión. Antes, el session_confirm de B
 * (dirigido a C) se descartaba en silencio: la sesión quedaba colgada y el
 * contacto sin marcar. Ahora A corta y marca a B como "firma CONFIRM v2", así
 * que el ataque no se puede repetir.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  (globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;
});
vi.mock("../agent/memory/memoryStore", async () => {
  const { sqliteMemoryStoreModule } = await import("./sqliteTestBridge");
  return sqliteMemoryStoreModule();
});
vi.mock("expo-sqlite", () => ({}));
vi.mock("react-native", () => ({ Platform: { OS: "android" } }));

import { resetSqliteBridge, useSqliteDevice } from "./sqliteTestBridge";
import { createMemorySecureBackend, setTestSecureBackend } from "../privacy/keyManager";
import { NidoMessenger } from "./messenger";
import { LoopbackTransport } from "./transport";
import { P2PSession, makeEnvelope } from "./protocol";
import { generateEphemeral, generateIdentity, generateSigningKeypair, randomNonce, toHex, HANDSHAKE_NONCE_BYTES } from "./crypto";
import { encodePairingPayload } from "./pairing";
import { isContactConfirmV2 } from "./store";
import { resetFeatureFlagsForTests, setFeatureOverrideForTests } from "../config/featureFlags";

beforeEach(() => {
  resetSqliteBridge();
  useSqliteDevice("a");
  setTestSecureBackend(createMemorySecureBackend());
  resetFeatureFlagsForTests();
  setFeatureOverrideForTests("p2p.ratchetV5", false);
});

async function setup() {
  const tA = new LoopbackTransport();
  const tB = new LoopbackTransport();
  const disconnects: string[] = [];
  const realDisconnect = tA.disconnect.bind(tA);
  tA.disconnect = async (pk: string) => {
    disconnects.push(pk);
    return realDisconnect(pk);
  };
  const m = new NidoMessenger(tA);
  const { pkHex: aPk } = await m.ensureIdentity();
  const B = generateIdentity();
  const bPk = toHex(B.publicKey);
  const cPk = toHex(generateIdentity().publicKey);
  // QR viejo (sin "caps"): el contacto empieza sin marcar, como antes de 0.1.49.
  const code = `NIDO1:${JSON.stringify({ v: 2, app: "nido", name: "Beto", pk: bPk, spk: toHex(generateSigningKeypair().publicKey) })}`;
  await m.pairWith(code);
  tA.linkTo(tB, { pkHex: aPk, alias: "yo", transport: "bluetooth" }, { pkHex: bPk, alias: "beto", transport: "bluetooth" });
  await tB.startDiscovery({ onFrame: () => {} });
  await tA.connect("beto");
  const eA = m.newHandshakeEphemeral();
  const eB = generateEphemeral();
  const nA = randomNonce(HANDSHAKE_NONCE_BYTES);
  const nB = randomNonce(HANDSHAKE_NONCE_BYTES);
  // B cree hablar con C.
  const atB = P2PSession.fromHandshakeV2(eB.secretKey, eA.publicKey, cPk, nB, nA);
  atB.expectRecipient(bPk);
  atB.enableV5(false);
  // A: el transporte vio el CONFIRM de B sin firma v2 (C se la quitó).
  await m.completeHandshake(bPk, eA.secretKey, eB.publicKey, nA, nB, false);
  return { m, atB, B, bPk, cPk, disconnects };
}

describe("0.1.52: unknown key share en el messenger", () => {
  it("el session_confirm de B dirigido a C: A corta la conexión y marca a B (firma CONFIRM v2)", async () => {
    const { m, atB, B, bPk, cPk, disconnects } = await setup();
    expect(await isContactConfirmV2(bPk)).toBe(false);
    const frame = atB.pack(makeEnvelope("session_confirm", "c-B", B.publicKey, cPk, atB.confirmPayload()));
    expect(await m.handleFrame(bPk, frame)).toBeNull();
    expect(disconnects).toContain(bPk);
    expect(await isContactConfirmV2(bPk)).toBe(true);
    // La sesión no queda viva: un chat de B tampoco entra.
    const chat = atB.pack(makeEnvelope("chat", "x", B.publicKey, cPk, { text: "hola" }));
    expect(await m.handleFrame(bPk, chat)).toBeNull();
    expect(m.sessionUsesV5(bPk)).toBe(false);
  });

  it("un frame que no autentica no corta nada (no es un ataque, es ruido)", async () => {
    const { m, bPk, disconnects } = await setup();
    expect(await m.handleFrame(bPk, new Uint8Array(300))).toBeNull();
    expect(disconnects).not.toContain(bPk);
    expect(await isContactConfirmV2(bPk)).toBe(false);
  });
});
