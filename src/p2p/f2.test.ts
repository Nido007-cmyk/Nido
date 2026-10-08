/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * f2.test.ts — NIDO: F-2 (HIGH) — pérdida de claves de identidad P2P.
 *
 * Invariante central: identidad P2P durable (fila `p2p_identity`) +
 * CUALQUIER secreto requerido del Keystore ausente = KEY_LOSS, NUNCA
 * first-run. NIDO falla cerrado, muestra recovery honesto y jamás regenera
 * en silencio una identidad nueva (fork silencioso: los peers conservan las
 * claves viejas y el usuario nunca se entera de que su identidad cambió).
 *
 * El repro pre-fix (fork confirmado en 944833b: pk1=a5c7a022… → pk2=510dd29c…
 * sin error; sign_pk regenerada sin error) vive documentado en el reporte
 * de la lane; estos tests fijan el comportamiento post-fix.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { toHex, fromHex } from "./crypto";
import {
  archiveAndClearP2PIdentity,
  failAllOutbox,
  getIdentity,
  getSigningKeypair,
  findContactByPk,
  listContacts,
  P2PIdentityKeyLossError,
  saveContact,
} from "./store";
import {
  createMemorySecureBackend,
  setTestSecureBackend,
  type SecureBackend,
} from "../privacy/keyManager";
import { NidoMessenger } from "./messenger";
import { LoopbackTransport } from "./transport";
import { encodePairingPayload } from "./pairing";
import { makeP2PMem, useP2PMem, type P2PMem } from "./p2pMemoryMock";

vi.mock("../agent/memory/memoryStore", async () => {
  const { p2pMemoryStoreModuleRouted } = await import("./p2pMemoryMock");
  return p2pMemoryStoreModuleRouted();
});

// ---------------------------------------------------------------------------
// Contextos: dos NIDOs independientes (mem + Keystore separados).
// ---------------------------------------------------------------------------
function freshMem(): P2PMem {
  return {
    identity: [],
    contacts: [],
    messages: [],
    ackLog: [],
    lateAck: [],
    nonceCache: [],
    identityArchive: [],
  repairIntents: [],
  bootRepairLog: [],
  };
}
const memA = freshMem();
const memB = freshMem();
let backendA: SecureBackend;
let backendB: SecureBackend;

type Ctx = <T>(fn: () => Promise<T>) => Promise<T>;
const asA: Ctx = async (fn) => {
  setTestSecureBackend(backendA);
  useP2PMem(memA);
  return fn();
};
const asB: Ctx = async (fn) => {
  setTestSecureBackend(backendB);
  useP2PMem(memB);
  return fn();
};

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(memA, freshMem());
  Object.assign(memB, freshMem());
  backendA = createMemorySecureBackend();
  backendB = createMemorySecureBackend();
});

/** Backend espía que cuenta escrituras (para la prueba de "no escribir"). */
function countingBackend(inner: SecureBackend): { backend: SecureBackend; writes: string[] } {
  const writes: string[] = [];
  return {
    writes,
    backend: {
      getItemAsync: (k) => inner.getItemAsync(k),
      setItemAsync: async (k, v) => {
        writes.push(k);
        return inner.setItemAsync(k, v);
      },
      deleteItemAsync: (k) => inner.deleteItemAsync(k),
    },
  };
}

/** Simula el Keystore invalidado: fila durable intacta, secretos perdidos. */
async function loseKeystoreSecrets(backend: SecureBackend, ...aliases: string[]): Promise<void> {
  for (const a of aliases) await backend.deleteItemAsync(a);
}

