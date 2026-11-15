/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Auditoría 2026-10-29: el archivo de la rotación de clave ya no guarda las
 * claves en claro. Y la recuperación tras un cierre a mitad sigue funcionando
 * con los archivos sellados; el formato antiguo en claro se retiró en 0.1.99
 * (T-16 · P-05) y openStaging lo rechaza.
 */
import { describe, expect, it } from "vitest";
import {
  isSealedStaging,
  openStaging,
  sealStaging,
  StagingKeyMissingError,
  type StagingKeyStore,
} from "./stagingSeal";

function memKeys(): StagingKeyStore & { value: string | null } {
  const ks = {
    value: null as string | null,
    async get() {
      return ks.value;
    },
    async set(hex: string) {
      ks.value = hex;
    },
  };
  return ks;
}

const OLD = "a".repeat(64);
const NEW = "b".repeat(64);
const JSON_IN = JSON.stringify({ newDekHex: NEW, oldDekHex: OLD, dbPaths: ["/x/nido_memory.db"], rekeyed: [] });

describe("archivo de rotación cifrado", () => {
  it("no contiene las claves en claro y se abre con su llave", async () => {
    const keys = memKeys();
    const sealed = await sealStaging(JSON_IN, keys);
    expect(sealed).not.toContain(OLD);
    expect(sealed).not.toContain(NEW);
    expect(isSealedStaging(sealed)).toBe(true);
    expect(await openStaging(sealed, keys)).toBe(JSON_IN);
  });

  it("reutiliza la llave existente", async () => {
    const keys = memKeys();
    await sealStaging("{}", keys);
    const first = keys.value;
    await sealStaging("{}", keys);
    expect(keys.value).toBe(first);
  });

  it("un archivo antiguo en claro se RECHAZA: el formato sin sellar se retiró en 0.1.99 (T-16 · P-05)", async () => {
    await expect(openStaging(JSON_IN, memKeys())).rejects.toThrow(/no sellado/);
  });

  it("un texto que ni siquiera es JSON también se rechaza como no sellado (T-16 · P-05)", async () => {
    await expect(openStaging("esto no es un staging", memKeys())).rejects.toThrow(/no sellado/);
  });

  it("sin la llave no se abre, y lo dice con un error propio (para no borrarlo)", async () => {
    const keys = memKeys();
    const sealed = await sealStaging(JSON_IN, keys);
    keys.value = null;
    await expect(openStaging(sealed, keys)).rejects.toBeInstanceOf(StagingKeyMissingError);
  });

  it("un archivo manipulado no se acepta", async () => {
    const keys = memKeys();
    const sealed = JSON.parse(await sealStaging(JSON_IN, keys));
    sealed.c = (sealed.c[0] === "0" ? "1" : "0") + sealed.c.slice(1);
    await expect(openStaging(JSON.stringify(sealed), keys)).rejects.toThrow(/no válido/);
  });

  it("si SecureStore no guarda la llave, no se escribe nada (fail-closed)", async () => {
    const broken: StagingKeyStore = { get: async () => null, set: async () => {} };
    await expect(sealStaging(JSON_IN, broken)).rejects.toThrow(/llave/);
  });
});
