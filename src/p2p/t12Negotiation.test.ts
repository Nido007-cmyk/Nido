/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * t12Negotiation.test.ts — Tanda T-12 (red y relay I) · 0.1.99.
 *
 * Sondas escritas ANTES de las curas (rojo por la causa exacta de cada
 * asiento) y regresiones permanentes de:
 * - M-25: el anti-replay de negociación era UNA cache global: un solo par
 *   podía agotarla y dejar mudos a todos los demás.
 * - m-41: el COUNTER entrante sustituía la propuesta guardada SIN ninguna
 *   verificación (ni ligadura con la original ni política de scopes).
 * - m-42: DECLINE no exigía estado: podía tumbar una sesión ACCEPTED.
 * - m-43: el mapa de sesiones no tenía poda cableada ni cota: crecía sin fin.
 * - P-20: la guarda de destinatario de handlePropose SÍ está cableada en
 *   producción (setLocalIdentity se llama en bootstrapIdentity de
 *   NidoScreen); esta sonda la prueba por la vía real y queda como regresión.
 * - m-46: un `ts` de sobre en el futuro lejano envenenaba la marca de agua
 *   de evicción de P2PSession y la sesión quedaba muda.
 * - m-48: el arranque v5 (L) desencapsulaba ML-KEM ante CADA primer frame
 *   con ct, sin presupuesto: coste asimétrico a favor del atacante.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { PROTOCOL_VERSION, type P2PMessageType } from "./protocol";
import { negotiationService, type NegotiationEvent } from "./negotiationService";
import {
  createProposal,
  signNegotiationMessage,
  type TaskProposal,
  type SignedNegotiationMessage,
} from "./negotiation";
import { globalReplayProtection } from "./replayProtection";
import nacl from "tweetnacl";
import { toHex } from "./crypto";
import {
  generateEphemeral,
  generateIdentity,
  randomNonce,
  HANDSHAKE_NONCE_BYTES,
} from "./crypto";
import { P2PSession, makeEnvelope } from "./protocol";

// Conteo de desencapsulados ML-KEM (m-48): se envuelve el módulo real.
const kemCounter = vi.hoisted(() => ({ decapsulations: 0 }));
vi.mock("./pq", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./pq")>();
  return {
    ...actual,
    kemDecapsulate: (ct: Uint8Array, sk: Uint8Array) => {
      kemCounter.decapsulations += 1;
      return actual.kemDecapsulate(ct, sk);
    },
  };
});

// Auditoría completa 2026-10-31 (F6-05): misma sustitución que
// negotiationService.test.ts — solo getSigningKeypair, resto real.
vi.mock("./store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./store")>();
  return {
    ...actual,
    getSigningKeypair: async () => nacl.sign.keyPair(),
  };
});

// ---------------------------------------------------------------- M-25 / m-41 / m-42 / m-43 / P-20

