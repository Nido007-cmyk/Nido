/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

// NIDO Protocol Conformance Suite v0 — reference-ts
// Strict JSON parser for the conformance suite.
//
// Differences vs JSON.parse (deliberate, spec-driven):
//  - duplicate object keys        -> PARSE_ERROR (JSON.parse keeps the last)
//  - trailing data after value     -> PARSE_ERROR
//  - lone surrogates               -> PARSE_ERROR
//  - unescaped control chars       -> PARSE_ERROR
//  - integers with |n| >= 2^53     -> UNSAFE_INTEGER (precision loss is silent corruption)
//  - non-standard grammar          -> PARSE_ERROR
//
// This parser must NEVER throw on arbitrary input: it returns a Result.

import { Result, ok, err } from './types';

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [k: string]: JsonValue };

export type ParseError = 'PARSE_ERROR' | 'UNSAFE_INTEGER' | 'DUPLICATE_FIELD';

// True iff the decimal literal denotes exactly the integer value of the
// parsed double (e.g. "1e21" is exact; "9007199254740993" is not).
function exactIntegerLiteral(raw: string, n: number): boolean {
  const m = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(raw);
  if (!m) return false;
  const neg = m[1] === '-';
  const digits = (m[2] + (m[3] ?? '')).replace(/^0+/, '') || '0';
  const exp10 = (m[4] ? parseInt(m[4], 10) : 0) - (m[3] ?? '').length;
  let value: bigint;
  if (exp10 >= 0) {
    value = BigInt(digits) * 10n ** BigInt(exp10);
  } else {
    const div = 10n ** BigInt(-exp10);
    const num = BigInt(digits);
    if (num % div !== 0n) return false;
    value = num / div;
  }
  if (neg) value = -value;
  try {
    return BigInt(n) === value;
  } catch {
    return false;
  }
}

class P {
  pos = 0;
  constructor(readonly s: string) {}

  fail(): never {
    throw new Error('parse');
  }

  peek(): string {
    return this.s[this.pos];
  }

  ws(): void {
    while (this.pos < this.s.length) {
      const c = this.s[this.pos];
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') this.pos++;
      else break;
    }
  }

  value(): JsonValue {
    this.ws();
    if (this.pos >= this.s.length) this.fail();
    const c = this.peek();
    if (c === '{') return this.object();
    if (c === '[') return this.array();
    if (c === '"') return this.string();
    if (c === 't') return this.lit('true', true);
    if (c === 'f') return this.lit('false', false);
    if (c === 'n') return this.lit('null', null);
    if (c === '-' || (c >= '0' && c <= '9')) return this.number();
    this.fail();
  }

  lit(word: string, v: JsonValue): JsonValue {
    if (this.s.startsWith(word, this.pos)) {
      this.pos += word.length;
      return v;
    }
    this.fail();
  }

  string(): string {
    // assumes peek() === '"'
    this.pos++;
    let out = '';
    while (true) {
      if (this.pos >= this.s.length) this.fail();
      const c = this.s[this.pos];
      if (c === '"') {
        this.pos++;
        return out;
      }
      if (c === '\\') {
        out += this.escape();
        continue;
      }
      const code = c.charCodeAt(0);
      if (code < 0x20) this.fail(); // unescaped control
      if (code >= 0xd800 && code <= 0xdbff) {
        // high surrogate must be followed by low surrogate
        const lo = this.s.charCodeAt(this.pos + 1);
        if (lo >= 0xdc00 && lo <= 0xdfff) {
          out += c + this.s[this.pos + 1];
          this.pos += 2;
          continue;
        }
        this.fail(); // lone high surrogate
      }
      if (code >= 0xdc00 && code <= 0xdfff) this.fail(); // lone low surrogate
      out += c;
      this.pos++;
    }
  }

