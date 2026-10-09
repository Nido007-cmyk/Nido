/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

// NIDO Protocol Conformance Suite v0
// Vector generator: source/ (hand-authored) -> final/ (official, committed).
//
// Run with CONFORMANCE_GEN=1 to (re)generate final/*.json + manifest.json +
// state_machines_tables.json. Without it, this test regenerates in memory and
// asserts the committed files are byte-identical in content (freshness check).

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { canonicalize } from '../reference-ts/canonicalize';
import { sha256HexUtf8 } from '../reference-ts/hash';
import { edSign, TEST_KEYS } from '../reference-ts/sig';
import { makeTestDeviceCert } from '../reference-ts/envelope';
import { signDelegationToken } from '../reference-ts/delegation';
import { parseStrict, JsonValue } from '../reference-ts/strictJson';
import { MACHINES } from '../reference-ts/stateMachines';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', 'vectors', 'v0', 'source');
const FINAL = join(HERE, '..', 'vectors', 'v0', 'final');
const GEN = process.env.CONFORMANCE_GEN === '1';

type AnyObj = Record<string, any>;

function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x));
}

function isPlainObj(x: unknown): x is AnyObj {
  return x !== null && typeof x === 'object' && !Array.isArray(x);
}

function deepMerge(target: AnyObj, patch: AnyObj): AnyObj {
  for (const k of Object.keys(patch)) {
    if (isPlainObj(patch[k]) && isPlainObj(target[k])) deepMerge(target[k], patch[k]);
    else target[k] = clone(patch[k]);
  }
  return target;
}

function resolveAliases(x: any): any {
  if (typeof x === 'string') {
    if (x.startsWith('peer:alias:')) {
      const name = x.slice('peer:alias:'.length);
      if (!TEST_KEYS[name]) throw new Error('unknown alias ' + name);
      return 'peer:' + TEST_KEYS[name].pubHex;
    }
    if (x.startsWith('alias:')) {
      const name = x.slice('alias:'.length);
      if (!TEST_KEYS[name]) throw new Error('unknown alias ' + name);
      return TEST_KEYS[name].pubHex;
    }
    return x;
  }
  if (Array.isArray(x)) return x.map(resolveAliases);
  if (isPlainObj(x)) {
    const out: AnyObj = {};
    for (const k of Object.keys(x)) out[k] = resolveAliases(x[k]);
    return out;
  }
  return x;
}

function getPath(obj: AnyObj, path: string): { parent: AnyObj; key: string } {
  const seg = path.split('.');
  let cur: any = obj;
  for (let i = 0; i < seg.length - 1; i++) {
    cur = cur[seg[i]];
    if (!isPlainObj(cur)) throw new Error('bad path ' + path);
  }
  return { parent: cur as AnyObj, key: seg[seg.length - 1] };
}

function applyOp(obj: AnyObj, op: AnyObj): void {
  if (op.op === 'set') {
    const { parent, key } = getPath(obj, op.path);
    parent[key] = clone(op.value);
  } else if (op.op === 'delete') {
    const { parent, key } = getPath(obj, op.path);
    delete parent[key];
  } else if (op.op === 'reorder') {
    const keys = Object.keys(obj).reverse();
    const copy: AnyObj = {};
    for (const k of keys) copy[k] = obj[k];
    for (const k of Object.keys(obj)) delete obj[k];
    Object.assign(obj, copy);
  } else {
    throw new Error('unknown op ' + op.op);
  }
}

