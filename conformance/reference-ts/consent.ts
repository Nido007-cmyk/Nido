/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

// NIDO Protocol Conformance Suite v0 — reference-ts
// Consent binding: a grant authorizes EXACTLY what was consented to.
// Correct consent + modified parameters -> POLICY_DENIED.

import { Result, ok, err } from './types';

export interface ConsentGrant {
  consent_id: string;
  capability: string;
  capability_version: string;
  parameters_hash: string; // sha256 of canonical parameters
  peer: string;
  max_uses: number;
  uses: number;
  expires_at: number;
}

export interface ConsentRequest {
  capability: string;
  capability_version: string;
  parameters_hash: string;
  peer: string;
  now: number;
}

export type ConsentError = 'POLICY_DENIED' | 'CONSENT_EXPIRED' | 'CONSENT_EXHAUSTED';

export function checkConsent(
  grant: ConsentGrant,
  req: ConsentRequest
): Result<{ uses_left: number }, ConsentError> {
  // Boundary is inclusive: at expires_at the grant is already expired.
  // (Unified with delegation: now >= expires_at means expired everywhere.)
  if (req.now >= grant.expires_at) return err('CONSENT_EXPIRED');
  if (grant.uses >= grant.max_uses) return err('CONSENT_EXHAUSTED');
  if (
    req.capability !== grant.capability ||
    req.capability_version !== grant.capability_version ||
    req.parameters_hash !== grant.parameters_hash ||
    req.peer !== grant.peer
  ) {
    return err('POLICY_DENIED');
  }
  return ok({ uses_left: grant.max_uses - grant.uses - 1 });
}