describe("T-12 · negociación (M-25, m-41, m-42, m-43, P-20)", () => {
  let aliceKeys: nacl.SignKeyPair;
  let bobKeys: nacl.SignKeyPair;
  let carolKeys: nacl.SignKeyPair;
  let alicePkHex: string;
  let bobPkHex: string;
  let carolPkHex: string;
  let events: NegotiationEvent[];

  beforeEach(() => {
    aliceKeys = nacl.sign.keyPair();
    bobKeys = nacl.sign.keyPair();
    carolKeys = nacl.sign.keyPair();
    alicePkHex = toHex(aliceKeys.publicKey);
    bobPkHex = toHex(bobKeys.publicKey);
    carolPkHex = toHex(carolKeys.publicKey);
    events = [];
    negotiationService.setLocalIdentity(bobPkHex);
    negotiationService.subscribe((e) => events.push(e));
    negotiationService.setPeerSigPkResolver(async (peerPkHex) =>
      peerPkHex.toLowerCase() === alicePkHex.toLowerCase()
        ? alicePkHex
        : peerPkHex.toLowerCase() === carolPkHex.toLowerCase()
          ? carolPkHex
          : null,
    );
  });

  afterEach(async () => {
    // Restaurar límites y caches compartidas si una sonda los tocó.
    try {
      const rp = await import("./replayProtection");
      const bucketed = (rp as Record<string, unknown>)["globalNegotiationReplayProtection"] as
        | { setLimitsForTests?: (a: number, b: number) => void; clear?: () => void }
        | undefined;
      bucketed?.setLimitsForTests?.(1000, 10000);
      bucketed?.clear?.();
    } catch {
      /* la clase aún no existe en el árbol sin curar */
    }
    globalReplayProtection.clear();
  });

  function makeProposal(
    from: nacl.SignKeyPair = aliceKeys,
    fromPkHex: string = alicePkHex,
    recipientPkHex: string = bobPkHex,
    scopes: string[] = ["read:notes"],
    ttlMs = 300000,
  ): TaskProposal {
    return createProposal(
      from.secretKey,
      fromPkHex,
      recipientPkHex,
      "Ayúdame a organizar mis notas",
      scopes,
      {},
      ttlMs,
    );
  }

  function makeEnv(
    action: "PROPOSE" | "COUNTER" | "ACCEPT" | "DECLINE" | "EXPIRE",
    negotiationId: string,
    signed: SignedNegotiationMessage,
    fromPkHex: string = alicePkHex,
  ) {
    return {
      v: PROTOCOL_VERSION,
      type: "negotiation" as P2PMessageType,
      id: `msg-${negotiationId}-${action}-${Math.random().toString(36).slice(2)}`,
      from: fromPkHex,
      to: bobPkHex,
      ts: Date.now(),
      payload: {
        action,
        negotiationId,
        signed: signed as unknown as Record<string, unknown>,
      },
    };
  }

  async function proposeFrom(
    from: nacl.SignKeyPair,
    fromPkHex: string,
    negotiationId: string,
    scopes: string[] = ["read:notes"],
    ttlMs = 300000,
  ): Promise<TaskProposal> {
    const proposal = makeProposal(from, fromPkHex, bobPkHex, scopes, ttlMs);
    const signed = signNegotiationMessage(from.secretKey, fromPkHex, "PROPOSE", proposal.proposalId, proposal);
    await negotiationService.handleEnvelope(makeEnv("PROPOSE", negotiationId, signed, fromPkHex) as never);
    return proposal;
  }

  it("P-20: un PROPOSE dirigido a un tercero se ignora con la identidad puesta (guarda cableada)", async () => {
    const proposal = makeProposal(aliceKeys, alicePkHex, carolPkHex); // para Carol, no para Bob
    const signed = signNegotiationMessage(aliceKeys.secretKey, alicePkHex, "PROPOSE", proposal.proposalId, proposal);
    await negotiationService.handleEnvelope(makeEnv("PROPOSE", "t12-p20", signed) as never);
    expect(events).toHaveLength(0);
    expect(negotiationService.listSessions().some((s) => s.negotiationId === "t12-p20")).toBe(false);
    // Control: el mismo emisor, dirigido a Bob, sí entra.
    await proposeFrom(aliceKeys, alicePkHex, "t12-p20-ok");
    expect(events.some((e) => e.type === "proposal_received")).toBe(true);
  });

  it("M-25: llenar la cache anti-replay global heredada no deja mudo a un segundo par", async () => {
    // El ataque del asiento: 10.000 nonces basura agotan la cache ÚNICA y a
    // partir de ahí TODO PROPOSE legítimo se descarta como «replay».
    for (let i = 0; i < 10000; i++) {
      globalReplayProtection.checkAndRecord(`basura-${i}`);
    }
    expect(globalReplayProtection.size).toBe(10000);
    await proposeFrom(carolKeys, carolPkHex, "t12-m25-carol");
    expect(events.some((e) => e.type === "proposal_received")).toBe(true);
  });

  it("M-25: la inundación de un par llena SU cubeta y no la del resto (vía real)", async () => {
    const rp = await import("./replayProtection");
    const bucketed = (rp as Record<string, unknown>)["globalNegotiationReplayProtection"] as
      | { setLimitsForTests: (a: number, b: number) => void; clear: () => void }
      | undefined;
    // Sin la clase de la cura no hay cubetas que ejercer: la sonda falla aquí.
    expect(bucketed, "globalNegotiationReplayProtection debe existir (M-25)").toBeDefined();
    bucketed!.setLimitsForTests(3, 100);
    bucketed!.clear();

    // Alice inunda con el mismo PROPOSE re-firmado (nonces de mensaje nuevos):
    // cada intento quema un hueco de SU cubeta antes del descarte por duplicado.
    const proposal = makeProposal();
    for (let i = 0; i < 5; i++) {
      const signed = signNegotiationMessage(aliceKeys.secretKey, alicePkHex, "PROPOSE", proposal.proposalId, proposal);
      await negotiationService.handleEnvelope(makeEnv("PROPOSE", "t12-m25-flood", signed) as never);
    }
    // Con la cubeta de Alice llena, ni un PROPOSE NUEVO suyo entra…
    await proposeFrom(aliceKeys, alicePkHex, "t12-m25-alice-new");
    expect(negotiationService.listSessions().some((s) => s.negotiationId === "t12-m25-alice-new")).toBe(false);
    // …pero Carol negocia sin enterarse de la inundación.
    await proposeFrom(carolKeys, carolPkHex, "t12-m25-carol-ok");
    expect(events.some((e) => e.type === "proposal_received" && e.session.negotiationId === "t12-m25-carol-ok")).toBe(true);
  });

  it("m-41: un COUNTER honesto (forma de producción: spread con scopes nuevos) sí contraoferta", async () => {
    const proposal = await proposeFrom(aliceKeys, alicePkHex, "t12-m41-honest");
    events = [];
    // Forma EXACTA del camino de producción (counterSession → respond):
    // spread de la propuesta guardada cambiando solo requestedScopes; la
    // firma interior sigue siendo la de la propuesta original.
    const counterPayload: TaskProposal = { ...proposal, requestedScopes: ["read:reminders"] };
    const signed = signNegotiationMessage(aliceKeys.secretKey, alicePkHex, "COUNTER", proposal.proposalId, counterPayload);
    await negotiationService.handleEnvelope(makeEnv("COUNTER", "t12-m41-honest", signed) as never);
    const session = negotiationService.listSessions().find((s) => s.negotiationId === "t12-m41-honest");
    expect(session?.state).toBe("COUNTERED");
    expect(session?.proposal.requestedScopes).toEqual(["read:reminders"]);
    expect(events.some((e) => e.type === "counter_received")).toBe(true);
  });

  it("m-41: un COUNTER que cambia destinatario, propuesta o caducidad se ignora", async () => {
    const proposal = await proposeFrom(aliceKeys, alicePkHex, "t12-m41-binding");
    const originalScopes = [...proposal.requestedScopes];
    const variants: Array<[string, TaskProposal]> = [
      ["otro destinatario", { ...proposal, recipientPkHex: carolPkHex }],
      ["otro proponente", { ...proposal, proposerPkHex: carolPkHex }],
      ["otra propuesta", { ...proposal, proposalId: "f".repeat(64) }],
      ["caducidad extendida", { ...proposal, expiresAt: proposal.expiresAt + 3_600_000 }],
    ];
    for (const [label, payload] of variants) {
      events = [];
      const signed = signNegotiationMessage(aliceKeys.secretKey, alicePkHex, "COUNTER", proposal.proposalId, payload);
      await negotiationService.handleEnvelope(makeEnv("COUNTER", "t12-m41-binding", signed) as never);
      const session = negotiationService.listSessions().find((s) => s.negotiationId === "t12-m41-binding");
      expect(session?.state, label).toBe("PROPOSED");
      expect(session?.proposal.requestedScopes, label).toEqual(originalScopes);
      expect(events.some((e) => e.type === "counter_received"), label).toBe(false);
    }
  });

  it("m-41: un COUNTER que pide un scope que la política deniega se ignora", async () => {
    const proposal = await proposeFrom(aliceKeys, alicePkHex, "t12-m41-deny");
    events = [];
    const counterPayload: TaskProposal = { ...proposal, requestedScopes: ["admin:total"] };
    const signed = signNegotiationMessage(aliceKeys.secretKey, alicePkHex, "COUNTER", proposal.proposalId, counterPayload);
    await negotiationService.handleEnvelope(makeEnv("COUNTER", "t12-m41-deny", signed) as never);
    const session = negotiationService.listSessions().find((s) => s.negotiationId === "t12-m41-deny");
    expect(session?.state).toBe("PROPOSED");
    expect(session?.proposal.requestedScopes).toEqual(["read:notes"]);
    expect(events.some((e) => e.type === "counter_received")).toBe(false);
  });

  it("m-42: DECLINE sobre una sesión ACCEPTED se ignora; sobre PROPOSED sigue funcionando", async () => {
    const proposal = await proposeFrom(aliceKeys, alicePkHex, "t12-m42");
    const acceptSigned = signNegotiationMessage(aliceKeys.secretKey, alicePkHex, "ACCEPT", proposal.proposalId, proposal);
    await negotiationService.handleEnvelope(makeEnv("ACCEPT", "t12-m42", acceptSigned) as never);
    let session = negotiationService.listSessions().find((s) => s.negotiationId === "t12-m42");
    expect(session?.state).toBe("ACCEPTED");

    events = [];
    const declineSigned = signNegotiationMessage(aliceKeys.secretKey, alicePkHex, "DECLINE", proposal.proposalId, {
      reason: "tarde",
    });
    await negotiationService.handleEnvelope(makeEnv("DECLINE", "t12-m42", declineSigned) as never);
    session = negotiationService.listSessions().find((s) => s.negotiationId === "t12-m42");
    expect(session?.state).toBe("ACCEPTED");
    expect(events.some((e) => e.type === "declined")).toBe(false);

    // Control: DECLINE sobre PROPOSED sí declina.
    const p2 = await proposeFrom(aliceKeys, alicePkHex, "t12-m42-b");
    const decline2 = signNegotiationMessage(aliceKeys.secretKey, alicePkHex, "DECLINE", p2.proposalId, {
      reason: "no",
    });
    await negotiationService.handleEnvelope(makeEnv("DECLINE", "t12-m42-b", decline2) as never);
    expect(negotiationService.listSessions().find((s) => s.negotiationId === "t12-m42-b")?.state).toBe("DECLINED");
  });

  it("m-43: una sesión PROPOSED cuya propuesta venció se caduca en la siguiente pasada del despacho", async () => {
    await proposeFrom(aliceKeys, alicePkHex, "t12-m43-stale", ["read:notes"], 2000);
    expect(negotiationService.listSessions().find((s) => s.negotiationId === "t12-m43-stale")?.state).toBe("PROPOSED");
    await new Promise((r) => setTimeout(r, 2200));
    // Cualquier sobre posterior dispara la pasada de poda del despacho.
    await proposeFrom(carolKeys, carolPkHex, "t12-m43-trigger");
    expect(negotiationService.listSessions().find((s) => s.negotiationId === "t12-m43-stale")?.state).toBe("EXPIRED");
  });

  it(
    "m-43: el mapa de sesiones tiene cota dura con desalojo del PROPOSED más viejo",
    async () => {
      // La cota del mapa es el sujeto; la cubeta anti-replay (M-25) se
      // abre para que no sea ella la que frene la inundación de sesiones
      // (con los topes por defecto, ~500 PROPOSE de un par agotan su
      // cubeta: 2 nonces por propuesta entre mensaje y puente).
      const rp = await import("./replayProtection");
      rp.globalNegotiationReplayProtection.setLimitsForTests(100_000, 100_000);
      rp.globalNegotiationReplayProtection.clear();
      const total = 513;
      for (let i = 0; i < total; i++) {
        await proposeFrom(aliceKeys, alicePkHex, `t12-m43-cap-${i}`);
      }
      const sessions = negotiationService.listSessions();
      expect(sessions.length).toBeLessThanOrEqual(512);
      const capSessions = sessions.filter((s) => s.negotiationId.startsWith("t12-m43-cap-"));
      expect(capSessions.length).toBeLessThan(total);
      expect(sessions.some((s) => s.negotiationId === `t12-m43-cap-${total - 1}`)).toBe(true);
    },
    120_000,
  );
});

