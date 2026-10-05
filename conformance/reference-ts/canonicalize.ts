// NIDO Protocol Conformance Suite v0 — reference-ts
// RFC 8785 (JCS) canonicalization.
//
// Decisions (recorded in SPEC_AMBIGUITIES.md, provisional for v0):
//  - object keys sorted by UTF-16 code units (JS default string order)
//  - strings: only `"`, `\` and U+0000-U+001F escaped; controls as \uXXXX
//    (lowercase hex, NO short escapes like \n)
//  - numbers: integers with |n| < 2^53 as-is; -0 -> "0";
//    other finite numbers via shortest round-trip (JS String(n));
//    non-finite -> error (they are not valid JSON anyway)
//  - lone surrogates -> error
//  - no whitespace, UTF-8 output (caller encodes)

import { Result, ok, err } from './types';
import { JsonValue } from './strictJson';

export type CanonError = 'NON_FINITE_NUMBER' | 'LONE_SURROGATE' | 'UNREPRESENTABLE';

function escapeString(s: string): Result<string, CanonError> {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code === 0x22) out += '\\"';
    else if (code === 0x5c) out += '\\\\';
    else if (code < 0x20) out += '\\u' + code.toString(16).padStart(4, '0');
    else if (code >= 0xd800 && code <= 0xdbff) {
      const lo = s.charCodeAt(i + 1);
      if (lo >= 0xdc00 && lo <= 0xdfff) {
        out += s[i] + s[i + 1];
        i++;
      } else {
        return err('LONE_SURROGATE');
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return err('LONE_SURROGATE');
    } else {
      out += s[i];
    }
  }
  out += '"';
  return ok(out);
}

function canonNumber(n: number): Result<string, CanonError> {
  if (!Number.isFinite(n)) return err('NON_FINITE_NUMBER');
  if (Object.is(n, -0)) return ok('0');
  // Integers: shortest form. The strict parser already rejected literals that
  // would silently lose precision; exactly-representable large integers
  // (e.g. 1e21) serialize via shortest round-trip ("1e+21").
  if (Number.isInteger(n)) return ok(String(n));
  // Shortest round-trip decimal representation.
  return ok(String(n));
}

function canonValue(v: JsonValue): Result<string, CanonError> {
  if (v === null) return ok('null');
  if (v === true) return ok('true');
  if (v === false) return ok('false');
  if (typeof v === 'number') return canonNumber(v);
  if (typeof v === 'string') return escapeString(v);
  if (Array.isArray(v)) {
    const parts: string[] = [];
    for (const item of v) {
      const r = canonValue(item);
      if (!r.ok) return r;
      parts.push(r.value);
    }
    return ok('[' + parts.join(',') + ']');
  }
  // object: sort keys by UTF-16 code units
  const keys = Object.keys(v).sort();
  const parts: string[] = [];
  for (const k of keys) {
    const kr = escapeString(k);
    if (!kr.ok) return kr;
    const vr = canonValue(v[k]);
    if (!vr.ok) return vr;
    parts.push(kr.value + ':' + vr.value);
  }
  return ok('{' + parts.join(',') + '}');
}

export function canonicalize(v: JsonValue): Result<string, CanonError> {
  return canonValue(v);
}
