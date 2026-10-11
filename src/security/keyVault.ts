/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * keyVault.ts — HW-VAULT, nivel A ("tras el primer desbloqueo").
 * Diseño e investigación: docs/design/BLOQUEO_BIOMETRICO_REAL.md.
 *
 * La DEK de SQLCipher se envuelve con una llave de hardware (KEK del
 * Android Keystore). Cada uso de la KEK exige un PIN/patrón o una huella
 * fuerte ligados por el hardware a ESA operación (CryptoObject, timeout 0).
 * Tras desbloquear, la DEK queda en memoria mientras el proceso vive (P2P
 * en segundo plano, recordatorios y tareas siguen igual). Si la tablet se
 * reinicia o NIDO se cierra, hace falta autenticarse otra vez.
 *
 * Reglas de seguridad de datos (no negociables):
 *  - La DEK en claro del SecureStore solo se borra DESPUÉS de verificar que
 *    el blob se desenvuelve exactamente a la misma DEK.
 *  - Cualquier fallo de la activación deja todo como estaba (modo legado).
 *  - Con el blob presente jamás se genera una DEK nueva (keyManager).
 */

import { withPermissionRequest } from "../p2p/permissionGuard";
import {
  deleteLegacyDatabaseKey,
  deleteVaultBlob,
  getDatabaseKeyHex,
  readLegacyDatabaseKey,
  readVaultBlob,
  readVaultSetting,
  registerVaultRewrap,
  setUnlockedDatabaseKey,
  writeLegacyDatabaseKey,
  writeVaultBlob,
  writeVaultSetting,
} from "../privacy/keyManager";

export type VaultSecurityLevel = "strongbox" | "tee" | "software" | "unknown";
export interface VaultStatus {
  supported: boolean;
  kekExists: boolean;
  securityLevel: VaultSecurityLevel;
  apiLevel: number;
}

export interface KeyVaultNative {
  getStatus(): Promise<VaultStatus>;
  ensureKek(): Promise<VaultStatus>;
  wrapWithAuth(plainB64: string, title: string, subtitle: string): Promise<string>;
  unwrapWithAuth(blobB64: string, title: string, subtitle: string): Promise<string>;
  deleteKek(): Promise<void>;
  terminateProcess(): Promise<void>;
}

/** Códigos estables del módulo nativo (ver NidoKeyVaultModule.kt). */
export type VaultErrorCode =
  | "E_UNSUPPORTED"
  | "E_NO_SECURE_LOCK"
  | "E_KEY_INVALIDATED"
  | "E_BLOB_CORRUPT"
  | "E_NO_KEK"
  | "E_CANCELLED"
  | "E_AUTH_FAILED"
  | "E_VERIFY_MISMATCH"
  | "E_UNAVAILABLE"
  | "E_UNKNOWN";

const KNOWN_CODES: readonly VaultErrorCode[] = [
  "E_UNSUPPORTED",
  "E_NO_SECURE_LOCK",
  "E_KEY_INVALIDATED",
  "E_BLOB_CORRUPT",
  "E_NO_KEK",
  "E_CANCELLED",
  "E_AUTH_FAILED",
];

export class VaultError extends Error {
  readonly code: VaultErrorCode;
  constructor(code: VaultErrorCode, message: string) {
    super(message);
    this.name = "VaultError";
    this.code = code;
  }
}

let testNative: KeyVaultNative | null | undefined;

/** Solo tests: inyecta un módulo nativo simulado (null = no disponible). */
export function setKeyVaultNativeForTests(n: KeyVaultNative | null | undefined): void {
  testNative = n;
}

function native(): KeyVaultNative | null {
  if (testNative !== undefined) return testNative;
  try {
    // require perezoso: en Node/vitest el módulo nativo no existe.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const m = require("nido-keyvault") as { default?: KeyVaultNative };
    return m?.default && typeof m.default.wrapWithAuth === "function" ? m.default : null;
  } catch {
    return null;
  }
}

function requireNative(): KeyVaultNative {
  const n = native();
  if (!n) throw new VaultError("E_UNAVAILABLE", "La protección por hardware no está disponible en esta build.");
  return n;
}

function toVaultError(e: unknown): VaultError {
  if (e instanceof VaultError) return e;
  const code = (e as { code?: unknown } | null)?.code;
  const msg = e instanceof Error ? e.message : String(e);
  if (typeof code === "string" && (KNOWN_CODES as readonly string[]).includes(code)) {
    return new VaultError(code as VaultErrorCode, msg);
  }
  return new VaultError("E_UNKNOWN", msg);
}

