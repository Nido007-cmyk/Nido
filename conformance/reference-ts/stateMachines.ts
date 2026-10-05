// NIDO Protocol Conformance Suite v0 — reference-ts
// Reference state machines: TASK, NEGOTIATION, CONSENT, DELEGATION, REVOCATION.
//
// Tables are data (also published as vectors/v0/state_machines_tables.json).
// An invalid transition yields a DEFINED error, never an ambiguous state.

import { Result, ok, err } from './types';

export type MachineName = 'TASK' | 'NEGOTIATION' | 'CONSENT' | 'DELEGATION' | 'REVOCATION';

interface MachineDef {
  initial: string;
  terminal: string[];
  transitions: Record<string, Record<string, string>>;
}

export const MACHINES: Record<MachineName, MachineDef> = {
  TASK: {
    initial: 'REQUESTED',
    terminal: ['RESULT', 'ERROR', 'REJECTED', 'CANCELLED', 'EXPIRED'],
    transitions: {
      REQUESTED: { accept: 'ACCEPTED', reject: 'REJECTED', expire: 'EXPIRED', cancel: 'CANCELLED' },
      ACCEPTED: { start: 'IN_PROGRESS', cancel: 'CANCELLED', expire: 'EXPIRED', result: 'RESULT', error: 'ERROR' },
      IN_PROGRESS: { progress: 'IN_PROGRESS', result: 'RESULT', error: 'ERROR', cancel: 'CANCELLED', expire: 'EXPIRED' },
    },
  },
  NEGOTIATION: {
    initial: 'PROPOSED',
    terminal: ['ACCEPTED', 'DECLINED', 'EXPIRED'],
    transitions: {
      PROPOSED: { counter: 'COUNTERED', accept: 'ACCEPTED', decline: 'DECLINED', expire: 'EXPIRED' },
      COUNTERED: { counter: 'COUNTERED', accept: 'ACCEPTED', decline: 'DECLINED', expire: 'EXPIRED' },
    },
  },
  CONSENT: {
    initial: 'REQUESTED',
    terminal: ['DENIED', 'EXPIRED', 'CONSUMED', 'REVOKED'],
    transitions: {
      REQUESTED: { grant: 'GRANTED', deny: 'DENIED', expire: 'EXPIRED' },
      GRANTED: { use: 'GRANTED', consume: 'CONSUMED', revoke: 'REVOKED', expire: 'EXPIRED' },
    },
  },
  DELEGATION: {
    initial: 'ISSUED',
    terminal: ['REVOKED', 'EXPIRED', 'EXHAUSTED'],
    transitions: {
      ISSUED: { activate: 'ACTIVE', revoke: 'REVOKED', expire: 'EXPIRED' },
      ACTIVE: { use: 'ACTIVE', exhaust: 'EXHAUSTED', redelegate: 'ACTIVE', revoke: 'REVOKED', expire: 'EXPIRED' },
    },
  },
  REVOCATION: {
    initial: 'VALID',
    terminal: ['PROPAGATED', 'SUPERSEDED'],
    transitions: {
      VALID: { issue_revocation: 'REVOCATION_ISSUED', supersede: 'SUPERSEDED' },
      REVOCATION_ISSUED: { acknowledge: 'PROPAGATED', supersede: 'SUPERSEDED' },
    },
  },
};

export type TransitionError = 'INVALID_TRANSITION' | 'UNKNOWN_MACHINE' | 'UNKNOWN_STATE' | 'TERMINAL_STATE';

export function transition(
  machine: string,
  state: string,
  event: string
): Result<string, TransitionError> {
  const def = (MACHINES as Record<string, MachineDef>)[machine];
  if (!def) return err('UNKNOWN_MACHINE');
  if (def.terminal.includes(state)) return err('TERMINAL_STATE');
  const from = def.transitions[state];
  if (!from) return err('UNKNOWN_STATE');
  const to = from[event];
  if (!to) return err('INVALID_TRANSITION');
  return ok(to);
}

export function isTerminal(machine: MachineName, state: string): boolean {
  return MACHINES[machine].terminal.includes(state);
}
