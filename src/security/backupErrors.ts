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
  constructor(code: BackupErrorCode, message: string) {
    super(message);
    this.name = "BackupError";
    this.code = code;
  }
}

export function backupErrorCode(e: unknown): BackupErrorCode | null {
  if (e instanceof BiometricCancelled) return "authCancelled";
  const code = (e as { code?: unknown } | null)?.code;
  return typeof code === "string" && (CODES as readonly string[]).includes(code) ? (code as BackupErrorCode) : null;
}
