// MIT License
// Copyright (c) 2026 NIDO contributors
// See LICENSE file for details.

//! Evaluators for the 14 v0 conformance kinds.
//!
//! Each evaluator is written directly from the normative spec documents
//! (`docs/AGENT_PROTOCOL.md`, `conformance/SECURITY_INVARIANTS.md`,
//! `conformance/SPEC_AMBIGUITIES.md`) and the official vectors. Deliberate
//! interpretation choices for inputs the vectors do not pin are marked
//! with `INTERPRETATION` comments and collected in
//! `conformance/DIFFERENTIAL_REPORT_RUST.md`.

use crate::canon::canonicalize;
use crate::json::{parse_strict, Value};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};

// ---------------------------------------------------------------------------
// small builders
// ---------------------------------------------------------------------------

fn obj(pairs: Vec<(&str, Value)>) -> Value {
    Value::Obj(pairs.into_iter().map(|(k, v)| (k.to_string(), v)).collect())
}

fn s(v: &str) -> Value {
    Value::Str(v.to_string())
}
fn b(v: bool) -> Value {
    Value::Bool(v)
}
fn n(v: f64) -> Value {
    Value::Num(crate::json::Num { val: v })
}
fn arr(items: Vec<Value>) -> Value {
    Value::Arr(items)
}

fn err(code: &str) -> Value {
    obj(vec![("ok", b(false)), ("error", s(code))])
}

fn is_hex32_lower(v: &Value) -> bool {
    match v {
        Value::Str(x) => {
            x.len() == 32
                && x.bytes()
                    .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
        }
        _ => false,
    }
}

fn is_hex64_lower_str(x: &str) -> bool {
    x.len() == 64
        && x.bytes()
            .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
}

fn get_str<'a>(v: &'a Value, key: &str) -> Option<&'a str> {
    v.get(key).and_then(|x| x.as_str())
}

fn get_num(v: &Value, key: &str) -> Option<f64> {
    v.get(key).and_then(|x| x.as_f64())
}

fn ed25519_verify(pubkey_hex: &str, msg: &[u8], sig_hex: &str) -> bool {
    let pk = hex::decode(pubkey_hex).ok().filter(|v| v.len() == 32);
    let sg = hex::decode(sig_hex).ok().filter(|v| v.len() == 64);
    match (pk, sg) {
        (Some(pk), Some(sg)) => {
            let vk = VerifyingKey::from_bytes(pk.as_slice().try_into().unwrap());
            let sig = Signature::from_bytes(sg.as_slice().try_into().unwrap());
            vk.map(|vk| vk.verify(msg, &sig).is_ok()).unwrap_or(false)
        }
        _ => false,
    }
}

fn sha256_hex(data: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(data);
    hex::encode(h.finalize())
}

// ---------------------------------------------------------------------------
// canonicalization
// ---------------------------------------------------------------------------

pub fn eval_canonicalization(input_raw: &str) -> Value {
    let v = match parse_strict(input_raw) {
        Ok(v) => v,
        Err(e) => return err(e.code),
    };
    let mut canon = String::new();
    canonicalize(&v, &mut canon);
    let digest = sha256_hex(canon.as_bytes());
    obj(vec![
        ("ok", b(true)),
        ("canonical", s(&canon)),
        ("sha256", s(&digest)),
    ])
}

// ---------------------------------------------------------------------------
// signature
// ---------------------------------------------------------------------------

pub fn eval_signature(input: &Value) -> Value {
    let key = get_str(input, "key").unwrap_or("");
    // INTERPRETATION: the key must be a strict 64-char lowercase hex
    // ed25519 public key. Anything else (alias, garbage, wrong length)
    // fails closed as UNKNOWN_KEY (pinned by sig-006 for "not-a-key").
    if !is_hex64_lower_str(key) {
        return err("UNKNOWN_KEY");
    }
    let message = match input.get("message").and_then(|v| v.as_str()) {
        Some(m) => m,
        None => return err("BAD_SIGNATURE"),
    };
    let sig = get_str(input, "signature").unwrap_or("");
    // Malformed signatures (non-hex, truncated) fail as BAD_SIGNATURE
    // (sig-004, sig-005) — the key resolved, the signature did not verify.
    if ed25519_verify(key, message.as_bytes(), sig) {
        obj(vec![("ok", b(true))])
    } else {
        err("BAD_SIGNATURE")
    }
}

// ---------------------------------------------------------------------------
// envelope
// ---------------------------------------------------------------------------

const SKEW_MS: f64 = 300_000.0;

const ENVELOPE_FIELDS: &[&str] = &[
    "protocol_version",
    "message_type",
    "message_id",
    "task_id",
    "nonce",
    "created_at",
    "expires_at",
    "sender",
    "recipient_identity",
    "crypto_suite",
    "payload",
    "signature",
];

fn parse_proto_version(s: &str) -> Option<(u64, u64)> {
    let rest = s.strip_prefix("nido/")?;
    let (maj, min) = rest.split_once('.')?;
    if maj.is_empty() || min.is_empty() {
        return None;
    }
    if !maj.bytes().all(|c| c.is_ascii_digit()) || !min.bytes().all(|c| c.is_ascii_digit()) {
        return None;
    }
    Some((maj.parse().ok()?, min.parse().ok()?))
}