// ---------------------------------------------------------------- m-46

describe("T-12 · protocolo (m-46)", () => {
  function twoSessions() {
    const aliceId = generateIdentity();
    const bobId = generateIdentity();
    const aEph = generateEphemeral();
    const bEph = generateEphemeral();
    const n1 = randomNonce(HANDSHAKE_NONCE_BYTES);
    const n2 = randomNonce(HANDSHAKE_NONCE_BYTES);
    const aSession = P2PSession.fromHandshakeV2(aEph.secretKey, bEph.publicKey, toHex(bobId.publicKey), n1, n2);
    const bSession = P2PSession.fromHandshakeV2(bEph.secretKey, aEph.publicKey, toHex(aliceId.publicKey), n2, n1);
    aSession.expectRecipient(toHex(aliceId.publicKey));
    bSession.expectRecipient(toHex(bobId.publicKey));
    return { aliceId, bobId, aSession, bSession };
  }

  it(
    "m-46: un sobre con ts en el futuro lejano no envenena la sesión (la marca de evicción no lo absorbe)",
    () => {
      const { aliceId, bobId, aSession, bSession } = twoSessions();
      const now = Date.now();
      const envWithTs = (id: string, ts: number) => ({
        ...makeEnvelope("chat", id, aliceId.publicKey, toHex(bobId.publicKey), { text: "x" }),
        ts,
      });
      // 1) El veneno: un sobre válido con ts dentro de un año.
      const poison = aSession.pack(envWithTs("t12-poison", now + 365 * 24 * 3600 * 1000) as never);
      bSession.unpack(poison);
      // 2) Tráfico suficiente para que el veneno salga expulsado del conjunto
      //    de ids vistos (>10.000) y su ts pase a la marca de agua. Los ts del
      //    relleno crecen de 1 en 1 ms (como un reloj real entre mensajes).
      for (let i = 0; i < 10001; i++) {
        const f = aSession.pack(envWithTs(`t12-fill-${i}`, now + i) as never);
        if (bSession.unpack(f) === null) throw new Error(`relleno ${i} rechazado: la sesión ya está muda`);
      }
      // 3) Un mensaje legítimo con ts normal debe seguir entrando.
      const legit = aSession.pack(envWithTs("t12-legit", now + 20000) as never);
      expect(bSession.unpack(legit)).not.toBeNull();
    },
    120_000,
  );

  it("m-46: un sobre con ts más de 24 h en el futuro se descarta en la puerta", () => {
    const { aliceId, bobId, aSession, bSession } = twoSessions();
    const future = {
      ...makeEnvelope("chat", "t12-future", aliceId.publicKey, toHex(bobId.publicKey), { text: "futuro" }),
      ts: Date.now() + 25 * 3600 * 1000,
    };
    expect(bSession.unpack(aSession.pack(future as never))).toBeNull();
    // Control: 1 h en el futuro (reloj del par algo adelantado) sí entra.
    const near = {
      ...makeEnvelope("chat", "t12-near", aliceId.publicKey, toHex(bobId.publicKey), { text: "cerca" }),
      ts: Date.now() + 3600 * 1000,
    };
    expect(bSession.unpack(aSession.pack(near as never))).not.toBeNull();
  });
});

