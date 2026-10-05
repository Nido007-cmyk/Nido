//! `nido-conformance-rs`: language-agnostic conformance harness adapter.
//!
//! Protocol (identical to `reference-ts`):
//! - stdin: one JSON object per line: `{"id": "...", "kind": "...",
//!   "input": {...}}` — or `"input_raw": "..."` for the `envelope` and
//!   `canonicalization` kinds.
//! - stdout: one JSON object per line: `{"id": "...", "result": {...}}`.
//! - Logs go to stderr only, so stdout stays machine-parseable.

use nido_conformance_rs::json::{parse_strict, Value};
use nido_conformance_rs::{eval, json};
use std::io::{BufRead, Write};

fn main() {
    let stdin = std::io::stdin();
    let stdout = std::io::stdout();
    let mut out = stdout.lock();
    for line in stdin.lock().lines() {
        let line = match line {
            Ok(l) => l,
            Err(e) => {
                eprintln!("[nido-conformance-rs] stdin read error: {e}");
                continue;
            }
        };
        if line.trim().is_empty() {
            continue;
        }
        let response = handle_line(&line);
        let mut buf = String::new();
        json::write_compact(&response, &mut buf);
        buf.push('\n');
        if out.write_all(buf.as_bytes()).is_err() {
            break;
        }
    }
    let _ = out.flush();
}

fn handle_line(line: &str) -> Value {
    let vec = match parse_strict(line) {
        Ok(v) => v,
        Err(e) => {
            eprintln!(
                "[nido-conformance-rs] vector line failed to parse: {}",
                e.code
            );
            return obj2("unparsed", err_obj("VECTOR_MALFORMED"));
        }
    };
    let id = vec
        .get("id")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown")
        .to_string();
    let kind = vec.get("kind").and_then(|v| v.as_str()).unwrap_or("");
    // `canonicalization` and `envelope` carry their raw text at the TOP
    // level of the vector (sibling of `input`), not inside `input`.
    let input_raw = vec.get("input_raw").and_then(|v| v.as_str());
    let result = match kind {
        "canonicalization" => match input_raw {
            Some(raw) => eval::eval_canonicalization(raw),
            None => err_obj("VECTOR_MALFORMED"),
        },
        "signature" => dispatch_input(&vec, eval::eval_signature),
        "envelope" => {
            let raw = match input_raw {
                Some(r) => r,
                None => return obj2(&id, err_obj("VECTOR_MALFORMED")),
            };
            let ctx = vec.get("input").and_then(|v| v.get("ctx"));
            eval::eval_envelope(ctx, raw)
        }
        "policy" => dispatch_input(&vec, eval::eval_policy),
        "budget" => dispatch_input(&vec, eval::eval_budget),
        "disclosure" => dispatch_input(&vec, eval::eval_disclosure),
        "graph" => dispatch_input(&vec, eval::eval_graph),
        "delegation" => dispatch_input(&vec, eval::eval_delegation),
        "consent" => dispatch_input(&vec, eval::eval_consent),
        "protocol_version" => dispatch_input(&vec, eval::eval_protocol_version),
        "capability_version" => dispatch_input(&vec, eval::eval_capability_version),
        "extension" => dispatch_input(&vec, eval::eval_extension),
        "state_machine" => dispatch_input(&vec, eval::eval_state_machine),
        "idempotency" => dispatch_input(&vec, eval::eval_idempotency),
        other => {
            eprintln!("[nido-conformance-rs] unknown kind: {other}");
            err_obj("UNKNOWN_KIND")
        }
    };
    obj2(&id, result)
}

fn dispatch_input(vec: &Value, f: fn(&Value) -> Value) -> Value {
    match vec.get("input") {
        Some(input) => f(input),
        None => err_obj("VECTOR_MALFORMED"),
    }
}

fn err_obj(code: &str) -> Value {
    Value::Obj(vec![
        ("ok".to_string(), Value::Bool(false)),
        ("error".to_string(), Value::Str(code.to_string())),
    ])
}

fn obj2(id: &str, result: Value) -> Value {
    Value::Obj(vec![
        ("id".to_string(), Value::Str(id.to_string())),
        ("result".to_string(), result),
    ])
}