// ---------------------------------------------------------------------------
describe("F-2: fail-closed ante pérdida de claves de identidad", () => {
  it("fila + nido_p2p_sk ausente → error tipado, fila intacta, ninguna identidad nueva", async () => {
    const m = new NidoMessenger(new LoopbackTransport());
    const first = await asA(() => m.ensureIdentity("Yo"));
    const firstPk = first.pkHex;

    await asA(() => loseKeystoreSecrets(backendA, "nido_p2p_sk"));

    const err = await asA(() => m.ensureIdentity().catch((e) => e));
    expect(err).toBeInstanceOf(P2PIdentityKeyLossError);
    expect(err.code).toBe("NIDO_P2P_IDENTITY_KEY_LOST");
    expect(err.alias).toBe("nido_p2p_sk");
    expect(err.pkHex).toBe(firstPk);
    // Distinto del KeyLossError de la DEK (N4): otro name, otro code.
    expect(err.name).toBe("P2PIdentityKeyLossError");
    expect(err.code).not.toBe("NIDO_KEY_LOST");

    // La fila queda INTACTA y no se generó ninguna identidad nueva.
    expect(memA.identity).toHaveLength(1);
    expect(memA.identity[0].pk_hex).toBe(firstPk);
    expect(await asA(() => backendA.getItemAsync("nido_p2p_sk"))).toBeNull();
  });

  it("fila + nido_p2p_sign_sk ausente (registrada) → error tipado, sin regeneración", async () => {
    const m = new NidoMessenger(new LoopbackTransport());
    await asA(() => m.ensureIdentity("Yo"));
    const kp1 = await asA(() => getSigningKeypair());
    const spk1 = toHex(kp1.publicKey);
    expect(memA.identity[0].sign_pk_hex).toBe(spk1); // nacimiento registrado

    await asA(() => loseKeystoreSecrets(backendA, "nido_p2p_sign_sk"));

    const err = await asA(() => getSigningKeypair().catch((e) => e));
    expect(err).toBeInstanceOf(P2PIdentityKeyLossError);
    expect(err.code).toBe("NIDO_P2P_IDENTITY_KEY_LOST");
    expect(err.alias).toBe("nido_p2p_sign_sk");
    // Sin regeneración silenciosa: el Keystore sigue sin la clave.
    expect(await asA(() => backendA.getItemAsync("nido_p2p_sign_sk"))).toBeNull();
    // Y la fila durable conserva la spk registrada (prueba de la pérdida).
    expect(memA.identity[0].sign_pk_hex).toBe(spk1);
  });

  it("identidad que NUNCA tuvo firma registrada → primera firma legítima, no KEY_LOSS", async () => {
    // Borde de migración: fila antigua (pre-F-2) sin sign_pk_hex. Generar la
    // firma aquí NO es pérdida: es el nacimiento tardío, y queda registrada
    // para que futuras pérdidas sí sean detectables.
    const { generateIdentity } = await import("./crypto");
    const kp = generateIdentity();
    memA.identity = [
      { pk_hex: toHex(kp.publicKey), sk_hex: "", name: "Yo", sign_pk_hex: null },
    ];
    await asA(() => backendA.setItemAsync("nido_p2p_sk", toHex(kp.secretKey)));
    const skp = await asA(() => getSigningKeypair()); // no lanza
    expect(memA.identity[0].sign_pk_hex).toBe(toHex(skp.publicKey));
    // A partir de ahora, perderla SÍ es KEY_LOSS.
    await asA(() => loseKeystoreSecrets(backendA, "nido_p2p_sign_sk"));
    await expect(asA(() => getSigningKeypair())).rejects.toBeInstanceOf(P2PIdentityKeyLossError);
  });

  it("first run real (sin fila ni claves) → creación normal de ambos secretos", async () => {
    const m = new NidoMessenger(new LoopbackTransport());
    const id = await asA(() => m.ensureIdentity("Yo"));
    expect(id.pkHex).toHaveLength(64);
    expect(id.fingerprint.length).toBeGreaterThan(0);
    const kp = await asA(() => getSigningKeypair());
    expect(toHex(kp.publicKey)).toHaveLength(64);
    expect(await asA(() => backendA.getItemAsync("nido_p2p_sk"))).not.toBeNull();
    expect(await asA(() => backendA.getItemAsync("nido_p2p_sign_sk"))).not.toBeNull();
    expect(memA.identity[0].sign_pk_hex).toBe(toHex(kp.publicKey));
  });

  it("durante la ventana de pérdida NO se escribe ningún secreto nuevo", async () => {
    const m = new NidoMessenger(new LoopbackTransport());
    await asA(() => m.ensureIdentity("Yo"));
    await asA(() => getSigningKeypair());
    const spy = countingBackend(createMemorySecureBackend());
    // Copia el estado real al backend espiado.
    for (const k of ["nido_p2p_sk", "nido_p2p_sign_sk"]) {
      const v = await backendA.getItemAsync(k);
      if (v) await spy.backend.setItemAsync(k, v);
    }
    spy.writes.length = 0;
    await asA(() => loseKeystoreSecrets(spy.backend, "nido_p2p_sk", "nido_p2p_sign_sk"));
    setTestSecureBackend(spy.backend);
    useP2PMem(memA);
    spy.writes.length = 0; // solo cuentan las escrituras del intento fallido

    await expect(m.ensureIdentity()).rejects.toBeInstanceOf(P2PIdentityKeyLossError);
    await expect(getSigningKeypair()).rejects.toBeInstanceOf(P2PIdentityKeyLossError);
    // Invariante: jamás se escribe un secreto incapaz de abrir/representar
    // los datos existentes. Cero escrituras en la ventana de pérdida.
    expect(spy.writes).toEqual([]);
  });

  it("myPairingCode falla cerrado ante la pérdida (no muestra un QR falso)", async () => {
    const m = new NidoMessenger(new LoopbackTransport());
    await asA(() => m.ensureIdentity("Yo"));
    await asA(() => getSigningKeypair());
    await asA(() => loseKeystoreSecrets(backendA, "nido_p2p_sk"));
    await expect(asA(() => m.myPairingCode())).rejects.toBeInstanceOf(P2PIdentityKeyLossError);
  });

  it("startLink falla cerrado ante la pérdida (no enlaza con identidad falsa)", async () => {
    const m = new NidoMessenger(new LoopbackTransport());
    await asA(() => m.ensureIdentity("Yo"));
    await asA(() => loseKeystoreSecrets(backendA, "nido_p2p_sk"));
    await expect(asA(() => m.startLink())).rejects.toBeInstanceOf(P2PIdentityKeyLossError);
  });
});

