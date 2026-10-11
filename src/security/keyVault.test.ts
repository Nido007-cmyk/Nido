/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  createMemorySecureBackend,
  setTestSecureBackend,
  getDatabaseKeyHex,
  setUnlockedDatabaseKey,
  storeDatabaseKeyHex,
  VaultLockedError,
  VAULT_BLOB_ALIAS,
  type SecureBackend,
} from "../privacy/keyManager";
import {
  activateVault,
  deactivateVault,
  isVaultActive,
  setKeyVaultNativeForTests,
  unlockVault,
  type KeyVaultNative,
  type VaultAuthResult,
} from "./keyVault";

const DEK = "ab".repeat(32);
const PROMPT = { title: "t", subtitle: "s" };

/** Módulo nativo simulado: KEK = XOR con 0x5a; exige autenticación previa. */
function makeFakeNative(opts: { secure?: boolean } = {}) {
  const state = {
    kek: false,
    authed: false,
    authResult: "ok" as VaultAuthResult,
    invalidated: false,
    corruptNextWrap: false,
    authCalls: 0,
  };
  const xor = (b64: string) => {
    const bin = atob(b64);
    let out = "";
    for (let i = 0; i < bin.length; i++) out += String.fromCharCode(bin.charCodeAt(i) ^ 0x5a);
    return btoa(out);
  };
  const guard = () => {
    if (state.invalidated) throw Object.assign(new Error("invalidated"), { code: "E_KEY_INVALIDATED" });
    if (!state.kek) throw Object.assign(new Error("no kek"), { code: "E_NO_KEK" });
    if (!state.authed) throw Object.assign(new Error("auth"), { code: "E_AUTH_REQUIRED" });
  };
  const native: KeyVaultNative = {
    getStatus: async () => ({ supported: opts.secure ?? true, kekExists: state.kek, securityLevel: "tee", apiLevel: 34 }),
    ensureKek: async () => {
      if (!(opts.secure ?? true)) throw Object.assign(new Error("no lock"), { code: "E_NO_SECURE_LOCK" });
      state.kek = true;
      return { supported: true, kekExists: true, securityLevel: "tee", apiLevel: 34 };
    },
    authenticate: async () => {
      state.authCalls++;
      if (state.authResult === "ok") state.authed = true;
      return state.authResult;
    },
    wrap: async (b64) => {
      guard();
      if (state.corruptNextWrap) {
        state.corruptNextWrap = false;
        return "v1:" + xor(btoa("x".repeat(32)));
      }
      return "v1:" + xor(b64);
    },
    unwrap: async (blob) => {
      guard();
      if (!blob.startsWith("v1:")) throw Object.assign(new Error("corrupt"), { code: "E_BLOB_CORRUPT" });
      return xor(blob.slice(3));
    },
    deleteKek: async () => {
      state.kek = false;
    },
  };
  return { native, state };
}

let backend: SecureBackend;

beforeEach(async () => {
  backend = createMemorySecureBackend();
  setTestSecureBackend(backend);
  setUnlockedDatabaseKey(null);
  await backend.setItemAsync("nido_db_key", DEK); // usuario existente (modo legado)
});

describe("HW-VAULT: activación (migración verificada)", () => {
  it("envuelve la DEK, borra la copia en claro y la deja en memoria", async () => {
    const { native } = makeFakeNative();
    setKeyVaultNativeForTests(native);
    await activateVault(PROMPT);
    expect(await isVaultActive()).toBe(true);
    expect(await backend.getItemAsync("nido_db_key")).toBeNull();
    expect(await getDatabaseKeyHex()).toBe(DEK);
  });

  it("si la verificación no coincide, no cambia nada", async () => {
    const { native, state } = makeFakeNative();
    setKeyVaultNativeForTests(native);
    state.corruptNextWrap = true;
    await expect(activateVault(PROMPT)).rejects.toMatchObject({ code: "E_VERIFY_MISMATCH" });
    expect(await isVaultActive()).toBe(false);
    expect(await backend.getItemAsync("nido_db_key")).toBe(DEK);
  });

  it("tablet sin PIN: error claro y modo legado intacto", async () => {
    const { native } = makeFakeNative({ secure: false });
    setKeyVaultNativeForTests(native);
    await expect(activateVault(PROMPT)).rejects.toMatchObject({ code: "E_NO_SECURE_LOCK" });
    expect(await backend.getItemAsync("nido_db_key")).toBe(DEK);
  });

  it("cancelar el diálogo no cambia nada", async () => {
    const { native, state } = makeFakeNative();
    setKeyVaultNativeForTests(native);
    state.authResult = "cancelled";
    await expect(activateVault(PROMPT)).rejects.toMatchObject({ code: "E_CANCELLED" });
    expect(await isVaultActive()).toBe(false);
    expect(await backend.getItemAsync("nido_db_key")).toBe(DEK);
  });
});

