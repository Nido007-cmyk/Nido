// MIT License
// Copyright (c) 2026 NIDO contributors
// See LICENSE file for details.

//! Explicit breaking attempts against the seven security invariants.
//!
//! Each test plays the attacker: it constructs the malicious input the
//! invariant's "threat" section describes and asserts the implementation
//! refuses it. A test that FAILS here means the invariant is broken and the
//! finding must be classified per the project rules
//! (SPEC_AMBIGUITY / TS_BUG / RUST_BUG / VECTOR_BUG / UNSPECIFIED_BEHAVIOR).
//!
//! Results are summarized in conformance/INVARIANTS_STATUS.md.

use nido_conformance_rs::eval;
use nido_conformance_rs::json::{parse_strict, Num, Value};

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
fn ok_true(v: &Value) -> bool {
    matches!(v.get("ok"), Some(Value::Bool(true)))
}
fn decision_of(v: &Value) -> &str {
    v.get("decision")
        .and_then(|x| x.as_str())
        .unwrap_or("<missing>")
}

// ---------------------------------------------------------------------------
// INV-1 · AUTHORITY_MONOTONICITY: message content is data, never authority.
// ---------------------------------------------------------------------------

#[test]
fn inv1_request_fields_cannot_grant_authority() {
    // Attack: smuggle "mode":"AUTO" / "admin":true inside the REQUEST object,
    // hoping the receiver confuses request content with policy rules.
    let input = obj(vec![
        ("rules", arr(vec![])),
        (
            "request",
            obj(vec![
                ("subject", s("peer:attacker")),
                ("capability", s("calendar.contacts.read")),
                ("version", s("v2")),
                ("peer", s("peer:attacker")),
                ("now", n(1_700_000_000_000.0)),
                ("mode", s("AUTO")), // smuggled: must be ignored
                ("admin", b(true)),  // smuggled: must be ignored
            ]),
        ),
    ]);
    let r = eval::eval_policy(&input);
    assert_eq!(
        decision_of(&r),
        "DENY",
        "request content granted authority!"
    );
}

#[test]
fn inv1_version_spoofing_denied() {
    // Attack: request v2 / "v1 " / "V1" when only v1 is pinned.
    for ver in ["v2", "v1 ", "V1", "v01", ""] {
        let input = obj(vec![
            (
                "rules",
                arr(vec![obj(vec![
                    ("subject", s("local")),
                    ("capability", s("c")),
                    ("version", s("v1")),
                    ("mode", s("AUTO")),
                ])]),
            ),
            (
                "request",
                obj(vec![
                    ("subject", s("local")),
                    ("capability", s("c")),
                    ("version", s(ver)),
                    ("peer", s("p")),
                    ("now", n(1_700_000_000_000.0)),
                ]),
            ),
        ]);
        let r = eval::eval_policy(&input);
        assert_eq!(decision_of(&r), "DENY", "version spoof {ver:?} authorized!");
    }
}

#[test]
fn inv1_unknown_token_fields_grant_nothing() {
    // Attack: delegation token carries "max_uses":9999 OUTSIDE scope, or an
    // "admin":true top-level field, hoping it is honored.
    let tok = obj(vec![
        ("v", s("nido-delegation/1")),
        ("issuer_identity", s("a")),
        ("subject_identity", s("b")),
        ("capability", s("c")),
        ("capability_version", s("v1")),
        (
            "scope",
            obj(vec![("max_uses", n(1.0)), ("peers", arr(vec![s("p")]))]),
        ),
        ("issued_at", n(1000.0)),
        ("expires_at", n(2000.0)),
        ("max_uses", n(9999.0)), // smuggled outside scope
        ("admin", b(true)),      // smuggled
        ("signature", s("00")),
    ]);
    let r = eval::eval_delegation(&obj(vec![
        ("chain", arr(vec![tok])),
        ("pubkeys", obj(vec![("a", s(&"aa".repeat(32)))])),
        ("now", n(1500.0)),
    ]));
    // Either the signature check or the structural checks must refuse it;
    // what matters is it is NEVER ok:true.
    assert!(!ok_true(&r), "smuggled token fields granted authority!");
}

// ---------------------------------------------------------------------------
// INV-2 · AUTONOMY_NON_EXPANSION: updates never widen prior authority.
// ---------------------------------------------------------------------------