fn eval_one_envelope(env: &Value, now: f64, skew_ms: f64, seen: &mut HashSet<String>) -> Value {
    // --- schema ------------------------------------------------------------
    for f in ENVELOPE_FIELDS {
        if env.get(f).is_none() {
            return err("ENVELOPE_MALFORMED");
        }
    }
    let str_field = |k: &str| get_str(env, k);
    for k in [
        "protocol_version",
        "message_type",
        "message_id",
        "task_id",
        "nonce",
        "crypto_suite",
        "recipient_identity",
    ] {
        if str_field(k).is_none() {
            return err("ENVELOPE_MALFORMED");
        }
    }
    let created_at = get_num(env, "created_at");
    let expires_at = get_num(env, "expires_at");
    let (created_at, expires_at) = match (created_at, expires_at) {
        (Some(c), Some(e)) if c.is_finite() && e.is_finite() => (c, e),
        _ => return err("ENVELOPE_MALFORMED"),
    };
    let sender = match env.get("sender") {
        Some(v) if v.is_obj() => v,
        _ => return err("ENVELOPE_MALFORMED"),
    };
    if env.get("payload").is_none() {
        return err("ENVELOPE_MALFORMED");
    }
    if get_str(env, "signature").is_none() {
        return err("ENVELOPE_MALFORMED");
    }
    // --- id formats ---------------------------------------------------------
    for k in ["message_id", "task_id", "nonce"] {
        if !is_hex32_lower(env.get(k).unwrap()) {
            return err("INVALID_ID_FORMAT");
        }
    }
    // --- version / suite / type ---------------------------------------------
    // v0 speaks exactly 'nido/1.0'. The reference does a byte-exact string
    // comparison (not a parse-and-compare, which would accept 'nido/01.0');
    // an unparseable or merely different version is UNSUPPORTED_VERSION
    // (fail closed: we cannot speak what we cannot parse).
    if str_field("protocol_version").unwrap() != "nido/1.0" {
        return err("UNSUPPORTED_VERSION");
    }
    if str_field("crypto_suite").unwrap() != "ed25519-sha256-v1" {
        return err("UNSUPPORTED_CRYPTO");
    }
    let message_type = str_field("message_type").unwrap();
    // v0 knows exactly one message type.
    if message_type != "TASK_REQUEST" {
        return err("UNKNOWN_MESSAGE_TYPE");
    }
    // --- timestamps ----------------------------------------------------------
    // Fractional timestamps are INVALID_TIMESTAMP (env-013). created_at in
    // the future beyond skew is INVALID_TIMESTAMP (env-012); expiry is
    // checked against now - skew (env-007/008 boundary).
    if created_at.fract() != 0.0 || expires_at.fract() != 0.0 {
        return err("INVALID_TIMESTAMP");
    }
    if expires_at <= created_at {
        return err("INVALID_TIMESTAMP");
    }
    if expires_at <= now - skew_ms {
        return err("EXPIRED");
    }
    if created_at > now + skew_ms {
        return err("INVALID_TIMESTAMP");
    }
    // --- sender / device certificate ------------------------------------------
    // NOTE: the replay set is intentionally NOT touched until the envelope
    // signature below verifies. Inserting before authentication lets an
    // invalid envelope poison the set for later envelopes in the same
    // batch (differential audit finding, 2026-09-27; mirrors reference-ts
    // which adds to `seen` only on the success path).
    let device_id = match get_str(sender, "device_id") {
        Some(d) => d,
        None => return err("ENVELOPE_MALFORMED"),
    };
    let identity_pubkey = match get_str(sender, "identity_pubkey") {
        Some(k) if is_hex64_lower_str(k) => k,
        _ => return err("ENVELOPE_MALFORMED"),
    };
    let cert = match sender.get("device_cert") {
        Some(c) if c.is_obj() => c,
        // Missing cert: we cannot authenticate the device at all.
        _ => return err("UNKNOWN_DEVICE"),
    };
    let cert_device_pubkey = match get_str(cert, "device_pubkey") {
        Some(k) if is_hex64_lower_str(k) => k,
        _ => return err("CERT_INVALID"),
    };
    let cert_identity = match get_str(cert, "identity_pubkey") {
        Some(k) => k,
        None => return err("CERT_INVALID"),
    };
    if cert_identity != identity_pubkey {
        return err("CERT_BINDING_MISMATCH");
    }
    let cert_issued = get_num(cert, "issued_at");
    let cert_expires = get_num(cert, "expires_at");
    let (cert_issued, cert_expires) = match (cert_issued, cert_expires) {
        (Some(i), Some(e)) if i.is_finite() && e.is_finite() => (i, e),
        _ => return err("CERT_INVALID"),
    };
    // INTERPRETATION: a cert that claims issuance after its own expiry is
    // malformed; a cert not yet valid (issued_at > now) is rejected.
    // Boundary for expiry: now >= expires_at is expired (AMB-06 unified).
    if cert_issued > cert_expires {
        return err("CERT_INVALID");
    }
    if cert_issued > now {
        return err("CERT_INVALID");
    }
    if now >= cert_expires {
        return err("CERT_EXPIRED");
    }
    let cert_sig = match get_str(cert, "signature") {
        Some(sv) => sv,
        None => return err("CERT_INVALID"),
    };
    // Cert signature covers the whole cert minus "signature" (verified
    // empirically against env-001).
    let mut cert_nosig: Vec<(String, Value)> = Vec::new();
    if let Value::Obj(pairs) = cert {
        for (k, v) in pairs {
            if k != "signature" {
                cert_nosig.push((k.clone(), v.clone()));
            }
        }
    }
    let mut cert_canon = String::new();
    canonicalize(&Value::Obj(cert_nosig), &mut cert_canon);
    if !ed25519_verify(identity_pubkey, cert_canon.as_bytes(), cert_sig) {
        return err("CERT_INVALID");
    }
    // --- envelope signature -----------------------------------------------------
    // Covers the canonical envelope minus "signature", INCLUDING unknown
    // envelope-level fields (verified empirically against env-002: the
    // x_trace field is signed but ignored for processing).
    let mut env_nosig: Vec<(String, Value)> = Vec::new();
    if let Value::Obj(pairs) = env {
        for (k, v) in pairs {
            if k != "signature" {
                env_nosig.push((k.clone(), v.clone()));
            }
        }
    }
    let mut env_canon = String::new();
    canonicalize(&Value::Obj(env_nosig), &mut env_canon);
    let env_sig = get_str(env, "signature").unwrap();
    if !ed25519_verify(cert_device_pubkey, env_canon.as_bytes(), env_sig) {
        return err("INVALID_SIGNATURE");
    }
    // --- replay --------------------------------------------------------------
    // Checked and populated only after authentication (see note above).
    let message_id = str_field("message_id").unwrap().to_string();
    if seen.contains(&message_id) {
        return err("DUPLICATE_MESSAGE");
    }
    // --- payload ----------------------------------------------------------------
    let payload = env.get("payload").unwrap();
    if !payload.is_obj() {
        return err("ENVELOPE_MALFORMED");
    }
    if has_forbidden_field(payload) {
        return err("FORBIDDEN_FIELD");
    }
    // TASK_REQUEST payload: capability, capability_version, parameters and
    // ttl_ms are required (AGENT_PROTOCOL.md §5.1 lists them without `?`;
    // the reference does not check requiredness but the spec schema does).
    // consent_requirement and idempotency_key are documented optional
    // fields (§5.1) accepted by the reference allowlist. Anything else is
    // PAYLOAD_MALFORMED (AMB-08: payload schema governs).
    //
    // NOTE (differential review): §5.1 also documents an optional
    // `delegation?` payload field, but the reference's per-type allowlist
    // rejects it. Classified SPEC_AMBIGUITY; this implementation follows
    // the reference (reject) until the spec is clarified. See
    // conformance/DIFFERENTIAL_REPORT_RUST.md.
    for k in ["capability", "capability_version"] {
        if get_str(payload, k).is_none() {
            return err("PAYLOAD_MALFORMED");
        }
    }
    match payload.get("parameters") {
        Some(p) if p.is_obj() => {}
        _ => return err("PAYLOAD_MALFORMED"),
    }
    if get_num(payload, "ttl_ms").is_none() {
        return err("PAYLOAD_MALFORMED");
    }
    let allowed_payload = [
        "capability",
        "capability_version",
        "parameters",
        "consent_requirement",
        "idempotency_key",
        "ttl_ms",
    ];
    if let Value::Obj(pairs) = payload {
        for (k, _) in pairs {
            if !allowed_payload.contains(&k.as_str()) {
                return err("PAYLOAD_MALFORMED");
            }
        }
    }
    // Authenticated and fully valid: only now does the message_id join the
    // replay set (mirrors reference-ts: add on success path only).
    seen.insert(message_id);
    obj(vec![
        ("ok", b(true)),
        ("message_type", s("TASK_REQUEST")),
        ("sender_device", s(device_id)),
        ("task_id", s(get_str(env, "task_id").unwrap())),
    ])
}

