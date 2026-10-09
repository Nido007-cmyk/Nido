/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

// NIDO Protocol Conformance Suite v0 — reference-ts
// Conformance adapter: vector -> normalized result.
//
// This is the ONLY TS-specific piece of the harness. Any other implementation
// (Rust, Kotlin, Swift) must accept the same vector JSON files and produce
// the same normalized result JSON. See ../harness/protocol.md.

import { parseStrict, JsonValue } from './strictJson';
import { canonicalize } from './canonicalize';
import { sha256HexUtf8 } from './hash';
import { edVerify, TEST_KEYS } from './sig';
import { validateEnvelope, ValidateCtx } from './envelope';
import {
  decidePolicy, consumeBudget, projectDisclosed, graphDisclosure,
  PolicyRule, PolicyRequest, BudgetState,
} from './policy';
import { verifyDelegationChain, DelegationToken } from './delegation';
import { checkConsent, ConsentGrant, ConsentRequest } from './consent';
import { negotiateVersion, negotiateCapabilityVersion, CapabilityRegistry } from './versions';
import { transition, MACHINES } from './stateMachines';

export type VectorKind =
  | 'canonicalization' | 'envelope' | 'signature' | 'policy'
  | 'budget' | 'disclosure' | 'graph' | 'delegation' | 'consent'
  | 'protocol_version' | 'capability_version' | 'extension'
  | 'state_machine' | 'idempotency';

export interface Vector {
  id: string;
  title: string;
  category: 'valid' | 'invalid' | 'boundary' | 'adversarial';
  kind: VectorKind;
  input?: unknown;
  input_raw?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [k: string]: any;
}

function asJson(v: unknown): JsonValue {
  return v as JsonValue;
}

function resolvePubkey(aliasOrHex: string): string | null {
  if (TEST_KEYS[aliasOrHex]) return TEST_KEYS[aliasOrHex].pubHex;
  if (/^[0-9a-f]{64}$/.test(aliasOrHex)) return aliasOrHex;
  return null;
}

function runCanonicalization(v: Vector): unknown {
  const raw = v.input_raw as string;
  const parsed = parseStrict(raw);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const canon = canonicalize(parsed.value);
  if (!canon.ok) return { ok: false, error: canon.error };
  return { ok: true, canonical: canon.value, sha256: sha256HexUtf8(canon.value) };
}

function runEnvelope(v: Vector): unknown {
  const raw = v.input_raw as string;
  const input = (v.input ?? {}) as Record<string, unknown>;
  const ctxIn = (input['ctx'] ?? {}) as Partial<ValidateCtx>;
  const ctx: Partial<ValidateCtx> = { ...ctxIn };
  if (Array.isArray(ctxIn.seen)) ctx.seen = new Set(ctxIn.seen as string[]);
  const r = validateEnvelope(raw, ctx);
  if (!r.ok) return { ok: false, error: r.error };
  return {
    ok: true,
    message_type: r.value.message_type,
    task_id: r.value.task_id,
    sender_device: r.value.sender_device,
  };
}

function runSignature(v: Vector): unknown {
  const input = v.input as { key: string; message: string; signature: string };
  const pub = resolvePubkey(input.key);
  if (!pub) return { ok: false, error: 'UNKNOWN_KEY' };
  const good = edVerify(pub, Buffer.from(input.message, 'utf8'), input.signature);
  return good ? { ok: true } : { ok: false, error: 'BAD_SIGNATURE' };
}

function runPolicy(v: Vector): unknown {
  const input = v.input as { rules: PolicyRule[]; request: PolicyRequest };
  return { ok: true, decision: decidePolicy(input.rules, input.request) };
}

function runBudget(v: Vector): unknown {
  const input = v.input as {
    state: BudgetState; steps: { identity: string; units: number }[];
    opts: { budget: number; window_ms: number; now: number };
  };
  let state = input.state;
  for (let i = 0; i < input.steps.length; i++) {
    const s = input.steps[i];
    const r = consumeBudget(state, s.identity, s.units, input.opts);
    if (!r.ok) return { ok: false, error: r.error, at_step: i };
    state = r.state;
    if (i === input.steps.length - 1) return { ok: true, remaining: r.remaining };
  }
  return { ok: true, remaining: input.opts.budget };
}