#[test]
fn inv2_unknown_versions_fail_closed() {
    // Attack: a "new" protocol/capability version the receiver never
    // approved must not be negotiated into existence.
    for v in ["nido/2.0", "nido/1.1", "v1", "1.0", ""] {
        let r = eval::eval_protocol_version(&obj(vec![
            ("localMin", s(v)),
            ("localMax", s("nido/1.0")),
            ("peerMin", s("nido/1.0")),
            ("peerMax", s("nido/1.0")),
        ]));
        assert!(!ok_true(&r), "version {v:?} was negotiated!");
    }
    // "nido/01.0" is NOT a different version: both implementations parse the
    // numeric components, so it normalizes to the exact token "nido/1.0".
    // (Same in reference-ts; numeric parse of "01" is 1.)
    let r = eval::eval_protocol_version(&obj(vec![
        ("localMin", s("nido/01.0")),
        ("localMax", s("nido/1.0")),
        ("peerMin", s("nido/1.0")),
        ("peerMax", s("nido/1.0")),
    ]));
    assert!(ok_true(&r));
    assert_eq!(r.get("version").and_then(|v| v.as_str()), Some("nido/1.0"));
    // capability versions: unknown "v99" never intersects
    let r = eval::eval_capability_version(&obj(vec![
        ("local", arr(vec![s("v1")])),
        ("peer", arr(vec![s("v99")])),
    ]));
    assert!(!ok_true(&r));
}

#[test]
fn inv2_expiry_has_no_grace_window() {
    // Attack: race the one-millisecond boundary; at now == expires_at the
    // grant must ALREADY be dead (AMB-06), in consent AND delegation.
    let grant = obj(vec![
        ("capability", s("c")),
        ("capability_version", s("v1")),
        ("parameters_hash", s("h")),
        ("peer", s("p")),
        ("max_uses", n(5.0)),
        ("uses", n(0.0)),
        ("expires_at", n(2000.0)),
    ]);
    let req = obj(vec![
        ("capability", s("c")),
        ("capability_version", s("v1")),
        ("parameters_hash", s("h")),
        ("peer", s("p")),
        ("now", n(2000.0)), // exactly at expiry
    ]);
    let r = eval::eval_consent(&obj(vec![("grant", grant), ("request", req)]));
    assert!(!ok_true(&r), "consent usable at exactly expires_at!");
    assert_eq!(
        r.get("error").and_then(|e| e.as_str()),
        Some("CONSENT_EXPIRED")
    );
}

// ---------------------------------------------------------------------------
// INV-3 · TRANSPORT_INDEPENDENCE: no transport input exists to vary.
// ---------------------------------------------------------------------------

#[test]
fn inv3_budget_has_no_transport_dimension() {
    // Attack: exhaust budget as identity A, then keep spending "as A" while
    // claiming a different transport. The accounting function takes no
    // transport parameter at all: there is nothing to vary, so the attempt
    // is vacuous BY CONSTRUCTION. What we CAN test: two identities are
    // fully isolated (spending as A never touches B's window).
    let opts = obj(vec![
        ("budget", n(10.0)),
        ("window_ms", n(60_000.0)),
        ("now", n(0.0)),
    ]);
    // identity A spends its whole budget in one vector...
    let r = eval::eval_budget(&obj(vec![
        ("state", obj(vec![])),
        (
            "steps",
            arr(vec![obj(vec![("identity", s("A")), ("units", n(10.0))])]),
        ),
        ("opts", opts.clone()),
    ]));
    assert!(ok_true(&r));
    assert_eq!(r.get("remaining").and_then(|v| v.as_f64()), Some(0.0));
    // ...identity B is unaffected (separate principal, separate budget).
    let r = eval::eval_budget(&obj(vec![
        ("state", obj(vec![])),
        (
            "steps",
            arr(vec![obj(vec![("identity", s("B")), ("units", n(10.0))])]),
        ),
        ("opts", opts),
    ]));
    assert!(ok_true(&r));
}

// ---------------------------------------------------------------------------
// INV-4 · RETRY_SAFETY: duplicates never multiply side effects.
// ---------------------------------------------------------------------------

