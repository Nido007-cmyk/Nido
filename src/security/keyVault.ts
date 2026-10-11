/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * keyVault.ts — HW-VAULT, nivel A ("tras el primer desbloqueo").
 * Diseño completo: docs/design/BLOQUEO_BIOMETRICO_REAL.md.
 *
 * La DEK de SQLCipher se envuelve con una llave de hardware (KEK del
 * Android Keystore) que solo funciona tras el PIN/patrón o la huella del
 * dueño. Tras desbloquear, la DEK queda en memoria mientras el proceso vive
 * (P2P en segundo plano, recordatorios y tareas siguen igual). Si la tablet
 * se reinicia o NIDO se cierra, hace falta autenticarse otra vez.
 *
 * Reglas de seguridad de datos (no negociables):
 *  - La DEK en claro del SecureStore solo se borra DESPUÉS de verificar que
 *    el blob se desenvuelve exactamente a la misma DEK.
 *  - Cualquier fallo de la activación deja todo como estaba (modo legado).
 *  - Con el blob presente jamás se genera una DEK nueva (keyManager).
 */

import {
  deleteLegacyDatabaseKey,
  deleteVaultBlob,
  getDatabaseKeyHex,
  readLegacyDatabaseKey,
  readVaultBlob,
  registerVaultRewrap,
  setUnlockedDatabaseKey,
  writeLegacyDatabaseKey,
  writeVaultBlob,
} from "../privacy/keyManager";

export type VaultSecurityLevel = "strongbox" | "tee" | "software" | "unknown";
export interface VaultStatus {
  supported: boolean;
  kekExists: boolean;
  securityLevel: VaultSecurityLevel;
  apiLevel: number;
}
export type VaultAuthResult = "ok" | "cancelled" | "failed";

export interface KeyVaultNative {
  getStatus(): Promise<VaultStatus>;
  ensureKek(): Promise<VaultStatus>;
  authenticate(title: string, subtitle: string): Promise<VaultAuthResult>;
  wrap(plainB64: string): Promise<string>;
  unwrap(blobB64: string): Promise<string>;
  deleteKek(): Promise<void>;
}

/** Códigos estables del módulo nativo (ver NidoKeyVaultModule.kt). */
export type VaultErrorCode =
  | "E_NO_SECURE_LOCK"
  | "E_AUTH_REQUIRED"
  | "E_KEY_INVALIDATED"
  | "E_BLOB_CORRUPT"
  | "E_NO_KEK"
  | "E_CANCELLED"
  | "E_AUTH_FAILED"
  | "E_VERIFY_MISMATCH"
  | "E_UNAVAILABLE"
  | "E_UNKNOWN";

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
    return m?.default && typeof m.default.wrap === "function" ? m.default : null;
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
  const known: VaultErrorCode[] = [
    "E_NO_SECURE_LOCK",
    "E_AUTH_REQUIRED",
    "E_KEY_INVALIDATED",
    "E_BLOB_CORRUPT",
    "E_NO_KEK",
  ];
  if (typeof code === "string" && (known as string[]).includes(code)) {
    return new VaultError(code as VaultErrorCode, msg);
  }
  return new VaultError("E_UNKNOWN", msg);
}

const hexToB64 = (hex: string): string => {
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  bytes.fill(0);
  return btoa(bin);
};

const b64ToHex = (b64: string): string => {
  const bin = atob(b64);
  let hex = "";
  for (let i = 0; i < bin.length; i++) hex += bin.charCodeAt(i).toString(16).padStart(2, "0");
  return hex;
};

async function authenticateOrThrow(n: KeyVaultNative, title: string, subtitle: string): Promise<void> {
  let r: VaultAuthResult;
  try {
    r = await n.authenticate(title, subtitle);
  } catch (e) {
    throw toVaultError(e);
  }
  if (r === "cancelled") throw new VaultError("E_CANCELLED", "Autenticación cancelada.");
  if (r !== "ok") throw new VaultError("E_AUTH_FAILED", "No se pudo autenticar.");
}

/**
 * Ejecuta una operación de la KEK; si Android responde que hace falta
 * autenticarse (p. ej. el diálogo previo usó una biometría débil o pasaron
 * más de 30 s), pide autenticación una vez y reintenta.
 */