fn has_forbidden_field(v: &Value) -> bool {
    match v {
        Value::Obj(pairs) => pairs.iter().any(|(k, val)| {
            let kl = k.to_lowercase();
            kl == "prompt"
                || kl == "instructions"
                || kl == "system_prompt"
                || has_forbidden_field(val)
        }),
        Value::Arr(items) => items.iter().any(has_forbidden_field),
        _ => false,
    }
}

pub fn eval_envelope(ctx: Option<&Value>, input_raw: &str) -> Value {
    // The raw envelope text is parsed FIRST: a malformed envelope reports
    // its parse error even when the evaluation context is absent
    // (env-023, env-024).
    let parsed = match parse_strict(input_raw) {
        Ok(v) => v,
        Err(e) => return err(e.code),
    };
    // ctx = input.ctx: { now_ms, seen: [message_id...], skew_ms }
    let now = ctx
        .and_then(|c| c.get("now_ms"))
        .and_then(|v| v.as_f64())
        .filter(|v| v.is_finite());
    let now = match now {
        Some(v) => v,
        None => return err("ENVELOPE_MALFORMED"),
    };
    let skew_ms = ctx
        .and_then(|c| c.get("skew_ms"))
        .and_then(|v| v.as_f64())
        .filter(|v| v.is_finite() && *v >= 0.0)
        .unwrap_or(SKEW_MS);
    // Replay cache: seeded from ctx.seen, persists across the envelopes of
    // one evaluation (env-009 delivers two envelopes in one vector).
    let mut seen: HashSet<String> = ctx
        .and_then(|c| c.get("seen"))
        .and_then(|v| v.as_arr())
        .map(|a| {
            a.iter()
                .filter_map(|v| v.as_str().map(|x| x.to_string()))
                .collect()
        })
        .unwrap_or_default();
    match &parsed {
        Value::Arr(envs) => {
            let mut results = Vec::new();
            for env in envs {
                results.push(eval_one_envelope(env, now, skew_ms, &mut seen));
            }
            obj(vec![("ok", b(true)), ("results", arr(results))])
        }
        env => eval_one_envelope(env, now, skew_ms, &mut seen),
    }
}

// ---------------------------------------------------------------------------
// policy
// ---------------------------------------------------------------------------

