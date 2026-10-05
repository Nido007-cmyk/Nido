// NIDO Protocol Conformance Suite v0 — reference-ts
// Minimal deterministic policy decision function.
//
// A rule pins: subject, capability, EXACT version. Version mismatch -> DENY
// (AUTONOMY_NON_EXPANSION: updates never widen prior authority).
// Unknown subject/capability -> DENY. Expired rule -> DENY.
// Constraints are checked only after mode allows; they can only narrow.

import { Result, ok, err } from './types';
import { JsonValue } from './strictJson';

export type PolicyMode = 'AUTO' | 'ASK' | 'DENY';
export type PolicyDecision =
  | 'DENY'
  | 'ASK_USER'
  | 'ALLOW_ONCE'
  | 'ALLOW_FOR_CONTACT'
  | 'ALLOW_UNDER_CONDITIONS';

export interface PolicyConstraints {
  max_window_ms?: number;
  min_granularity_ms?: number;
  peers?: string[]; // allowed peer identities
  max_disclosure_units?: number;
}

export interface PolicyRule {
  subject: string;      // 'local' | 'peer:<pubkey>' | 'any'
  capability: string;   // e.g. 'calendar.availability.query'
  version: string;      // EXACT pinned version, e.g. 'v1'
  mode: PolicyMode;
  constraints?: PolicyConstraints;
  expires_at?: number;  // ms epoch; rule dead after this
}

export interface PolicyRequest {
  subject: string;
  capability: string;
  version: string;
  peer: string;
  now: number;
  window_ms?: number;
  granularity_ms?: number;
  disclosure_units?: number;
}

export function decidePolicy(rules: PolicyRule[], req: PolicyRequest): PolicyDecision {
  const candidates = rules.filter(
    (r) => r.subject === req.subject && r.capability === req.capability
  );
  if (candidates.length === 0) return 'DENY';
  // Version pinning: a rule for v1 never authorizes v2.
  const pinned = candidates.filter((r) => r.version === req.version);
  if (pinned.length === 0) return 'DENY';
  // Liveness boundary (AMB-06, pinned 2026-09-27): a rule carrying expires_at
  // is live iff now < expires_at; at now == expires_at it is already dead.
  const live = pinned.filter((r) => r.expires_at === undefined || req.now < r.expires_at);
  if (live.length === 0) return 'DENY';
  if (live.some((r) => r.mode === 'DENY')) return 'DENY';
  const ask = live.find((r) => r.mode === 'ASK');
  const auto = live.find((r) => r.mode === 'AUTO');
  if (ask && !auto) return 'ASK_USER';
  if (!auto) return 'DENY';
  const c = auto.constraints ?? {};
  if (c.peers !== undefined && !c.peers.includes(req.peer)) return 'DENY';
  if (c.max_window_ms !== undefined && (req.window_ms ?? 0) > c.max_window_ms) return 'DENY';
  if (c.min_granularity_ms !== undefined && (req.granularity_ms ?? 0) < c.min_granularity_ms) return 'DENY';
  if (c.max_disclosure_units !== undefined && (req.disclosure_units ?? 0) > c.max_disclosure_units) return 'DENY';
  const hasConstraints = Object.keys(c).length > 0;
  if (req.subject.startsWith('peer:')) return hasConstraints ? 'ALLOW_UNDER_CONDITIONS' : 'ALLOW_FOR_CONTACT';
  return hasConstraints ? 'ALLOW_UNDER_CONDITIONS' : 'ALLOW_ONCE';
}

export type BudgetError = 'BUDGET_EXHAUSTED' | 'BUDGET_INVALID';

// Privacy budget accounting. Keyed by IDENTITY (not device, not transport, not
// capability): splitting a query across capabilities/devices/transports must
// not evade the budget (DISCLOSURE_ACCOUNTING, TRANSPORT_INDEPENDENCE).
export interface BudgetWindow {
  window_start: number;
  consumed: number;
}
export type BudgetState = Record<string, BudgetWindow>;

export interface BudgetOpts {
  budget: number;      // max units per window
  window_ms: number;
  now: number;
}

export function consumeBudget(
  state: BudgetState,
  identity: string,
  units: number,
  opts: BudgetOpts
): { ok: true; state: BudgetState; remaining: number } | { ok: false; error: BudgetError } {
  if (!Number.isFinite(units) || units < 0) return { ok: false, error: 'BUDGET_INVALID' };
  const w = state[identity];
  let window_start: number;
  let consumed: number;
  if (!w || opts.now - w.window_start >= opts.window_ms) {
    window_start = opts.now;
    consumed = 0;
  } else {
    window_start = w.window_start;
    consumed = w.consumed;
  }
  if (consumed + units > opts.budget) return { ok: false, error: 'BUDGET_EXHAUSTED' };
  const next: BudgetState = { ...state, [identity]: { window_start, consumed: consumed + units } };
  return { ok: true, state: next, remaining: opts.budget - (consumed + units) };
}

// Minimum disclosure: allowlist projection. Anything not listed is dropped.
// Paths: 'a.b.c' for nested objects; 'arr[].field' projects `field` from each
// element of array `arr` (elements must be objects).
export function projectDisclosed(value: JsonValue, allowedPaths: string[]): JsonValue {
  if (allowedPaths.length === 0) return null;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const rec = value as Record<string, JsonValue>;
  const out: Record<string, JsonValue> = {};
  for (const p of allowedPaths) {
    const m = p.match(/^([A-Za-z0-9_]+)\[\]\.([A-Za-z0-9_.]+)$/);
    if (m) {
      const arr = rec[m[1]];
      if (!Array.isArray(arr)) continue;
      out[m[1]] = arr.map((el) => projectDisclosed(el, [m[2]]));
      continue;
    }
    const seg = p.split('.');
    let src: JsonValue = rec;
    const chain: { parent: Record<string, JsonValue>; key: string }[] = [];
    let okPath = true;
    for (const s of seg) {
      if (src === null || typeof src !== 'object' || Array.isArray(src) || !(s in src)) {
        okPath = false;
        break;
      }
      chain.push({ parent: src as Record<string, JsonValue>, key: s });
      src = (src as Record<string, JsonValue>)[s];
    }
    if (!okPath) continue;
    // rebuild nested structure in `out`
    let dst = out;
    for (let i = 0; i < chain.length - 1; i++) {
      const k = chain[i].key;
      if (typeof dst[k] !== 'object' || dst[k] === null || Array.isArray(dst[k])) dst[k] = {};
      dst = dst[k] as Record<string, JsonValue>;
    }
    const last = chain[chain.length - 1];
    dst[last.key] = last.parent[last.key];
  }
  return out;
}

// Graph-level disclosure accounting: sum declared units across nodes; the
// aggregate must fit the requester's budget. Composition of individually-OK
// nodes must not smuggle excess disclosure (C-3).
export function graphDisclosure(
  nodes: { id: string; disclosed_units: number }[],
  budget: number
): Result<{ total: number }, 'GRAPH_BUDGET_EXCEEDED' | 'GRAPH_INVALID'> {
  let total = 0;
  for (const n of nodes) {
    if (!Number.isFinite(n.disclosed_units) || n.disclosed_units < 0) {
      return err('GRAPH_INVALID');
    }
    total += n.disclosed_units;
  }
  if (total > budget) return err('GRAPH_BUDGET_EXCEEDED');
  return ok({ total });
}
