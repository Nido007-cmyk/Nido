/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * T-14 (0.1.99) · m-51: el interruptor «Enviar por amigos cuando no
 * llego» (`p2p.relaySend`) corta el SELLADO de sobres propios en el
 * Messenger. Con el relevo maestro encendido pero este apagado, un
 * mensaje que no sale en directo NO se sella; con el defecto
 * (encendido), se sella como hasta hoy. Los sobres ya sellados no se
 * tocan: el interruptor corta los nuevos.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

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
import { generateIdentity, generateSigningKeypair, toHex } from "./crypto";
import { encodePairingPayload } from "./pairing";
import { getIdentity, getSigningKeypair } from "./store";
import { resetFeatureFlagsForTests, setFeatureEnabled } from "../config/featureFlags";
import * as relay from "./relay/relayService";

let kv: relay.RelayKv;

beforeEach(async () => {
  resetSqliteBridge();
  useSqliteDevice("a");
  setTestSecureBackend(createMemorySecureBackend());
  resetFeatureFlagsForTests();
  await setFeatureEnabled("p2p.relay", true);
  kv = relay.memoryKv();
  relay.setRelayKvForTests(() => kv);
});

/** Messenger emparejado con Beto, SIN sesión viva: todo envío falla en directo. */
async function setup() {
  const tA = new LoopbackTransport();
  const m = new NidoMessenger(tA);
  const { pkHex: myPk } = await m.ensureIdentity();
  const peerId = generateIdentity();
  const peerSign = generateSigningKeypair();
  await m.pairWith(encodePairingPayload("Beto", peerId.publicKey, peerSign.publicKey));
  const contact = (await m.contacts())[0];
  const peerPk = contact.pkHex;
  const signing = await getSigningKeypair();
  const idn = await getIdentity();
  const me: relay.Me = { pkHex: myPk.toLowerCase(), signSecretKey: signing.secretKey, idSecretKey: idn!.secretKey };
  const peerMe: relay.Me = {
    pkHex: toHex(peerId.publicKey).toLowerCase(),
    signSecretKey: peerSign.secretKey,
    idSecretKey: peerId.secretKey,
  };
  // El saludo del peer: su clave de buzón queda en mi estado del relevo.
  const now = Date.now();
  const hp = await relay.helloPayload(peerMe, now);
  const book = (pk: string) => (pk.toLowerCase() === peerPk.toLowerCase() ? toHex(peerSign.publicKey).toLowerCase() : null);
  await relay.receive(peerPk, hp, me, book, now);
  return { m, peerPk };
}

async function waitFor(cond: () => Promise<boolean>, ms = 3000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await cond()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return cond();
}

describe("T-14 · m-51: el interruptor de envío por relevo", () => {
  it("con el defecto (encendido), un mensaje sin directo se sella para el relevo", async () => {
    const s = await setup();
    await s.m.sendChat("Beto", "hola sin directo");
    expect(await waitFor(async () => (await relay.relayUsage()).envelopes === 1)).toBe(true);
  });

  it("apagado, el mismo mensaje NO se sella (y el chat queda enviado solo en local)", async () => {
    const s = await setup();
    await setFeatureEnabled("p2p.relaySend", false);
    await s.m.sendChat("Beto", "esto no viaja");
    // Margen de sobra para que un sellado (si lo hubiera) aterrice.
    await new Promise((r) => setTimeout(r, 400));
    expect((await relay.relayUsage()).envelopes).toBe(0);
    expect(await s.m.lastRelaySealMiss()).toBeNull();
  });

  it("apagado a mitad: lo ya sellado sigue en el almacén; lo nuevo no se sella", async () => {
    const s = await setup();
    await s.m.sendChat("Beto", "primero");
    expect(await waitFor(async () => (await relay.relayUsage()).envelopes === 1)).toBe(true);
    await setFeatureEnabled("p2p.relaySend", false);
    await s.m.sendChat("Beto", "segundo");
    await new Promise((r) => setTimeout(r, 400));
    expect((await relay.relayUsage()).envelopes).toBe(1);
  });
});
