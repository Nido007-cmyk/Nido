//! JSON Canonicalization Scheme implementation (NIDO v0 profile).
//!
//! Rules applied:
//! - Object keys sorted by UTF-16 code units (surrogate pairs sort as their
//!   two halves; lone surrogates cannot occur — the parser rejects them).
//! - No insignificant whitespace.
//! - Numbers in ECMAScript `Number.prototype.toString` form (`-0` -> `0`).
//! - Strings: `"` and `\` escaped; C0 controls as `\u00XX` (lowercase hex).
//!   DEL (0x7F) and everything above are emitted literally as UTF-8.
//!
//! This follows the resolution recorded in SPEC_AMBIGUITIES.md (AMB-01):
//! short escapes `\b \t \n \f \r` are NOT used; all C0 controls use
//! `\u00XX`.
//!
//! NOTE (differential review, 2026-09-27): this is a DELIBERATE deviation
//! from the published RFC 8785 §3.2.2.2, which REQUIRES the short escapes
//! `\b \t \n \f \r` for U+0008, U+0009, U+000A, U+000C, U+000D (verified
//! against rfc-editor.org/rfc/rfc8785.html). AMB-01's evidence paragraph
//! misstates the RFC on this point, and its resolution text claims "full
//! RFC 8785 compliance" while mandating `\uXXXX`-for-all. The deviation is
//! self-consistent: reference-ts, the official vectors (canon-003), and
//! this implementation all agree byte-for-byte. Classified SPEC_AMBIGUITY;
//! see conformance/DIFFERENTIAL_REPORT_RUST.md. A future protocol version
//! may adopt true RFC 8785 escaping, which would change canonical bytes
//! (and therefore signatures/hashes) for strings containing those five
//! control characters.

use crate::json::Value;
use crate::num::format_es;

pub fn canonicalize(v: &Value, out: &mut String) {
    // Values deeper than the parser limit cannot exist (parse_strict rejects
    // them), but the writer is recursive too, so it carries its own guard:
    // a Value that somehow exceeds it is replaced by null rather than
    // risking a stack overflow. This keeps canonicalization total.
    canonicalize_depth(v, out, 0);
}

fn canonicalize_depth(v: &Value, out: &mut String, depth: usize) {
    if depth > crate::json::MAX_PARSE_DEPTH + 16 {
        out.push_str("null");
        return;
    }
    let depth = depth + 1;
    match v {
        Value::Null => out.push_str("null"),
        Value::Bool(true) => out.push_str("true"),
        Value::Bool(false) => out.push_str("false"),
        Value::Num(n) => out.push_str(&format_es(n.val)),
        Value::Str(s) => {
            out.push('"');
            for c in s.chars() {
                match c {
                    '"' => out.push_str("\\\""),
                    '\\' => out.push_str("\\\\"),
                    c if (c as u32) < 0x20 => {
                        out.push_str(&format!("\\u{:04x}", c as u32));
                    }
                    c => out.push(c),
                }
            }
            out.push('"');
        }
        Value::Arr(items) => {
            out.push('[');
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                canonicalize_depth(item, out, depth);
            }
            out.push(']');
        }
        Value::Obj(pairs) => {
            let mut sorted: Vec<&(String, Value)> = pairs.iter().collect();
            sorted.sort_by(|a, b| cmp_utf16(&a.0, &b.0));
            out.push('{');
            for (i, (k, val)) in sorted.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                // keys are strings: same escaping rules
                out.push('"');
                for c in k.chars() {
                    match c {
                        '"' => out.push_str("\\\""),
                        '\\' => out.push_str("\\\\"),
                        c if (c as u32) < 0x20 => {
                            out.push_str(&format!("\\u{:04x}", c as u32));
                        }
                        c => out.push(c),
                    }
                }
                out.push('"');
                out.push(':');
                canonicalize_depth(val, out, depth);
            }
            out.push('}');
        }
    }
}

/// Compare two strings by UTF-16 code units, as RFC 8785 requires.
fn cmp_utf16(a: &str, b: &str) -> std::cmp::Ordering {
    utf16_units(a).cmp(&utf16_units(b))
}

fn utf16_units(s: &str) -> Vec<u16> {
    let mut units = Vec::new();
    for c in s.chars() {
        let v = c as u32;
        if v < 0x10000 {
            units.push(v as u16);
        } else {
            let v = v - 0x10000;
            units.push(0xD800 + (v >> 10) as u16);
            units.push(0xDC00 + (v & 0x3FF) as u16);
        }
    }
    units
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::json::parse_strict;

    fn canon(s: &str) -> String {
        let v = parse_strict(s).unwrap();
        let mut out = String::new();
        canonicalize(&v, &mut out);
        out
    }

    #[test]
    fn key_order_utf16() {
        // 'z' (U+007A) < 'é' (U+00E9) < '€' (U+20AC)
        assert_eq!(canon(r#"{"€":1,"z":2,"é":3}"#), r#"{"z":2,"é":3,"€":1}"#);
    }

    #[test]
    fn control_escapes_are_long() {
        // AMB-01: JCS uses \uXXXX for ALL C0 controls, not short escapes.
        assert_eq!(
            canon("\"\\b\\t\\n\\f\\r\""),
            "\"\\u0008\\u0009\\u000a\\u000c\\u000d\""
        );
    }

    #[test]
    fn negative_zero() {
        assert_eq!(canon("-0"), "0");
        assert_eq!(canon("-0.0"), "0");
    }

    #[test]
    fn nested_sorting() {
        assert_eq!(
            canon(r#"{"b":{"d":1,"c":2},"a":3}"#),
            r#"{"a":3,"b":{"c":2,"d":1}}"#
        );
    }
}
