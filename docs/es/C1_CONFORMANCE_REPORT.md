> **Idioma:** [English](../C1_CONFORMANCE_REPORT.md) · Español
# Reporte C-1 — Conformance v0 (2026-09-27)

## Alcance

Verificación ejecutable del protocolo de agente NIDO: implementación de
referencia, vectores oficiales versionados, harness agnóstico de lenguaje,
test diferencial parcial, invariantes de seguridad, ambigüedades del spec
registradas.

Tag: `conformance-v0` (commit `071e8a4`). Baseline `design-baseline-v0.1`
intacta.

## Clasificación de estado (exacta, sin suavizar)

| Etiqueta | Estado |
|---|---|
| IMPLEMENTED | sí |
| AUTOMATED/UNIT TESTED | sí — 626 tests en verde (49 archivos), typecheck limpio |
| ANDROID COMPILED | no |
| EMULATOR TESTED | no |
| PHYSICAL DEVICE TESTED | no |
| EXTERNALLY AUDITED | no |

## Entregado

- **reference-ts**: parser JSON estricto, canonicalización RFC 8785,
  SHA-256, Ed25519 (tweetnacl), verificaciones de
  envelope/policy/budget/disclosure/delegation/consent/
  version/state-machine, adaptador a una interfaz de vectores agnóstica de
  lenguaje.
- **157 vectores oficiales** (45 válidos / 72 inválidos / 13 de borde / 27
  adversariales), generador determinista + verificación de frescura
  (`final/` nunca puede divergir de `source/`).
- **7 tests de propiedad/fuzz** en verde: fuzz de parser con 2000 entradas
  (nunca lanza), determinismo/idempotencia de canonicalización, basura de
  política-nunca-autoriza, monotonicidad de budget, recorridos de
  state-machine (nunca lanzan, terminal sigue terminal), composición DENY,
  idempotencia.
- **Harness** (`harness/`): protocolo NDJSON-sobre-stdio para que CUALQUIER
  lenguaje pueda testearse contra los vectores oficiales; `runner.py` hace
  diff con igualdad profunda JSON.
- **Segunda implementación parcial** (Python, canonicalización + SHA-256):
  **26/26 diferencial pass** en vectores oficiales.
- **Diferencial de floats vs el motor JS** (oráculo independiente): 516
  doubles + casos borde, **0 mismatches** tras corregir 2 divergencias
  reales encontradas por el test (forma exponencial `1e21` → `1e+21`;
  `1e-5` → notación fija `0.00001`).
- **SECURITY_INVARIANTS.md**: 7 invariantes, cada uno como
  threat → escenario/ruta de exploit → mitigación → test.
- **SPEC_AMBIGUITIES.md**: 10 ambigüedades resueltas con lecturas
  conservadoras (fail-closed) registradas.
- **Fixes encontrados por este bloque**: drop silencioso de campo
  `__proto__` (ahora parse null-prototype, `canon-a05`); división de borde
  de expiración (`now >` vs `now >=` unificado a expirado-inclusivo,
  `con-009`).

## Red-team de este bloque (threat → exploit → mitigación → test)

1. **Bug sistemático de referencia, invisible por auto-referencia** →
   valores esperados generados por el mismo código que se testea.
   Mitigado para canonicalización (impl Python independiente + oráculo del
   motor JS); los tests de propiedad usan oráculos independientes
   (monotonicidad, terminal-pegado). Residual: MEDIO para policy /
   delegation / state machines — aún sin segunda implementación.
2. **`expected` erróneo en un vector fuente se vuelve "verdad"** → el test
   de frescura previene drift, no autoría errónea. Vectores adversariales
   revisados a mano; revisión completa de los 157 vectores aún pendiente
   (trackeada, no bloqueante).
3. **Mismo autor para ambas implementaciones** → posible mala lectura
   correlacionada. Para números el oráculo fue el motor JS
   (independiente). Resto: pendiente Rust.
4. **Harness enmascarando errores** → el runner sale non-zero ante stdout
   cerrado, JSON inválido, o id mismatch. El driver Python marca kinds no
   implementados explícitamente (`NOT_IMPLEMENTED_BY_PARTIAL_IMPL`).
5. **Brechas de cobertura (registradas, no ocultas)**: sin vectores de
   concurrencia/interleaving, sin vectores de clock-skew-entre-
   dispositivos, sin vectores de rotación de claves.

## Mapeo de Definition-of-Done

1. Suite ejecutable — HECHO (vitest, un comando).
2. Vectores oficiales versionados — HECHO (`vectors/v0/`, manifiesto).
3. Vectores negativos/adversariales — HECHO (72 + 27).
4. State machines verificables — HECHO (`state_machines.json` + tablas).
5. `SECURITY_INVARIANTS.md` — HECHO (7 invariantes).
6. Segunda implementación independiente — PARCIAL (Python, solo
   canonicalización).
7. Differential testing — PARCIAL (26/26 + 516 floats; harness listo para
   Rust).
8. Fuzz/property testing — HECHO (7 propiedades).
9. Lista de ambigüedades — HECHO (10, todas resueltas con lecturas
   registradas).
10. Correcciones del spec desde evidencia — HECHO (`__proto__`,
    expiración, formateo de floats).
11. Cero expansión innecesaria — HECHO (sin features nuevas;
    `projectDisclosed` congelado como provisional, documentado).
12. Estado exacto de C-1 Android — sin cambios desde el registro
    2026-09-27: prebuild verificado, NO compilado, NO probado en
    emulador/físico. C-1 sigue ABIERTO.
13. Tags separados cuando reproducible — HECHO (`conformance-v0`,
    alcance limitado).
14. "Probar que dos implementaciones leen el documento igual" — PROBADO
    para canonicalización (el componente donde la exactitud de bytes más
    importa); PENDIENTE para el resto.

## Riesgo residual (lo que este reporte NO afirma)

- Ninguna auditoría externa de ningún tipo.
- Ninguna validación Android/emulador/física.
- La lógica de policy, delegation y state-machine tiene una sola
  implementación; sus vectores son auto-consistentes, no probados
  diferencialmente.
- La suite mide reducción de superficie de ataque, no completitud de
  features.

## Siguiente

Segunda implementación completa (Rust preferido) contra `harness/` →
corrida diferencial sobre LOS 157 vectores → entonces, y solo entonces,
desbloquear `calendar.availability.query/v1` pendiente de verificación
Android de C-1.
