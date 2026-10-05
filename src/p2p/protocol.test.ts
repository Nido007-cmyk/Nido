import { describe, it, expect } from "vitest";
import { generateEphemeral, generateIdentity, randomNonce, toHex, HANDSHAKE_NONCE_BYTES } from "./crypto";
import {
  FrameReassembler,
  P2PSession,
  makeEnvelope,
} from "./protocol";

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

describe("protocolo P2P", () => {
  it("pack/unpack ida y vuelta entre dos sesiones", () => {
    const { aliceId, bobId, aSession, bSession } = twoSessions();
    const env = makeEnvelope("chat", "id-1", aliceId.publicKey, toHex(bobId.publicKey), {
      text: "hola bob",
    });
    const frame = aSession.pack(env);
    // Longitud big-endian íntegra: decodifica al tamaño real del cuerpo.
    const bodyLen = (frame[0] << 24) | (frame[1] << 16) | (frame[2] << 8) | frame[3];
    expect(bodyLen).toBe(frame.length - 4);
    expect(bodyLen).toBeGreaterThan(24);
    const out = bSession.unpack(frame);
    expect(out).not.toBeNull();
    expect(out!.type).toBe("chat");
    expect(out!.payload).toEqual({ text: "hola bob" });
    expect(out!.from).toBe(toHex(aliceId.publicKey));
  });

  it("suplantación: from distinto al peer → se descarta", () => {
    const { aliceId, bobId, aSession, bSession } = twoSessions();
    const eveId = generateIdentity();
    const env = makeEnvelope("chat", "id-2", eveId.publicKey, toHex(bobId.publicKey), { text: "soy eve" });
    const frame = aSession.pack(env); // cifrado con la sesión, pero from=eve
    expect(bSession.unpack(frame)).toBeNull();
  });

  it("frame manipulado → null", () => {
    const { aliceId, bobId, aSession, bSession } = twoSessions();
    const env = makeEnvelope("chat", "id-3", aliceId.publicKey, toHex(bobId.publicKey), { text: "x" });
    const frame = aSession.pack(env);
    frame[frame.length - 1] ^= 0x01;
    expect(bSession.unpack(frame)).toBeNull();
  });

  it("frame truncado o basura → null sin lanzar", () => {
    const { bSession } = twoSessions();
    expect(bSession.unpack(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(bSession.unpack(new Uint8Array(0))).toBeNull();
  });

  it("makeEnvelope valida claves", () => {
    const { bobId } = twoSessions();
    expect(() =>
      makeEnvelope("chat", "id", new Uint8Array(10), toHex(bobId.publicKey), {}),
    ).toThrow();
    expect(() => makeEnvelope("chat", "id", generateIdentity().publicKey, "zzz", {})).toThrow();
  });

  it("FrameReassembler reensambla chunks arbitrarios", () => {
    const { aliceId, bobId, aSession } = twoSessions();
    const frames = [
      aSession.pack(makeEnvelope("chat", "a", aliceId.publicKey, toHex(bobId.publicKey), { text: "uno" })),
      aSession.pack(makeEnvelope("chat", "b", aliceId.publicKey, toHex(bobId.publicKey), { text: "dos" })),
    ];
    const stream = new Uint8Array(frames[0].length + frames[1].length);
    stream.set(frames[0], 0);
    stream.set(frames[1], frames[0].length);
    const re = new FrameReassembler();
    // Entrega en trozos raros: 1 byte, luego 7, luego el resto.
    const out1 = re.push(stream.slice(0, 1));
    const out2 = re.push(stream.slice(1, 8));
    const out3 = re.push(stream.slice(8));
    expect(out1).toHaveLength(0);
    expect(out2).toHaveLength(0);
    expect(out3).toHaveLength(2);
    expect(out3[0].length).toBe(frames[0].length);
    expect(out3[1].length).toBe(frames[1].length);
  });

  it("FrameReassembler descarta frame corrupto sin atascarse", () => {
    const re = new FrameReassembler();
    // Longitud absurda (0xFFFFFFFF) seguida de un frame válido.
    const bad = new Uint8Array([0xff, 0xff, 0xff, 0xff, 1, 2, 3]);
    expect(re.push(bad)).toHaveLength(0);
    const { aliceId, bobId, aSession } = twoSessions();
    const good = aSession.pack(
      makeEnvelope("chat", "c", aliceId.publicKey, toHex(bobId.publicKey), { text: "ok" }),
    );
    expect(re.push(good)).toHaveLength(1);
  });
});
