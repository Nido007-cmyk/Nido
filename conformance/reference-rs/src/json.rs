//! Strict JSON parser for the conformance harness.
//!
//! Rules (from SPEC_AMBIGUITIES.md and the official vectors):
//! - No duplicate object keys -> `DUPLICATE_FIELD`.
//! - No trailing data after the top-level value -> `PARSE_ERROR`.
//! - Lone surrogates in `\uXXXX` escapes -> `PARSE_ERROR`.
//! - Unescaped C0 control characters in strings -> `PARSE_ERROR`.
//! - Non-finite numbers (`1e999`) -> `NON_FINITE_NUMBER`.
//! - Integers with |value| >= 2^53 that are not exactly representable
//!   as f64 -> `UNSAFE_INTEGER`.
//! - `__proto__` is an ordinary inert data key (parsed on a plain map,
//!   never merged into any prototype chain).

#[derive(Clone, Debug)]
pub enum Value {
    Null,
    Bool(bool),
    Num(Num),
    Str(String),
    Arr(Vec<Value>),
    Obj(Vec<(String, Value)>),
}

/// A JSON number: its f64 value. (The exact source literal is only needed
/// transiently at parse time for the unsafe-integer check, which compares
/// the literal's exact value against the parsed f64 before constructing
/// the `Num`.)
#[derive(Clone, Debug)]
pub struct Num {
    pub val: f64,
}

#[derive(Clone, Debug)]
pub struct ParseError {
    pub code: &'static str,
}

impl Value {
    pub fn get(&self, key: &str) -> Option<&Value> {
        match self {
            Value::Obj(pairs) => pairs.iter().find(|(k, _)| k == key).map(|(_, v)| v),
            _ => None,
        }
    }
    pub fn as_str(&self) -> Option<&str> {
        match self {
            Value::Str(s) => Some(s),
            _ => None,
        }
    }
    pub fn as_f64(&self) -> Option<f64> {
        match self {
            Value::Num(n) => Some(n.val),
            _ => None,
        }
    }
    pub fn as_arr(&self) -> Option<&[Value]> {
        match self {
            Value::Arr(a) => Some(a),
            _ => None,
        }
    }
    pub fn is_obj(&self) -> bool {
        matches!(self, Value::Obj(_))
    }
}

struct Parser<'a> {
    b: &'a [u8],
    pos: usize,
    depth: usize,
}

/// Maximum nesting depth accepted by the strict parser.
///
/// Rationale: no legitimate NIDO envelope needs more than a handful of
/// nesting levels, while unbounded recursion lets a malicious peer crash the
/// process with a stack overflow (Rust stack exhaustion aborts; it cannot be
/// caught). V8's JSON parser throws a catchable RangeError at a few thousand
/// levels, so an explicit low limit is the fail-closed Rust equivalent.
/// Exceeding it yields the typed error `NESTING_TOO_DEEP`, never a crash.
pub const MAX_PARSE_DEPTH: usize = 128;

pub fn parse_strict(s: &str) -> Result<Value, ParseError> {
    let mut p = Parser {
        b: s.as_bytes(),
        pos: 0,
        depth: 0,
    };
    p.skip_ws();
    let v = p.parse_value()?;
    p.skip_ws();
    if p.pos != p.b.len() {
        return Err(ParseError {
            code: "PARSE_ERROR",
        });
    }
    Ok(v)
}

impl<'a> Parser<'a> {
    fn skip_ws(&mut self) {
        while self.pos < self.b.len() {
            match self.b[self.pos] {
                b' ' | b'\t' | b'\n' | b'\r' => self.pos += 1,
                _ => break,
            }
        }
    }

    fn peek(&self) -> Option<u8> {
        self.b.get(self.pos).copied()
    }

