import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createMemorySecureBackend,
  setTestSecureBackend,
  SecureStoreReadError,
  type SecureBackend,
} from "../privacy/keyManager";
import { resetP2PMem, type P2PMem } from "./p2pMemoryMock";

/** La próxima lectura del backend falla (transitorio) y luego se recupera. */
function failNextRead(inner: SecureBackend): SecureBackend {
  let fail = true;
  return {
    getItemAsync: async (k: string) => {
      if (fail) {
        fail = false;
        throw new Error("boom: fallo transitorio del SecureStore");
      }
      return inner.getItemAsync(k);
    },
    setItemAsync: (k: string, v: string) => inner.setItemAsync(k, v),
    deleteItemAsync: (k: string) => inner.deleteItemAsync(k),
  };
}

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
import { LoopbackTransport } from "./transport";
import { P2PSession, makeEnvelope } from "./protocol";
import {
  generateEphemeral,
  generateIdentity,
  generateSigningKeypair,
  randomNonce,
  toHex,
  HANDSHAKE_NONCE_BYTES,
} from "./crypto";
import { encodePairingPayload } from "./pairing";

/** Nonces frescos para un handshake v2 en tests. */
function freshNonces(): [Uint8Array, Uint8Array] {
  return [randomNonce(HANDSHAKE_NONCE_BYTES), randomNonce(HANDSHAKE_NONCE_BYTES)];
}

beforeEach(() => {
  resetP2PMem(mem);
  setTestSecureBackend(createMemorySecureBackend());
});