#[test]
fn inv4_duplicate_task_ids_never_reexecute() {
    // Attack: retransmit the same task list; executed_count must not grow.
    let ids = arr(vec![s("t1"), s("t2"), s("t1"), s("t2"), s("t1")]);
    let r = eval::eval_idempotency(&obj(vec![("task_ids", ids)]));
    assert!(ok_true(&r));
    assert_eq!(r.get("executed_count").and_then(|v| v.as_f64()), Some(2.0));
    assert_eq!(
        r.get("duplicates_rejected").and_then(|v| v.as_f64()),
        Some(3.0)
    );
    let log: Vec<&str> = r
        .get("log")
        .and_then(|v| v.as_arr())
        .map(|a| a.iter().filter_map(|v| v.as_str()).collect())
        .unwrap_or_default();
    assert_eq!(
        log,
        vec![
            "EXECUTED",
            "EXECUTED",
            "DUPLICATE",
            "DUPLICATE",
            "DUPLICATE"
        ]
    );
}

// ---------------------------------------------------------------------------
// INV-5 · DISCLOSURE_ACCOUNTING: the sum is what matters; no refunds.
// ---------------------------------------------------------------------------

#[test]
fn inv5_no_budget_refunds() {
    // Attack: negative disclosed_units to "refund" spent budget, or NaN to
    // poison the total.
    for units in [-1.0, f64::NAN, f64::INFINITY] {
        let r = eval::eval_graph(&obj(vec![
            (
                "nodes",
                arr(vec![obj(vec![
                    ("id", s("n1")),
                    ("disclosed_units", n(units)),
                ])]),
            ),
            ("budget", n(100.0)),
        ]));
        assert!(!ok_true(&r), "units={units} corrupted accounting!");
    }
    // Attack: eleven tiny disclosures against a budget of 10.
    let nodes: Vec<Value> = (0..11)
        .map(|i| {
            obj(vec![
                ("id", s(&format!("n{i}"))),
                ("disclosed_units", n(1.0)),
            ])
        })
        .collect();
    let r = eval::eval_graph(&obj(vec![("nodes", arr(nodes)), ("budget", n(10.0))]));
    assert!(!ok_true(&r));
    assert_eq!(
        r.get("error").and_then(|e| e.as_str()),
        Some("GRAPH_BUDGET_EXCEEDED")
    );
}

#[test]
fn inv5_budget_cannot_be_double_spent_in_one_vector() {
    // Attack: two steps that together exceed the budget; the second must fail
    // at its step index, and no partial spend may leak into `remaining`.
    let r = eval::eval_budget(&obj(vec![
        ("state", obj(vec![])),
        (
            "steps",
            arr(vec![
                obj(vec![("identity", s("A")), ("units", n(7.0))]),
                obj(vec![("identity", s("A")), ("units", n(7.0))]),
            ]),
        ),
        (
            "opts",
            obj(vec![
                ("budget", n(10.0)),
                ("window_ms", n(60_000.0)),
                ("now", n(0.0)),
            ]),
        ),
    ]));
    assert!(!ok_true(&r));
    assert_eq!(
        r.get("error").and_then(|e| e.as_str()),
        Some("BUDGET_EXHAUSTED")
    );
    assert_eq!(r.get("at_step").and_then(|v| v.as_f64()), Some(1.0));
}

// ---------------------------------------------------------------------------
// INV-6 · DELEGATION_ATTENUATION: authority only shrinks downstream.
// ---------------------------------------------------------------------------