    fn parse_value(&mut self) -> Result<Value, ParseError> {
        match self.peek() {
            Some(b'{') => self.parse_object(),
            Some(b'[') => self.parse_array(),
            Some(b'"') => Ok(Value::Str(self.parse_string()?)),
            Some(b't') => self.parse_lit("true", Value::Bool(true)),
            Some(b'f') => self.parse_lit("false", Value::Bool(false)),
            Some(b'n') => self.parse_lit("null", Value::Null),
            Some(c) if c == b'-' || c.is_ascii_digit() => self.parse_number(),
            _ => Err(ParseError {
                code: "PARSE_ERROR",
            }),
        }
    }

    fn parse_lit(&mut self, lit: &str, v: Value) -> Result<Value, ParseError> {
        if self.b[self.pos..].starts_with(lit.as_bytes()) {
            self.pos += lit.len();
            Ok(v)
        } else {
            Err(ParseError {
                code: "PARSE_ERROR",
            })
        }
    }

    fn parse_object(&mut self) -> Result<Value, ParseError> {
        self.depth += 1;
        if self.depth > MAX_PARSE_DEPTH {
            return Err(ParseError {
                code: "NESTING_TOO_DEEP",
            });
        }
        let r = self.parse_object_inner();
        self.depth -= 1;
        r
    }

    fn parse_object_inner(&mut self) -> Result<Value, ParseError> {
        self.pos += 1; // {
        let mut pairs: Vec<(String, Value)> = Vec::new();
        self.skip_ws();
        if self.peek() == Some(b'}') {
            self.pos += 1;
            return Ok(Value::Obj(pairs));
        }
        loop {
            self.skip_ws();
            if self.peek() != Some(b'"') {
                return Err(ParseError {
                    code: "PARSE_ERROR",
                });
            }
            let key = self.parse_string()?;
            self.skip_ws();
            if self.peek() != Some(b':') {
                return Err(ParseError {
                    code: "PARSE_ERROR",
                });
            }
            self.pos += 1;
            self.skip_ws();
            let val = self.parse_value()?;
            if pairs.iter().any(|(k, _)| k == &key) {
                return Err(ParseError {
                    code: "DUPLICATE_FIELD",
                });
            }
            pairs.push((key, val));
            self.skip_ws();
            match self.peek() {
                Some(b',') => {
                    self.pos += 1;
                }
                Some(b'}') => {
                    self.pos += 1;
                    return Ok(Value::Obj(pairs));
                }
                _ => {
                    return Err(ParseError {
                        code: "PARSE_ERROR",
                    })
                }
            }
        }
    }

    fn parse_array(&mut self) -> Result<Value, ParseError> {
        self.depth += 1;
        if self.depth > MAX_PARSE_DEPTH {
            return Err(ParseError {
                code: "NESTING_TOO_DEEP",
            });
        }
        let r = self.parse_array_inner();
        self.depth -= 1;
        r
    }

    fn parse_array_inner(&mut self) -> Result<Value, ParseError> {
        self.pos += 1; // [
        let mut items: Vec<Value> = Vec::new();
        self.skip_ws();
        if self.peek() == Some(b']') {
            self.pos += 1;
            return Ok(Value::Arr(items));
        }
        loop {
            self.skip_ws();
            items.push(self.parse_value()?);
            self.skip_ws();
            match self.peek() {
                Some(b',') => {
                    self.pos += 1;
                }
                Some(b']') => {
                    self.pos += 1;
                    return Ok(Value::Arr(items));
                }
                _ => {
                    return Err(ParseError {
                        code: "PARSE_ERROR",
                    })
                }
            }
        }
    }

    fn hex4(&mut self) -> Result<u32, ParseError> {
        if self.pos + 4 > self.b.len() {
            return Err(ParseError {
                code: "PARSE_ERROR",
            });
        }
        let mut v: u32 = 0;
        for i in 0..4 {
            let c = self.b[self.pos + i];
            let d = match c {
                b'0'..=b'9' => (c - b'0') as u32,
                b'a'..=b'f' => (c - b'a' + 10) as u32,
                b'A'..=b'F' => (c - b'A' + 10) as u32,
                _ => {
                    return Err(ParseError {
                        code: "PARSE_ERROR",
                    })
                }
            };
            v = v * 16 + d;
        }
        self.pos += 4;
        Ok(v)
    }