// ---------------------------------------------------------------------------
describe("F-2: recovery honesto y explícito", () => {
  it("sin confirmación explícita → lanza y nada cambia", async () => {
    const m = new NidoMessenger(new LoopbackTransport());
    const first = await asA(() => m.ensureIdentity("Yo"));
    await asA(() => getSigningKeypair());
    await asA(() => loseKeystoreSecrets(backendA, "nido_p2p_sign_sk"));

    await expect(asA(() => m.recoverP2PIdentityAfterKeyLoss(false))).rejects.toThrow(
      /confirmación explícita/i,
    );
    // Nada cambió: fila intacta, sin archivo, sin identidad nueva.
    expect(memA.identity).toHaveLength(1);
    expect(memA.identity[0].pk_hex).toBe(first.pkHex);
    expect(memA.identityArchive).toHaveLength(0);
  });

  it("confirmado → vieja archivada (N4), identidad nueva, AMBAS claves rotadas", async () => {
    const m = new NidoMessenger(new LoopbackTransport());
    const first = await asA(() => m.ensureIdentity("Yo"));
    const oldSpk = toHex((await asA(() => getSigningKeypair())).publicKey);
    await asA(() => loseKeystoreSecrets(backendA, "nido_p2p_sign_sk"));

    const res = await asA(() => m.recoverP2PIdentityAfterKeyLoss(true));

    expect(res.oldPkHex).toBe(first.pkHex);
    expect(res.newPkHex).not.toBe(first.pkHex);
    // N4: la vieja no se destruyó — quedó archivada con traza.
    expect(memA.identityArchive).toHaveLength(1);
    expect(memA.identityArchive[0]).toMatchObject({
      pk_hex: first.pkHex,
      name: "Yo",
      sign_pk_hex: oldSpk,
      reason: "p2p-identity-keystore-key-loss",
    });
    expect(memA.identityArchive[0].lost_at).toBeGreaterThan(0);
    // La identidad nueva vive en fila + Keystore, coherente.
    expect(memA.identity).toHaveLength(1);
    expect(memA.identity[0].pk_hex).toBe(res.newPkHex);
    expect(await asA(() => backendA.getItemAsync("nido_p2p_sk"))).not.toBeNull();
    expect(await asA(() => backendA.getItemAsync("nido_p2p_sign_sk"))).not.toBeNull();
    // Decisión F-13 documentada: la firma también rota — la spk vieja no se
    // reutiliza, para que el recovery sea un corte criptográfico limpio sin
    // enlace forense entre la identidad vieja y la nueva.
    const newSpk = toHex((await asA(() => getSigningKeypair())).publicKey);
    expect(newSpk).not.toBe(oldSpk);
    expect(memA.identity[0].sign_pk_hex).toBe(newSpk);
  });

  it("el outbox pendiente falla como identity_changed y es reintentable tras re-pair", async () => {
    const m = new NidoMessenger(new LoopbackTransport());
    await asA(() => m.ensureIdentity("Yo"));
    const peerPk = "cc".repeat(32);
    await asA(() => saveContact(peerPk, "Peer", null));
    const sent1 = await asA(() => m.sendChat("Peer", "hola"));
    expect(sent1.queued).toBe(true);
    await asA(() => loseKeystoreSecrets(backendA, "nido_p2p_sk"));

    const res = await asA(() => m.recoverP2PIdentityAfterKeyLoss(true));
    expect(res.failedOutbox).toBe(1);

    const { getOutboundMessage, resetOutboundForRetry } = await import("./store");
    const row = await asA(() => getOutboundMessage(sent1.id));
    expect(row?.status).toBe("failed");
    expect(row?.failureReason).toBe("identity_changed");
    // Reintentable por el usuario tras re-emparejar: vuelve a queued.
    expect(await asA(() => resetOutboundForRetry(sent1.id))).toBe(true);
    expect((await asA(() => getOutboundMessage(sent1.id)))?.status).toBe("queued");
  });

  it("archiveAndClearP2PIdentity sin identidad → null, sin efectos", async () => {
    expect(await asA(() => archiveAndClearP2PIdentity("x"))).toBeNull();
    expect(memA.identityArchive).toHaveLength(0);
  });

  it("failAllOutbox solo toca queued/sent del outbox", async () => {
    const m = new NidoMessenger(new LoopbackTransport());
    await asA(() => m.ensureIdentity("Yo"));
    const peerPk = "dd".repeat(32);
    await asA(() => saveContact(peerPk, "Peer", null));
    const q = await asA(() => m.sendChat("Peer", "uno"));
    const { saveMessage, getOutboundMessage } = await import("./store");
    await asA(() =>
      saveMessage({ id: "in1", dir: "in", peerPk, type: "chat", text: "x", status: "read", ts: 1 }),
    );
    const n = await asA(() => failAllOutbox("identity_changed"));
    expect(n).toBe(1);
    expect((await asA(() => getOutboundMessage(q.id)))?.failureReason).toBe("identity_changed");
  });
});

