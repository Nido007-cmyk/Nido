// Mensajes de amigo en amigo: ¿sirven de verdad? Una red simulada de 60
// teléfonos sin internet en 6 barrios (cada uno con 4 contactos en su
// barrio y 2 fuera), 120 mensajes a contactos de otro barrio, 72 h, cinco
// semillas. Se compara con la entrega directa de hoy.
import nacl from "tweetnacl";
import { describe, expect, it } from "vitest";
import { toHex } from "../crypto";
import { generateCarryPrekey, sealCarry } from "./carryCrypto";
import { STORE_LIMITS } from "./carryStore";
import { simulate, type SimConfig } from "./carrySimulation";

const T = 1_800_000_000_000;
const s = nacl.sign.keyPair();
const k = generateCarryPrekey(toHex(nacl.box.keyPair().publicKey), s.secretKey, T);
const sender = nacl.box.keyPair();
const tpl = sealCarry({ recipient: k.pub, senderPkHex: toHex(sender.publicKey), senderSecretKey: sender.secretKey, id: "t", kind: "chat", text: "x", now: T });
const base: Omit<SimConfig, "relay" | "seed"> = {
  neighbourhoods: 6,
  perNeighbourhood: 10,
  localContacts: 4,
  remoteContacts: 2,
  pLocal: 0.15,
  pRemote: 0.01,
  carriers: 1,
  messages: 120,
  hours: 72,
};
const seeds = [1, 2, 3, 4, 5];
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

describe("red simulada", () => {
  it("de amigo en amigo entrega bastante más que solo directo, a las 24 y a las 72 h", { timeout: 60_000 }, () => {
    const direct = seeds.map((seed) => simulate({ ...base, relay: false, seed }, tpl));
    const relay = seeds.map((seed) => simulate({ ...base, relay: true, seed }, tpl));
    const d24 = mean(direct.map((r) => r.deliveredBy[24]));
    const r24 = mean(relay.map((r) => r.deliveredBy[24]));
    const d72 = mean(direct.map((r) => r.deliveredBy[72]));
    const r72 = mean(relay.map((r) => r.deliveredBy[72]));
    expect(r24).toBeGreaterThanOrEqual(d24 * 1.4);
    expect(r72).toBeGreaterThanOrEqual(d72 * 1.25);
    // Lo que cuesta: pocas copias por mensaje y ningún teléfono cargado.
    expect(mean(relay.map((r) => r.meanCopies))).toBeLessThan(15);
    for (const r of relay) expect(r.maxHeld).toBeLessThan(STORE_LIMITS.maxEnvelopes / 4);
  });
  it("si solo la mitad acepta llevar sobres, sigue ayudando", { timeout: 60_000 }, () => {
    const direct = seeds.map((seed) => simulate({ ...base, relay: false, seed }, tpl));
    const half = seeds.map((seed) => simulate({ ...base, relay: true, carriers: 0.5, seed }, tpl));
    expect(mean(half.map((r) => r.deliveredBy[72]))).toBeGreaterThan(mean(direct.map((r) => r.deliveredBy[72])));
  });
});