  escape(): string {
    this.pos++; // consume backslash
    if (this.pos >= this.s.length) this.fail();
    const c = this.s[this.pos];
    switch (c) {
      case '"': this.pos++; return '"';
      case '\\': this.pos++; return '\\';
      case '/': this.pos++; return '/';
      case 'b': this.pos++; return '\b';
      case 'f': this.pos++; return '\f';
      case 'n': this.pos++; return '\n';
      case 'r': this.pos++; return '\r';
      case 't': this.pos++; return '\t';
      case 'u': {
        const hex = this.s.slice(this.pos + 1, this.pos + 5);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) this.fail();
        const hi = parseInt(hex, 16);
        this.pos += 5;
        if (hi >= 0xd800 && hi <= 0xdbff) {
          // must be followed by \uDC00-\uDFFF
          if (this.s[this.pos] === '\\' && this.s[this.pos + 1] === 'u') {
            const hex2 = this.s.slice(this.pos + 2, this.pos + 6);
            if (/^[0-9a-fA-F]{4}$/.test(hex2)) {
              const lo = parseInt(hex2, 16);
              if (lo >= 0xdc00 && lo <= 0xdfff) {
                this.pos += 6;
                return String.fromCharCode(hi, lo);
              }
            }
          }
          this.fail(); // lone surrogate via escape
        }
        if (hi >= 0xdc00 && hi <= 0xdfff) this.fail();
        return String.fromCharCode(hi);
      }
      default:
        this.fail();
    }
  }

  number(): number {
    const start = this.pos;
    if (this.peek() === '-') this.pos++;
    if (this.pos >= this.s.length) this.fail();
    if (this.peek() === '0') {
      this.pos++;
    } else if (this.peek() >= '1' && this.peek() <= '9') {
      while (this.pos < this.s.length && this.s[this.pos] >= '0' && this.s[this.pos] <= '9') this.pos++;
    } else {
      this.fail();
    }
    if (this.peek() === '.') {
      this.pos++;
      const fstart = this.pos;
      while (this.pos < this.s.length && this.s[this.pos] >= '0' && this.s[this.pos] <= '9') this.pos++;
      if (this.pos === fstart) this.fail();
    }
    const p = this.peek();
    if (p === 'e' || p === 'E') {
      this.pos++;
      const s2 = this.peek();
      if (s2 === '+' || s2 === '-') this.pos++;
      const estart = this.pos;
      while (this.pos < this.s.length && this.s[this.pos] >= '0' && this.s[this.pos] <= '9') this.pos++;
      if (this.pos === estart) this.fail();
    }
    const raw = this.s.slice(start, this.pos);
    const n = Number(raw);
    if (!Number.isFinite(n)) this.fail();
    if (Number.isInteger(n) && Math.abs(n) >= 2 ** 53 && !exactIntegerLiteral(raw, n)) {
      throw new Error('unsafe-integer');
    }
    return n;
  }

  array(): JsonValue[] {
    this.pos++; // [
    const out: JsonValue[] = [];
    this.ws();
    if (this.peek() === ']') {
      this.pos++;
      return out;
    }
    while (true) {
      out.push(this.value());
      this.ws();
      const c = this.peek();
      if (c === ',') {
        this.pos++;
        continue;
      }
      if (c === ']') {
        this.pos++;
        return out;
      }
      this.fail();
    }
  }

  object(): { [k: string]: JsonValue } {
    this.pos++; // {
    // Null prototype: "__proto__" is data, never magic (no prototype pollution,
    // no silent field drop). Duplicate detection uses hasOwnProperty above.
    const out: { [k: string]: JsonValue } = Object.create(null);
    this.ws();
    if (this.peek() === '}') {
      this.pos++;
      return out;
    }
    while (true) {
      this.ws();
      if (this.peek() !== '"') this.fail();
      const key = this.string();
      if (Object.prototype.hasOwnProperty.call(out, key)) {
        throw new Error('duplicate-key');
      }
      this.ws();
      if (this.peek() !== ':') this.fail();
      this.pos++;
      out[key] = this.value();
      this.ws();
      const c = this.peek();
      if (c === ',') {
        this.pos++;
        continue;
      }
      if (c === '}') {
        this.pos++;
        return out;
      }
      this.fail();
    }
  }
}

export function parseStrict(input: string): Result<JsonValue, ParseError> {
  try {
    const p = new P(input);
    const v = p.value();
    p.ws();
    if (p.pos !== input.length) return err('PARSE_ERROR');
    return ok(v);
  } catch (e) {
    if (e instanceof Error && e.message === 'unsafe-integer') return err('UNSAFE_INTEGER');
    if (e instanceof Error && e.message === 'duplicate-key') return err('DUPLICATE_FIELD');
    return err('PARSE_ERROR');
  }
}