fn constraints_satisfied(constraints: &Value, req: &Value) -> bool {
    let pairs = match constraints {
        Value::Obj(p) => p,
        _ => return false,
    };
    for (k, cval) in pairs {
        match k.as_str() {
            "max_window_ms" => {
                let max = match cval.as_f64() {
                    Some(v) => v,
                    None => return false,
                };
                match req.get("window_ms").and_then(|v| v.as_f64()) {
                    // INTERPRETATION: a missing window_ms cannot satisfy a
                    // max_window_ms constraint (fail closed).
                    Some(w) if w <= max => {}
                    _ => return false,
                }
            }
            "min_granularity_ms" => {
                let min = match cval.as_f64() {
                    Some(v) => v,
                    None => return false,
                };
                match req.get("granularity_ms").and_then(|v| v.as_f64()) {
                    Some(g) if g >= min => {}
                    _ => return false,
                }
            }
            "peers" => {
                let list = match cval.as_arr() {
                    Some(a) => a,
                    None => return false,
                };
                let peer = match req.get("peer").and_then(|v| v.as_str()) {
                    Some(p) => p,
                    None => return false,
                };
                if !list.iter().any(|v| v.as_str() == Some(peer)) {
                    return false;
                }
            }
            "max_disclosure_units" => {
                let max = match cval.as_f64() {
                    Some(v) => v,
                    None => return false,
                };
                // A request that does not declare disclosure_units declares
                // zero, which satisfies any non-negative max.
                let d = req
                    .get("disclosure_units")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(0.0);
                if !(d <= max) {
                    return false;
                }
            }
            // INTERPRETATION: unknown constraint types cannot be evaluated,
            // so they fail closed.
            _ => return false,
        }
    }
    true
}

pub fn eval_policy(input: &Value) -> Value {
    let rules = match input.get("rules").and_then(|v| v.as_arr()) {
        Some(r) => r,
        None => return obj(vec![("ok", b(true)), ("decision", s("DENY"))]),
    };
    let req = match input.get("request") {
        Some(r) if r.is_obj() => r,
        _ => return obj(vec![("ok", b(true)), ("decision", s("DENY"))]),
    };
    // `now` travels inside the request (policy vectors carry it as
    // request.now). Without a trustworthy `now`, rule expiry cannot be
    // evaluated; fail closed.
    let now = match get_num(req, "now") {
        Some(v) if v.is_finite() => v,
        _ => return obj(vec![("ok", b(true)), ("decision", s("DENY"))]),
    };
    let subj = get_str(req, "subject").unwrap_or("");
    let cap = get_str(req, "capability").unwrap_or("");
    let ver = get_str(req, "version").unwrap_or("");

    let mut matching: Vec<&Value> = Vec::new();
    for rule in rules {
        if get_str(rule, "subject").unwrap_or("\u{0}") != subj {
            continue;
        }
        if get_str(rule, "capability").unwrap_or("\u{0}") != cap {
            continue;
        }
        if get_str(rule, "version").unwrap_or("\u{0}") != ver {
            continue;
        }
        // Expired rules never match (boundary: now >= expires_at is expired).
        if let Some(exp) = get_num(rule, "expires_at") {
            if now >= exp {
                continue;
            }
        }
        matching.push(rule);
    }

    // DENY always wins over everything (pol-006).
    if matching.iter().any(|r| get_str(r, "mode") == Some("DENY")) {
        return obj(vec![("ok", b(true)), ("decision", s("DENY"))]);
    }
    // INTERPRETATION: an unknown rule mode fails closed as DENY.
    if matching.iter().any(|r| {
        !matches!(
            get_str(r, "mode"),
            Some("DENY") | Some("ASK") | Some("AUTO")
        )
    }) {
        return obj(vec![("ok", b(true)), ("decision", s("DENY"))]);
    }
    // Most permissive live rule wins (reference policy.ts): a matching AUTO
    // rule takes precedence over ASK_USER; ASK applies only when no AUTO
    // rule matches.
    let autos: Vec<&&Value> = matching
        .iter()
        .filter(|r| get_str(r, "mode") == Some("AUTO"))
        .collect();
    if autos.is_empty() {
        if matching.iter().any(|r| get_str(r, "mode") == Some("ASK")) {
            return obj(vec![("ok", b(true)), ("decision", s("ASK_USER"))]);
        }
        return obj(vec![("ok", b(true)), ("decision", s("DENY"))]);
    }
    let mut plain = false;
    let mut conditional = false;
    for rule in autos {
        let c = rule.get("constraints");
        let empty = match c {
            None => true,
            Some(Value::Obj(p)) => p.is_empty(),
            Some(_) => false,
        };
        if empty {
            plain = true;
        } else if constraints_satisfied(c.unwrap(), req) {
            conditional = true;
        }
    }
    let decision = if plain {
        if subj == "local" {
            "ALLOW_ONCE"
        } else {
            "ALLOW_FOR_CONTACT"
        }
    } else if conditional {
        "ALLOW_UNDER_CONDITIONS"
    } else {
        "DENY"
    };
    obj(vec![("ok", b(true)), ("decision", s(decision))])
}

// ---------------------------------------------------------------------------
// budget
// ---------------------------------------------------------------------------

