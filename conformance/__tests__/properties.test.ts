// NIDO Protocol Conformance Suite v0
// Property / fuzz tests (seeded PRNG — deterministic across runs).
//
// These encode the security invariants as PROPERTIES, not just examples:
// a second implementation must satisfy them too.

import { describe, it, expect } from 'vitest';
import { parseStrict, JsonValue } from '../reference-ts/strictJson';
import { canonicalize } from '../reference-ts/canonicalize';
import { decidePolicy, PolicyRule, PolicyRequest, PolicyDecision, consumeBudget } from '../reference-ts/policy';
import { transition, MACHINES } from '../reference-ts/stateMachines';
import { runTaskSequence } from '../reference-ts/adapter';

// mulberry32 — deterministic seed
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FUZZ_ALPHABET = 'abcXYZ019 \t\n\r"\\{}[],:.-+eE_\u00e9\ud83d\ude00\0';

function randomString(r: () => number, maxLen: number): string {
  const n = Math.floor(r() * maxLen);
  let s = '';
  for (let i = 0; i < n; i++) s += FUZZ_ALPHABET[Math.floor(r() * FUZZ_ALPHABET.length)];
  return s;
}

function randomJson(r: () => number, depth: number): JsonValue {
  const pick = r();
  if (depth <= 0 || pick < 0.25) {
    const scalars: JsonValue[] = [null, true, false, 0, 1, -1, 1.5, -0, 'x', '', 'é'];
    return scalars[Math.floor(r() * scalars.length)];
  }
  if (pick < 0.6) {
    const n = Math.floor(r() * 4);
    const arr: JsonValue[] = [];
    for (let i = 0; i < n; i++) arr.push(randomJson(r, depth - 1));
    return arr;
  }
  const n = Math.floor(r() * 4);
  const obj: Record<string, JsonValue> = {};
  for (let i = 0; i < n; i++) obj[randomString(r, 6)] = randomJson(r, depth - 1);
  return obj;
}

describe('fuzz: strict parser never throws', () => {
  it('2000 random strings -> Result, never an exception', () => {
    const r = rng(0xC0FFEE);
    for (let i = 0; i < 2000; i++) {
      const s = randomString(r, 60);
      let res;
      try {
        res = parseStrict(s);
      } catch (e) {
        throw new Error(`parseStrict threw on ${JSON.stringify(s)}: ${e}`);
      }
      expect(typeof res.ok).toBe('boolean');
      if (res.ok) {
        // re-serializing and re-parsing must agree (no silent mutation)
        const again = parseStrict(JSON.stringify(res.value));
        expect(again.ok).toBe(true);
      }
    }
  });
});

describe('fuzz: canonicalization is deterministic and idempotent', () => {
  it('500 random values -> stable, re-canonicalizable', () => {
    const r = rng(0xB16B00B5);
    for (let i = 0; i < 500; i++) {
      const v = randomJson(r, 4);
      const c1 = canonicalize(v);
      const c2 = canonicalize(v);
      expect(c1).toEqual(c2);
      if (c1.ok) {
        const parsed = parseStrict(c1.value);
        expect(parsed.ok).toBe(true);
        if (parsed.ok) {
          const c3 = canonicalize(parsed.value);
          expect(c3).toEqual(c1); // idempotent
        }
      }
    }
  });
});

describe('fuzz: policy never throws; garbage never authorizes', () => {
  const rules: PolicyRule[] = [
    { subject: 'peer:AAA', capability: 'calendar.availability.query', version: 'v1', mode: 'AUTO' },
  ];
  it('1000 random requests -> Decision, invalid versions/capabilities DENY', () => {
    const r = rng(0xDECAFBAD);
    for (let i = 0; i < 1000; i++) {
      const req: PolicyRequest = {
        subject: randomString(r, 12),
        capability: randomString(r, 20),
        version: randomString(r, 6),
        peer: 'peer:AAA',
        now: 1800000000000,
      };
      const d: PolicyDecision = decidePolicy(rules, req);
      expect(['DENY', 'ASK_USER', 'ALLOW_ONCE', 'ALLOW_FOR_CONTACT', 'ALLOW_UNDER_CONDITIONS']).toContain(d);
      // a garbage capability can never match the pinned rule
      if (req.capability !== 'calendar.availability.query' || req.version !== 'v1' || req.subject !== 'peer:AAA') {
        expect(d).toBe('DENY');
      }
    }
  });
});

