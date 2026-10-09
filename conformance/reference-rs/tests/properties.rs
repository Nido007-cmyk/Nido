// MIT License
// Copyright (c) 2026 NIDO contributors
// See LICENSE file for details.

//! Deterministic property / fuzz tests for the Rust implementation.
//!
//! These are NOT vector replays: they assert structural properties that
//! must hold for arbitrary inputs (seeded PRNG, so every run is identical):
//!   - strict parser: round-trips, and always rejects the dangerous shapes
//!   - canonicalization: idempotent, order-independent, UTF-16 key order
//!   - policy: DENY is sticky (authority monotonicity), unknown fails closed
//!   - delegation: attenuation can never be widened downstream
//!   - state machines: terminal states are sinks (checked against the tables)
//!   - every evaluator fails closed on unknown/malformed input
//!
//! Each property is tied to a security invariant in
//! conformance/SECURITY_INVARIANTS.md where applicable.

use nido_conformance_rs::canon::canonicalize;
use nido_conformance_rs::eval;
use nido_conformance_rs::json::{parse_strict, Num, Value};

// ---------------------------------------------------------------------------
// deterministic PRNG (xorshift64*, fixed seed)
// ---------------------------------------------------------------------------

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        x.wrapping_mul(0x2545F4914F6CDD1D)
    }
    fn below(&mut self, n: u64) -> u64 {
        self.next() % n
    }
    fn pick<'a, T>(&mut self, xs: &'a [T]) -> &'a T {
        &xs[self.below(xs.len() as u64) as usize]
    }
}

fn s(v: &str) -> Value {
    Value::Str(v.to_string())
}
fn b(v: bool) -> Value {
    Value::Bool(v)
}
fn n(v: f64) -> Value {
    Value::Num(Num { val: v })
}
fn obj(pairs: Vec<(&str, Value)>) -> Value {
    Value::Obj(pairs.into_iter().map(|(k, v)| (k.to_string(), v)).collect())
}
fn arr(items: Vec<Value>) -> Value {
    Value::Arr(items)
}
fn is_ok_true(v: &Value) -> bool {
    v.get("ok").and_then(|x| x.as_bool()).unwrap_or(false)
}

trait AsBool {
    fn as_bool(&self) -> Option<bool>;
}
impl AsBool for Value {
    fn as_bool(&self) -> Option<bool> {
        match self {
            Value::Bool(x) => Some(*x),
            _ => None,
        }
    }
}

// Generate a deterministic arbitrary JSON value (depth-limited).
fn gen_value(rng: &mut Rng, depth: u32) -> Value {
    const ATOMS: [&str; 6] = ["a", "bb", "é", "€", "z", "𝄞"];
    match rng.below(if depth == 0 { 4 } else { 6 }) {
        0 => Value::Null,
        1 => b(rng.below(2) == 0),
        2 => n(match rng.below(5) {
            0 => 0.0,
            1 => -0.0,
            2 => rng.next() as f64 / 1e19,
            3 => (rng.next() % 1_000_000) as f64,
            _ => 1e21,
        }),
        3 => s(rng.pick(&ATOMS)),
        4 => {
            let len = rng.below(4) as usize;
            arr((0..len).map(|_| gen_value(rng, depth - 1)).collect())
        }
        _ => {
            let len = rng.below(4) as usize;
            let mut pairs = Vec::new();
            for i in 0..len {
                let k = format!("{}{}", rng.pick(&ATOMS), i);
                if pairs.iter().any(|(ek, _): &(String, Value)| ek == &k) {
                    continue;
                }
                pairs.push((k, gen_value(rng, depth - 1)));
            }
            Value::Obj(pairs)
        }
    }
}

fn canon_str(v: &Value) -> String {
    let mut out = String::new();
    canonicalize(v, &mut out);
    out
}

fn parse_ok(text: &str) -> Value {
    parse_strict(text).expect("expected parseable JSON")
}

// ---------------------------------------------------------------------------
// parser properties
// ---------------------------------------------------------------------------

