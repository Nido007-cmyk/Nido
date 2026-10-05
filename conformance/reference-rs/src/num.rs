//! ECMAScript number formatting (for RFC 8785 canonicalization) and the
//! unsafe-integer check.
//!
//! Formatting follows the ECMAScript `Number.prototype.toString` algorithm:
//! shortest round-trip digits, then the exponent placement rules from the
//! spec. `-0` formats as `"0"` (RFC 8785 canonical form).

/// Format an f64 the way the ECMAScript `Number.prototype.toString`
/// algorithm does: shortest round-trip digits, then the spec's exponent
/// placement rules.
pub fn format_es(val: f64) -> String {
    if val == 0.0 {
        return "0".to_string();
    }
    let neg = val < 0.0;
    let a = val.abs();
    let mut buf = ryu::Buffer::new();
    let (digits, n) = shortest_parts(buf.format(a));
    let k = digits.len() as i32;
    let body = if k <= n && n <= 21 {
        format!("{}{}", digits, "0".repeat((n - k) as usize))
    } else if 0 < n && n <= 21 {
        format!("{}.{}", &digits[..n as usize], &digits[n as usize..])
    } else if -6 < n && n <= 0 {
        format!("0.{}{}", "0".repeat((-n) as usize), digits)
    } else {
        let e = n - 1;
        let sig = if digits.len() == 1 {
            digits.clone()
        } else {
            format!("{}.{}", &digits[..1], &digits[1..])
        };
        if e < 0 {
            format!("{sig}e-{}", -e)
        } else {
            format!("{sig}e+{e}")
        }
    };
    if neg {
        format!("-{body}")
    } else {
        body
    }
}

/// Split ryu's shortest representation into significant digits (no leading
/// or trailing zeros) and n = number of integer digits
/// (value = 0.digits * 10^n).
fn shortest_parts(s: &str) -> (String, i32) {
    let digits_of = |t: &str| -> String {
        let d: String = t
            .bytes()
            .filter(|&c| c != b'.')
            .map(|c| c as char)
            .collect();
        let d = d.trim_start_matches('0').trim_end_matches('0');
        if d.is_empty() {
            "0".to_string()
        } else {
            d.to_string()
        }
    };
    if let Some(epos) = s.bytes().position(|c| c == b'e' || c == b'E') {
        let mant = &s[..epos];
        let exp: i32 = s[epos + 1..].parse().unwrap_or(0);
        (digits_of(mant), exp + 1)
    } else if let Some(dpos) = s.bytes().position(|c| c == b'.') {
        let intpart = &s[..dpos];
        let fracpart = &s[dpos + 1..];
        let n = if intpart.bytes().all(|c| c == b'0') {
            // value < 1: count leading zeros of the fraction
            let lz = fracpart.bytes().take_while(|&c| c == b'0').count();
            -(lz as i32)
        } else {
            intpart.trim_start_matches('0').len() as i32
        };
        (digits_of(&format!("{intpart}{fracpart}")), n)
    } else {
        (digits_of(s), s.trim_start_matches('0').len() as i32)
    }
}

// ---------------------------------------------------------------------------
// Unsafe-integer check
// ---------------------------------------------------------------------------

/// Minimal unsigned big integer (base 1e9 limbs), just enough to compare a
/// decimal literal's exact value against the exact value of an f64.
#[derive(Clone, Debug)]
struct Big {
    /// little-endian limbs, no leading zero limbs
    limbs: Vec<u32>,
}

impl Big {
    fn zero() -> Self {
        Big { limbs: Vec::new() }
    }
    fn normalize(&mut self) {
        while self.limbs.last() == Some(&0) {
            self.limbs.pop();
        }
    }
    fn from_u64(mut v: u64) -> Self {
        let mut limbs = Vec::new();
        while v > 0 {
            limbs.push((v % 1_000_000_000) as u32);
            v /= 1_000_000_000;
        }
        Big { limbs }
    }
    fn mul_small(&mut self, m: u32) {
        let mut carry: u64 = 0;
        for limb in self.limbs.iter_mut() {
            let t = *limb as u64 * m as u64 + carry;
            *limb = (t % 1_000_000_000) as u32;
            carry = t / 1_000_000_000;
        }
        while carry > 0 {
            self.limbs.push((carry % 1_000_000_000) as u32);
            carry /= 1_000_000_000;
        }
    }
    fn add_small(&mut self, a: u32) {
        let mut carry = a as u64;
        let mut i = 0;
        while carry > 0 {
            if i == self.limbs.len() {
                self.limbs.push(0);
            }
            let t = self.limbs[i] as u64 + carry;
            self.limbs[i] = (t % 1_000_000_000) as u32;
            carry = t / 1_000_000_000;
            i += 1;
        }
    }
    /// self *= 2^bits
    fn shl_bits(&mut self, mut bits: u32) {
        while bits >= 32 {
            // multiply by 2^32
            let mut carry: u64 = 0;
            for limb in self.limbs.iter_mut() {
                let t = (*limb as u64) * 4_294_967_296 + carry;
                *limb = (t % 1_000_000_000) as u32;
                carry = t / 1_000_000_000;
            }
            while carry > 0 {
                self.limbs.push((carry % 1_000_000_000) as u32);
                carry /= 1_000_000_000;
            }
            bits -= 32;
        }
        if bits > 0 {
            self.mul_small(1 << bits);
        }
    }
    fn eq(&self, other: &Big) -> bool {
        let mut a = self.clone();
        let mut b = other.clone();
        a.normalize();
        b.normalize();
        a.limbs == b.limbs
    }
}

