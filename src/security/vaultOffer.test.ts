/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/** 0.1.51: cuándo se ofrece la protección por hardware en la pantalla principal. */
import { beforeEach, describe, expect, it, vi } from "vitest";

const offer = vi.hoisted(() => ({ never: false, snoozeUntil: 0, fail: false }));
vi.mock("../models/settings", () => ({
  getVaultOfferState: async () => {
    if (offer.fail) throw new Error("settings rotos");
    return { never: offer.never, snoozeUntil: offer.snoozeUntil };
  },
}));

import { createMemorySecureBackend, setTestSecureBackend, storeDatabaseKeyHex } from "../privacy/keyManager";
import { activateVault, setKeyVaultNativeForTests, type KeyVaultNative } from "./keyVault";
import { shouldOfferVault, VAULT_OFFER_SNOOZE_MS } from "./vaultOffer";

function fakeNative(supported: boolean): KeyVaultNative {
  let kek = false;
  const xor = (b64: string) => {
    const bin = atob(b64);
    let out = "";
    for (let i = 0; i < bin.length; i++) out += String.fromCharCode(bin.charCodeAt(i) ^ 0x5a);
    return btoa(out);
  };
  return {
    getStatus: async () => ({ supported, kekExists: kek, securityLevel: "tee", apiLevel: 34 }),
    ensureKek: async () => {
      kek = true;
      return { supported, kekExists: true, securityLevel: "tee", apiLevel: 34 };
    },
    wrapWithAuth: async (b64) => "v1:" + xor(b64),
    unwrapWithAuth: async (blob) => xor(blob.slice(3)),
    deleteKek: async () => {
      kek = false;
    },
    terminateProcess: async () => {},
  };
}

const PROMPT = { title: "t", subtitle: "s" };

beforeEach(async () => {
  offer.never = false;
  offer.snoozeUntil = 0;
  offer.fail = false;
  setTestSecureBackend(createMemorySecureBackend());
  await storeDatabaseKeyHex("ab".repeat(32));
  setKeyVaultNativeForTests(fakeNative(true));
});

describe("0.1.51: oferta de la protección por hardware", () => {
  it("se ofrece si el teléfono la soporta y no está activa", async () => {
    expect(await shouldOfferVault()).toBe(true);
  });

  it("no se ofrece si ya está activa", async () => {
    await activateVault(PROMPT, PROMPT);
    expect(await shouldOfferVault()).toBe(false);
  });

  it("no se ofrece si el teléfono no la soporta o la build no trae el módulo", async () => {
    setKeyVaultNativeForTests(fakeNative(false));
    expect(await shouldOfferVault()).toBe(false);
    setKeyVaultNativeForTests(null);
    expect(await shouldOfferVault()).toBe(false);
  });

  it("'No volver a preguntar' la apaga para siempre", async () => {
    offer.never = true;
    expect(await shouldOfferVault()).toBe(false);
  });

  it("'Ahora no' la esconde una semana y luego vuelve", async () => {
    const now = 1_800_000_000_000;
    offer.snoozeUntil = now + VAULT_OFFER_SNOOZE_MS;
    expect(await shouldOfferVault(now)).toBe(false);
    expect(await shouldOfferVault(now + VAULT_OFFER_SNOOZE_MS + 1)).toBe(true);
  });

  it("ante un error, no se muestra (nunca lanza)", async () => {
    offer.fail = true;
    expect(await shouldOfferVault()).toBe(false);
  });
});