    fn parse_string(&mut self) -> Result<String, ParseError> {
        // caller guarantees b[pos] == b'"'
        self.pos += 1;
        let mut out = String::new();
        loop {
            let c = self.peek().ok_or(ParseError {
                code: "PARSE_ERROR",
            })?;
            if c == b'"' {
                self.pos += 1;
                return Ok(out);
            }
            if c < 0x20 {
                // Unescaped C0 control: rejected.
                return Err(ParseError {
                    code: "PARSE_ERROR",
                });
            }
            if c == b'\\' {
                self.pos += 1;
                let e = self.peek().ok_or(ParseError {
                    code: "PARSE_ERROR",
                })?;
                self.pos += 1;
                match e {
                    b'"' => out.push('"'),
                    b'\\' => out.push('\\'),
                    b'/' => out.push('/'),
                    b'b' => out.push('\u{0008}'),
                    b'f' => out.push('\u{000C}'),
                    b'n' => out.push('\n'),
                    b'r' => out.push('\r'),
                    b't' => out.push('\t'),
                    b'u' => {
                        let hi = self.hex4()?;
                        let ch: u32;
                        if (0xD800..0xDC00).contains(&hi) {
                            // high surrogate: must be followed by \uDC00-\uDFFF
                            if self.peek() == Some(b'\\') {
                                self.pos += 1;
                                if self.peek() == Some(b'u') {
                                    self.pos += 1;
                                    let lo = self.hex4()?;
                                    if (0xDC00..0xE000).contains(&lo) {
                                        ch = 0x10000 + ((hi - 0xD800) << 10) + (lo - 0xDC00);
                                    } else {
                                        return Err(ParseError {
                                            code: "PARSE_ERROR",
                                        });
                                    }
                                } else {
                                    return Err(ParseError {
                                        code: "PARSE_ERROR",
                                    });
                                }
                            } else {
                                return Err(ParseError {
                                    code: "PARSE_ERROR",
                                });
                            }
                        } else if (0xDC00..0xE000).contains(&hi) {
                            return Err(ParseError {
                                code: "PARSE_ERROR",
                            });
                        } else {
                            ch = hi;
                        }
                        out.push(char::from_u32(ch).ok_or(ParseError {
                            code: "PARSE_ERROR",
                        })?);
                    }
                    _ => {
                        return Err(ParseError {
                            code: "PARSE_ERROR",
                        })
                    }
                }
            } else {
                // Regular UTF-8 char: find its byte length.
                let rest = &self.b[self.pos..];
                let s = std::str::from_utf8(rest).map_err(|_| ParseError {
                    code: "PARSE_ERROR",
                })?;
                let ch = s.chars().next().ok_or(ParseError {
                    code: "PARSE_ERROR",
                })?;
                out.push(ch);
                self.pos += ch.len_utf8();
            }
        }
    }