// ---------------------------------------------------------------------------
describe("F-2: el peer viejo trata la identidad nueva como desconocida", () => {
  it("tras el recovery, el contacto antiguo no reconoce la pk nueva; el re-pair crea un contacto nuevo", async () => {
    // A y B emparejados.
    const mA = new NidoMessenger(new LoopbackTransport());
    const mB = new NidoMessenger(new LoopbackTransport());
    const aFirst = await asA(() => mA.ensureIdentity("Aldo"));
    const bId = await asB(() => mB.ensureIdentity("Beto"));
    const bSign = await asB(() => getSigningKeypair());
    await asB(() => mB.pairWith(encodePairingPayload("Aldo", fromHex(aFirst.pkHex), bSign.publicKey)));
    expect(await asB(() => findContactByPk(aFirst.pkHex))).not.toBeNull();

    // A pierde su Keystore y hace recovery honesto.
    await asA(() => loseKeystoreSecrets(backendA, "nido_p2p_sk"));
    const res = await asA(() => mA.recoverP2PIdentityAfterKeyLoss(true));
    expect(res.newPkHex).not.toBe(aFirst.pkHex);

    // B no reconoce la identidad nueva: es un peer desconocido hasta el re-pair.
    expect(await asB(() => findContactByPk(res.newPkHex))).toBeNull();
    // El contacto viejo sigue intacto (no se fusionó ni se borró en silencio).
    const old = await asB(() => findContactByPk(aFirst.pkHex));
    expect(old?.name).toBe("Aldo");

    // Re-pair: A muestra su código nuevo; B lo empareja como contacto nuevo.
    // (Sin colisión de nombre — la identidad recuperada lleva el nombre por
    // defecto — así que no hay desambiguación; el gesto explícito de
    // escanear+confirmar ya es la elección.)
    const newCode = await asA(() => mA.myPairingCode());
    const rePaired = await asB(() => mB.pairWith(newCode));
    expect(rePaired).not.toBeNull();
    expect(rePaired!.pkHex).toBe(res.newPkHex);
    const contacts = await asB(() => listContacts());
    expect(contacts.map((c) => c.pkHex).sort()).toEqual([aFirst.pkHex, res.newPkHex].sort());
  });
});