// ---------------------------------------------------------------- m-48

describe("T-12 · ratchet v5 (m-48)", () => {
  function pairV5() {
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
    sL.enableV5(true);
    sH.enableV5(true);
    return { sL, sH, lowPk, highPk, low, high };
  }

  /** Frame v5 en claro (sin caja de cabecera) con un ct basura de 1088 B. */
  function garbageCtFrame(): Uint8Array {
    const HEADER = 42;
    const CT = 1088;
    const NONCE = 24;
    const BOX = 64;
    const body = new Uint8Array(HEADER + CT + NONCE + BOX);
    body[0] = 0x05; // V5_MARKER
    body[1] = 0x01; // FLAG_HAS_CT
    for (let i = 2; i < body.length; i++) body[i] = (i * 37 + 11) & 0xff;
    const frame = new Uint8Array(4 + body.length);
    frame[0] = (body.length >>> 24) & 0xff;
    frame[1] = (body.length >>> 16) & 0xff;
    frame[2] = (body.length >>> 8) & 0xff;
    frame[3] = body.length & 0xff;
    frame.set(body, 4);
    return frame;
  }

  it("m-48: tras el presupuesto de arranques, los primeros frames basura ya no cuestan desencapsulados", () => {
    const { sL, sH, low, highPk } = pairV5();
    // L ofrece (su session_confirm crea la oferta); H la acepta y arranca.
    const confirmL = sL.pack(
      makeEnvelope("session_confirm", "t12-m48-c1", low.publicKey, highPk, sL.confirmPayload()),
    );
    expect(sH.unpack(confirmL)).not.toBeNull();

    kemCounter.decapsulations = 0;
    // Inundación de primeros frames con ct basura hacia L (sin arrancar).
    for (let i = 0; i < 24; i++) {
      expect(sL.unpack(garbageCtFrame())).toBeNull();
    }
    const spent = kemCounter.decapsulations;
    // Sin presupuesto (antes de la cura) serían 24 desencapsulados.
    expect(spent).toBeGreaterThan(0);
    expect(spent).toBeLessThanOrEqual(8);
  });

  it("m-48: el arranque honesto sigue funcionando tras frames basura dentro del presupuesto", () => {
    const p = pairV5();
    const confirmL = p.sL.pack(
      makeEnvelope("session_confirm", "t12-m48-c2", p.low.publicKey, p.highPk, p.sL.confirmPayload()),
    );
    expect(p.sH.unpack(confirmL)).not.toBeNull();
    // Un par de frames basura (dentro del presupuesto) no queman el arranque.
    p.sL.unpack(garbageCtFrame());
    p.sL.unpack(garbageCtFrame());
    // El primer frame v5 auténtico de H arranca a L.
    const first = p.sH.pack(makeEnvelope("chat", "t12-m48-first", p.high.publicKey, p.lowPk, { text: "hola" }));
    // El frame debe ser v5 de verdad (marcador tras el prefijo de longitud),
    // no un clásico que L abriría por la otra vía.
    expect([0x05, 0x06]).toContain(first[4]);
    const opened = p.sL.unpack(first);
    expect(opened).not.toBeNull();
    expect(opened!.payload).toEqual({ text: "hola" });
  });
});