    fn parse_number(&mut self) -> Result<Value, ParseError> {
        let start = self.pos;
        if self.peek() == Some(b'-') {
            self.pos += 1;
        }
        // int part
        match self.peek() {
            Some(b'0') => {
                self.pos += 1;
            }
            Some(c) if c.is_ascii_digit() && c != b'0' => {
                while matches!(self.peek(), Some(c) if c.is_ascii_digit()) {
                    self.pos += 1;
                }
            }
            _ => {
                return Err(ParseError {
                    code: "PARSE_ERROR",
                })
            }
        }
        // frac part
        if self.peek() == Some(b'.') {
            self.pos += 1;
            if !matches!(self.peek(), Some(c) if c.is_ascii_digit()) {
                return Err(ParseError {
                    code: "PARSE_ERROR",
                });
            }
            while matches!(self.peek(), Some(c) if c.is_ascii_digit()) {
                self.pos += 1;
            }
        }
        // exp part
        if matches!(self.peek(), Some(b'e') | Some(b'E')) {
            self.pos += 1;
            if matches!(self.peek(), Some(b'+') | Some(b'-')) {
                self.pos += 1;
            }
            if !matches!(self.peek(), Some(c) if c.is_ascii_digit()) {
                return Err(ParseError {
                    code: "PARSE_ERROR",
                });
            }
            while matches!(self.peek(), Some(c) if c.is_ascii_digit()) {
                self.pos += 1;
            }
        }
        let literal = std::str::from_utf8(&self.b[start..self.pos])
            .map_err(|_| ParseError {
                code: "PARSE_ERROR",
            })?
            .to_string();
        let val: f64 = literal.parse().map_err(|_| ParseError {
            code: "PARSE_ERROR",
        })?;
        if !val.is_finite() {
            return Err(ParseError {
                code: "NON_FINITE_NUMBER",
            });
        }
        if val.fract() == 0.0 && val.abs() >= 9_007_199_254_740_992.0 {
            if !crate::num::is_exact_integer_literal(&literal, val) {
                return Err(ParseError {
                    code: "UNSAFE_INTEGER",
                });
            }
        }
        Ok(Value::Num(Num { val }))
    }
}

/// Compact JSON writer for harness result values (insertion-ordered keys).
pub fn write_compact(v: &Value, out: &mut String) {
    match v {
        Value::Null => out.push_str("null"),
        Value::Bool(true) => out.push_str("true"),
        Value::Bool(false) => out.push_str("false"),
        Value::Num(n) => out.push_str(&crate::num::format_es(n.val)),
        Value::Str(s) => write_json_string(s, out),
        Value::Arr(items) => {
            out.push('[');
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write_compact(item, out);
            }
            out.push(']');
        }
        Value::Obj(pairs) => {
            out.push('{');
            for (i, (k, val)) in pairs.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write_json_string(k, out);
                out.push(':');
                write_compact(val, out);
            }
            out.push('}');
        }
    }
}

fn write_json_string(s: &str, out: &mut String) {
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{08}' => out.push_str("\\b"),
            '\u{0C}' => out.push_str("\\f"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => {
                out.push_str(&format!("\\u{:04x}", c as u32));
            }
            c => out.push(c),
        }
    }
    out.push('"');
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dup_key_rejected() {
        assert_eq!(
            parse_strict(r#"{"a":1,"a":2}"#).unwrap_err().code,
            "DUPLICATE_FIELD"
        );
    }

    #[test]
    fn proto_is_inert_data() {
        let v = parse_strict(r#"{"__proto__":{"x":1},"a":2}"#).unwrap();
        assert!(v.get("__proto__").is_some());
        assert_eq!(v.get("a").unwrap().as_f64(), Some(2.0));
    }

    #[test]
    fn lone_surrogate_rejected() {
        assert!(parse_strict("\"\\ud800\"").is_err());
        assert!(parse_strict("\"\\udc00\"").is_err());
        assert!(parse_strict("\"\\ud800x\"").is_err());
    }

    #[test]
    fn surrogate_pair_ok() {
        let v = parse_strict("\"\\ud83d\\ude00\"").unwrap();
        assert_eq!(v.as_str(), Some("😀"));
    }

    #[test]
    fn control_char_rejected() {
        assert!(parse_strict("\"\u{01}\"").is_err());
    }

    #[test]
    fn unsafe_integer_rejected() {
        assert_eq!(
            parse_strict("9007199254740993").unwrap_err().code,
            "UNSAFE_INTEGER"
        );
        // exactly 2^53 is representable
        assert!(parse_strict("9007199254740992").is_ok());
    }

    #[test]
    fn non_finite_rejected() {
        assert_eq!(parse_strict("1e999").unwrap_err().code, "NON_FINITE_NUMBER");
    }

    #[test]
    fn trailing_garbage_rejected() {
        assert!(parse_strict("{} {}").is_err());
        assert!(parse_strict("").is_err());
    }
}
