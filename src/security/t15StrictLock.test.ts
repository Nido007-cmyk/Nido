/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * T-15 · m-02: el nivel B («máxima seguridad») no puede fallar EN ABIERTO.
 *
 * Antes de esta tanda, `readVaultSetting` devolvía null tanto si no había
 * nada guardado como si la lectura de SecureStore lanzaba, y
 * `getStrictLockSeconds` traducía ese null a «desactivado»: con el nivel B
 * activado, un error transitorio dejaba la DEK viva en memoria sin cierre
 * y sin aviso. La cura va ACOTADA a la ruta del nivel B:
 * `readVaultSettingStrict` distingue {valor} de {error} solo para quien lo
 * pide, `getStrictLockState` expone los tres estados y el ayudante
 * `strictLockSecondsOrFailClosed` convierte «no se pudo leer» en la espera
 * mínima ofrecida (30 s). El contrato de `readVaultSetting` («null =
 * sigue») queda intacto para sus otros tres consumidores (puerta de
 * respaldo, llave del staging y censo de borrado total): se fija aquí como
 * control.
 *
 * La parte de App.tsx es estructural (la casa no renderiza App en la
 * suite): las dos rutas del listener de AppState deben consumir el estado
 * tri-estado, no la lectura que confunde error con desactivado.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createMemorySecureBackend,
  readVaultSetting,
  readVaultSettingStrict,
  setTestSecureBackend,
  type SecureBackend,
} from "../privacy/keyManager";
import {
  getStrictLockSeconds,
  getStrictLockState,
  strictLockSecondsOrFailClosed,
} from "./keyVault";

const STRICT_KEY = "nido_vault_strict_lock_seconds";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Backend en memoria cuyo getItemAsync lanza para la clave del nivel B. */
function throwingBackend(inner: SecureBackend): SecureBackend {
  return {
    getItemAsync: async (k: string) => {
      if (k === STRICT_KEY) throw new Error("SecureStore: error transitorio de lectura");
      return inner.getItemAsync(k);
    },
    setItemAsync: (k: string, v: string) => inner.setItemAsync(k, v),
    deleteItemAsync: (k: string) => inner.deleteItemAsync(k),
  };
}

let memory: SecureBackend;

beforeEach(() => {
  memory = createMemorySecureBackend();
  setTestSecureBackend(memory);
});

afterEach(() => {
  setTestSecureBackend(null);
});

describe("m-02 · lectura estricta acotada al nivel B", () => {
  it("readVaultSettingStrict devuelve el valor cuando la lectura va bien", async () => {
    await memory.setItemAsync(STRICT_KEY, "60");
    await expect(readVaultSettingStrict(STRICT_KEY)).resolves.toEqual({ ok: true, value: "60" });
    await expect(readVaultSettingStrict("nido_vault_otra_clave")).resolves.toEqual({
      ok: true,
      value: null,
    });
  });

  it("readVaultSettingStrict distingue el error de lectura del «sin valor»", async () => {
    setTestSecureBackend(throwingBackend(memory));
    const r = await readVaultSettingStrict(STRICT_KEY);
    expect(r.ok).toBe(false);
  });

  it("readVaultSettingStrict mantiene la guarda de prefijo de la función existente", async () => {
    await expect(readVaultSettingStrict("clave_sin_prefijo")).rejects.toThrow();
  });

  it("con nivel B guardado y lectura fallando, el estado es «unreadable», no «disabled»", async () => {
    await memory.setItemAsync(STRICT_KEY, "60");
    setTestSecureBackend(throwingBackend(memory));
    await expect(getStrictLockState()).resolves.toEqual({ kind: "unreadable" });
  });

  it("el ayudante fail-closed convierte «unreadable» en la espera mínima ofrecida (30 s)", async () => {
    await memory.setItemAsync(STRICT_KEY, "60");
    setTestSecureBackend(throwingBackend(memory));
    const state = await getStrictLockState();
    expect(strictLockSecondsOrFailClosed(state)).toBe(30);
  });

  it("con lectura buena, el estado y el ayudante dan los segundos guardados", async () => {
    await memory.setItemAsync(STRICT_KEY, "300");
    await expect(getStrictLockState()).resolves.toEqual({ kind: "seconds", seconds: 300 });
    expect(strictLockSecondsOrFailClosed(await getStrictLockState())).toBe(300);
    await expect(getStrictLockSeconds()).resolves.toBe(300);
  });

  it("sin valor guardado, el nivel B está desactivado y el ayudante no cierra", async () => {
    await expect(getStrictLockState()).resolves.toEqual({ kind: "disabled" });
    expect(strictLockSecondsOrFailClosed(await getStrictLockState())).toBeNull();
    await expect(getStrictLockSeconds()).resolves.toBeNull();
  });

  it("un valor guardado fuera de las opciones ofrecidas sigue siendo «desactivado» (comportamiento conservado)", async () => {
    await memory.setItemAsync(STRICT_KEY, "999");
    await expect(getStrictLockState()).resolves.toEqual({ kind: "disabled" });
    await expect(getStrictLockSeconds()).resolves.toBeNull();
  });

  it("CONTROL · el contrato de readVaultSetting no cambia: error de lectura = null (los otros tres consumidores siguen igual)", async () => {
    setTestSecureBackend(throwingBackend(memory));
    await expect(readVaultSetting(STRICT_KEY)).resolves.toBeNull();
    await expect(readVaultSetting("nido_vault_backup_last_at")).resolves.toBeNull();
  });
});

describe("m-02 · App.tsx consume el estado tri-estado en las dos rutas", () => {
  const app = readFileSync(join(ROOT, "App.tsx"), "utf8");

  it("App.tsx ya no llama a la lectura que confunde error con desactivado", () => {
    expect(app).not.toContain("getStrictLockSeconds");
  });

  it("las dos rutas (background y vuelta a active) usan el estado y el ayudante fail-closed", () => {
    const states = app.split("getStrictLockState").length - 1;
    const helpers = app.split("strictLockSecondsOrFailClosed").length - 1;
    expect(states).toBeGreaterThanOrEqual(2);
    expect(helpers).toBeGreaterThanOrEqual(2);
  });
});
