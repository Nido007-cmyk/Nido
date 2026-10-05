/**
 * pairingCeremony.test.ts — B/F3: la ceremonia de emparejamiento de la UI
 * exige la misma política que el path del agente.
 *
 * Invariante: ningún peer queda emparejado/verificado desde la UI sin
 * (1) decodificar+validar el payload, (2) mostrar huella, (3) mostrar
 * advertencias de ligadura, (4) confirmación explícita, (5) y solo
 * entonces la escritura de emparejamiento.
 */
import { describe, it, expect, vi } from "vitest";
import {
  previewPairingCeremony,
  runPairingCeremony,
  pairingBindingWarning,
  type CeremonyT,
  type PairingCeremonyDeps,
  type PairingContactLike,
} from "./pairingCeremony";
import { encodePairingPayload } from "./pairing";
import {
  generateIdentity,
  generateSigningKeypair,
  toHex,
  fingerprint,
  fromHex,
} from "./crypto";
import en from "../i18n/locales/en.json";

/** t determinista con las mismas claves agentConfirm.* de producción. */
const t: CeremonyT = (key, opts) => {
  const leaf = key.split(".").pop() ?? key;
  const agentConfirm = (en as unknown as Record<string, Record<string, string>>)
    .agentConfirm;
  let s: string = agentConfirm?.[leaf] ?? key;
  for (const [k, v] of Object.entries(opts ?? {}))
    s = s.split(`{{${k}}}`).join(v);
  return s;
};

function makePeer(name: string) {
  const kp = generateIdentity();
  const skp = generateSigningKeypair();
  return {
    code: encodePairingPayload(name, kp.publicKey, skp.publicKey),
    pkHex: toHex(kp.publicKey),
    name,
  };
}

const noContacts = async (): Promise<readonly PairingContactLike[]> => [];
const noSelf = async (): Promise<string | null> => null;

/** Deps falsos para runPairingCeremony; requestConfirm/pairNow son espías. */
function deps(opts: {
  contacts?: readonly PairingContactLike[];
  selfPkHex?: string | null;
  confirm?: boolean | "throw";
  pairName?: string;
} = {}): { d: PairingCeremonyDeps; requestConfirm: ReturnType<typeof vi.fn>; pairNow: ReturnType<typeof vi.fn> } {
  const requestConfirm = vi.fn(async () => {
    if (opts.confirm === "throw") throw new Error("dialog exploded");
    return opts.confirm ?? true;
  });
  const pairNow = vi.fn(async () => ({ name: opts.pairName ?? "Peer" }));
  const d: PairingCeremonyDeps = {
    t,
    listContacts: async () => opts.contacts ?? [],
    selfPkHex: async () => opts.selfPkHex ?? null,
    requestConfirm,
    pairNow,
  };
  return { d, requestConfirm, pairNow };
}

describe("previewPairingCeremony", () => {
  it("peer nuevo válido: muestra huella en formato de cotejo verbal y mensaje de confirmación", async () => {
    const peer = makePeer("Ana");
    const preview = await previewPairingCeremony(peer.code, {
      t,
      listContacts: noContacts,
      selfPkHex: null,
    });
    expect(preview.payload.name).toBe("Ana");
    expect(preview.payload.pk).toBe(peer.pkHex);
    expect(preview.fingerprint).toBe(fingerprint(fromHex(peer.pkHex)));
    // 8 grupos de 4 hex — el formato que se coteja en persona.
    expect(preview.fingerprint.split(" ")).toHaveLength(8);
    expect(preview.message).toContain("Ana");
    expect(preview.message).toContain(preview.fingerprint);
    expect(preview.title).not.toBe("");
    expect(preview.warning).toBe("");
  });

  it("payload malformado: lanza ANTES de cualquier confirmación", async () => {
    const { d, requestConfirm, pairNow } = deps();
    await expect(
      runPairingCeremony("esto no es un QR", d),
    ).rejects.toThrow();
    expect(requestConfirm).not.toHaveBeenCalled();
    expect(pairNow).not.toHaveBeenCalled();
  });

  it("self-QR: se rechaza antes de la confirmación", async () => {
    const me = makePeer("Yo");
    const { d, requestConfirm, pairNow } = deps({ selfPkHex: me.pkHex });
    await expect(runPairingCeremony(me.code, d)).rejects.toThrow(/propio/i);
    expect(requestConfirm).not.toHaveBeenCalled();
    expect(pairNow).not.toHaveBeenCalled();
  });
});

describe("runPairingCeremony — confirmación", () => {
  it("confirmar → pairNow se llama una vez y devuelve 'paired'", async () => {
    const peer = makePeer("Bob");
    const { d, pairNow } = deps({ confirm: true, pairName: "Bob" });
    const out = await runPairingCeremony(peer.code, d);
    expect(out).toEqual({ status: "paired", name: "Bob" });
    expect(pairNow).toHaveBeenCalledTimes(1);
  });

  it("cancelar → pairNow NO se llama: sin mutación en la DB", async () => {
    const peer = makePeer("Carol");
    const { d, pairNow } = deps({ confirm: false });
    const out = await runPairingCeremony(peer.code, d);
    expect(out).toEqual({ status: "cancelled" });
    expect(pairNow).not.toHaveBeenCalled();
  });

  it("fallo del diálogo de confirmación → fail closed: no se empareja", async () => {
    const peer = makePeer("Dave");
    const { d, pairNow, requestConfirm } = deps({ confirm: "throw" });
    // El throw del diálogo se trata como "no confirmado": sin emparejar.
    const out = await runPairingCeremony(peer.code, d);
    expect(out).toEqual({ status: "cancelled" });
    expect(requestConfirm).toHaveBeenCalledTimes(1);
    expect(pairNow).not.toHaveBeenCalled();
  });

  it("la confirmación recibe el título y el mensaje con huella", async () => {
    const peer = makePeer("Eve");
    const { d, requestConfirm } = deps({ confirm: true });
    await runPairingCeremony(peer.code, d);
    expect(requestConfirm).toHaveBeenCalledTimes(1);
    const [title, message] = requestConfirm.mock.calls[0] as [string, string];
    expect(title).not.toBe("");
    expect(message).toContain("Eve");
    expect(message).toContain(fingerprint(fromHex(peer.pkHex)));
  });
});