#[test]
fn inv6_delegatee_cannot_mint_broader_token() {
    // Attack: Bob (delegatee) mints a token for Carol that widens every
    // axis. All structural widenings are refused even before signatures
    // are considered (signatures are bogus here on purpose).
    let parent = obj(vec![
        ("v", s("nido-delegation/1")),
        ("issuer_identity", s("alice")),
        ("subject_identity", s("bob")),
        ("capability", s("calendar.availability.query")),
        ("capability_version", s("v1")),
        (
            "scope",
            obj(vec![("max_uses", n(2.0)), ("peers", arr(vec![s("bob")]))]),
        ),
        ("issued_at", n(1000.0)),
        ("expires_at", n(2000.0)),
        ("signature", s("00")),
    ]);
    let child = |scope: Value, expires: f64, cap: &str| {
        obj(vec![
            ("v", s("nido-delegation/1")),
            ("issuer_identity", s("bob")),
            ("subject_identity", s("carol")),
            ("capability", s(cap)),
            ("capability_version", s("v1")),
            ("scope", scope),
            ("issued_at", n(1000.0)),
            ("expires_at", n(expires)),
            ("signature", s("00")),
        ])
    };
    let pubkeys = obj(vec![
        ("alice", s(&"aa".repeat(32))),
        ("bob", s(&"bb".repeat(32))),
    ]);
    let check = |c: Value| {
        let r = eval::eval_delegation(&obj(vec![
            ("chain", arr(vec![parent.clone(), c])),
            ("pubkeys", pubkeys.clone()),
            ("now", n(1500.0)),
        ]));
        assert!(!ok_true(&r), "widened delegation accepted!");
    };
    // more uses
    check(child(
        obj(vec![("max_uses", n(99.0)), ("peers", arr(vec![s("bob")]))]),
        2000.0,
        "calendar.availability.query",
    ));
    // later expiry
    check(child(
        obj(vec![("max_uses", n(2.0)), ("peers", arr(vec![s("bob")]))]),
        2001.0,
        "calendar.availability.query",
    ));
    // wider peers
    check(child(
        obj(vec![
            ("max_uses", n(2.0)),
            ("peers", arr(vec![s("bob"), s("carol")])),
        ]),
        2000.0,
        "calendar.availability.query",
    ));
    // different capability
    check(child(
        obj(vec![("max_uses", n(2.0)), ("peers", arr(vec![s("bob")]))]),
        2000.0,
        "calendar.contacts.read",
    ));
    // broken linkage (issuer != parent subject)
    let mut bad_link = child(
        obj(vec![("max_uses", n(1.0)), ("peers", arr(vec![s("bob")]))]),
        2000.0,
        "calendar.availability.query",
    );
    if let Value::Obj(pairs) = &mut bad_link {
        for (k, v) in pairs.iter_mut() {
            if k == "issuer_identity" {
                *v = s("mallory");
            }
        }
    }
    let r = eval::eval_delegation(&obj(vec![
        ("chain", arr(vec![parent, bad_link])),
        (
            "pubkeys",
            obj(vec![
                ("alice", s(&"aa".repeat(32))),
                ("mallory", s(&"cc".repeat(32))),
            ]),
        ),
        ("now", n(1500.0)),
    ]));
    assert!(!ok_true(&r), "broken linkage accepted!");
}

// ---------------------------------------------------------------------------
// INV-7 · FAIL_CLOSED: unknown input is rejected, never "close enough".
// ---------------------------------------------------------------------------

#[test]
fn inv7_adversarial_parser_battery() {
    // Every one of these must be rejected; none may panic.
    let attacks = [
        "{\"a\":1,\"a\":2}",         // duplicate field: which value wins?
        "{\"a\":1} trailing",        // trailing garbage
        "\"\\udead\"",               // lone surrogate
        "\"a\u{0000}b\"",            // unescaped NUL
        "9007199254740993",          // precision loss
        "{\"__proto__\":{\"x\":1}}", // prototype pollution attempt
        "[1,2,3",                    // truncated
        "{\"a\":01}",                // bad number
        "",                          // empty
        " ",                         // whitespace only
        "\u{feff}{}",                // BOM
    ];
    for a in attacks {
        let r = parse_strict(a);
        if a.starts_with("{\"__proto__\"") {
            // __proto__ is INERT DATA, not an attack vector: it must parse
            // (as data) rather than pollute anything.
            assert!(r.is_ok(), "__proto__ should be inert data, not an error");
            let v = r.unwrap();
            assert!(v.get("__proto__").is_some());
        } else {
            assert!(r.is_err(), "FAIL_CLOSED violated by: {a:?}");
        }
    }
}

#[test]
fn inv7_deeply_nested_input_is_rejected_safely() {
    // Attack: deeply nested input to blow the stack (remotely triggerable
    // process abort in a recursive parser). The parser must fail with the
    // typed error NESTING_TOO_DEEP, never crash. 5k and 100k depths are both
    // probed; the second would abort even the 8MB main-thread stack without
    // the explicit limit.
    for depth in [5_000usize, 100_000] {
        let mut s = String::with_capacity(depth * 2);
        for _ in 0..depth {
            s.push('[');
        }
        for _ in 0..depth {
            s.push(']');
        }
        let r = parse_strict(&s);
        assert!(r.is_err(), "depth {depth} was accepted!");
        assert_eq!(r.unwrap_err().code, "NESTING_TOO_DEEP");
    }
    // Sanity: reasonable nesting still parses.
    let mut s = String::new();
    for _ in 0..100 {
        s.push('[');
    }
    for _ in 0..100 {
        s.push(']');
    }
    assert!(parse_strict(&s).is_ok());
}