describe("NidoMessenger", () => {
  it("ensureIdentity es estable entre llamadas", async () => {
    const m = new NidoMessenger();
    const a = await m.ensureIdentity("Mi NIDO");
    const b = await m.ensureIdentity("Mi NIDO");
    expect(a.pkHex).toBe(b.pkHex);
    expect(a.fingerprint.split(" ")).toHaveLength(8);
  });

  it("M-2: un fallo transitorio del Keystore NO regenera la identidad en silencio", async () => {
    // Repro del review: getItemAsync falla una vez de forma transitoria.
    // Antes del fix, getIdentity() devolvía null y ensureIdentity()
    // generaba una identidad NUEVA, sobrescribiendo la real.
    const real = createMemorySecureBackend();
    setTestSecureBackend(real);
    const m = new NidoMessenger();
    const before = await m.ensureIdentity("Mi NIDO");
    setTestSecureBackend(failNextRead(real));
    const m2 = new NidoMessenger();
    const err = await m2.ensureIdentity("Mi NIDO").catch((e) => e);
    expect(err).toBeInstanceOf(SecureStoreReadError);
    expect(String(err.message)).toMatch(/fail-closed/i);
    // Tras recuperarse: la MISMA identidad, no una regenerada.
    const after = await m2.ensureIdentity("Mi NIDO");
    expect(after.pkHex).toBe(before.pkHex);
  });

  it("pairWith rechaza el propio código", async () => {
    const m = new NidoMessenger();
    await m.ensureIdentity();
    const mine = await m.myPairingCode();
    await expect(m.pairWith(mine)).rejects.toThrow("propio");
  });

  it("pairWith guarda el contacto verificado", async () => {
    const m = new NidoMessenger();
    await m.ensureIdentity();
    const peerId = generateIdentity();
    const peerSign = generateSigningKeypair();
    const contact = await m.pairWith(encodePairingPayload("Beto", peerId.publicKey, peerSign.publicKey));
    expect(contact).not.toBeNull();
    expect(contact!.name).toBe("Beto");
    expect(contact!.verified).toBe(true);
    expect((await m.contacts()).map((c) => c.name)).toEqual(["Beto"]);
  });

  it("pairWith devuelve el contacto correcto aunque el nombre se repita (búsqueda por clave, no por nombre)", async () => {
    const m = new NidoMessenger();
    await m.ensureIdentity();
    // Dos contactos distintos con el mismo nombre visible: UNIT B exige
    // desambiguación explícita (mismo nombre ≠ misma identidad).
    const peerA = generateIdentity();
    const contactA = await m.pairWith(
      encodePairingPayload("Beto", peerA.publicKey, generateSigningKeypair().publicKey),
    );
    const peerB = generateIdentity();
    const contactB = await m.pairWith(
      encodePairingPayload("Beto", peerB.publicKey, generateSigningKeypair().publicKey),
      { disambiguation: "different_person", newName: "Beto 2" },
    );
    // La UI debe mostrar el contacto que se acaba de emparejar, no el
    // primero que coincida por nombre (bug L-2).
    expect(contactA).not.toBeNull();
    expect(contactB).not.toBeNull();
    expect(contactA!.pkHex).toBe(toHex(peerA.publicKey));
    expect(contactB!.pkHex).toBe(toHex(peerB.publicKey));
    expect(contactB!.pkHex).not.toBe(contactA!.pkHex);
    expect(contactB!.name).toBe("Beto 2");
  });

  it("sendChat a desconocido lanza ayuda para emparejar", async () => {
    const m = new NidoMessenger();
    await m.ensureIdentity();
    await expect(m.sendChat("nadie", "hola")).rejects.toThrow("Pair first");
  });

  it("sin transporte, el mensaje queda en cola cifrada en reposo", async () => {
    const m = new NidoMessenger(); // NativeP2PTransport: available=false
    await m.ensureIdentity();
    const peerId = generateIdentity();
    const peerSign = generateSigningKeypair();
    await m.pairWith(encodePairingPayload("Beto", peerId.publicKey, peerSign.publicKey));
    const { queued } = await m.sendChat("beto", "hola sin radio");
    expect(queued).toBe(true);
    const outbox = await m.pendingOutbox();
    expect(outbox).toHaveLength(1);
    expect(outbox[0].text).toBe("hola sin radio");
    expect(outbox[0].status).toBe("queued");
  });

  it("con loopback y handshake, el frame cifrado llega al peer", async () => {
    const tA = new LoopbackTransport();
    const tB = new LoopbackTransport();
    const m = new NidoMessenger(tA);
    const { pkHex: myPk } = await m.ensureIdentity();
    const peerId = generateIdentity();
    const peerSign = generateSigningKeypair();
    await m.pairWith(encodePairingPayload("Beto", peerId.publicKey, peerSign.publicKey));
    const contact = (await m.contacts())[0];

    tA.linkTo(
      tB,
      { pkHex: myPk, alias: "yo", transport: "bluetooth" },
      { pkHex: contact.pkHex, alias: "beto", transport: "bluetooth" },
    );
    const received: Uint8Array[] = [];
    await tB.startDiscovery({ onFrame: (_pk, frame) => received.push(frame) });
    await tA.connect("beto");

    // Handshake v2: intercambio de efímeras + nonces firmados.
    const myEph = m.newHandshakeEphemeral();
    const peerEph = generateEphemeral();
    const [myNonce, peerNonce] = freshNonces();
    await m.completeHandshake(contact.pkHex, myEph.secretKey, peerEph.publicKey, myNonce, peerNonce);
    const peerSession = P2PSession.fromHandshakeV2(peerEph.secretKey, myEph.publicKey, myPk, peerNonce, myNonce);

    // El peer confirma la sesión: solo entonces hay liveness mutua.
    const peerConfirm = makeEnvelope("session_confirm", "confirm-1", peerId.publicKey, myPk, {});
    const confirmOut = await m.handleFrame(toHex(peerId.publicKey), peerSession.pack(peerConfirm));
    expect(confirmOut?.type).toBe("session_confirm");

    const { id, queued } = await m.sendChat("beto", "hola por NIDO");
    expect(queued).toBe(false);
    await new Promise((r) => setTimeout(r, 30));
    expect(received).toHaveLength(2); // mi session_confirm + el chat
    const env = peerSession.unpack(received[1]);
    expect(env?.type).toBe("chat");
    // N6 §5.1: el payload saliente lleva el message_id estable (mismo id en
    // todos los reintentos); el envelope id es el nonce de transmisión.
    expect(env?.payload).toEqual({ text: "hola por NIDO", message_id: id });
  });

  it("handleFrame guarda en bandeja y readInbox marca leído", async () => {
    const m = new NidoMessenger();
    const { pkHex: myPk } = await m.ensureIdentity();
    const peerId = generateIdentity();
    const peerSign = generateSigningKeypair();
    await m.pairWith(encodePairingPayload("Beto", peerId.publicKey, peerSign.publicKey));

    const myEph = m.newHandshakeEphemeral();
    const peerEph = generateEphemeral();
    const [myNonce, peerNonce] = freshNonces();
    await m.completeHandshake(toHex(peerId.publicKey), myEph.secretKey, peerEph.publicKey, myNonce, peerNonce);

    // El peer empaqueta un chat con su sesión (un frame válido marca liveness).
    const peerSession = P2PSession.fromHandshakeV2(peerEph.secretKey, myEph.publicKey, myPk, peerNonce, myNonce);
    const env = makeEnvelope("chat", "msg-1", peerId.publicKey, myPk, { text: "hola de vuelta" });
    const out = await m.handleFrame(toHex(peerId.publicKey), peerSession.pack(env));
    expect(out?.type).toBe("chat");

    const inbox = await m.readInbox();
    expect(inbox).toHaveLength(1);
    expect(inbox[0].text).toBe("hola de vuelta");
    expect(await m.readInbox()).toHaveLength(0); // ya quedó marcado leído
  });

  it("M-6: leer la bandeja NO saca una agent_task encolada de la cola de aprobación", async () => {
    const { saveMessage, getPendingAgentTasks } = await import("./store");
    const m = new NidoMessenger();
    await m.ensureIdentity();
    // Simula la llegada de una tarea remota (como la guardaría handleBytes).
    await saveMessage({
      id: "task-1",
      dir: "in",
      peerPk: "ab".repeat(32),
      type: "agent_task",
      text: "[Tarea de su NIDO · test] haz algo",
      status: "queued",
      ts: 1,
    });
    const inbox = await m.readInbox();
    expect(inbox).toHaveLength(1);
    // Sigue en la bandeja de aprobación: no se marcó "read" en silencio.
    expect((await getPendingAgentTasks()).map((t) => t.id)).toEqual(["task-1"]);
    // Y una segunda lectura la sigue mostrando como pendiente.
    expect((await m.readInbox()).map((x) => x.id)).toEqual(["task-1"]);
    expect((await getPendingAgentTasks()).map((t) => t.id)).toEqual(["task-1"]);
  });

  it("handleFrame sin sesión descarta en silencio", async () => {
    const m = new NidoMessenger();
    await m.ensureIdentity();
    const peerId = generateIdentity();
    const out = await m.handleFrame(toHex(peerId.publicKey), new Uint8Array([0, 0, 0, 5, 1, 2, 3]));
    expect(out).toBeNull();
    expect(await m.readInbox()).toHaveLength(0);
  });

  it("bandeja vacía devuelve lista vacía", async () => {
    const m = new NidoMessenger();
    await m.ensureIdentity();
    expect(await m.readInbox()).toEqual([]);
  });

  it("H-8: un handshake nuevo no sustituye la sesión viva hasta liveness", async () => {
    const m = new NidoMessenger();
    const { pkHex: myPk } = await m.ensureIdentity();
    const peerId = generateIdentity();
    const peerSign = generateSigningKeypair();
    await m.pairWith(encodePairingPayload("Beto", peerId.publicKey, peerSign.publicKey));
    const contact = (await m.contacts())[0];
    const peerPk = toHex(peerId.publicKey);

    // Handshake 1 → el peer confirma → sesión viva.
    const myEph1 = m.newHandshakeEphemeral();
    const peerEph1 = generateEphemeral();
    const [myNonce1, peerNonce1] = freshNonces();
    await m.completeHandshake(contact.pkHex, myEph1.secretKey, peerEph1.publicKey, myNonce1, peerNonce1);
    const peerSession1 = P2PSession.fromHandshakeV2(
      peerEph1.secretKey, myEph1.publicKey, myPk, peerNonce1, myNonce1,
    );
    await m.handleFrame(peerPk, peerSession1.pack(makeEnvelope("session_confirm", "c1", peerId.publicKey, myPk, {})));

    // Handshake 2 (p. ej. HELLO repetido por un atacante): queda como
    // CANDIDATA; la viva NO se sustituye.
    const myEph2 = m.newHandshakeEphemeral();
    const peerEph2 = generateEphemeral();
    const [myNonce2, peerNonce2] = freshNonces();
    await m.completeHandshake(contact.pkHex, myEph2.secretKey, peerEph2.publicKey, myNonce2, peerNonce2);

    // La sesión viva sigue aceptando frames del peer real.
    const chatOld = makeEnvelope("chat", "old-1", peerId.publicKey, myPk, { text: "por la viva" });
    const out = await m.handleFrame(peerPk, peerSession1.pack(chatOld));
    expect(out?.type).toBe("chat");

    // El peer real completa el handshake 2 con un frame válido bajo la
    // candidata → liveness → se promociona y sustituye a la viva.
    const peerSession2 = P2PSession.fromHandshakeV2(
      peerEph2.secretKey, myEph2.publicKey, myPk, peerNonce2, myNonce2,
    );
    await m.handleFrame(peerPk, peerSession2.pack(makeEnvelope("session_confirm", "c2", peerId.publicKey, myPk, {})));
    const chatNew = makeEnvelope("chat", "new-1", peerId.publicKey, myPk, { text: "por la nueva" });
    const out2 = await m.handleFrame(peerPk, peerSession2.pack(chatNew));
    expect(out2?.type).toBe("chat");

    // La vieja ya no autentica: fue sustituida solo tras liveness.
    const chatOld2 = makeEnvelope("chat", "old-2", peerId.publicKey, myPk, { text: "vieja" });
    const out3 = await m.handleFrame(peerPk, peerSession1.pack(chatOld2));
    expect(out3).toBeNull();
  });
});