// ---------------------------------------------------------------------------
describe("F-2: auditoría grep-level — ninguna ruta regenera en silencio", () => {
  const SRC = path.resolve(__dirname);

  /** Archivos .ts/.tsx no-test bajo src/, con comentarios eliminados. */
  function sourceFiles(): Array<{ file: string; code: string }> {
    const out: Array<{ file: string; code: string }> = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(p);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(entry.name) || /\.test\.(ts|tsx)$/.test(entry.name)) continue;
        let code = fs.readFileSync(p, "utf8");
        code = code.replace(/\/\*[\s\S]*?\*\//g, ""); // bloques
        code = code.replace(/(^|\s)\/\/.*$/gm, ""); // líneas
        out.push({ file: path.relative(SRC, p), code });
      }
    };
    walk(SRC);
    return out;
  }

  it("generateIdentity()/generateSigningKeypair() solo existen en los sitios sancionados", () => {
    const allowed = new Set(["crypto.ts", "messenger.ts", "store.ts"]);
    const offenders: string[] = [];
    for (const { file, code } of sourceFiles()) {
      const base = path.basename(file);
      if (allowed.has(base)) continue;
      if (/generateIdentity\s*\(/.test(code) || /generateSigningKeypair\s*\(/.test(code)) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("getIdentity() nunca devuelve null ante fila durable (solo ante ausencia real)", () => {
    const lines = fs.readFileSync(path.join(SRC, "store.ts"), "utf8").split("\n");
    const start = lines.findIndex((l) => l.startsWith("export async function getIdentity"));
    // El cuerpo termina en la próxima exportación de nivel superior.
    let end = lines.findIndex((l, i) => i > start && /^export (async )?function /.test(l));
    if (end === -1) end = lines.length;
    const body = lines.slice(start, end).join("\n");
    const nullReturns = (body.match(/return null/g) ?? []).length;
    expect(nullReturns).toBe(1);
    expect(body).toMatch(/if \(!row\) return null/);
    // Y la rama "fila sin secreto" lanza el error tipado.
    expect(body).toMatch(/throw p2pIdentityKeyLost\(P2P_SK_ALIAS/);
  });

  it("ningún caller de bootstrap captura el error para regenerar", () => {
    // Patrón prohibido: catch (…P2PIdentityKeyLossError…) seguido de
    // generación/guardado de identidad. Se busca a nivel léxico en los
    // callers conocidos (messenger, UI, agent tools).
    const suspects = ["messenger.ts", "nativeTransport.ts"];
    const uiSuspects = fs
      .readdirSync(path.join(SRC, "..", "ui"))
      .filter((f) => f.endsWith(".tsx"))
      .map((f) => path.join("..", "ui", f));
    void uiSuspects;
    for (const rel of suspects) {
      const code = fs.readFileSync(path.join(SRC, rel), "utf8");
      const idx = code.indexOf("P2PIdentityKeyLossError");
      // Solo se permite NOMBRAR el tipo en comentarios/docs; el código
      // nunca lo captura para regenerar.
      const codeNoComments = code
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|\s)\/\/.*$/gm, "");
      expect(codeNoComments.includes("P2PIdentityKeyLossError")).toBe(false);
    }
  });
});