describe("HW-VAULT: arranque", () => {
  it("con la bóveda activa y sin desbloquear, la DEK NO se puede leer", async () => {
    const { native, state } = makeFakeNative();
    setKeyVaultNativeForTests(native);
    await activateVault(PROMPT);
    setUnlockedDatabaseKey(null); // simula reinicio del proceso
    state.authed = false;
    await expect(getDatabaseKeyHex()).rejects.toBeInstanceOf(VaultLockedError);
    // Y jamás genera una DEK nueva en claro.
    expect(await backend.getItemAsync("nido_db_key")).toBeNull();
  });

  it("desbloquear con PIN/huella devuelve exactamente la misma DEK", async () => {
    const { native, state } = makeFakeNative();
    setKeyVaultNativeForTests(native);
    await activateVault(PROMPT);
    setUnlockedDatabaseKey(null);
    state.authed = false;
    await unlockVault(PROMPT);
    expect(await getDatabaseKeyHex()).toBe(DEK);
  });

  it("activación interrumpida (blob + DEK en claro): el desbloqueo la completa", async () => {
    const { native, state } = makeFakeNative();
    setKeyVaultNativeForTests(native);
    state.kek = true;
    state.authed = true;
    await backend.setItemAsync(VAULT_BLOB_ALIAS, await native.wrap(btoa(String.fromCharCode(...DEK.match(/../g)!.map((h) => parseInt(h, 16))))));
    state.authed = false;
    await unlockVault(PROMPT);
    expect(await getDatabaseKeyHex()).toBe(DEK);
    expect(await backend.getItemAsync("nido_db_key")).toBeNull();
  });

  it("blob dañado con la DEK en claro aún presente: vuelve al modo legado sin perder nada", async () => {
    const { native, state } = makeFakeNative();
    setKeyVaultNativeForTests(native);
    state.kek = true;
    await backend.setItemAsync(VAULT_BLOB_ALIAS, "basura");
    await unlockVault(PROMPT);
    expect(await isVaultActive()).toBe(false);
    expect(await getDatabaseKeyHex()).toBe(DEK);
  });

  it("llave invalidada por Android (se quitó el PIN): error tipado para la pantalla de recuperación", async () => {
    const { native, state } = makeFakeNative();
    setKeyVaultNativeForTests(native);
    await activateVault(PROMPT);
    setUnlockedDatabaseKey(null);
    state.invalidated = true;
    await expect(unlockVault(PROMPT)).rejects.toMatchObject({ code: "E_KEY_INVALIDATED" });
  });
});

describe("HW-VAULT: nuevas DEK y desactivación", () => {
  it("con la bóveda activa, guardar una DEK nueva la envuelve y nunca la escribe en claro", async () => {
    const { native } = makeFakeNative();
    setKeyVaultNativeForTests(native);
    await activateVault(PROMPT);
    const NEW = "cd".repeat(32);
    await storeDatabaseKeyHex(NEW);
    expect(await backend.getItemAsync("nido_db_key")).toBeNull();
    expect(await getDatabaseKeyHex()).toBe(NEW);
    setUnlockedDatabaseKey(null);
    await unlockVault(PROMPT);
    expect(await getDatabaseKeyHex()).toBe(NEW);
  });

  it("sin bóveda, guardar una DEK nueva usa el SecureStore como siempre", async () => {
    setKeyVaultNativeForTests(null);
    const NEW = "ef".repeat(32);
    await storeDatabaseKeyHex(NEW);
    expect(await backend.getItemAsync("nido_db_key")).toBe(NEW);
  });

  it("desactivar devuelve la DEK al SecureStore y borra el blob", async () => {
    const { native, state } = makeFakeNative();
    setKeyVaultNativeForTests(native);
    await activateVault(PROMPT);
    await deactivateVault(PROMPT);
    expect(await isVaultActive()).toBe(false);
    expect(await backend.getItemAsync("nido_db_key")).toBe(DEK);
    expect(state.kek).toBe(false);
    setUnlockedDatabaseKey(null);
    expect(await getDatabaseKeyHex()).toBe(DEK);
  });
});