const hexToB64 = (hex: string): string => {
  let bin = "";
  for (let i = 0; i < 32; i++) bin += String.fromCharCode(parseInt(hex.slice(i * 2, i * 2 + 2), 16));
  return btoa(bin);
};

const b64ToHex = (b64: string): string => {
  const bin = atob(b64);
  let hex = "";
  for (let i = 0; i < bin.length; i++) hex += bin.charCodeAt(i).toString(16).padStart(2, "0");
  return hex;
};

export interface VaultPrompt {
  title: string;
  subtitle: string;
}

async function wrapDek(n: KeyVaultNative, dekHex: string, p: VaultPrompt): Promise<string> {
  try {
    // Integración 0.1.7: si el diálogo de PIN/huella pausara la actividad en
    // algún dispositivo, no debe mandar a la pantalla de bloqueo (misma
    // bandera que los permisos; el nivel B sigue contando, ver App.tsx).
    return await withPermissionRequest(() => n.wrapWithAuth(hexToB64(dekHex), p.title, p.subtitle));
  } catch (e) {
    throw toVaultError(e);
  }
}

async function unwrapDek(n: KeyVaultNative, blob: string, p: VaultPrompt): Promise<string> {
  try {
    return b64ToHex(await withPermissionRequest(() => n.unwrapWithAuth(blob, p.title, p.subtitle)));
  } catch (e) {
    throw toVaultError(e);
  }
}

/** ¿La DEK de este dispositivo está envuelta por la llave de hardware? */
export async function isVaultActive(): Promise<boolean> {
  return (await readVaultBlob()) !== null;
}

/** Estado para la UI (null si la build no trae el módulo nativo). */
export async function vaultStatus(): Promise<VaultStatus | null> {
  const n = native();
  if (!n) return null;
  try {
    return await n.getStatus();
  } catch {
    return null;
  }
}

/**
 * Desbloqueo de arranque: un diálogo (PIN/huella) que desenvuelve la DEK y
 * la deja en memoria. Si quedó una activación a medias (blob + DEK en
 * claro), la completa o la revierte de forma segura.
 */
export async function unlockVault(prompt: VaultPrompt): Promise<void> {
  const blob = await readVaultBlob();
  if (!blob) return; // modo legado: nada que desbloquear
  const n = requireNative();
  let dekHex: string;
  try {
    dekHex = await unwrapDek(n, blob, prompt);
  } catch (e) {
    const ve = toVaultError(e);
    // Activación interrumpida con blob inservible: la DEK legada sigue ahí →
    // volver al modo legado sin perder nada.
    if (ve.code === "E_BLOB_CORRUPT" || ve.code === "E_NO_KEK") {
      if (await readLegacyDatabaseKey()) {
        await deleteVaultBlob();
        return;
      }
    }
    throw ve;
  }
  // Activación interrumpida tras escribir el blob: terminarla si coincide.
  const legacy = await readLegacyDatabaseKey();
  if (legacy) {
    if (legacy === dekHex) {
      await deleteLegacyDatabaseKey();
    } else {
      // Nunca debería pasar; ante la duda gana la DEK con la que se abrieron
      // los datos hasta ahora (la legada) y se descarta el blob.
      await deleteVaultBlob();
      setUnlockedDatabaseKey(null);
      return;
    }
  }
  setUnlockedDatabaseKey(dekHex);
}

/**
 * Activa la protección por hardware (migración verificada, §8 del diseño).
 * Dos diálogos: uno para proteger la llave y otro para verificarla.
 */
export async function activateVault(protect: VaultPrompt, verify: VaultPrompt): Promise<VaultStatus> {
  const n = requireNative();
  if (await isVaultActive()) return n.getStatus();
  let status: VaultStatus;
  try {
    status = await n.ensureKek();
  } catch (e) {
    throw toVaultError(e);
  }
  const dek = await getDatabaseKeyHex();
  if (!dek) throw new VaultError("E_UNKNOWN", "No hay llave de base de datos que proteger.");
  const blob = await wrapDek(n, dek, protect);
  // 1) Guardar el blob (la DEK legada SIGUE intacta).
  await writeVaultBlob(blob);
  // 2) Verificar: desenvolver debe devolver exactamente la misma DEK.
  let roundTrip: string;
  try {
    roundTrip = await unwrapDek(n, blob, verify);
  } catch (e) {
    await deleteVaultBlob().catch(() => {});
    throw toVaultError(e);
  }
  if (roundTrip !== dek.toLowerCase()) {
    await deleteVaultBlob().catch(() => {});
    throw new VaultError("E_VERIFY_MISMATCH", "La verificación falló: no se cambió nada.");
  }
  // 3) Solo ahora: la DEK queda en memoria y se borra la copia en claro.
  setUnlockedDatabaseKey(roundTrip);
  await deleteLegacyDatabaseKey();
  return status;
}

