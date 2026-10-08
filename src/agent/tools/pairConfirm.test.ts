/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// __DEV__ es un global de React Native: se define para el entorno de test.
vi.hoisted(() => {
  (globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;
});

const contactsState = vi.hoisted(() => ({
  list: [] as Array<{ pkHex: string; name: string; verified: boolean }>,
  fail: false,
}));

// Los handlers importan react-native de forma dinámica: se mockea el módulo.
// También se mockean los módulos nativos que no existen fuera del teléfono.
// El servicio de messenger se sustituye por un stub controlable: solo se
// necesita contacts() para las advertencias M-5 (el handler real no corre
// porque la confirmación siempre se cancela en estos tests).
vi.mock("expo-calendar", () => ({}));
vi.mock("expo-contacts", () => ({}));
vi.mock("expo-document-picker", () => ({}));
vi.mock("expo-file-system", () => ({ File: class {} }));
vi.mock("expo-sqlite", () => ({}));
vi.mock("react-native", () => ({ Linking: { openURL: vi.fn() }, Platform: { OS: "android" } }));
vi.mock("../../services/nidoMessenger", () => ({
  getSharedNidoMessenger: () => ({
    contacts: async () => {
      if (contactsState.fail) throw new Error("base no disponible");
      return contactsState.list;
    },
  }),
}));

import { generateIdentity, toHex } from "../../p2p/crypto";
import { encodePairingPayload } from "../../p2p/pairing";
import { buildToolHandlers } from "./handlers";

function makeCode(name: string) {
  const id = generateIdentity();
  const sign = generateIdentity();
  return { code: encodePairingPayload(name, id.publicKey, sign.publicKey), pkHex: toHex(id.publicKey) };
}

async function capturePairDialog(code: string) {
  const seen: Array<{ title: string; message: string }> = [];
  const h = buildToolHandlers({
    requestConfirm: async (req) => {
      seen.push(req);
      return false; // cancelar: el handler de emparejar nunca corre
    },
  });
  const out = await h["nido_pair"]({ code });
  expect(out).toMatch(/I did nothing/i);
  expect(seen).toHaveLength(1);
  return seen[0].message;
}

describe("M-5: nido_pair como acción sensible (diálogo con identidad)", () => {
  beforeEach(() => {
    contactsState.list = [];
    contactsState.fail = false;
  });

  it("M-5: el diálogo sigue mostrando nombre + huella (no se debilita 1f1f65b)", async () => {
    const { code } = makeCode("Beto");
    const message = await capturePairDialog(code);
    expect(message).toContain("Beto");
    expect(message).toMatch(/[0-9a-f]{4}( [0-9a-f]{4}){7}/);
    expect(message).not.toMatch(/already paired|DIFFERENT identity/);
  });

  it("M-5: re-emparejar una identidad conocida lo advierte en el diálogo", async () => {
    const { code, pkHex } = makeCode("Beto");
    contactsState.list = [{ pkHex, name: "Beto", verified: true }];
    const message = await capturePairDialog(code);
    expect(message).toContain("Beto");
    expect(message).toMatch(/[0-9a-f]{4}( [0-9a-f]{4}){7}/);
    expect(message).toMatch(/already paired as “Beto”\./);
  });

  it("M-5: misma identidad con otro nombre → se muestra el nombre conocido", async () => {
    const { code, pkHex } = makeCode("Roberto");
    contactsState.list = [{ pkHex, name: "Beto", verified: true }];
    const message = await capturePairDialog(code);
    expect(message).toMatch(/already paired as “Beto” \(not as “Roberto”\)/);
  });

  it("M-5: mismo nombre con OTRA identidad → advertencia de suplantación", async () => {
    const { code, pkHex } = makeCode("Beto");
    const other = generateIdentity();
    contactsState.list = [{ pkHex: toHex(other.publicKey), name: "Beto", verified: true }];
    expect(toHex(other.publicKey)).not.toBe(pkHex);
    const message = await capturePairDialog(code);
    // UNIT B: la colisión ya no se resuelve con un "sí" booleano ("in
    // person"); el diálogo exige la elección explícita replace /
    // different person / cancel, y conserva la advertencia de identidad
    // DIFERENTE + la huella nueva para cotejo.
    expect(message).toMatch(/DIFFERENT identity/);
    expect(message).toMatch(/replace/i);
    expect(message).toMatch(/different person/i);
    expect(message).toMatch(/cancel/i);
    // Y la huella de la NUEVA identidad sigue visible para cotejo.
    expect(message).toMatch(/[0-9a-f]{4}( [0-9a-f]{4}){7}/);
  });

  it("M-5: si no se pueden leer los contactos, el diálogo sigue pidiendo confirmación con nombre + huella", async () => {
    contactsState.fail = true;
    const { code } = makeCode("Beto");
    const message = await capturePairDialog(code);
    expect(message).toContain("Beto");
    expect(message).toMatch(/[0-9a-f]{4}( [0-9a-f]{4}){7}/);
  });
});