pub fn eval_budget(input: &Value) -> Value {
    let opts = match input.get("opts") {
        Some(o) if o.is_obj() => o,
        _ => {
            return obj(vec![
                ("ok", b(false)),
                ("error", s("BUDGET_INVALID")),
                ("at_step", n(0.0)),
            ])
        }
    };
    let budget = get_num(opts, "budget").unwrap_or(f64::NAN);
    let window_ms = get_num(opts, "window_ms").unwrap_or(f64::NAN);
    let now = get_num(opts, "now").unwrap_or(f64::NAN);
    // INTERPRETATION: a negative budget or non-positive window is a
    // malformed policy; fail closed before any step.
    if !(budget >= 0.0) || !(window_ms > 0.0) || !now.is_finite() {
        return obj(vec![
            ("ok", b(false)),
            ("error", s("BUDGET_INVALID")),
            ("at_step", n(0.0)),
        ]);
    }
    // state: identity -> { window_start, consumed }
    let mut state: HashMap<String, (f64, f64)> = HashMap::new();
    if let Some(Value::Obj(pairs)) = input.get("state") {
        for (id, entry) in pairs {
            let ws = get_num(entry, "window_start");
            let co = get_num(entry, "consumed");
            match (ws, co) {
                (Some(ws), Some(co)) if ws.is_finite() && co.is_finite() && co >= 0.0 => {
                    state.insert(id.clone(), (ws, co));
                }
                // INTERPRETATION: corrupt accounting state fails closed —
                // never spend against books we cannot read.
                _ => {
                    return obj(vec![
                        ("ok", b(false)),
                        ("error", s("BUDGET_INVALID")),
                        ("at_step", n(0.0)),
                    ])
                }
            }
        }
    }
    let steps = match input.get("steps").and_then(|v| v.as_arr()) {
        Some(sv) => sv,
        None => {
            return obj(vec![
                ("ok", b(false)),
                ("error", s("BUDGET_INVALID")),
                ("at_step", n(0.0)),
            ])
        }
    };
    let mut last_remaining = budget;
    for (i, step) in steps.iter().enumerate() {
        let units = step.get("units").and_then(|v| v.as_f64());
        let identity = step.get("identity").and_then(|v| v.as_str());
        let (units, identity) = match (units, identity) {
            (Some(u), Some(id)) if u.is_finite() && u >= 0.0 => (u, id),
            _ => {
                return obj(vec![
                    ("ok", b(false)),
                    ("error", s("BUDGET_INVALID")),
                    ("at_step", n(i as f64)),
                ])
            }
        };
        let (ws, consumed) = match state.get(identity) {
            Some(&(ws, co)) if now - ws < window_ms => (ws, co),
            _ => (now, 0.0),
        };
        if consumed + units > budget {
            return obj(vec![
                ("ok", b(false)),
                ("error", s("BUDGET_EXHAUSTED")),
                ("at_step", n(i as f64)),
            ]);
        }
        let consumed = consumed + units;
        state.insert(identity.to_string(), (ws, consumed));
        last_remaining = budget - consumed;
    }
    obj(vec![("ok", b(true)), ("remaining", n(last_remaining))])
}

// ---------------------------------------------------------------------------
// disclosure
// ---------------------------------------------------------------------------

enum Seg {
    Field(String),
    ArrayField(String), // "name[]"
}

fn parse_path(path: &str) -> Vec<Seg> {
    path.split('.')
        .map(|seg| {
            if let Some(name) = seg.strip_suffix("[]") {
                Seg::ArrayField(name.to_string())
            } else {
                Seg::Field(seg.to_string())
            }
        })
        .collect()
}

fn apply_path(result: &mut Value, value: &Value, segs: &[Seg]) {
    let (head, rest) = match segs.split_first() {
        Some(x) => x,
        None => return,
    };
    match head {
        Seg::Field(name) => {
            let child = match value {
                Value::Obj(pairs) => pairs.iter().find(|(k, _)| k == name).map(|(_, v)| v),
                _ => None,
            };
            let child = match child {
                Some(c) => c,
                None => return,
            };
            if rest.is_empty() {
                // Whole subtree is disclosed (documents the granularity
                // limit: allowlisting "a" discloses all of "a").
                match result {
                    Value::Obj(pairs) => {
                        if let Some(slot) = pairs.iter_mut().find(|(k, _)| k == name) {
                            slot.1 = child.clone();
                        } else {
                            pairs.push((name.clone(), child.clone()));
                        }
                    }
                    _ => {}
                }
                return;
            }
            if !child.is_obj() {
                return;
            }
            let slot: &mut Value = match result {
                Value::Obj(pairs) => {
                    if !pairs.iter().any(|(k, _)| k == name) {
                        pairs.push((name.clone(), Value::Obj(Vec::new())));
                    }
                    pairs
                        .iter_mut()
                        .find(|(k, _)| k == name)
                        .map(|(_, v)| v)
                        .unwrap()
                }
                _ => return,
            };
            if slot.is_obj() {
                apply_path(slot, child, rest);
            }
        }
        Seg::ArrayField(name) => {
            let arrv = match value {
                Value::Obj(pairs) => pairs.iter().find(|(k, _)| k == name).map(|(_, v)| v),
                _ => None,
            };
            let items = match arrv.and_then(|v| v.as_arr()) {
                Some(a) => a,
                None => return,
            };
            // Ensure result[name] is an array of matching length.
            let out_items: &mut Vec<Value> = match result {
                Value::Obj(pairs) => {
                    if !pairs.iter().any(|(k, _)| k == name) {
                        pairs.push((name.clone(), Value::Arr(vec![Value::Null; items.len()])));
                    }
                    let slot = pairs
                        .iter_mut()
                        .find(|(k, _)| k == name)
                        .map(|(_, v)| v)
                        .unwrap();
                    match slot {
                        Value::Arr(a) => a,
                        _ => return,
                    }
                }
                _ => return,
            };
            if out_items.len() != items.len() {
                out_items.resize(items.len(), Value::Null);
            }
            for (i, elem) in items.iter().enumerate() {
                if rest.is_empty() {
                    // Trailing "[]": project each element wholly.
                    out_items[i] = elem.clone();
                } else if elem.is_obj() {
                    if !out_items[i].is_obj() {
                        out_items[i] = Value::Obj(Vec::new());
                    }
                    apply_path(&mut out_items[i], elem, rest);
                } else {
                    // INTERPRETATION: non-object array elements disclose
                    // nothing; emit an empty object to preserve structure
                    // without fabricating content.
                    out_items[i] = Value::Obj(Vec::new());
                }
            }
        }
    }
}