describe("R6: invalidación del messenger en Clear All Data", () => {
  /** Transporte espía: registra si discovery llegó a arrancar. */
  function spyTransport() {
    const spy = { started: false, stopped: false };
    const transport = {
      name: "spy",
      available: true,
      startDiscovery: async () => {
        spy.started = true;
      },
      stopDiscovery: async () => {
        spy.stopped = true;
      },
      connect: async () => {
        throw new Error("sin radio");
      },
      sendFrame: async () => {},
      disconnect: async () => {},
    };
    return { spy, transport };
  }

  it("destroy a mitad de startLink: no arranca discovery y la operación falla explícito", async () => {
    // Puerta determinista sobre la lectura del Keystore: ensureIdentity()
    // queda pausada en `await getIdentity()` hasta que el test la libere.
    // Se siembra una fila LEGADA (con sk_hex en la fila, sin Keystore) para
    // forzar la lectura del Keystore (sin fila, getIdentity retorna null sin
    // tocar el backend). F-2: una fila SIN sk en ningún lado ya no puede
    // usarse como puerta: lanza P2PIdentityKeyLossError en vez de pausar.
    mem.identity = [{ pk_hex: "aa".repeat(32), sk_hex: "bb".repeat(32), name: "Test", sign_pk_hex: null }];
    let releaseRead!: () => void;
    let enteredRead!: () => void;
    const readStarted = new Promise<void>((r) => {
      enteredRead = r;
    });
    const gate = new Promise<void>((r) => {
      releaseRead = r;
    });
    const real = createMemorySecureBackend();
    setTestSecureBackend({
      getItemAsync: async (k: string) => {
        enteredRead();
        await gate;
        return real.getItemAsync(k);
      },
      setItemAsync: (k, v) => real.setItemAsync(k, v),
      deleteItemAsync: (k) => real.deleteItemAsync(k),
    });
    const { spy, transport } = spyTransport();
    const m = new NidoMessenger(transport as never);
    const p = m.startLink();
    await readStarted; // startLink está pausado dentro de ensureIdentity()
    await m.destroy(); // Clear All Data invalida la instancia a mitad
    releaseRead();
    await expect(p).rejects.toThrow(/invalidado por Clear All Data/);
    expect(spy.started).toBe(false); // discovery jamás arrancó en la instancia muerta
    expect(spy.stopped).toBe(true); // destroy detuvo el transporte
  });

  it("tras destroy, ningún método público opera: ni envía, ni persiste, ni procesa frames", async () => {
    const { transport } = spyTransport();
    const m = new NidoMessenger(transport as never);
    await m.ensureIdentity();
    await m.destroy();
    await expect(m.ensureIdentity()).rejects.toThrow(/invalidado por Clear All Data/);
    await expect(m.myPairingCode()).rejects.toThrow(/invalidado por Clear All Data/);
    await expect(m.contacts()).rejects.toThrow(/invalidado por Clear All Data/);
    await expect(m.readInbox()).rejects.toThrow(/invalidado por Clear All Data/);
    await expect(m.handleBytes("aa".repeat(32), new Uint8Array([1, 2, 3]))).rejects.toThrow(
      /invalidado por Clear All Data/,
    );
    await expect(m.handleFrame("aa".repeat(32), new Uint8Array([1, 2, 3]))).rejects.toThrow(
      /invalidado por Clear All Data/,
    );
    // La bandeja queda intacta: la instancia muerta no persistió nada.
    expect(mem.messages).toHaveLength(0);
  });
});