/** Desactiva: la DEK vuelve al SecureStore (modo legado) tras autenticarse. */
export async function deactivateVault(prompt: VaultPrompt): Promise<void> {
  const blob = await readVaultBlob();
  if (!blob) return;
  const n = requireNative();
  const dek = await unwrapDek(n, blob, prompt);
  await writeLegacyDatabaseKey(dek);
  // Verificar la copia legada antes de soltar el blob.
  if ((await readLegacyDatabaseKey()) !== dek) {
    throw new VaultError("E_VERIFY_MISMATCH", "No se pudo guardar la llave: no se cambió nada.");
  }
  await deleteVaultBlob();
  setUnlockedDatabaseKey(null);
  await writeVaultSetting(STRICT_KEY, null).catch(() => {});
  await n.deleteKek().catch(() => {});
}

// ---------------------------------------------------------------------------
// Nivel B — "máxima seguridad" (opcional)
// ---------------------------------------------------------------------------

const STRICT_KEY = "nido_vault_strict_lock_seconds";
/** Opciones de espera antes de cerrar NIDO al salir (s). 0 no se ofrece:
 *  abrir un selector de archivos o la cámara del sistema saca a NIDO a
 *  segundo plano y lo cerraría a mitad. */
export const STRICT_LOCK_OPTIONS = [30, 60, 300] as const;

/** Segundos de espera del nivel B, o null si está desactivado. */
export async function getStrictLockSeconds(): Promise<number | null> {
  const raw = await readVaultSetting(STRICT_KEY);
  if (raw === null) return null;
  const n = Number(raw);
  return (STRICT_LOCK_OPTIONS as readonly number[]).includes(n) ? n : null;
}

/** Activa (segundos) o desactiva (null) el nivel B. Exige la bóveda activa. */
export async function setStrictLockSeconds(seconds: number | null): Promise<void> {
  if (seconds !== null) {
    if (!(STRICT_LOCK_OPTIONS as readonly number[]).includes(seconds)) {
      throw new Error("keyVault: espera no permitida.");
    }
    if (!(await isVaultActive())) {
      throw new VaultError("E_UNKNOWN", "Activa primero la protección por hardware.");
    }
  }
  await writeVaultSetting(STRICT_KEY, seconds === null ? null : String(seconds));
}

/**
 * Cierra NIDO por completo: borra la DEK de memoria y termina el proceso.
 * Al volver a abrir, la pantalla de la bóveda pide PIN/huella.
 */
export async function lockAndTerminate(): Promise<void> {
  setUnlockedDatabaseKey(null);
  const n = native();
  if (n) await n.terminateProcess().catch(() => {});
}

/** Borrado total ("Borrar todos los datos"): elimina la KEK de hardware. */
export async function deleteVaultKek(): Promise<void> {
  setUnlockedDatabaseKey(null);
  await writeVaultSetting(STRICT_KEY, null).catch(() => {});
  const n = native();
  if (n) await n.deleteKek().catch(() => {});
}

let rewrapPrompts: { protect: VaultPrompt; verify: VaultPrompt } = {
  protect: { title: "NIDO", subtitle: "Confirma para proteger la nueva llave" },
  verify: { title: "NIDO", subtitle: "Confirma otra vez para verificarla" },
};

/** La UI puede fijar textos traducidos para la re-envoltura (rotación). */
export function setRewrapPrompts(p: { protect: VaultPrompt; verify: VaultPrompt }): void {
  rewrapPrompts = p;
}

/**
 * Re-envoltura para una DEK NUEVA (rotación / recuperación de rekey) con la
 * bóveda activa: nunca se escribe en claro. Registrada en keyManager.
 */
async function rewrapNewDek(hex: string): Promise<void> {
  const n = requireNative();
  const blob = await wrapDek(n, hex, rewrapPrompts.protect);
  const check = await unwrapDek(n, blob, rewrapPrompts.verify);
  if (check !== hex.toLowerCase()) {
    throw new VaultError("E_VERIFY_MISMATCH", "No se pudo proteger la nueva llave.");
  }
  await writeVaultBlob(blob);
  setUnlockedDatabaseKey(hex);
}

registerVaultRewrap(rewrapNewDek);