async function withKek<T>(
  n: KeyVaultNative,
  prompt: { title: string; subtitle: string },
  op: () => Promise<T>,
): Promise<T> {
  try {
    return await op();
  } catch (e) {
    const ve = toVaultError(e);
    if (ve.code !== "E_AUTH_REQUIRED") throw ve;
  }
  await authenticateOrThrow(n, prompt.title, prompt.subtitle);
  try {
    return await op();
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

export interface VaultPrompt {
  title: string;
  subtitle: string;
}

/**
 * Desbloqueo de arranque: autentica, desenvuelve y deja la DEK en memoria.
 * Si quedó una activación a medias (blob + DEK en claro), la completa o la
 * revierte de forma segura.
 */
export async function unlockVault(prompt: VaultPrompt): Promise<void> {
  const blob = await readVaultBlob();
  if (!blob) return; // modo legado: nada que desbloquear
  const n = requireNative();
  await authenticateOrThrow(n, prompt.title, prompt.subtitle);
  let dekHex: string;
  try {
    dekHex = b64ToHex(await withKek(n, prompt, () => n.unwrap(blob)));
  } catch (e) {
    const ve = toVaultError(e);
    // Activación interrumpida con blob inservible: la DEK legada sigue ahí →
    // volver al modo legado sin perder nada.
    if (ve.code === "E_BLOB_CORRUPT" || ve.code === "E_NO_KEK") {
      const legacy = await readLegacyDatabaseKey();
      if (legacy) {
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
      await deleteLegacyKeySafely();
    } else {
      // Nunca debería pasar; ante la duda, gana la DEK con la que se abrieron
      // los datos hasta ahora (la legada) y se descarta el blob.
      await deleteVaultBlob();
      setUnlockedDatabaseKey(null);
      return;
    }
  }
  setUnlockedDatabaseKey(dekHex);
}

async function deleteLegacyKeySafely(): Promise<void> {
  await deleteLegacyDatabaseKey();
}

/**
 * Activa la protección por hardware (migración verificada, §8 del diseño).
 * Requiere que la app ya esté desbloqueada (la DEK legada se lee aquí).
 */
export async function activateVault(prompt: VaultPrompt): Promise<VaultStatus> {
  if (await isVaultActive()) {
    const st = await requireNative().getStatus();
    return st;
  }
  const n = requireNative();
  let status: VaultStatus;
  try {
    status = await n.ensureKek();
  } catch (e) {
    throw toVaultError(e);
  }
  const dek = await getDatabaseKeyHex();
  if (!dek) throw new VaultError("E_UNKNOWN", "No hay llave de base de datos que proteger.");
  await authenticateOrThrow(n, prompt.title, prompt.subtitle);
  const blob = await withKek(n, prompt, () => n.wrap(hexToB64(dek)));
  // 1) Guardar el blob (la DEK legada SIGUE intacta).
  await writeVaultBlob(blob);
  // 2) Verificar: desenvolver debe devolver exactamente la misma DEK.
  let roundTrip: string;
  try {
    roundTrip = b64ToHex(await withKek(n, prompt, () => n.unwrap(blob)));
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
  await deleteLegacyKeySafely();
  return status;
}

/** Desactiva: la DEK vuelve al SecureStore (modo legado) tras autenticarse. */
export async function deactivateVault(prompt: VaultPrompt): Promise<void> {
  const blob = await readVaultBlob();
  if (!blob) return;
  const n = requireNative();
  await authenticateOrThrow(n, prompt.title, prompt.subtitle);
  const dek = b64ToHex(await withKek(n, prompt, () => n.unwrap(blob)));
  await writeLegacyDatabaseKey(dek);
  // Verificar la copia legada antes de soltar el blob.
  if ((await readLegacyDatabaseKey()) !== dek) {
    throw new VaultError("E_VERIFY_MISMATCH", "No se pudo guardar la llave: no se cambió nada.");
  }
  await deleteVaultBlob();
  setUnlockedDatabaseKey(null);
  await n.deleteKek().catch(() => {});
}

/** Borrado total ("Borrar todos los datos"): elimina la KEK de hardware. */
export async function deleteVaultKek(): Promise<void> {
  setUnlockedDatabaseKey(null);
  const n = native();
  if (n) await n.deleteKek().catch(() => {});
}

/**
 * Re-envoltura para una DEK NUEVA (rotación / recuperación de rekey) con la
 * bóveda activa: nunca se escribe en claro. Registrada en keyManager.
 */
async function rewrapNewDek(hex: string): Promise<void> {
  const n = requireNative();
  const prompt = { title: "NIDO", subtitle: "Confirma para guardar la nueva llave" };
  const blob = await withKek(n, prompt, () => n.wrap(hexToB64(hex)));
  const check = b64ToHex(await withKek(n, prompt, () => n.unwrap(blob)));
  if (check !== hex.toLowerCase()) {
    throw new VaultError("E_VERIFY_MISMATCH", "No se pudo proteger la nueva llave.");
  }
  await writeVaultBlob(blob);
  setUnlockedDatabaseKey(hex);
}

registerVaultRewrap(rewrapNewDek);
