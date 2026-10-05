> **Language:** English · [Español](../es/reference-rs/README.md)
# reference-rs — NIDO conformance reference implementation (Rust)

Second, independent implementation of the NIDO v0 conformance surface,
written from the spec text and the official vectors — not a mechanical
translation of `reference-ts`. Exists to prove **interoperability**, not
imitation: any behavioral divergence found during differential testing is
classified (`SPEC_AMBIGUITY` / `TS_BUG` / `RUST_BUG` / `VECTOR_BUG` /
`UNSPECIFIED_BEHAVIOR`) and the spec is fixed first, then a regression
vector is added, then the implementations.

## Layout

| Path | Contents |
|---|---|
| `src/lib.rs` | Library root; re-exports `canon`, `eval`, `json`, `num` for integration tests |
| `src/main.rs` | Thin NDJSON/stdin-stdout adapter (harness protocol only, no logic) |
| `src/json.rs` | Strict JSON parser: rejects duplicates, trailing data, lone surrogates, unescaped C0, unsafe integers, non-finite numbers; max nesting depth 128 (`NESTING_TOO_DEEP`) |
| `src/canon.rs` | NIDO v0 canonicalization profile (key sort by UTF-16 code units; all C0 controls as `\uXXXX` — see deviation note) |
| `src/num.rs` | `format_es`: f64 → string, bit-for-bit identical to `Number.prototype.toString` (verified on 20,026 patterns, 0 mismatches) |
| `src/eval.rs` | All evaluators: canonicalization, envelope, signature, protocol/capability versions, policy, consent, delegation, budget, graph, idempotency, disclosure, extensions, state machines |
| `tests/` | `float_differential.rs`, `properties.rs`, `invariants.rs`, corpus generators |

Crypto: `ed25519-dalek` (audited) + `sha2` (audited). No hand-rolled crypto.

## Build & test

```bash
export PATH="$HOME/.cargo/bin:$PATH"   # rustup stable + rustfmt
cd conformance/reference-rs
cargo fmt --check
cargo test --locked        # 14 unit + 1 float-differential + 12 invariant attacks + 16 property tests
```

## Differential testing

```bash
cd ~/workspace/nido-app
python3 conformance/harness/runner.py --impl ./conformance/reference-rs/target/debug/nido-conformance-rs
# passed=157 failed=0 ; results saved per-run to conformance/harness/differential-results-rs.json
# (the runner writes conformance/harness/differential-results.json; restore it with
#  git checkout afterwards — it is the TS-tracked results file)
```

The NDJSON protocol matches the language-agnostic harness: one JSON vector
per line on stdin (`{"category","id","input"/"input_raw"}`), one JSON result
per line on stdout (`{"ok","error"|...}`).

## Known deviations from RFC 8785 (intentional, documented)

The NIDO v0 canonicalization profile escapes **all** C0 controls as
`\uXXXX`, while RFC 8785 §3.2.2.2 requires `\b \t \n \f \r` for five of
them. This is a frozen v0 profile decision (changing it would change every
hash and signature); it is documented in `src/canon.rs` and classified as
`SPEC_AMBIGUITY` in the differential report. Do not "fix" it silently.

## Security-relevant limits

- `MAX_PARSE_DEPTH = 128`: deeper nesting → typed error `NESTING_TOO_DEEP`
  (a recursive parser without a limit is a remotely triggerable stack
  overflow; found by invariant attack INV-7, fixed 2026-09-27).
- The canonicalizer carries its own depth guard and is total (never panics).
- `src/main.rs` never panics on malformed input lines; it emits
  `{"ok":false,"error":"ADAPTER_ERROR"}`.
