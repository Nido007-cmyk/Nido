/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * keyLossRecovery.ts — NIDO: N4-RECOVERY-UI — presentation logic for the
 * honest Keystore-loss recovery screen.
 *
 * A KeyLossError (code "NIDO_KEY_LOST") means: encrypted databases exist on
 * the device but the expected DEK is missing/unusable, and NIDO refused to
 * silently generate a fresh one. That state must surface as an explicit,
 * honest, user-visible recovery screen — never as a generic crash, a silent
 * fallback, or a fake first-run.
 *
 * This module is deliberately UI-framework-free so the whole recovery
 * contract (typed error → honest screen model → explicit double-confirmed
 * recovery) is testable in the vitest suite, which has no RN renderer (same
 * approach as the N3 lane). `KeyLossRecoveryScreen.tsx` is a thin renderer
 * over this module; App.tsx routes through `routeStartupError`.
 *
 * Presentation + wiring ONLY. No crypto, no storage, no key derivation:
 * those live in `src/privacy/keyManager.ts` / `src/security/secureDatabase.ts`
 * and are untouched by this lane.
 */
import { KeyLossError } from "../privacy/keyManager";

/** The typed contract code — copied from KeyLossError, never re-derived. */
export const KEY_LOST_CODE = "NIDO_KEY_LOST" as const;

/**
 * The single routing decision App.tsx makes about startup key errors.
 * KeyLossError → the explicit honest recovery screen; anything else keeps
 * the previous behavior (it surfaces naturally where the database is first
 * used).
 */
export function routeStartupError(e: unknown): "key-loss" | "proceed" {
  return e instanceof KeyLossError ? "key-loss" : "proceed";
}

/** i18n key paths the recovery screen renders (copy lives in locales EN/ES/PT). */
export const KEY_RECOVERY_COPY_KEYS = [
  "title",
  "whatHappened",
  "databasesFound",
  "notDeleted",
  "cannotRecoverKey",
  "startRecovery",
  "checkAgain",
  "confirmTitle",
  "confirmBody",
  "confirmButton",
  "cancel",
  "recovering",
  "recoveryFailed",
] as const;

export type KeyRecoveryCopyKey = (typeof KEY_RECOVERY_COPY_KEYS)[number];

export interface KeyLossViewModel {
  /** The typed contract values, copied — never re-derived or paraphrased. */
  code: typeof KEY_LOST_CODE;
  /** Names of the encrypted databases found on the device, as reported. */
  databases: string[];
  /** i18n key paths under the "keyRecovery" namespace. */
  copy: Record<KeyRecoveryCopyKey, `keyRecovery.${KeyRecoveryCopyKey}`>;
}

/**
 * Builds the screen model from the typed contract. The honesty copy
 * (what happened / data not deleted / key cannot be recovered) lives in
 * the locale files; this function only binds the contract's `databases`
 * list into the model.
 */
export function buildKeyLossViewModel(error: KeyLossError): KeyLossViewModel {
  const copy = {} as KeyLossViewModel["copy"];
  for (const k of KEY_RECOVERY_COPY_KEYS) {
    copy[k] = `keyRecovery.${k}`;
  }
  return {
    code: error.code,
    databases: [...error.databases],
    copy,
  };
}

/**
 * Double-confirmation state machine for the destructive-adjacent recovery
 * action. The recovery (`recoverFromKeyLoss({ confirmed: true })`) may only
 * be invoked from the "executing" phase, which is unreachable without two
 * explicit user gestures: "begin" (explaining → confirming) and "confirm"
 * (confirming → executing).
 */
export type RecoveryPhase = "explaining" | "confirming" | "executing" | "done" | "failed";

export type RecoveryAction =
  | "begin"
  | "confirm"
  | "cancel"
  | "succeeded"
  | "errored"
  | "retry";

export function advanceRecoveryPhase(
  phase: RecoveryPhase,
  action: RecoveryAction,
): RecoveryPhase {
  switch (phase) {
    case "explaining":
      // A single stray "confirm" can never jump straight to execution.
      return action === "begin" ? "confirming" : "explaining";
    case "confirming":
      if (action === "confirm") return "executing";
      if (action === "cancel") return "explaining";
      return "confirming";
    case "executing":
      if (action === "succeeded") return "done";
      if (action === "errored") return "failed";
      return "executing";
    case "failed":
      // Back to the explicit confirmation — never straight to execution.
      return action === "retry" ? "confirming" : "failed";
    case "done":
      return "done";
  }
}

export interface KeyLossRecoveryDeps {
  /** Injected so tests can observe the exact call without touching storage. */
  recover: (opts: { confirmed: boolean }) => Promise<unknown>;
}

/**
 * Invokes the real recovery exactly once with the explicit confirmation.
 * The `confirmed: true` flag is set HERE — the only place in the
 * presentation layer allowed to do it — and callers must only call this
 * after the double-confirmation machine reached "executing". This function
 * never fires on its own and never passes `confirmed: false`.
 */
export async function executeKeyLossRecovery(
  deps: KeyLossRecoveryDeps,
): Promise<void> {
  await deps.recover({ confirmed: true });
}
