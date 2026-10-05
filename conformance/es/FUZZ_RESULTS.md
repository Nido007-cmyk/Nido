> **Idioma:** [English](../FUZZ_RESULTS.md) · Español
# RESULTADOS DE FUZZING — reference-rs

Fecha: **2026-09-27** · Objetivo: `conformance/reference-rs`
(`nido-conformance-rs v0.1.0`)

## 1. Corpus diferencial de formato de floats (Node vs Rust)

- Generador: `conformance/reference-rs/tests/gen_float_corpus.py`
  (determinista; semilla fija; MD5 `1956d24aeb77f307264b13e10c7b34cb`
  reproducido al regenerar).
- **20.026** patrones f64 finitos: subnormales, min/max, potencias de 2 y 10
  alrededor de cada frontera de exponente decimal, casos de redondeo
  casi-a-mitad (round-trip), patrones de bits aleatorios.
- Salidas esperadas: `tests/gen_float_expected.mjs` vía
  `Number.prototype.toString` → `tests/float_expected.jsonl`.
- Test: `tests/float_differential.rs`.
- **Resultado: 20.026 / 20.026 coinciden, 0 discrepancias.**
- Los archivos del corpus (`tests/float_corpus.txt`,
  `tests/float_expected.jsonl`) están commiteados para que el diferencial
  sea reproducible sin Node.

## 2. Tests de propiedades (`tests/properties.rs`, 16 tests)

Batería determinista de propiedades, todas en verde:

| Área | Propiedades |
|---|---|
| Parser | round-trip compacto; duplicados rechazados; datos finales (trailing data) rechazados; sustitutos solitarios (lone surrogates) rechazados; C0 sin escapar rechazados; frontera de enteros inseguros (`2^53-1` ok / `2^53` err / `1e21` ok); `__proto__` inerte |
| Canonicalización | idempotente; independiente del orden de inserción; orden de claves por unidades de código UTF-16; perfil de escapes NIDO (sin escapes cortos, todo C0 como `\uXXXX`) |
| Política | AUTHORITY_MONOTONICITY (la basura nunca autoriza); AUTONOMY_NON_EXPANSION (DENY es pegajoso); FAIL_CLOSED (sujeto/capacidad/versión/modo desconocidos ⇒ DENY) |
| Delegación | DELEGATION_ATTENUATION (scope más estrecho / expiración más corta / subconjunto de peers aceptado; cualquier ensanchamiento rechazado; max_uses=0 rechazado) |
| Máquinas de estado | los estados terminales son sumideros; máquina/evento desconocidos rechazados |
| Presupuesto/grafo/disclosure | doble gasto en un vector rechazado en el índice de paso; unidades negativas/NaN/Infinity rechazadas; allow-list vacía ⇒ `null`; la proyección nunca inventa campos |
| Evaluadores | basura en cada evaluador ⇒ `ok:false`, nunca un panic |

## 3. Ataques de invariantes (`tests/invariants.rs`, 12 tests)

Intentos explícitos de ruptura según `SECURITY_INVARIANTS.md`; todos
rechazados:

- INV-1: `mode`/`admin` contrabandeados en el request; spoofing de versión
  (`v2`, `v1 `, `V1`, `v01`, ``); campos desconocidos del token que no
  otorgan nada.
- INV-2: versiones de protocolo/capacidad desconocidas; expiración en la
  igualdad (`CONSENT_EXPIRED` en `now == expires_at`).
- INV-3: aislamiento de presupuesto entre identidades (no existe parámetro
  de transporte que variar — se cumple por construcción).
- INV-4: la retransmisión duplicada de `task_id` nunca re-ejecuta.
- INV-5: reembolsos de unidades negativas/NaN/Infinity; 11×1 disclosures de
  unidad vs presupuesto 10; el agotamiento a mitad de vector reporta el
  índice de paso.
- INV-6: el delegatario acuñando un token más amplio en cada eje (usos,
  expiración, peers, capacidad, vinculación) — todos rechazados.
- INV-7: batería adversarial de parser de 11 formas; **anidamiento de 5k y
  100k de profundidad → `NESTING_TOO_DEEP` tipado** (este ataque encontró el
  bug de desbordamiento de pila; ver abajo).

## 4. Hallazgos

1. **Desbordamiento de pila con entrada profundamente anidada
   (CORREGIDO).** El parser recursivo abortaba el proceso (SIGABRT) a ~5k
   de profundidad de anidamiento. Corrección: `MAX_PARSE_DEPTH = 128`
   explícito → error tipado `NESTING_TOO_DEEP`; el writer tiene su propia
   guarda y es total. Clasificado **RUST_BUG** (TS falla cerrado vía
   RangeError de V8 → `PARSE_ERROR`, verificado empíricamente). Test de
   regresión: `inv7_deeply_nested_input_is_rejected_safely`.
2. **Sin panics** en ninguna otra entrada de fuzz/propiedades: cada
   evaluador devuelve `ok:false` con un error tipado ante entrada
   malformada.

## 5. Aún no hecho

- Aún no hay fuzzer guiado por cobertura (cargo-fuzz / libFuzzer)
  conectado; las baterías anteriores son tests de propiedades
  deterministas, no fuzzing ciego.
- El corpus de floats cubre solo f64 finitos (NaN/±Infinity son rechazados
  por el parser estricto por diseño).
- El fuzzing por mutación de envelopes completos (bit-flips, truncamiento)
  contra el adaptador NDJSON es trabajo futuro.
