/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

// Auditoría completa 2026-10-31 (F6-09): el pegamento con la app
// real no tenía prueba (la lógica, en packShareWiring, sí). Aquí
// se fija lo que wirePackShare registra en el servicio: la
// identidad, el envoltorio de envío (una OFERTA que no sale se
// dice en voz alta; el resto lo cubren los tiempos de espera),
// el proveedor de datos, el importador y el filtro de ofertas
// alimentado por la foto del catálogo leída al cablear.

import { describe, it, expect, vi, beforeEach } from "vitest";

const registered = vi.hoisted(() => ({
  identity: null as string | null,
  send: null as null | ((peer: string, action: string, session: string, data: Record<string, unknown>) => Promise<void>),
  provider: null as unknown,
  importer: null as unknown,
  filter: null as null | ((adv: unknown) => boolean),
}));
const knowledgePacksMock = vi.hoisted(() => vi.fn(async () => [
  { id: "nido-esencial", filename: "nido-esencial.sqlite", sha256: "ab".repeat(32), sizeBytes: 10 },
]));

vi.mock("expo-file-system/legacy", () => ({
  documentDirectory: "file:///docs/",
  EncodingType: { Base64: "base64", UTF8: "utf8" },
  readAsStringAsync: vi.fn(async () => ""),
  writeAsStringAsync: vi.fn(async () => {}),
  makeDirectoryAsync: vi.fn(async () => {}),
  moveAsync: vi.fn(async () => {}),
  deleteAsync: vi.fn(async () => {}),
}));
// packSharing importa expo-crypto, que arrastra react-native
// (mismo apaño que packShareWiring.test.ts).
vi.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "SHA256" },
  digestStringAsync: async () => "0".repeat(64),
}));
vi.mock("./packShareService", () => ({
  packShareService: {
    setLocalIdentity: (pk: string) => { registered.identity = pk; },
    setSendFunction: (fn: typeof registered.send) => { registered.send = fn; },
    setDataProvider: (p: unknown) => { registered.provider = p; },
    setImporter: (i: unknown) => { registered.importer = i; },
    setOfferFilter: (f: typeof registered.filter) => { registered.filter = f; },
  },
}));
vi.mock("../rag/packs", () => ({
  knowledgePacks: knowledgePacksMock,
  closePack: vi.fn(async () => {}),
  prepareVectorIndexes: vi.fn(),
}));

import { wirePackShare, type PackShareMessenger } from "./packShareApp";

describe("wirePackShare (F6-09)", () => {
  beforeEach(() => {
    registered.identity = null;
    registered.send = null;
    registered.provider = null;
    registered.importer = null;
    registered.filter = null;
  });

  it("registra identidad, envío, proveedor, importador y filtro", async () => {
    const messenger: PackShareMessenger = { sendPackShare: vi.fn(async () => true) };
    await wirePackShare(messenger, "pk-mia");
    expect(registered.identity).toBe("pk-mia");
    expect(registered.send).toBeTypeOf("function");
    expect(registered.provider).toBeTruthy();
    expect(registered.importer).toBeTruthy();
    expect(registered.filter).toBeTypeOf("function");
    expect(knowledgePacksMock).toHaveBeenCalled();
  });

  it("una OFERTA que no sale lanza; un CHUNK que no sale, no", async () => {
    const messenger: PackShareMessenger = { sendPackShare: vi.fn(async () => false) };
    await wirePackShare(messenger, "pk-mia");
    await expect(registered.send!("peer", "OFFER", "s1", {})).rejects.toThrow("Sin conexión con el contacto");
    await expect(registered.send!("peer", "CHUNK", "s1", {})).resolves.toBeUndefined();
  });
});