/// Parse the exact integer value of a JSON number literal. Returns `None`
/// if the literal's exact value is not an integer at all (e.g.
/// `9007199254740992.5`, which rounds to an integer-valued f64 but is not
/// itself an integer — and therefore not exactly representable).
fn literal_exact_int(literal: &str) -> Option<Big> {
    let s = literal.strip_prefix('-').unwrap_or(literal);
    // split into digits and decimal exponent: value = digits * 10^scale
    let mut digits = String::new();
    let mut frac_len: i64 = 0;
    let mut exp: i64 = 0;
    let mut chars = s.chars().peekable();
    while let Some(&c) = chars.peek() {
        if c.is_ascii_digit() {
            digits.push(c);
            chars.next();
        } else {
            break;
        }
    }
    if chars.peek() == Some(&'.') {
        chars.next();
        while let Some(&c) = chars.peek() {
            if c.is_ascii_digit() {
                digits.push(c);
                frac_len += 1;
                chars.next();
            } else {
                break;
            }
        }
    }
    if matches!(chars.peek(), Some(&'e') | Some(&'E')) {
        chars.next();
        let mut neg = false;
        if chars.peek() == Some(&'+') {
            chars.next();
        } else if chars.peek() == Some(&'-') {
            neg = true;
            chars.next();
        }
        let mut e: i64 = 0;
        while let Some(&c) = chars.peek() {
            if c.is_ascii_digit() {
                e = e * 10 + (c as i64 - '0' as i64);
                chars.next();
            } else {
                break;
            }
        }
        exp = if neg { -e } else { e };
    }
    let scale = exp - frac_len;
    let digits = digits.trim_start_matches('0');
    let mut big = Big::zero();
    for c in digits.chars() {
        big.mul_small(10);
        big.add_small(c as u32 - b'0' as u32);
    }
    if scale > 0 {
        for _ in 0..scale {
            big.mul_small(10);
        }
    } else {
        // scale < 0: the literal's exact value divided by 10^(-scale).
        // A nonzero remainder means the literal is not an integer.
        for _ in 0..(-scale) {
            if divide_small(&mut big, 10) != 0 {
                return None;
            }
        }
    }
    Some(big)
}

fn divide_small(big: &mut Big, d: u32) -> u64 {
    let mut rem: u64 = 0;
    for limb in big.limbs.iter_mut().rev() {
        let t = rem * 1_000_000_000 + *limb as u64;
        *limb = (t / d as u64) as u32;
        rem = t % d as u64;
    }
    big.normalize();
    rem
}

/// Exact value of an integer-valued finite f64 as a Big.
fn f64_exact_int(val: f64) -> Big {
    let bits = val.abs().to_bits();
    let raw_exp = ((bits >> 52) & 0x7FF) as i32;
    let raw_mant = bits & 0xF_FFFF_FFFF_FFFF;
    let (mant, e2): (u64, i32) = if raw_exp == 0 {
        (raw_mant, -1074)
    } else {
        (raw_mant | 0x10_0000_0000_0000, raw_exp - 1075) // 2^52 implicit bit
    };
    let mut big = Big::from_u64(mant);
    if e2 >= 0 {
        big.shl_bits(e2 as u32);
    } else {
        // integer-valued => mantissa divisible by 2^(-e2)
        let mut rem_bits = (-e2) as u32;
        // divide by 2^rem_bits via repeated halving
        while rem_bits > 0 {
            divide_small(&mut big, 2);
            rem_bits -= 1;
        }
    }
    big
}

/// `true` iff the literal's exact integer value is exactly representable
/// as an f64 (i.e. `literal.parse::<f64>()` rounded to the literal itself).
pub fn is_exact_integer_literal(literal: &str, val: f64) -> bool {
    match literal_exact_int(literal) {
        None => false,
        Some(d) => d.eq(&f64_exact_int(val)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exact_check_basics() {
        assert!(is_exact_integer_literal(
            "9007199254740992",
            9007199254740992.0
        ));
        // 9007199254740993 rounds to 9007199254740992
        assert!(!is_exact_integer_literal(
            "9007199254740993",
            9007199254740992.0
        ));
        assert!(is_exact_integer_literal("1e21", 1e21));
        assert!(!is_exact_integer_literal("10000000000000000000001", 1e22));
    }

    #[test]
    fn es_format_spot() {
        assert_eq!(format_es(0.0), "0");
        assert_eq!(format_es(-0.0), "0");
        assert_eq!(format_es(1e21), "1e+21");
        assert_eq!(format_es(1e-5), "0.00001");
        assert_eq!(format_es(1e-7), "1e-7");
        assert_eq!(format_es(0.1 + 0.2), "0.30000000000000004");
        assert_eq!(format_es(123.456), "123.456");
        assert_eq!(format_es(-42.5), "-42.5");
        assert_eq!(format_es(1e308), "1e+308");
        assert_eq!(format_es(5e-324), "5e-324");
        assert_eq!(format_es(100.0), "100");
        assert_eq!(format_es(0.000001), "0.000001");
        assert_eq!(format_es(0.0000001), "1e-7");
        assert_eq!(format_es(123456789012345680000.0), "123456789012345680000");
    }
}
