> **Language:** English · [Español](es/README.md)
# NIDO Protocol Conformance Suite v0

Executable verification that two implementations understand the protocol
document the same way. The suite does NOT measure features; it measures
**verified attack-surface reduction** (see `SECURITY_INVARIANTS.md`).

> "NO CONFÍES EN QUE DOS IMPLEMENTACIONES ENTENDIERON EL DOCUMENTO IGUAL. DEMUÉSTRALO."

## Layout

```
conformance/
  reference-ts/        # Reference implementation (TypeScript, NOT product code)
  vectors/v0/source/   # Human-authored vectors (may use key aliases)
  vectors/v0/final/    # Generated, frozen vectors (literal keys, signed)
  harness/             # Language-agnostic differential harness (NDJSON over stdio)
  harness/reference-python/  # PARTIAL second implementation (canonicalization + SHA-256)
  __tests__/
    gen.test.ts        # Deterministic generator + freshness check
    vectors.test.ts    # Generic runner over final/ (157 vectors)
    properties.test.ts # Fuzz / property tests (7 properties)
  SECURITY_INVARIANTS.md
  SPEC_AMBIGUITIES.md
```

## Status

- `IMPLEMENTED` · `AUTOMATED/UNIT TESTED`: yes (157 vectors + 7 properties green)
- `ANDROID COMPILED` / `EMULATOR TESTED` / `PHYSICAL DEVICE TESTED`: no
- `EXTERNALLY AUDITED`: no
- Second implementation: PARTIAL (Python, canonicalization + SHA-256 only).
  Full second implementation (Rust preferred) is still pending.

## Running

```bash
npx vitest run conformance/__tests__     # full suite
npx tsc --noEmit                        # typecheck

# Differential test against the partial Python implementation:
python3 conformance/harness/runner.py \
  --impl "python3 conformance/harness/reference-python/canon.py --ndjson" \
  --only canonicalization

# Any other implementation speaking the harness protocol:
python3 conformance/harness/runner.py --impl ./my-iut
```

## Modifying vectors

1. Edit ONLY `vectors/v0/source/*.json`.
2. Regenerate: `CONFORMANCE_GEN=1 npx vitest run conformance/__tests__/gen.test.ts`
3. The freshness test fails if `final/` is stale — regenerate, never hand-edit.
4. Run the full suite + typecheck before committing.

## Normative documents

- `SECURITY_INVARIANTS.md` — the 7 invariants, each as
  threat → exploit path → mitigation → test.
- `SPEC_AMBIGUITIES.md` — 10 ambiguities found and resolved, with the
  conservative (fail-closed) reading recorded.

## Non-goals (v0)

No new features, no relay/Internet P2P, no group crypto, no agent economy,
no new capabilities. `calendar.availability.query/v1` stays BLOCKED until:
stable suite → second independent implementation → differential tests →
C-1 verified on Android where possible.