describe("pairingBindingWarning (M-5)", () => {
  it("identidad ya emparejada con el mismo nombre → aviso", async () => {
    const peer = makePeer("Frank");
    const warning = await pairingBindingWarning(t, peer.pkHex, "Frank", async () => [
      { pkHex: peer.pkHex, name: "Frank" },
    ]);
    expect(warning).toMatch(/ya está emparejada|already paired/i);
    expect(warning).toContain("Frank");
  });

  it("identidad ya emparejada con OTRO nombre → aviso con ambos nombres", async () => {
    const peer = makePeer("Grace");
    const warning = await pairingBindingWarning(t, peer.pkHex, "Grace", async () => [
      { pkHex: peer.pkHex, name: "Graciela" },
    ]);
    expect(warning).toContain("Graciela");
    expect(warning).toContain("Grace");
  });

  it("mismo nombre con OTRA identidad → aviso de conflicto", async () => {
    const peer = makePeer("Hugo");
    const other = makePeer("Hugo");
    const warning = await pairingBindingWarning(t, peer.pkHex, "Hugo", async () => [
      { pkHex: other.pkHex, name: "Hugo" },
    ]);
    expect(warning).toMatch(/OTRA identidad|another identity|Atención|Warning/i);
    expect(warning).toContain("Hugo");
  });

  it("contactos no consultables → sin aviso pero la ceremonia continúa (best-effort)", async () => {
    const peer = makePeer("Ivy");
    const warning = await pairingBindingWarning(t, peer.pkHex, "Ivy", async () => {
      throw new Error("db locked");
    });
    expect(warning).toBe("");
    const { d, pairNow } = deps({
      confirm: true,
      contacts: undefined,
      pairName: "Ivy",
    });
    // listContacts del deps lanza → la ceremonia sigue y exige confirmar.
    const d2: PairingCeremonyDeps = {
      ...d,
      listContacts: async () => {
        throw new Error("db locked");
      },
    };
    const out = await runPairingCeremony(peer.code, d2);
    expect(out.status).toBe("paired");
    expect(pairNow).toHaveBeenCalledTimes(1);
  });
});

describe("re-emparejamiento", () => {
  it("peer ya conocido: la advertencia aparece en el diálogo y confirmar empareja (idempotente)", async () => {
    const peer = makePeer("Jack");
    const existing: readonly PairingContactLike[] = [
      { pkHex: peer.pkHex, name: "Jack" },
    ];
    const preview = await previewPairingCeremony(peer.code, {
      t,
      listContacts: async () => existing,
      selfPkHex: null,
    });
    expect(preview.warning).not.toBe("");
    expect(preview.message).toContain(preview.warning);

    const { d, requestConfirm, pairNow } = deps({
      contacts: existing,
      confirm: true,
      pairName: "Jack",
    });
    const out = await runPairingCeremony(peer.code, d);
    expect(out).toEqual({ status: "paired", name: "Jack" });
    // El diálogo que vio el usuario contenía la advertencia.
    const [, message] = requestConfirm.mock.calls[0] as [string, string];
    expect(message).toContain(preview.warning);
    expect(pairNow).toHaveBeenCalledTimes(1);
  });
});

describe("UNIT B-Q10 (revival note): re-escanear una identidad retirada", () => {
  it("la ceremonia informa que la identidad fue retirada y que se restaurará; sin nota si no hay fila", async () => {
    const peer = makePeer("Beto");
    const tRet = ((key: string, opts?: Record<string, string>) =>
      key === "agentConfirm.pairBindingWasRetired"
        ? `RETIRADA:${opts?.name}`
        : t(key, opts)) as CeremonyT;
    const preview = await previewPairingCeremony(peer.code, {
      t: tRet,
      listContacts: async () => [],
      selfPkHex: null,
      // La pk escaneada fue superseded antes.
      findContactAny: async (pk: string) =>
        pk.toLowerCase() === peer.pkHex.toLowerCase()
          ? { name: "Beto", supersededBy: "nueva-pk" }
          : null,
    });
    expect(preview.warning).toContain("RETIRADA:Beto");

    // Sin fila (identidad genuinamente nueva): sin nota, ceremonia normal.
    const preview2 = await previewPairingCeremony(peer.code, {
      t: tRet,
      listContacts: async () => [],
      selfPkHex: null,
      findContactAny: async () => null,
    });
    expect(preview2.warning).not.toContain("RETIRADA");
  });

  it("sin findContactAny la ceremonia sigue segura (best-effort)", async () => {
    const peer = makePeer("Beto");
    const preview = await previewPairingCeremony(peer.code, {
      t,
      listContacts: async () => [],
      selfPkHex: null,
    });
    expect(preview.payload.pk).toBe(peer.pkHex);
  });
});