pub fn eval_disclosure(input: &Value) -> Value {
    let allowed = match input.get("allowed").and_then(|v| v.as_arr()) {
        Some(a) => a,
        None => return obj(vec![("ok", b(true)), ("projected", Value::Null)]),
    };
    if allowed.is_empty() {
        return obj(vec![("ok", b(true)), ("projected", Value::Null)]);
    }
    let value = match input.get("value") {
        Some(v) if v.is_obj() => v,
        // INTERPRETATION (INV-5): non-object values project to null.
        _ => return obj(vec![("ok", b(true)), ("projected", Value::Null)]),
    };
    let mut result = Value::Obj(Vec::new());
    for p in allowed {
        if let Some(path) = p.as_str() {
            apply_path(&mut result, value, &parse_path(path));
        }
    }
    obj(vec![("ok", b(true)), ("projected", result)])
}

// ---------------------------------------------------------------------------
// graph
// ---------------------------------------------------------------------------

pub fn eval_graph(input: &Value) -> Value {
    let nodes = match input.get("nodes").and_then(|v| v.as_arr()) {
        Some(a) => a,
        None => return err("GRAPH_INVALID"),
    };
    let budget = match get_num(input, "budget") {
        Some(v) if v.is_finite() && v >= 0.0 => v,
        _ => return err("GRAPH_INVALID"),
    };
    let mut total = 0.0;
    for node in nodes {
        match node.get("disclosed_units").and_then(|v| v.as_f64()) {
            // INTERPRETATION (INV-5): negative or non-finite disclosed_units
            // would corrupt disclosure accounting (under-counting); the
            // function refuses to certify instead of failing open.
            Some(u) if u.is_finite() && u >= 0.0 => total += u,
            _ => return err("GRAPH_INVALID"),
        }
    }
    if total > budget {
        err("GRAPH_BUDGET_EXCEEDED")
    } else {
        obj(vec![("ok", b(true)), ("total", n(total))])
    }
}

// ---------------------------------------------------------------------------
// delegation
// ---------------------------------------------------------------------------

const TOKEN_FIELDS: &[&str] = &[
    "v",
    "issuer_identity",
    "subject_identity",
    "capability",
    "capability_version",
    "scope",
    "issued_at",
    "expires_at",
];

pub fn eval_delegation(input: &Value) -> Value {
    let chain = match input.get("chain").and_then(|v| v.as_arr()) {
        Some(c) if !c.is_empty() => c,
        _ => return err("DELEGATION_INVALID"),
    };
    let pubkeys = match input.get("pubkeys") {
        Some(Value::Obj(p)) => p,
        _ => return err("DELEGATION_INVALID"),
    };
    let now = match get_num(input, "now") {
        Some(v) if v.is_finite() => v,
        _ => return err("DELEGATION_INVALID"),
    };

    let mut prev: Option<&Value> = None;
    for tok in chain {
        if !tok.is_obj() {
            return err("DELEGATION_INVALID");
        }
        if get_str(tok, "v") != Some("nido-delegation/1") {
            return err("DELEGATION_INVALID");
        }
        let issuer = match get_str(tok, "issuer_identity") {
            Some(x) => x,
            None => return err("DELEGATION_INVALID"),
        };
        let _subject = match get_str(tok, "subject_identity") {
            Some(x) => x,
            None => return err("DELEGATION_INVALID"),
        };
        let capability = match get_str(tok, "capability") {
            Some(x) => x,
            None => return err("DELEGATION_INVALID"),
        };
        let cap_version = match get_str(tok, "capability_version") {
            Some(x) => x,
            None => return err("DELEGATION_INVALID"),
        };
        let scope = match tok.get("scope") {
            Some(sv) if sv.is_obj() => sv,
            _ => return err("DELEGATION_INVALID"),
        };
        // max_uses must be an integer >= 1: a zero-use delegation grants
        // nothing and is malformed (reference rejects it; fail closed).
        let max_uses = match scope.get("max_uses").and_then(|v| v.as_f64()) {
            Some(u) if u.is_finite() && u >= 1.0 && u.fract() == 0.0 => u,
            _ => return err("DELEGATION_INVALID"),
        };
        // peers is OPTIONAL per the token interface (missing = unrestricted
        // peer scope). When present it must be an array of strings.
        let peers: Option<Vec<&str>> = match scope.get("peers") {
            None => None,
            Some(v) => match v.as_arr() {
                Some(a) => {
                    let mut out = Vec::new();
                    for p in a {
                        match p.as_str() {
                            Some(ps) => out.push(ps),
                            None => return err("DELEGATION_INVALID"),
                        }
                    }
                    Some(out)
                }
                None => return err("DELEGATION_INVALID"),
            },
        };
        let issued_at = get_num(tok, "issued_at");
        let expires_at = get_num(tok, "expires_at");
        let (issued_at, expires_at) = match (issued_at, expires_at) {
            (Some(i), Some(e)) if i.is_finite() && e.is_finite() => (i, e),
            _ => return err("DELEGATION_INVALID"),
        };
        // A token whose expiry is not after its issuance is malformed
        // (zero/negative-duration delegation is meaningless; fail closed).
        // Expiry boundary: now >= expires_at is expired (AMB-06 unified).
        if issued_at >= expires_at {
            return err("DELEGATION_INVALID");
        }
        if now >= expires_at {
            return err("DELEGATION_INVALID");
        }
        // Signature scope: canonical form of the KNOWN token fields minus
        // "signature", with the scope RECONSTRUCTED as {peers, max_uses}
        // (peers normalized to null when absent), exactly like the
        // reference's tokenBody. Unknown top-level fields are ignored for
        // verification (verified empirically: neg-003's "note" is not
        // covered by the signature); unknown scope fields are likewise
        // excluded by the reconstruction.
        let pubkey = pubkeys
            .iter()
            .find(|(k, _)| k == issuer)
            .and_then(|(_, v)| v.as_str())
            .unwrap_or("");
        if !is_hex64_lower_str(pubkey) {
            return err("DELEGATION_INVALID");
        }
        let signed_scope = obj(vec![
            (
                "peers",
                match &peers {
                    Some(pl) => arr(pl.iter().map(|x| s(x)).collect()),
                    None => Value::Null,
                },
            ),
            ("max_uses", n(max_uses)),
        ]);
        let mut signed_pairs: Vec<(String, Value)> = Vec::new();
        if let Value::Obj(pairs) = tok {
            for (k, v) in pairs {
                if k == "signature" {
                    continue;
                }
                if k == "scope" {
                    signed_pairs.push((k.clone(), signed_scope.clone()));
                } else if TOKEN_FIELDS.contains(&k.as_str()) {
                    signed_pairs.push((k.clone(), v.clone()));
                }
            }
        }
        let mut canon = String::new();
        canonicalize(&Value::Obj(signed_pairs), &mut canon);
        let sig = get_str(tok, "signature").unwrap_or("");
        if !ed25519_verify(pubkey, canon.as_bytes(), sig) {
            return err("DELEGATION_INVALID");
        }
        // Linkage + attenuation against the previous token.
        if let Some(p) = prev {
            if get_str(tok, "issuer_identity") != get_str(p, "subject_identity") {
                return err("DELEGATION_INVALID");
            }
            if capability != get_str(p, "capability").unwrap_or("")
                || cap_version != get_str(p, "capability_version").unwrap_or("")
            {
                return err("DELEGATION_INVALID");
            }
            let p_scope = p.get("scope").unwrap();
            let p_max = p_scope
                .get("max_uses")
                .and_then(|v| v.as_f64())
                .unwrap_or(-1.0);
            if max_uses > p_max {
                return err("DELEGATION_INVALID");
            }
            let p_exp = get_num(p, "expires_at").unwrap_or(f64::INFINITY);
            if expires_at > p_exp {
                return err("DELEGATION_INVALID");
            }
            // Peer attenuation: only checked when the parent restricts peers.
            // An unrestricted parent (no peers list) lets the child narrow
            // freely; a missing child list means "no peers" (maximally
            // narrow), which is always a subset.
            let p_peers: Option<Vec<&str>> = p_scope
                .get("peers")
                .and_then(|v| v.as_arr())
                .map(|a| a.iter().filter_map(|v| v.as_str()).collect());
            if let Some(pp) = p_peers {
                let cp: &[&str] = peers.as_deref().unwrap_or(&[]);
                if !cp.iter().all(|x| pp.contains(x)) {
                    return err("DELEGATION_INVALID");
                }
            }
        }
        prev = Some(tok);
    }
    let leaf = prev.unwrap();
    obj(vec![
        ("ok", b(true)),
        (
            "leaf_subject",
            s(get_str(leaf, "subject_identity").unwrap()),
        ),
        (
            "max_uses",
            n(leaf
                .get("scope")
                .unwrap()
                .get("max_uses")
                .and_then(|v| v.as_f64())
                .unwrap()),
        ),
    ])
}

