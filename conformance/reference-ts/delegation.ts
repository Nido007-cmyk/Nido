// NIDO Protocol Conformance Suite v0 — reference-ts
// Delegation chain verification (DELEGATION_ATTENUATION, FAIL_CLOSED).
//
// A chain is an ordered list: [root_grant, delegation_1, ..., leaf].
// Each token is signed by its issuer. Rules:
//  - every signature valid under the issuer's identity key
//  - issuer of token[i+1] == subject of token[i] (chain linkage)
//  - expires_at monotonically non-increasing along the chain
//  - max_uses monotonically non-increasing
//  - capability identical along the chain (v0: no narrowing language yet)
//  - scope.peers subset of parent scope.peers (if parent restricts)
//  - leaf not expired at `now`
// Violation -> DELEGATION_INVALID. Unknown/ambiguous -> DELEGATION_INVALID (fail closed).

import { Result, ok, err } from './types';
import { JsonValue } from './strictJson';
import { canonicalize } from './canonicalize';
import { edVerify, edSign, TestKeypair } from './sig';

export interface DelegationToken {
  v: string;
  issuer_identity: string;
  subject_identity: string;
  capability: string;
  capability_version: string;
  scope: { peers?: string[]; max_uses: number };
  issued_at: number;
  expires_at: number;
  parent_hash?: string;
  signature: string;
}

export type DelegationError = 'DELEGATION_INVALID';

export interface DelegationCtx {
  now: number;
  pubkeys: Record<string, string>; // name -> pubHex for test identities
}

function tokenBody(t: DelegationToken): Record<string, JsonValue> {
  const body: Record<string, JsonValue> = {
    v: t.v,
    issuer_identity: t.issuer_identity,
    subject_identity: t.subject_identity,
    capability: t.capability,
    capability_version: t.capability_version,
    scope: { peers: t.scope.peers ?? null, max_uses: t.scope.max_uses } as unknown as JsonValue,
    issued_at: t.issued_at,
    expires_at: t.expires_at,
  };
  if (t.parent_hash !== undefined) body['parent_hash'] = t.parent_hash;
  return body;
}

export function signDelegationToken(t: Omit<DelegationToken, 'signature'>, signer: TestKeypair): string {
  const canon = canonicalize(tokenBody(t as DelegationToken));
  if (!canon.ok) throw new Error('delegation canon failed');
  return edSign(signer, Buffer.from(canon.value, 'utf8'));
}

export function verifyDelegationChain(chain: DelegationToken[], ctx: DelegationCtx): Result<{ leaf_subject: string; max_uses: number }, DelegationError> {
  if (chain.length === 0) return err('DELEGATION_INVALID');
  let prev: DelegationToken | null = null;
  for (const t of chain) {
    if (t.v !== 'nido-delegation/1') return err('DELEGATION_INVALID');
    const issuerPub = ctx.pubkeys[t.issuer_identity];
    if (!issuerPub) return err('DELEGATION_INVALID');
    const canon = canonicalize(tokenBody(t));
    if (!canon.ok) return err('DELEGATION_INVALID');
    if (!edVerify(issuerPub, Buffer.from(canon.value, 'utf8'), t.signature)) {
      return err('DELEGATION_INVALID');
    }
    if (!Number.isFinite(t.issued_at) || !Number.isFinite(t.expires_at)) return err('DELEGATION_INVALID');
    if (t.expires_at <= t.issued_at) return err('DELEGATION_INVALID');
    if (t.expires_at <= ctx.now) return err('DELEGATION_INVALID');
    if (!Number.isInteger(t.scope.max_uses) || t.scope.max_uses < 1) return err('DELEGATION_INVALID');
    if (prev) {
      // linkage
      if (t.issuer_identity !== prev.subject_identity) return err('DELEGATION_INVALID');
      // attenuation: never more authority downstream
      if (t.expires_at > prev.expires_at) return err('DELEGATION_INVALID');
      if (t.scope.max_uses > prev.scope.max_uses) return err('DELEGATION_INVALID');
      if (t.capability !== prev.capability || t.capability_version !== prev.capability_version) {
        return err('DELEGATION_INVALID');
      }
      if (prev.scope.peers !== undefined) {
        const childPeers = t.scope.peers ?? [];
        if (!childPeers.every((p) => prev!.scope.peers!.includes(p))) return err('DELEGATION_INVALID');
      }
    }
    prev = t;
  }
  const leaf = chain[chain.length - 1];
  return ok({ leaf_subject: leaf.subject_identity, max_uses: leaf.scope.max_uses });
}
