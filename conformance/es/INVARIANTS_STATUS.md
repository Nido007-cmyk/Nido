> **Idioma:** [English](../INVARIANTS_STATUS.md) · Español
# ESTADO DE INVARIANTES — tras intentos explícitos de ruptura (2026-09-27)

Objetivo: `conformance/reference-rs`, atacado según las secciones de
amenaza de `conformance/SECURITY_INVARIANTS.md`. Los ataques viven en
`conformance/reference-rs/tests/invariants.rs` (12 tests, todos en verde —
es decir, cada ataque fue rechazado).

## INV-1 · AUTHORITY_MONOTONICITY — SE CUMPLE

Ataques: `"mode":"AUTO"` / `"admin":true` contrabandeados dentro del objeto
*request*; spoofing de versión (`v2`, `v1 `, `V1`, `v01`, vacío); token de
delegación con `max_uses:9999` / `admin:true` fuera de `scope`. Todos
rechazados: el evaluador de políticas solo lee `(subject, capability,
version, …)` del request y solo reglas de coincidencia exacta de la política
local; los campos desconocidos del token nunca se consultan. **Sin
ruptura.**

## INV-2 · AUTONOMY_NON_EXPANSION — SE CUMPLE (con un hallazgo del lado TS)

Ataques: versiones de protocolo desconocidas (`nido/2.0`, `nido/1.1`,
`v1`, `1.0`, vacío) — ninguna negociable; versión de capacidad desconocida
`v99` — sin intersección; consentimiento usado exactamente en `expires_at` —
`CONSENT_EXPIRED`. `"nido/01.0"` se normaliza a `(1,0)` en *ambas*
implementaciones (análisis numérico) y negocia el token canónico `nido/1.0`
— no es una ruptura, es normalización documentada. **Rust se cumple.
Hallazgo:** la *política* de TS acepta `now == expires_at` como viva,
contradiciendo AMB-06 (`now >= expires_at` ⇒ expirado en todas partes) que
Rust, el consentimiento de TS y la delegación de TS siguen — clasificado
**TS_BUG**, en espera del pipeline spec→vector→fix.

## INV-3 · TRANSPORT_INDEPENDENCE — SE CUMPLE POR CONSTRUCCIÓN

Ataque: agotar un presupuesto y seguir gastando "cambiando de transporte".
Las funciones de contabilidad no toman **ningún parámetro de transporte** —
no hay dimensión que variar, así que el ataque es vacuo. Se verificó la
mitad significativa: aislamiento por identidad (gastar como A nunca toca la
ventana de B). La protección de replay se clavea por `message_id` por
remitente; las firmas cubren la forma canónica sin metadatos de transporte.
**Sin ruptura.**

## INV-4 · RETRY_SAFETY — SE CUMPLE EN LA CAPA DE PROTOCOLO

Ataques: `task_ids = [t1,t2,t1,t2,t1]` → `executed_count=2`,
`duplicates_rejected=3`, log exactamente
`[EXECUTED, EXECUTED, DUPLICATE, DUPLICATE, DUPLICATE]`; `message_id`
duplicado en un lote de envelopes → `DUPLICATE_MESSAGE`. **Sin ruptura.**
Capas v0 conocidas: el mismo `task_id` bajo un *nuevo* `message_id` es un
mensaje nuevo en la capa de protocolo en ambas implementaciones; la dedup a
nivel de tarea ("devolver el outcome registrado") pertenece a la capa
outbox del agente superior, aún no implementada. Documentado como
`UNSPECIFIED_BEHAVIOR`, no una ruptura.

## INV-5 · DISCLOSURE_ACCOUNTING — SE CUMPLE

Ataques: `disclosed_units` negativos / NaN / Infinity (intentos de
reembolso o envenenamiento) — todos `GRAPH_INVALID`; once disclosures de 1
unidad vs presupuesto 10 — `GRAPH_BUDGET_EXCEEDED`; doble gasto a mitad de
vector — `BUDGET_EXHAUSTED` en el índice de paso exacto sin que ningún gasto
parcial se filtre a `remaining`; proyección de disclosure — allow-list vacía
⇒ `null`, nunca inventa campos (testado por propiedades). **Sin ruptura.**

## INV-6 · DELEGATION_ATTENUATION — SE CUMPLE

Ataques: el delegatario acuña un token ensanchando *cada* eje — más
`max_uses`, `expires_at` posterior, `peers` más amplio, capacidad
intercambiada, vinculación de emisor rota. Todos rechazados (chequeos
estructurales y/o chequeo de firma; `ok:true` nunca producido). **Sin
ruptura.** Capas v0 conocidas: el verificador de cadena de ninguna
implementación consulta el estado de revocación — la revocación la aplica la
máquina de estados DELEGATION (terminal `REVOKED`). Un verificador que
ejecute solo chequeos de cadena aceptaría un token revocado pero no
expirado; igual en TS, documentado como `UNSPECIFIED_BEHAVIOR`.

## INV-7 · FAIL_CLOSED — SE CUMPLE (un bug encontrado y corregido)

Ataques: batería de parser de 11 formas (duplicados, basura final,
sustitutos solitarios, NUL sin escapar, enteros inseguros, entrada
truncada, BOM, `__proto__` — el último correctamente parseado como *datos
inertes*, no rechazado); máquinas/eventos desconocidos; versiones
malformadas. Todos errores tipados, sin panics. **Ruptura encontrada:**
entrada anidada a 5k de profundidad causaba un abort por desbordamiento de
pila (SIGABRT) — crash de proceso disparable remotamente vía un envelope
malicioso. Clasificado **RUST_BUG** (TS falla cerrado: RangeError de V8 →
capturado → `PARSE_ERROR`, verificado a 5k y 100k de profundidad).
**Corregido:** `MAX_PARSE_DEPTH = 128` explícito → `NESTING_TOO_DEEP`
tipado; canonicalizador endurecido con su propia guarda. Regresión:
profundidades de 5k y 100k sondeadas en el test.

## Resumen

| Invariante | Intentos de ruptura | Resultado |
|---|---|---|
| INV-1 AUTHORITY_MONOTONICITY | 3 | se cumple |
| INV-2 AUTONOMY_NON_EXPANSION | 3 | se cumple en Rust; TS_BUG encontrado (expiración de política en igualdad) |
| INV-3 TRANSPORT_INDEPENDENCE | 1 | se cumple por construcción |
| INV-4 RETRY_SAFETY | 1 | se cumple en capa de protocolo; dedup de capa de tarea fuera del alcance v0 |
| INV-5 DISCLOSURE_ACCOUNTING | 2 | se cumple |
| INV-6 DELEGATION_ATTENUATION | 6 sub-ataques | se cumple; capas de revocación anotadas |
| INV-7 FAIL_CLOSED | 2 | 1 RUST_BUG encontrado y corregido (DoS por anidamiento) |

Ningún invariante quedó roto de forma sin corregir. Dos hallazgos requieren
el pipeline spec→vector→fix (expiración de política de TS en igualdad; los
ítems SPEC_AMBIGUITY listados en `DIFFERENTIAL_REPORT_RUST.md`).
