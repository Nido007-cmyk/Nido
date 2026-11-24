/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Backup errors with a stable code (final audit, 0.1.16).
 *
 * backup.ts throws Spanish messages (kept as they are: logs and tests read
 * them). The screens showed e.message as is, so an English or Portuguese
 * user got the error in Spanish. Now each known error carries a code and the
 * screen shows `backup.errors.<code>` in the app language; anything without a
 * code keeps the old behaviour.
 */

import { BiometricCancelled } from "./biometricGate";

export type BackupErrorCode =
  | "storage"
  | "dbMissing"
  | "noDbKey"
  | "invalid"
  | "rollback"
  | "keyFormat"
  | "noDeviceKey"
  | "wrongKey"
  | "authCancelled";

/**
 * Auditoría 0.1.112, bloque 8: por qué un respaldo no vale. El código
 * «invalid» decía solo «el archivo no es un respaldo válido» en los tres
 * idiomas y el motivo concreto se quedaba en el mensaje interno en
 * español. Ahora el motivo viaja como código y la pantalla lo traduce
 * (backup.invalidReasons.<motivo>). El mensaje interno no cambia.
 */
export type BackupInvalidReason =
  | "notFound"
  | "tooSmall"
  | "tooLarge"
  | "tooLargeToShare"
  | "notJson"
  | "unknownFormat"
  | "noManifest"
  | "noDatabase"
  | "manifestIncomplete"
  | "tooNew"
  | "otherInstall"
  | "wontOpen"
  | "cantVerify"
  | "corrupt"
  | "unknown";

export const INVALID_REASONS: readonly BackupInvalidReason[] = [
  "notFound",
  "tooSmall",
  "tooLarge",
  "tooLargeToShare",
  "notJson",
  "unknownFormat",
  "noManifest",
  "noDatabase",
  "manifestIncomplete",
  "tooNew",
  "otherInstall",
  "wontOpen",
  "cantVerify",
  "corrupt",
  "unknown",
];

const CODES: readonly BackupErrorCode[] = [
  "storage",
  "dbMissing",
  "noDbKey",
  "invalid",
  "rollback",
  "keyFormat",
  "noDeviceKey",
  "wrongKey",
  "authCancelled",
];

export class BackupError extends Error {
  readonly code: BackupErrorCode;
  /** Solo con code "invalid": el motivo concreto (bloque 8, 0.1.112). */
  readonly detail?: BackupInvalidReason;
  constructor(code: BackupErrorCode, message: string, detail?: BackupInvalidReason) {
    super(message);
    this.name = "BackupError";
    this.code = code;
    if (detail) this.detail = detail;
  }
}

export function backupErrorCode(e: unknown): BackupErrorCode | null {
  if (e instanceof BiometricCancelled) return "authCancelled";
  const code = (e as { code?: unknown } | null)?.code;
  return typeof code === "string" && (CODES as readonly string[]).includes(code) ? (code as BackupErrorCode) : null;
}

/** El motivo concreto de un error «invalid», si lo trae y es conocido. */
export function backupInvalidReason(e: unknown): BackupInvalidReason | null {
  const d = (e as { detail?: unknown } | null)?.detail;
  return typeof d === "string" && (INVALID_REASONS as readonly string[]).includes(d) ? (d as BackupInvalidReason) : null;
}