describe('fuzz: budget accounting is monotonic within a window', () => {
  it('random consume sequences: consumed never decreases', () => {
    const r = rng(0x5EED);
    for (let trial = 0; trial < 200; trial++) {
      let state = {};
      const opts = { budget: 100, window_ms: 3600000, now: 1800000000000 };
      let consumed = 0;
      for (let i = 0; i < 10; i++) {
        const units = 1 + Math.floor(r() * 30);
        const res = consumeBudget(state, "idA", units, opts);
        if (res.ok) {
          state = res.state;
          consumed += units;
          expect(res.remaining).toBe(100 - consumed);
        } else {
          expect(res.error).toBe('BUDGET_EXHAUSTED');
          // retry with same units keeps failing: no silent top-up
          const retry = consumeBudget(state, "idA", units, opts);
          expect(retry.ok).toBe(false);
        }
      }
    }
  });
});

describe('fuzz: state machines never throw; terminal stays terminal', () => {
  it('random event walks over all machines', () => {
    const r = rng(0x57A7E);
    const machines = Object.keys(MACHINES) as (keyof typeof MACHINES)[];
    const eventPool = ['accept', 'reject', 'start', 'progress', 'result', 'cancel', 'expire',
      'counter', 'decline', 'grant', 'deny', 'use', 'revoke', 'activate', 'redelegate',
      'issue_revocation', 'acknowledge', 'bogus', ''];
    for (let trial = 0; trial < 500; trial++) {
      const machine = machines[Math.floor(r() * machines.length)];
      const def = MACHINES[machine];
      let state = def.initial;
      let terminal: string | null = null;
      for (let i = 0; i < 8; i++) {
        const ev = eventPool[Math.floor(r() * eventPool.length)];
        let res;
        try {
          res = transition(machine, state, ev);
        } catch (e) {
          throw new Error(`transition threw on ${machine}/${state}/${ev}: ${e}`);
        }
        if (res.ok) {
          if (terminal !== null) throw new Error(`transition out of terminal ${terminal}`);
          state = res.value;
          if (def.terminal.includes(state)) terminal = state;
        } else {
          expect(['INVALID_TRANSITION', 'TERMINAL_STATE', 'UNKNOWN_MACHINE', 'UNKNOWN_STATE']).toContain(res.error);
        }
      }
    }
  });

  it('DENY never becomes ALLOW by composing rules', () => {
    const r = rng(1103515245);
    for (let trial = 0; trial < 300; trial++) {
      const rules: PolicyRule[] = [];
      const n = 1 + Math.floor(r() * 4);
      let hasExactDeny = false;
      for (let i = 0; i < n; i++) {
        const mode = r() < 0.5 ? 'DENY' : 'AUTO';
        const rule: PolicyRule = {
          subject: 'peer:AAA', capability: 'cap.x', version: 'v1', mode,
        };
        if (mode === 'DENY') hasExactDeny = true;
        rules.push(rule);
      }
      const d: PolicyDecision = decidePolicy(rules, {
        subject: 'peer:AAA', capability: 'cap.x', version: 'v1', peer: 'peer:AAA', now: 1,
      });
      if (hasExactDeny) expect(d).toBe('DENY');
      else expect(d).toBe('ALLOW_FOR_CONTACT');
    }
  });

  it('duplicate task_ids never increase executed side effects', () => {
    const r = rng(123456789);
    const pool = ['t1', 't2', 't3', 't4'];
    for (let trial = 0; trial < 300; trial++) {
      const seq: string[] = [];
      const n = Math.floor(r() * 8);
      for (let i = 0; i < n; i++) seq.push(pool[Math.floor(r() * pool.length)]);
      const res = runTaskSequence(seq);
      const unique = new Set(seq).size;
      expect(res.executed_count).toBe(unique);
      expect(res.duplicates_rejected).toBe(seq.length - unique);
    }
  });
});
