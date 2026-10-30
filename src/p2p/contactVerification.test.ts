/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Lecciones de Signal y Briar (2026-10-29). Briar dejó pendiente que un
 * contacto añadido en remoto nunca quedara verificado (OTF-005), y en Signal
 * el 75 % de la gente creía haber verificado sin hacerlo. En NIDO el código
 * de emparejamiento es texto: puede llegar por cualquier canal. Hasta 0.1.62
 * todo contacto se guardaba como «verificado». Ahora entra sin verificar y
 * solo se marca cuando la persona confirma que comparó la huella.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemorySecureBackend, setTestSecureBackend } from "../privacy/keyManager";
import { resetP2PMem, type P2PMem } from "./p2pMemoryMock";

const mem: P2PMem = vi.hoisted(() => ({
  identity: [],
  contacts: [],
  messages: [],
  ackLog: [],
  lateAck: [],
  nonceCache: [],
  identityArchive: [],
  repairIntents: [],
  bootRepairLog: [],
}));

vi.mock("../agent/memory/memoryStore", async () => {
  const { p2pMemoryStoreModule } = await import("./p2pMemoryMock");
  return p2pMemoryStoreModule(mem);
});

import { NidoMessenger } from "./messenger";
import { fingerprint, generateIdentity, generateSigningKeypair } from "./crypto";
import { encodePairingPayload } from "./pairing";

beforeEach(() => {
  resetP2PMem(mem);
  setTestSecureBackend(createMemorySecureBackend());
});

describe("verificación de contactos", () => {
  it("un contacto nuevo entra sin verificar y se marca solo al confirmar la huella", async () => {
    const m = new NidoMessenger();
    await m.ensureIdentity();
    const id = generateIdentity();
    const sign = generateSigningKeypair();
    const c = await m.pairWith(encodePairingPayload("Ana", id.publicKey, sign.publicKey));
    expect(c!.verified).toBe(false);

    // La huella que hay que comparar es la que el NIDO de Ana muestra en «Mi código».
    expect(m.contactFingerprint(c!)).toBe(fingerprint(id.publicKey, sign.publicKey));

    expect(await m.setContactVerified(c!.pkHex, true)).toBe(true);
    expect((await m.contacts())[0].verified).toBe(true);
    expect(await m.setContactVerified(c!.pkHex, false)).toBe(true);
    expect((await m.contacts())[0].verified).toBe(false);
  });

  it("volver a pegar el mismo código no quita la verificación", async () => {
    const m = new NidoMessenger();
    await m.ensureIdentity();
    const id = generateIdentity();
    const sign = generateSigningKeypair();
    const code = encodePairingPayload("Ana", id.publicKey, sign.publicKey);
    const c = await m.pairWith(code);
    await m.setContactVerified(c!.pkHex, true);
    await m.pairWith(code);
    expect((await m.contacts())[0].verified).toBe(true);
  });

  it("un contacto que no existe no se marca", async () => {
    const m = new NidoMessenger();
    await m.ensureIdentity();
    expect(await m.setContactVerified("ab".repeat(32), true)).toBe(false);
  });
});
