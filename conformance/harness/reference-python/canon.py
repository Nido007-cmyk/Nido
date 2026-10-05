#!/usr/bin/env python3
"""NIDO conformance: PARTIAL second implementation (Python).

Implements ONLY canonicalization + SHA-256, independently from the TypeScript
reference (different author flow, different language, stdlib only). Used for
differential testing of the trickiest component.

This is NOT a full second implementation of the protocol. Status is tracked
in the conformance README / SECURITY_INVARIANTS.md.

Can also act as a harness IUT for kind == 'canonicalization':
    python3 canon.py --ndjson   # NDJSON vectors on stdin, NDJSON results on stdout
"""

import hashlib
import json
import math
import re
import sys
from fractions import Fraction


class CanonError(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


def _check_surrogates(s):
    if any(0xD800 <= ord(c) <= 0xDFFF for c in s):
        raise CanonError("PARSE_ERROR")


def _no_duplicates(pairs):
    obj = {}
    for k, v in pairs:
        if k in obj:
            raise CanonError("DUPLICATE_FIELD")
        obj[k] = v
    return obj


def _parse_int(s):
    v = int(s)
    if abs(v) >= 2**53 and float(v) != v:
        raise CanonError("UNSAFE_INTEGER")
    return v


def _parse_float(s):
    f = float(s)
    if math.isinf(f) or math.isnan(f):
        raise CanonError("NON_FINITE_NUMBER")
    if f.is_integer() and abs(f) >= 2**53 and Fraction(s) != Fraction(f):
        raise CanonError("UNSAFE_INTEGER")
    return f


def _parse_constant(s):
    # JSON has no NaN/Infinity/-Infinity; reject them.
    raise CanonError("PARSE_ERROR")


def parse_strict(text):
    """Strict JSON parse. Raises CanonError on any malformed input."""
    try:
        v = json.loads(
            text,
            object_pairs_hook=_no_duplicates,
            parse_int=_parse_int,
            parse_float=_parse_float,
            parse_constant=_parse_constant,
        )
    except CanonError:
        raise
    except Exception:
        raise CanonError("PARSE_ERROR")
    _walk_check(v)
    return v


def _walk_check(v):
    if isinstance(v, str):
        _check_surrogates(v)
    elif isinstance(v, list):
        for x in v:
            _walk_check(x)
    elif isinstance(v, dict):
        for k, x in v.items():
            _check_surrogates(k)
            _walk_check(x)


def utf16_units(s):
    units = []
    for ch in s:
        o = ord(ch)
        if o < 0x10000:
            units.append(o)
        else:
            o -= 0x10000
            units.append(0xD800 + (o >> 10))
            units.append(0xDC00 + (o & 0x3FF))
    return units


def escape_str(s):
    out = []
    for ch in s:
        o = ord(ch)
        if ch == '"':
            out.append('\\"')
        elif ch == "\\":
            out.append("\\\\")
        elif o < 0x20:
            out.append("\\u%04x" % o)
        else:
            out.append(ch)
    return "".join(out)


def es_float_str(f):
    """ECMAScript Number.prototype.toString for a finite double."""
    if f == 0:
        return "0"  # covers -0.0
    neg = f < 0
    a = abs(f)
    if a.is_integer():
        digits = str(int(a))
        n = len(digits)
        if n <= 21:
            out = digits
        else:
            sig = digits.rstrip("0")
            exp = n - 1
            mant = sig if len(sig) == 1 else sig[0] + "." + sig[1:]
            out = mant + "e+" + str(exp)
    else:
        # shortest round-trip digits from repr, then ECMAScript placement rules
        r = repr(a)
        m = re.fullmatch(r"(\d)\.(\d+)[eE]([+-]?)(\d+)", r)
        m2 = re.fullmatch(r"(\d+)[eE]([+-]?)(\d+)", r) if not m else None
        if m:
            s = m.group(1) + m.group(2)
            exp = int(m.group(3) + m.group(4))
            n = exp + 1
        elif m2:
            s = m2.group(1)
            n = int(m2.group(2) + m2.group(3)) + 1
        else:
            intpart, fracpart = r.split(".")
            s = intpart + fracpart
            n = len(intpart)
        k = len(s)
        if k <= n <= 21:
            out = s + "0" * (n - k)
        elif 0 < n <= 21:
            out = s[:n] + "." + s[n:]
        elif -6 < n <= 0:
            out = "0." + "0" * (-n) + s
        else:
            e = n - 1
            mant = s[0] if k == 1 else s[0] + "." + s[1:]
            out = mant + "e" + ("-" if e < 0 else "+") + str(abs(e))
    return ("-" if neg else "") + out


def canon_number(n):
    if isinstance(n, bool):
        raise CanonError("NON_FINITE_NUMBER")  # unreachable; bools handled elsewhere
    if isinstance(n, int):
        # JSON numbers are doubles: format exactly-representable large ints
        # the way ECMAScript would format the double.
        if abs(n) < 2**53:
            return str(n)
        return es_float_str(float(n))
    if isinstance(n, float):
        if math.isinf(n) or math.isnan(n):
            raise CanonError("NON_FINITE_NUMBER")
        return es_float_str(n)
    raise CanonError("NON_FINITE_NUMBER")


def canonicalize(v):
    if v is None:
        return "null"
    if v is True:
        return "true"
    if v is False:
        return "false"
    if isinstance(v, str):
        return '"' + escape_str(v) + '"'
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return canon_number(v)
    if isinstance(v, list):
        return "[" + ",".join(canonicalize(x) for x in v) + "]"
    if isinstance(v, dict):
        items = sorted(v.items(), key=lambda kv: utf16_units(kv[0]))
        return "{" + ",".join('"' + escape_str(k) + '":' + canonicalize(x) for k, x in items) + "}"
    raise CanonError("NON_FINITE_NUMBER")


def process_vector(v):
    """Returns the normalized result dict for a canonicalization vector."""
    try:
        parsed = parse_strict(v["input_raw"])
        canon = canonicalize(parsed)
        return {
            "ok": True,
            "canonical": canon,
            "sha256": hashlib.sha256(canon.encode("utf-8")).hexdigest(),
        }
    except CanonError as e:
        return {"ok": False, "error": e.code}


def main_ndjson():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        v = json.loads(line)
        if v.get("kind") != "canonicalization":
            result = {"ok": False, "error": "NOT_IMPLEMENTED_BY_PARTIAL_IMPL"}
        else:
            result = process_vector(v)
        sys.stdout.write(json.dumps({"id": v.get("id"), "result": result}, ensure_ascii=False) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--ndjson":
        main_ndjson()
    else:
        print("use --ndjson for harness mode", file=sys.stderr)
        sys.exit(2)