function genEnvelope(v: AnyObj, bases: Map<string, AnyObj>): AnyObj {
  // hand-written raw vectors (parser-level attacks): pass through
  if (!v.base && v.input_raw) {
    const out: AnyObj = {
      id: v.id, title: v.title, category: v.category, kind: v.kind,
      input_raw: v.input_raw, expected: v.expected,
    };
    if (v.input !== undefined) out.input = resolveAliases(clone(v.input));
    return out;
  }
  const base = bases.get(v.base);
  if (!base) throw new Error('unknown base ' + v.base);
  const obj = deepMerge(clone(base), clone(v.patch ?? {}));
  for (const p of v.delete ?? []) {
    const { parent, key } = getPath(obj, p);
    delete parent[key];
  }
  const certSpec = v.cert !== undefined ? v.cert : obj.cert;
  const signDevice = v.sign_device ?? obj.sign.device;
  const ctx = deepMerge(clone(obj.ctx ?? {}), clone(v.ctx_override ?? {}));
  delete obj.sign;
  delete obj.cert;
  delete obj.ctx;
  const resolved = resolveAliases(obj);
  if (certSpec) {
    resolved.sender.device_cert = makeTestDeviceCert(
      certSpec.device, certSpec.identity, certSpec.issued_at, certSpec.expires_at
    );
  }
  for (const op of v.pre ?? []) applyOp(resolved, op);
  const body = clone(resolved);
  delete body.signature;
  const canon = canonicalize(body as JsonValue);
  if (!canon.ok) throw new Error('envelope canon failed for ' + v.id);
  resolved.signature = edSign(TEST_KEYS[signDevice], Buffer.from(canon.value, 'utf8'));
  for (const op of v.tamper ?? []) applyOp(resolved, op);
  return {
    id: v.id, title: v.title, category: v.category, kind: v.kind,
    input_raw: JSON.stringify(resolved),
    input: { ctx: resolveAliases(ctx) },
    expected: v.expected,
  };
}

function genSignature(v: AnyObj): AnyObj {
  const input = resolveAliases(clone(v.input));
  if (input.sign_by) {
    const msg = input.sign_over ?? input.message;
    let sig = edSign(TEST_KEYS[input.sign_by], Buffer.from(msg, 'utf8'));
    if (input.truncate_sig) sig = sig.slice(0, input.truncate_sig * 2);
    input.signature = sig;
    delete input.sign_by;
    delete input.sign_over;
    delete input.truncate_sig;
  }
  return { id: v.id, title: v.title, category: v.category, kind: v.kind, input, expected: v.expected };
}

function genDelegation(v: AnyObj, bases: Map<string, AnyObj>): AnyObj {
  let chain: AnyObj[];
  let now: number;
  let pubkeys: AnyObj;
  if (v.base) {
    const base = bases.get(v.base);
    if (!base) throw new Error('unknown base ' + v.base);
    chain = clone(base) as AnyObj[];
    const ctxb = bases.get('ctx_base');
    if (!ctxb) throw new Error('ctx_base missing');
    now = v.now ?? ctxb.now;
    pubkeys = v.pubkeys ?? ctxb.pubkeys;
    for (const [i, patch] of Object.entries(v.chain_patch ?? {})) {
      deepMerge(chain[Number(i)], patch as AnyObj);
    }
    if (v.root_patch) deepMerge(chain[0], v.root_patch);
  } else {
    chain = clone(v.input.chain);
    now = v.input.now;
    pubkeys = v.input.pubkeys;
  }
  for (const token of chain) {
    const signBy = token.sign_by;
    delete token.sign_by;
    token.signature = signDelegationToken(token as any, TEST_KEYS[signBy]);
  }
  for (const t of v.tamper_chain ?? []) {
    const idx = t.index ?? chain.length - 1;
    const { parent, key } = getPath(chain[idx], t.path);
    parent[key] = clone(t.value);
  }
  const input = resolveAliases({ chain, now, pubkeys });
  return { id: v.id, title: v.title, category: v.category, kind: v.kind, input, expected: v.expected };
}

function genConsent(v: AnyObj): AnyObj {
  const input = resolveAliases(clone(v.input));
  for (const side of ['grant', 'request']) {
    if (input[side].parameters_hash === 'COMPUTE') {
      const canon = canonicalize(input[side].parameters as JsonValue);
      if (!canon.ok) throw new Error('consent canon failed');
      input[side].parameters_hash = sha256HexUtf8(canon.value);
    }
  }
  return { id: v.id, title: v.title, category: v.category, kind: v.kind, input, expected: v.expected };
}

