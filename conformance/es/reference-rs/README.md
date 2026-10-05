> **Idioma:** [English](../../reference-rs/README.md) · Español
# reference-rs — Implementación de referencia NIDO en Rust (conformidad)

Segunda implementación independiente de la superficie de conformidad NIDO
v0, escrita a partir del texto de la spec y los vectores oficiales — no una
traducción mecánica de `reference-ts`. Existe para probar
**interoperabilidad**, no imitación: cualquier divergencia de
comportamiento encontrada durante el testing diferencial se clasifica
(`SPEC_AMBIGUITY` / `TS_BUG` / `RUST_BUG` / `VECTOR_BUG` /
`UNSPECIFIED_BEHAVIOR`) y primero se corrige la spec, luego se añade un
vector de regresión, luego las implementaciones.

## Estructura

| Path | Contenido |
|---|---|
| `src/lib.rs` | Raíz de la librería; re-exporta `canon`, `eval`, `json`, `num` para tests de integración |
| `src/main.rs` | Adaptador NDJSON/stdin-stdout mínimo (solo protocolo del harness, sin lógica) |
| `src/json.rs` | Parser JSON estricto: rechaza duplicados, datos finales, sustitutos solitarios, C0 sin escapar, enteros inseguros, números no finitos; profundidad máxima de anidamiento 128 (`NESTING_TOO_DEEP`) |
| `src/canon.rs` | Perfil de canonicalización NIDO v0 (orden de claves por unidades de código UTF-16; todos los controles C0 como `\uXXXX` — ver nota de desviación) |
| `src/num.rs` | `format_es`: f64 → string, bit a bit idéntico a `Number.prototype.toString` (verificado en 20.026 patrones, 0 discrepancias) |
| `src/eval.rs` | Todos los evaluadores: canonicalización, envelope, firma, versiones de protocolo/capacidad, política, consentimiento, delegación, presupuesto, grafo, idempotencia, disclosure, extensiones, máquinas de estado |
| `tests/` | `float_differential.rs`, `properties.rs`, `invariants.rs`, generadores del corpus |

Cripto: `ed25519-dalek` (auditado) + `sha2` (auditado). Sin cripto
artesanal.

## Build & test

```bash
export PATH="$HOME/.cargo/bin:$PATH"   # rustup stable + rustfmt
cd conformance/reference-rs
cargo fmt --check
cargo test --locked        # 14 unitarios + 1 float-differential + 12 ataques de invariante + 16 tests de propiedades
```

## Testing diferencial

```bash
cd ~/workspace/nido-app
python3 conformance/harness/runner.py --impl ./conformance/reference-rs/target/debug/nido-conformance-rs
# passed=157 failed=0 ; resultados guardados por ejecución en conformance/harness/differential-results-rs.json
# (el runner escribe conformance/harness/differential-results.json; restáuralo con
#  git checkout después — es el archivo de resultados rastreado de TS)
```

El protocolo NDJSON coincide con el harness independiente del lenguaje: un
vector JSON por línea en stdin (`{"category","id","input"/"input_raw"}`), un
resultado JSON por línea en stdout (`{"ok","error"|...}`).

## Desviaciones conocidas de RFC 8785 (intencionadas, documentadas)

El perfil de canonicalización NIDO v0 escapa **todos** los controles C0
como `\uXXXX`, mientras que RFC 8785 §3.2.2.2 requiere `\b \t \n \f \r`
para cinco de ellos. Esta es una decisión congelada del perfil v0 (cambiarla
cambiaría cada hash y firma); está documentada en `src/canon.rs` y
clasificada como `SPEC_AMBIGUITY` en el informe diferencial. No la
"corrijas" silenciosamente.

## Límites relevantes para seguridad

- `MAX_PARSE_DEPTH = 128`: anidamiento más profundo → error tipado
  `NESTING_TOO_DEEP` (un parser recursivo sin límite es un desbordamiento
  de pila disparable remotamente; encontrado por el ataque de invariante
  INV-7, corregido 2026-09-27).
- El canonicalizador tiene su propia guarda de profundidad y es total (nunca
  hace panic).
- `src/main.rs` nunca hace panic ante líneas de entrada malformadas; emite
  `{"ok":false,"error":"ADAPTER_ERROR"}`.