function runDisclosure(v: Vector): unknown {
  const input = v.input as { value: JsonValue; allowed: string[] };
  return { ok: true, projected: projectDisclosed(asJson(input.value), input.allowed) };
}

function runGraph(v: Vector): unknown {
  const input = v.input as { nodes: { id: string; disclosed_units: number }[]; budget: number };
  const r = graphDisclosure(input.nodes, input.budget);
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, total: r.value.total };
}

function runDelegation(v: Vector): unknown {
  const input = v.input as { chain: DelegationToken[]; now: number; pubkeys: Record<string, string> };
  const pubkeys: Record<string, string> = {};
  for (const [k, alias] of Object.entries(input.pubkeys)) {
    const p = resolvePubkey(alias);
    if (!p) return { ok: false, error: 'UNKNOWN_KEY' };
    pubkeys[k] = p;
  }
  const r = verifyDelegationChain(input.chain, { now: input.now, pubkeys });
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, leaf_subject: r.value.leaf_subject, max_uses: r.value.max_uses };
}

function runConsent(v: Vector): unknown {
  const input = v.input as { grant: ConsentGrant; request: ConsentRequest };
  const r = checkConsent(input.grant, input.request);
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, uses_left: r.value.uses_left };
}

function runProtocolVersion(v: Vector): unknown {
  const input = v.input as { localMin: string; localMax: string; peerMin: string; peerMax: string };
  const r = negotiateVersion(input.localMin, input.localMax, input.peerMin, input.peerMax);
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, version: r.value };
}

function runCapabilityVersion(v: Vector): unknown {
  const input = v.input as { local: string[]; peer: string[] };
  const r = negotiateCapabilityVersion(input.local, input.peer);
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, version: r.value };
}

function runExtension(v: Vector): unknown {
  const input = v.input as { core: string[]; attempts: string[] };
  const reg = new CapabilityRegistry();
  for (const c of input.core) reg.registerCore(c);
  const results: string[] = [];
  for (const name of input.attempts ?? []) {
    const r = reg.registerExtension(name);
    results.push(r.ok ? 'ok' : r.error);
  }
  return { ok: true, results };
}

function runStateMachine(v: Vector): unknown {
  const input = v.input as { machine: string; events: string[] };
  const def = (MACHINES as Record<string, { initial: string }>)[input.machine];
  if (!def) return { ok: false, error: 'UNKNOWN_MACHINE' };
  let state = def.initial;
  for (let i = 0; i < input.events.length; i++) {
    const r = transition(input.machine, state, input.events[i]);
    if (!r.ok) return { ok: false, error: r.error, at_event: i };
    state = r.value;
  }
  return { ok: true, final: state };
}

export function runTaskSequence(ids: string[]): {
  ok: true; log: string[]; duplicates_rejected: number; executed_count: number;
} {
  const executed = new Set<string>();
  const log: string[] = [];
  let duplicates = 0;
  for (const id of ids) {
    if (executed.has(id)) {
      duplicates++;
      log.push('DUPLICATE');
    } else {
      executed.add(id);
      log.push('EXECUTED');
    }
  }
  return { ok: true, log, duplicates_rejected: duplicates, executed_count: executed.size };
}

function runIdempotency(v: Vector): unknown {
  const input = v.input as { task_ids: string[] };
  return runTaskSequence(input.task_ids);
}

export function runVector(v: Vector): unknown {
  switch (v.kind) {
    case 'canonicalization': return runCanonicalization(v);
    case 'envelope': return runEnvelope(v);
    case 'signature': return runSignature(v);
    case 'policy': return runPolicy(v);
    case 'budget': return runBudget(v);
    case 'disclosure': return runDisclosure(v);
    case 'graph': return runGraph(v);
    case 'delegation': return runDelegation(v);
    case 'consent': return runConsent(v);
    case 'protocol_version': return runProtocolVersion(v);
    case 'capability_version': return runCapabilityVersion(v);
    case 'extension': return runExtension(v);
    case 'state_machine': return runStateMachine(v);
    case 'idempotency': return runIdempotency(v);
    default: return { ok: false, error: 'UNKNOWN_VECTOR_KIND' };
  }
}