describe("M-4: resolución exacta de contactos (sin adivinanzas)", () => {
  async function pairNamed(m: NidoMessenger, name: string) {
    const peer = generateIdentity();
    await m.pairWith(encodePairingPayload(name, peer.publicKey, generateSigningKeypair().publicKey));
    return peer;
  }

  it("M-4: una subcadena NO resuelve al contacto («Bet» no es «Beto»)", async () => {
    const m = new NidoMessenger();
    await m.ensureIdentity();
    await pairNamed(m, "Beto");
    await expect(m.sendChat("Bet", "hola")).rejects.toThrow(/no NIDO contact named/);
    // Nada salió ni quedó encolado: no se envió a un destinatario adivinado.
    expect(await m.pendingOutbox()).toHaveLength(0);
  });

  it("M-4: coincidencia exacta insensible a mayúsculas/espacios sigue funcionando", async () => {
    const m = new NidoMessenger();
    await m.ensureIdentity();
    await pairNamed(m, "Beto");
    const { queued } = await m.sendChat("  bEtO  ", "hola");
    expect(queued).toBe(true);
  });

  it("M-4: dos contactos con el mismo nombre → ambigüedad, no se envía nada", async () => {
    const { saveContact } = await import("./store");
    const m = new NidoMessenger();
    await m.ensureIdentity();
    await pairNamed(m, "Beto");
    // UNIT B: pairWith exige desambiguación ante colisión de nombre; la
    // ambigüedad de resolución se prueba con datos legacy en el store.
    await saveContact(toHex(generateIdentity().publicKey), "Beto", null);
    const err = await m.sendChat("Beto", "hola").catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(String(err.message)).toMatch(/There are 2 NIDO contacts/);
    expect(String(err.message)).toMatch(/choose one/i);
    // Sin adivinanza: ningún mensaje salió ni quedó encolado.
    expect(await m.pendingOutbox()).toHaveLength(0);
  });

  it("M-4: nombre vacío no resuelve", async () => {
    const m = new NidoMessenger();
    await m.ensureIdentity();
    await pairNamed(m, "Beto");
    await expect(m.sendChat("   ", "hola")).rejects.toThrow(/no NIDO contact named/);
  });

  it("M-4: resolveContactByName distingue ok / not_found / ambiguous", async () => {
    const { resolveContactByName, saveContact } = await import("./store");
    const m = new NidoMessenger();
    await m.ensureIdentity();
    const a = generateIdentity();
    const b = generateIdentity();
    await m.pairWith(encodePairingPayload("Beto", a.publicKey, generateSigningKeypair().publicKey));
    await m.pairWith(encodePairingPayload("Ana", b.publicKey, generateSigningKeypair().publicKey));
    const ok = await resolveContactByName("beto");
    expect(ok.kind).toBe("ok");
    if (ok.kind === "ok") expect(ok.contact.name).toBe("Beto");
    expect((await resolveContactByName("nadie")).kind).toBe("not_found");
    // UNIT B: pairWith ya no permite dos vivos con el mismo nombre (exige
    // rename único); la ambigüedad de resolución se prueba con datos legacy
    // escritos directo en el store.
    await saveContact(toHex(generateIdentity().publicKey), "Beto", null);
    const amb = await resolveContactByName("Beto");
    expect(amb.kind).toBe("ambiguous");
    if (amb.kind === "ambiguous") expect(amb.candidates).toHaveLength(2);
  });
});