// ---------------------------------------------------------------------------
// consent
// ---------------------------------------------------------------------------

pub fn eval_consent(input: &Value) -> Value {
    let grant = match input.get("grant") {
        Some(g) if g.is_obj() => g,
        _ => return err("POLICY_DENIED"),
    };
    let req = match input.get("request") {
        Some(r) if r.is_obj() => r,
        _ => return err("POLICY_DENIED"),
    };
    // Binding: exact match on peer / capability / version / parameters_hash.
    // A missing field cannot match (fail closed).
    let bound = [
        "capability",
        "capability_version",
        "peer",
        "parameters_hash",
    ]
    .iter()
    .all(|k| get_str(req, k).is_some() && get_str(req, k) == get_str(grant, k));
    if !bound {
        return err("POLICY_DENIED");
    }
    // INTERPRETATION: without a trustworthy request time, expiry cannot be
    // evaluated; fail closed.
    let now = match get_num(req, "now") {
        Some(v) if v.is_finite() => v,
        _ => return err("POLICY_DENIED"),
    };
    let expires_at = match get_num(grant, "expires_at") {
        Some(v) if v.is_finite() => v,
        _ => return err("POLICY_DENIED"),
    };
    // Boundary (AMB-06 unified): now >= expires_at is expired.
    if now >= expires_at {
        return err("CONSENT_EXPIRED");
    }
    let uses = match grant.get("uses").and_then(|v| v.as_f64()) {
        Some(u) if u.is_finite() && u >= 0.0 && u.fract() == 0.0 => u,
        _ => return err("POLICY_DENIED"),
    };
    let max_uses = match grant.get("max_uses").and_then(|v| v.as_f64()) {
        Some(u) if u.is_finite() && u >= 0.0 && u.fract() == 0.0 => u,
        _ => return err("POLICY_DENIED"),
    };
    if uses >= max_uses {
        return err("CONSENT_EXHAUSTED");
    }
    obj(vec![
        ("ok", b(true)),
        ("uses_left", n(max_uses - uses - 1.0)),
    ])
}

// ---------------------------------------------------------------------------
// versions
// ---------------------------------------------------------------------------

pub fn eval_protocol_version(input: &Value) -> Value {
    let get = |k: &str| get_str(input, k).unwrap_or("");
    let mut vers: Vec<(u64, u64)> = Vec::new();
    for k in ["localMin", "localMax", "peerMin", "peerMax"] {
        match parse_proto_version(get(k)) {
            Some(v) => vers.push(v),
            // INTERPRETATION: an unparseable protocol version is
            // VERSION_MALFORMED (pinned for the "v1"-style case by ver-004).
            None => return err("VERSION_MALFORMED"),
        }
    }
    let (lmin, lmax, pmin, pmax) = (vers[0], vers[1], vers[2], vers[3]);
    // INTERPRETATION: an inverted range (min > max) is malformed, for
    // either side (ver-006 pins the local side).
    if lmin > lmax || pmin > pmax {
        return err("VERSION_MALFORMED");
    }
    let lo = lmin.max(pmin);
    let hi = lmax.min(pmax);
    if lo > hi {
        return err("UNSUPPORTED_VERSION");
    }
    obj(vec![
        ("ok", b(true)),
        ("version", s(&format!("nido/{}.{}", hi.0, hi.1))),
    ])
}