function genCanonicalization(v: AnyObj): AnyObj {
  const expected = clone(v.expected);
  if (expected.canonical === 'COMPUTE') {
    const parsed = parseStrict(v.input_raw);
    if (!parsed.ok) throw new Error('COMPUTE on invalid input ' + v.id);
    const canon = canonicalize(parsed.value);
    if (!canon.ok) throw new Error('canon failed ' + v.id);
    expected.canonical = canon.value;
    expected.sha256 = sha256HexUtf8(canon.value);
  }
  return { id: v.id, title: v.title, category: v.category, kind: v.kind, input_raw: v.input_raw, expected };
}

function genPassthrough(v: AnyObj): AnyObj {
  const out: AnyObj = { id: v.id, title: v.title, category: v.category, kind: v.kind, expected: v.expected };
  if (v.input_raw !== undefined) out.input_raw = v.input_raw;
  if (v.input !== undefined) out.input = resolveAliases(clone(v.input));
  return out;
}

function generateAll(): { files: Map<string, AnyObj[]>; manifest: AnyObj; tables: AnyObj } {
  const bases = new Map<string, AnyObj>();
  const srcFiles = readdirSync(SRC).filter((f) => f.endsWith('.json')).sort();
  const rawFiles = new Map<string, AnyObj>();
  for (const f of srcFiles) {
    const data = JSON.parse(readFileSync(join(SRC, f), 'utf8'));
    rawFiles.set(f, data);
    if (data.bases) for (const [k, b] of Object.entries(data.bases)) bases.set(k, b as AnyObj);
  }
  const files = new Map<string, AnyObj[]>();
  for (const [f, data] of rawFiles) {
    const out: AnyObj[] = [];
    for (const v of data.vectors) {
      try {
        switch (v.kind) {
          case 'envelope': out.push(genEnvelope(v, bases)); break;
          case 'signature': out.push(genSignature(v)); break;
          case 'delegation': out.push(genDelegation(v, bases)); break;
          case 'consent': out.push(genConsent(v)); break;
          case 'canonicalization': out.push(genCanonicalization(v)); break;
          default: out.push(genPassthrough(v));
        }
      } catch (e) {
        throw new Error(`gen failed for ${f}:${v.id}: ${(e as Error).message}`);
      }
    }
    files.set(f, out);
  }
  const totals: AnyObj = { valid: 0, invalid: 0, boundary: 0, adversarial: 0, total: 0 };
  const fileList: AnyObj[] = [];
  for (const [f, vecs] of files) {
    for (const vec of vecs) {
      totals[vec.category] = (totals[vec.category] ?? 0) + 1;
      totals.total++;
    }
    fileList.push({ file: f, vectors: vecs.length });
  }
  const manifest = { suite: 'nido-conformance', suite_version: '0', files: fileList, totals };
  const tables = { suite: 'nido-conformance', suite_version: '0', machines: MACHINES };
  return { files, manifest, tables };
}

describe('conformance vector generation', () => {
  it('generates (or verifies fresh) official vectors', () => {
    const { files, manifest, tables } = generateAll();
    if (GEN) {
      mkdirSync(FINAL, { recursive: true });
      for (const [f, vecs] of files) {
        writeFileSync(join(FINAL, f), JSON.stringify({ suite: 'nido-conformance', suite_version: '0', vectors: vecs }, null, 2) + '\n');
      }
      writeFileSync(join(FINAL, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
      writeFileSync(join(FINAL, 'state_machines_tables.json'), JSON.stringify(tables, null, 2) + '\n');
      return;
    }
    // freshness check against committed files
    for (const [f, vecs] of files) {
      const committed = JSON.parse(readFileSync(join(FINAL, f), 'utf8'));
      expect(committed.vectors).toEqual(vecs);
    }
    expect(JSON.parse(readFileSync(join(FINAL, 'manifest.json'), 'utf8'))).toEqual(manifest);
    expect(JSON.parse(readFileSync(join(FINAL, 'state_machines_tables.json'), 'utf8'))).toEqual(tables);
  });
});