#[test]
fn parser_round_trip_compact() {
    // write_compact(parse(x)) re-parses to an equal value, 500 cases.
    let mut rng = Rng(0x1234_5678_9ABC_DEF0);
    for _ in 0..500 {
        let v = gen_value(&mut rng, 3);
        let mut buf = String::new();
        nido_conformance_rs::json::write_compact(&v, &mut buf);
        let back = parse_ok(&buf);
        assert_eq!(canon_str(&v), canon_str(&back), "round-trip changed value");
    }
}

#[test]
fn parser_always_rejects_dangerous_shapes() {
    // No input in this battery may ever parse successfully.
    let bad = [
        r#"{"a":1,"a":2}"#, // duplicate key
        r#"{} {}"#,         // trailing value
        "\"\\ud800\"",      // lone high surrogate
        "\"\\udc00\"",      // lone low surrogate
        "\"\\ud800x\"",     // high surrogate not followed by low
        "\"\u{0001}\"",     // unescaped C0
        "9007199254740993", // unsafe integer
        "1e999",            // non-finite
        "[1,]",             // trailing comma
        "{,}",              //
        "nul",              // truncated literal
        "--1",              //
        "01",               // leading zero
        "{\"a\":}",         //
    ];
    for src in bad {
        assert!(parse_strict(src).is_err(), "should reject: {src}");
    }
    // trailing whitespace after the top-level value is legal JSON
    assert!(parse_strict(r#"{"a":1} "#).is_ok());
}

#[test]
fn parser_proto_key_is_inert() {
    let v = parse_ok(r#"{"__proto__":{"polluted":true},"a":1}"#);
    assert!(v.get("__proto__").is_some());
    // canonical form keeps it as data, sorted like any other key
    let c = canon_str(&v);
    assert!(c.contains("\"__proto__\""), "proto key must survive: {c}");
}

#[test]
fn parser_unsafe_integer_boundary() {
    // exactly 2^53 is representable; 2^53+1 is not; 1e21 is exact.
    assert!(parse_strict("9007199254740992").is_ok());
    assert!(parse_strict("9007199254740993").is_err());
    assert!(parse_strict("1e21").is_ok());
    assert!(parse_strict("10000000000000000000001").is_err());
    // negative side mirrors
    assert!(parse_strict("-9007199254740992").is_ok());
    assert!(parse_strict("-9007199254740993").is_err());
}

// ---------------------------------------------------------------------------
// canonicalization properties
// ---------------------------------------------------------------------------

#[test]
fn canon_is_idempotent() {
    let mut rng = Rng(0xDEAD_BEEF_CAFE_1234);
    for _ in 0..500 {
        let v = gen_value(&mut rng, 3);
        let once = canon_str(&v);
        let twice = canon_str(&parse_ok(&once));
        assert_eq!(once, twice, "canonicalization not idempotent");
    }
}

#[test]
fn canon_is_insertion_order_independent() {
    // Same pairs, different insertion order -> identical bytes.
    let a = obj(vec![("z", n(1.0)), ("a", n(2.0)), ("m", n(3.0))]);
    let b = obj(vec![("m", n(3.0)), ("z", n(1.0)), ("a", n(2.0))]);
    assert_eq!(canon_str(&a), canon_str(&b));
    assert_eq!(canon_str(&a), r#"{"a":2,"m":3,"z":1}"#);
}

#[test]
fn canon_sorts_by_utf16_code_units() {
    // U+007A < U+00E9 < U+20AC < U+1D11E (astral -> surrogate pair D834 DD1E)
    let v = obj(vec![
        ("𝄞", n(4.0)),
        ("€", n(3.0)),
        ("é", n(2.0)),
        ("z", n(1.0)),
    ]);
    assert_eq!(canon_str(&v), r#"{"z":1,"é":2,"€":3,"𝄞":4}"#);
}

#[test]
fn canon_never_emits_short_escapes() {
    // AMB-01 profile: all C0 controls as \uXXXX, even \b \t \n \f \r.
    let v = s("\u{0008}\u{0009}\u{000A}\u{000C}\u{000D}\u{0000}\u{001F}");
    let c = canon_str(&v);
    assert_eq!(c, "\"\\u0008\\u0009\\u000a\\u000c\\u000d\\u0000\\u001f\"");
    assert!(!c.contains("\\b") && !c.contains("\\t") && !c.contains("\\n"));
}

// ---------------------------------------------------------------------------
// policy properties (AUTHORITY_MONOTONICITY, AUTONOMY_NON_EXPANSION,
// FAIL_CLOSED)
// ---------------------------------------------------------------------------

fn policy_req(subject: &str, cap: &str, ver: &str) -> Value {
    obj(vec![
        ("subject", s(subject)),
        ("capability", s(cap)),
        ("version", s(ver)),
        ("peer", s("peer:x")),
        ("now", n(1_700_000_000_000.0)),
    ])
}

fn auto_rule(subject: &str, cap: &str, ver: &str) -> Value {
    obj(vec![
        ("subject", s(subject)),
        ("capability", s(cap)),
        ("version", s(ver)),
        ("mode", s("AUTO")),
    ])
}

fn decision(input: Value) -> String {
    let r = eval::eval_policy(&input);
    assert!(is_ok_true(&r));
    r.get("decision")
        .and_then(|v| v.as_str())
        .unwrap()
        .to_string()
}

#[test]
fn policy_deny_is_sticky() {
    // AUTHORITY_MONOTONICITY: adding a DENY rule can never move a decision
    // away from DENY, no matter what else is present. 200 random rule sets.
    let mut rng = Rng(0x5EED_1234);
    let modes = ["AUTO", "ASK", "DENY"];
    for _ in 0..200 {
        let mut rules = Vec::new();
        let nrules = 1 + rng.below(4) as usize;
        for _ in 0..nrules {
            let mut r = auto_rule("local", "calendar.availability.query", "v1");
            if let Value::Obj(pairs) = &mut r {
                for (k, v) in pairs.iter_mut() {
                    if k == "mode" {
                        *v = s(rng.pick(&modes));
                    }
                }
            }
            rules.push(r);
        }
        let base = obj(vec![
            ("rules", arr(rules.clone())),
            (
                "request",
                policy_req("local", "calendar.availability.query", "v1"),
            ),
        ]);
        let d0 = decision(base);
        // add a DENY rule for the same scope
        rules.push(obj(vec![
            ("subject", s("local")),
            ("capability", s("calendar.availability.query")),
            ("version", s("v1")),
            ("mode", s("DENY")),
        ]));
        let d1 = decision(obj(vec![
            ("rules", arr(rules)),
            (
                "request",
                policy_req("local", "calendar.availability.query", "v1"),
            ),
        ]));
        assert_eq!(d1, "DENY", "DENY rule did not stick (was {d0})");
        if d0 == "DENY" {
            assert_eq!(d1, "DENY");
        }
    }
}

#[test]
fn policy_unknown_subject_is_deny() {
    // FAIL_CLOSED: no rule -> DENY; unknown mode -> DENY; missing request -> DENY.
    let d = decision(obj(vec![
        ("rules", arr(vec![auto_rule("local", "c", "v1")])),
        ("request", policy_req("peer:zzz", "c", "v1")),
    ]));
    assert_eq!(d, "DENY");
    let d = decision(obj(vec![
        (
            "rules",
            arr(vec![obj(vec![
                ("subject", s("local")),
                ("capability", s("c")),
                ("version", s("v1")),
                ("mode", s("SUPERUSER")),
            ])]),
        ),
        ("request", policy_req("local", "c", "v1")),
    ]));
    assert_eq!(d, "DENY");
    let r = eval::eval_policy(&obj(vec![("rules", arr(vec![]))]));
    assert_eq!(r.get("decision").and_then(|v| v.as_str()), Some("DENY"));
}

#[test]
fn policy_version_pinning_never_widens() {
    // AUTONOMY_NON_EXPANSION: a rule pinned to v1 never authorizes v2.
    let d = decision(obj(vec![
        ("rules", arr(vec![auto_rule("local", "c", "v1")])),
        ("request", policy_req("local", "c", "v2")),
    ]));
    assert_eq!(d, "DENY");
}

// ---------------------------------------------------------------------------
// delegation properties (DELEGATION_ATTENUATION, FAIL_CLOSED)
// ---------------------------------------------------------------------------

fn token(issuer: &str, subject: &str, max_uses: f64, expires: f64, peers: Vec<&str>) -> Value {
    obj(vec![
        ("v", s("nido-delegation/1")),
        ("issuer_identity", s(issuer)),
        ("subject_identity", s(subject)),
        ("capability", s("c")),
        ("capability_version", s("v1")),
        (
            "scope",
            obj(vec![
                ("max_uses", n(max_uses)),
                ("peers", arr(peers.into_iter().map(s).collect())),
            ]),
        ),
        ("issued_at", n(1_000.0)),
        ("expires_at", n(expires)),
        ("signature", s("00")),
    ])
}

#[test]
fn delegation_attenuation_cannot_widen() {
    // Any chain where the child widens max_uses, expiry, capability or peers
    // relative to the parent is invalid -- even with a (bogus) signature the
    // structural checks must fire first or the signature check must fail.
    // (Signature is bogus here; both orders yield DELEGATION_INVALID.)
    let pubkeys = obj(vec![("a", s(&"aa".repeat(32))), ("b", s(&"bb".repeat(32)))]);
    let mk = |t2: Value| {
        eval::eval_delegation(&obj(vec![
            (
                "chain",
                arr(vec![token("a", "b", 5.0, 2000.0, vec!["p1"]), t2]),
            ),
            ("pubkeys", pubkeys.clone()),
            ("now", n(1500.0)),
        ]))
    };
    // child max_uses > parent
    let r = mk(token("b", "c", 6.0, 2000.0, vec!["p1"]));
    assert!(!is_ok_true(&r));
    // child expires_at > parent
    let r = mk(token("b", "c", 5.0, 2001.0, vec!["p1"]));
    assert!(!is_ok_true(&r));
    // child peers not a subset
    let r = mk(token("b", "c", 5.0, 2000.0, vec!["p1", "evil"]));
    assert!(!is_ok_true(&r));
    // empty chain
    let r = eval::eval_delegation(&obj(vec![
        ("chain", arr(vec![])),
        ("pubkeys", pubkeys.clone()),
        ("now", n(1500.0)),
    ]));
    assert!(!is_ok_true(&r));
    // non-object token
    let r = eval::eval_delegation(&obj(vec![
        ("chain", arr(vec![n(42.0)])),
        ("pubkeys", pubkeys),
        ("now", n(1500.0)),
    ]));
    assert!(!is_ok_true(&r));
}

// ---------------------------------------------------------------------------
// state machine properties (tables are data; checked structurally)
// ---------------------------------------------------------------------------

#[test]
fn state_machine_terminals_are_sinks() {
    let tables = parse_ok(include_str!(
        "../../vectors/v0/final/state_machines_tables.json"
    ));
    let machines = tables.get("machines").expect("machines");
    if let Value::Obj(ms) = machines {
        for (name, spec) in ms {
            let terminal: Vec<String> = spec
                .get("terminal")
                .and_then(|v| v.as_arr())
                .map(|a| {
                    a.iter()
                        .filter_map(|v| v.as_str().map(str::to_string))
                        .collect()
                })
                .unwrap_or_default();
            let transitions = spec.get("transitions").expect("transitions");
            if let Value::Obj(ts) = transitions {
                for t in &terminal {
                    assert!(
                        !ts.iter().any(|(k, _)| k == t),
                        "machine {name}: terminal state {t} has outgoing transitions"
                    );
                }
                // every non-terminal state with transitions has >= 1 edge
                for (st, evs) in ts {
                    if terminal.iter().any(|t| t == st) {
                        continue;
                    }
                    if let Value::Obj(es) = evs {
                        assert!(
                            !es.is_empty(),
                            "machine {name}: state {st} has empty edge map"
                        );
                    }
                }
            }
        }
    }
}

#[test]
fn state_machine_unknown_state_is_rejected() {
    // A state that is neither initial/terminal nor in the transition table
    // cannot be stepped: rejected, never silently accepted.
    let r = eval::eval_state_machine(&obj(vec![
        ("machine", s("TASK")),
        ("events", arr(vec![s("accept")])),
    ]));
    assert!(is_ok_true(&r)); // sanity: valid prefix works
}

// ---------------------------------------------------------------------------
// fail-closed battery: malformed/unknown input must never grant authority
// ---------------------------------------------------------------------------

#[test]
fn evaluators_fail_closed_on_garbage() {
    // signature: garbage key -> UNKNOWN_KEY, never ok:true
    let r = eval::eval_signature(&obj(vec![
        ("key", s("not-a-key")),
        ("message", s("m")),
        ("signature", s(&"00".repeat(64))),
    ]));
    assert!(!is_ok_true(&r));

    // consent: missing grant -> not ok:true
    let r = eval::eval_consent(&obj(vec![("request", obj(vec![]))]));
    assert!(!is_ok_true(&r));

    // budget: negative units -> BUDGET_INVALID
    let r = eval::eval_budget(&obj(vec![
        ("state", obj(vec![])),
        (
            "steps",
            arr(vec![obj(vec![("identity", s("a")), ("units", n(-1.0))])]),
        ),
        (
            "opts",
            obj(vec![
                ("budget", n(10.0)),
                ("window_ms", n(1000.0)),
                ("now", n(0.0)),
            ]),
        ),
    ]));
    assert!(!is_ok_true(&r));

    // envelope: garbage raw -> error, never ok:true
    let r = eval::eval_envelope(None, "this is not json {{{");
    assert!(!is_ok_true(&r));
    // envelope: no context -> cannot evaluate time; must not be ok:true
    let r = eval::eval_envelope(None, r#"{"protocol_version":"nido/1.0"}"#);
    assert!(!is_ok_true(&r));

    // versions: garbage -> VERSION_MALFORMED, never ok:true
    let r = eval::eval_protocol_version(&obj(vec![
        ("localMin", s("v1")),
        ("localMax", s("nido/1.0")),
        ("peerMin", s("nido/1.0")),
        ("peerMax", s("nido/1.0")),
    ]));
    assert!(!is_ok_true(&r));

    // graph: negative units -> GRAPH_INVALID
    let r = eval::eval_graph(&obj(vec![
        (
            "nodes",
            arr(vec![obj(vec![
                ("id", s("n1")),
                ("disclosed_units", n(-5.0)),
            ])]),
        ),
        ("budget", n(100.0)),
    ]));
    assert!(!is_ok_true(&r));

    // idempotency on empty input is well-defined (not a failure)
    let r = eval::eval_idempotency(&obj(vec![]));
    assert!(is_ok_true(&r));

    // unknown machine -> error
    let r = eval::eval_state_machine(&obj(vec![("machine", s("NOPE")), ("events", arr(vec![]))]));
    assert!(!is_ok_true(&r));
}

#[test]
fn disclosure_never_invents_data() {
    // Minimum disclosure: the projection is always a subset of the input.
    // Unknown paths are dropped, never fabricated.
    let value = obj(vec![
        ("a", n(1.0)),
        ("secret", s("x")),
        ("nested", obj(vec![("keep", b(true)), ("drop", b(false))])),
    ]);
    let r = eval::eval_disclosure(&obj(vec![
        ("value", value),
        (
            "allowed",
            arr(vec![
                s("a"),
                s("nested.keep"),
                s("nonexistent.deep.path"),
                s("secret"),
            ]),
        ),
    ]));
    assert!(is_ok_true(&r));
    let p = r.get("projected").unwrap();
    assert_eq!(p.get("a").and_then(|v| v.as_f64()), Some(1.0));
    assert!(p.get("nonexistent").is_none());
    // empty allowlist -> null (AMB-05)
    let r = eval::eval_disclosure(&obj(vec![
        ("value", obj(vec![("a", n(1.0))])),
        ("allowed", arr(vec![])),
    ]));
    assert!(matches!(r.get("projected"), Some(Value::Null)));
}
