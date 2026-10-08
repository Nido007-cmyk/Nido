/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Feature flags — delegated task execution.
 *
 * SAFETY: `delegation.enabled` defaults to OFF. All delegation code
 * paths (protocol handlers, executor, approval UI) must check this
 * flag and stay unreachable when it is off. The existing P2P stack
 * (transport, handshake, negotiation, chat) never reads this flag.
 */

export const FEATURE_FLAGS = {
  /** Delegated task execution NIDO-A -> NIDO-B. Default OFF. */
  "delegation.enabled": false,
} as const;

export type FeatureFlag = keyof typeof FEATURE_FLAGS;

export function isFeatureEnabled(flag: FeatureFlag): boolean {
  return (FEATURE_FLAGS[flag] as boolean) === true;
}
