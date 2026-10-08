/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * p2pIdentityRecovery.ts — NIDO: F-2 — presentation logic for the honest
 * P2P-identity key-loss recovery screen.
 *
 * A P2PIdentityKeyLossError (code "NIDO_P2P_IDENTITY_KEY_LOST") means: a
 * durable P2P identity row exists in the database but one of its required
 * Keystore secrets (nido_p2p_sk or a recorded nido_p2p_sign_sk) is missing,
 * and NIDO refused to silently generate a fresh identity (that would be a
 * silent fork: peers keep the old keys and the user never learns their
 * identity changed). That state must surface as an explicit, honest,
 * user-visible recovery screen — never as a generic link error, a silent
 * fallback, or a fake first-run.
 *
 * Deliberately UI-framework-free so the whole recovery contract (typed
 * error → honest screen model → explicit double-confirmed recovery) is
 * testable in the vitest suite, which has no RN renderer (same approach as
 * the N4 keyLossRecovery lane). `NidoScreen.tsx` is a thin renderer over
 * this module.
 *
 * Presentation + wiring ONLY. No crypto, no storage, no identity
 * generation: those live in `src/p2p/store.ts` / `src/p2p/messenger.ts`.
 */
import { P2PIdentityKeyLossError } from "../p2p/store";

/** The typed contract code — copied from P2PIdentityKeyLossError, never re-derived. */
export const P2P_IDENTITY_KEY_LOST_CODE = "NIDO_P2P_IDENTITY_KEY_LOST" as const;

/**
 * The single routing decision NidoScreen makes about identity bootstrap
 * errors. P2PIdentityKeyLossError → the explicit honest recovery screen;
 * anything else keeps the previous behavior (it surfaces where the
 * bootstrap was first used).
 */
export function routeIdentityBootstrapError(e: unknown): "p2p-identity-loss" | "proceed" {
  return e instanceof P2PIdentityKeyLossError ? "p2p-identity-loss" : "proceed";
}

/** i18n key paths the recovery screen renders (copy lives in locales EN/ES/PT). */
export const P2P_RECOVERY_COPY_KEYS = [
  "title",
  "whatHappened",
  "consequence",
  "archived",
  "recoverButton",
  "confirmTitle",
  "confirmBody",
  "secondTitle",
  "secondBody",
  "recovering",
  "recovered",
  "cancel",
  "lostIdentityLabel",
] as const;

export type P2PRecoveryCopyKey = (typeof P2P_RECOVERY_COPY_KEYS)[number];

export interface P2PIdentityRecoveryViewModel {
  /** The typed contract values, copied — never re-derived or paraphrased. */
  code: typeof P2P_IDENTITY_KEY_LOST_CODE;
  /** Which Keystore secret was missing (e.g. "nido_p2p_sk"). */
  alias: string;
  /** Lost identity (pk_hex, full — the renderer shows the fingerprint prefix). */
  pkHex: string;
  /** i18n key paths under the "p2pIdentityRecovery" namespace. */
  copy: Record<P2PRecoveryCopyKey, `p2pIdentityRecovery.${P2PRecoveryCopyKey}`>;
}

/**
 * Builds the screen model from the typed contract. The honesty copy
 * (what happened / peers will no longer recognize you / re-pairing
 * required) lives in the locale files; this function only binds the
 * contract's values into the model.
 */
export function buildP2PIdentityRecoveryViewModel(
  error: P2PIdentityKeyLossError,
): P2PIdentityRecoveryViewModel {
  const copy = {} as P2PIdentityRecoveryViewModel["copy"];
  for (const k of P2P_RECOVERY_COPY_KEYS) {
    copy[k] = `p2pIdentityRecovery.${k}`;
  }
  return {
    code: error.code,
    alias: error.alias,
    pkHex: error.pkHex,
    copy,
  };
}

/**
 * The double confirmation NidoScreen must run before invoking the real
 * recovery. The renderer must show the honest copy (whatHappened +
 * consequence) and require TWO explicit confirmations; only then may it
 * call `messenger.recoverP2PIdentityAfterKeyLoss(true)`. There is no
 * auto-regeneration anywhere in this path.
 */
export const RECOVERY_CONFIRMATIONS_REQUIRED = 2 as const;