fn parse_cap_version(s: &str) -> Option<u64> {
    let rest = s.strip_prefix('v')?;
    if rest.is_empty() || !rest.bytes().all(|c| c.is_ascii_digit()) {
        return None;
    }
    rest.parse().ok()
}

pub fn eval_capability_version(input: &Value) -> Value {
    let parse_list = |k: &str| -> Option<Vec<u64>> {
        let a = input.get(k).and_then(|v| v.as_arr())?;
        let mut out = Vec::new();
        for v in a {
            out.push(parse_cap_version(v.as_str()?)?);
        }
        Some(out)
    };
    let (local, peer) = match (parse_list("local"), parse_list("peer")) {
        (Some(l), Some(p)) => (l, p),
        // cver-003: "2" (missing the 'v' prefix) is VERSION_MALFORMED.
        _ => return err("VERSION_MALFORMED"),
    };
    let common: Vec<u64> = local.into_iter().filter(|v| peer.contains(v)).collect();
    match common.into_iter().max() {
        Some(v) => obj(vec![("ok", b(true)), ("version", s(&format!("v{v}")))]),
        None => err("UNSUPPORTED_VERSION"),
    }
}

// ---------------------------------------------------------------------------
// extension
// ---------------------------------------------------------------------------

pub fn eval_extension(input: &Value) -> Value {
    let core: HashSet<String> = match input.get("core").and_then(|v| v.as_arr()) {
        Some(a) => a
            .iter()
            .filter_map(|v| v.as_str().map(|x| x.to_string()))
            .collect(),
        None => HashSet::new(),
    };
    let attempts: Vec<String> = match input.get("attempts").and_then(|v| v.as_arr()) {
        Some(a) => a
            .iter()
            .filter_map(|v| v.as_str().map(|x| x.to_string()))
            .collect(),
        None => Vec::new(),
    };
    let mut registry = core.clone();
    let mut results = Vec::new();
    for name in attempts {
        // Shadowing is an EXACT match against a core capability name; a
        // mere prefix does not shadow (neg-010).
        if core.contains(&name) {
            results.push(s("EXTENSION_SHADOWING"));
        } else if registry.contains(&name) {
            results.push(s("ALREADY_REGISTERED"));
        } else {
            registry.insert(name);
            results.push(s("ok"));
        }
    }
    obj(vec![("ok", b(true)), ("results", arr(results))])
}

// ---------------------------------------------------------------------------
// state machine
// ---------------------------------------------------------------------------

const TABLES_JSON: &str = include_str!("../../vectors/v0/final/state_machines_tables.json");

pub fn eval_state_machine(input: &Value) -> Value {
    let machine = get_str(input, "machine").unwrap_or("");
    let events: Vec<&str> = match input.get("events").and_then(|v| v.as_arr()) {
        Some(a) => a.iter().filter_map(|v| v.as_str()).collect(),
        None => return err("INVALID_TRANSITION"),
    };
    let tables: Value = match parse_strict(TABLES_JSON) {
        Ok(t) => t,
        Err(_) => return err("UNKNOWN_MACHINE"),
    };
    let spec = match tables.get("machines").and_then(|m| m.get(machine)) {
        Some(sp) => sp,
        None => return err("UNKNOWN_MACHINE"),
    };
    let initial = get_str(spec, "initial").unwrap_or("");
    let terminal: HashSet<&str> = spec
        .get("terminal")
        .and_then(|v| v.as_arr())
        .map(|a| a.iter().filter_map(|v| v.as_str()).collect())
        .unwrap_or_default();
    let transitions = spec.get("transitions");
    let mut state = initial.to_string();
    for (i, ev) in events.iter().enumerate() {
        if terminal.contains(state.as_str()) {
            return obj(vec![
                ("ok", b(false)),
                ("error", s("TERMINAL_STATE")),
                ("at_event", n(i as f64)),
            ]);
        }
        let next = transitions
            .and_then(|t| t.get(&state))
            .and_then(|st| st.get(ev))
            .and_then(|v| v.as_str());
        match next {
            Some(nx) => state = nx.to_string(),
            None => {
                return obj(vec![
                    ("ok", b(false)),
                    ("error", s("INVALID_TRANSITION")),
                    ("at_event", n(i as f64)),
                ])
            }
        }
    }
    obj(vec![("ok", b(true)), ("final", s(&state))])
}

// ---------------------------------------------------------------------------
// idempotency
// ---------------------------------------------------------------------------

pub fn eval_idempotency(input: &Value) -> Value {
    let task_ids: Vec<&str> = match input.get("task_ids").and_then(|v| v.as_arr()) {
        Some(a) => a.iter().filter_map(|v| v.as_str()).collect(),
        None => Vec::new(),
    };
    let mut seen: HashSet<&str> = HashSet::new();
    let mut log = Vec::new();
    let mut executed = 0u64;
    let mut dups = 0u64;
    for tid in task_ids {
        if seen.insert(tid) {
            log.push(s("EXECUTED"));
            executed += 1;
        } else {
            log.push(s("DUPLICATE"));
            dups += 1;
        }
    }
    obj(vec![
        ("ok", b(true)),
        ("executed_count", n(executed as f64)),
        ("duplicates_rejected", n(dups as f64)),
        ("log", arr(log)),
    ])
}
