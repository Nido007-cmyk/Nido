/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * vaultBackupGate.ts — la bóveda solo se activa con un respaldo reciente
 * (D9, revisado el 29-10-2026).
 *
 * Con la bóveda activa, si un día se quita el bloqueo de pantalla Android
 * borra la llave y los datos solo vuelven con un respaldo y su clave. Hasta
 * ahora se RECOMENDABA hacer un respaldo antes; ahora se exige uno de los
 * últimos 30 días. La fecha se guarda en SecureStore (se lee sin abrir la
 * base, igual que los demás ajustes de la bóveda).
 */
export const LAST_BACKUP_KEY = "nido_vault_last_backup_at";
export const VAULT_BACKUP_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export class NoRecentBackupError extends Error {
  readonly code = "E_NO_RECENT_BACKUP";
  constructor() {
    super("Haz primero un respaldo y guarda su clave.");
    this.name = "NoRecentBackupError";
  }
}

/** Puro: ¿la fecha guardada es de un respaldo de los últimos 30 días? */
export function isBackupRecent(lastAtRaw: string | null, now = Date.now()): boolean {
  if (!lastAtRaw) return false;
  const at = Number(lastAtRaw);
  if (!Number.isFinite(at) || at <= 0 || at > now + 60_000) return false;
  return now - at <= VAULT_BACKUP_MAX_AGE_MS;
}

export interface BackupDateStore {
  get(): Promise<string | null>;
  set(value: string): Promise<void>;
}

const secureStore: BackupDateStore = {
  async get() {
    const { readVaultSetting } = await import("../privacy/keyManager");
    return readVaultSetting(LAST_BACKUP_KEY);
  },
  async set(value) {
    const { writeVaultSetting } = await import("../privacy/keyManager");
    await writeVaultSetting(LAST_BACKUP_KEY, value);
  },
};

/** Lo llama createBackup al terminar bien. Nunca lanza. */
export async function recordBackupMade(now = Date.now(), store: BackupDateStore = secureStore): Promise<void> {
  try {
    await store.set(String(now));
  } catch {
    /* sin SecureStore: la bóveda pedirá el respaldo otra vez, que es lo seguro */
  }
}

/** Lanza NoRecentBackupError si no hay un respaldo de los últimos 30 días. */
export async function assertRecentBackup(now = Date.now(), store: BackupDateStore = secureStore): Promise<void> {
  let raw: string | null = null;
  try {
    raw = await store.get();
  } catch {
    raw = null;
  }
  if (!isBackupRecent(raw, now)) throw new NoRecentBackupError();
}
