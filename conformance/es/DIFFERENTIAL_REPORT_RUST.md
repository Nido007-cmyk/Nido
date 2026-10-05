> **Idioma:** [English](../DIFFERENTIAL_REPORT_RUST.md) · Español
# INFORME DIFERENCIAL — Segunda implementación en Rust

Fecha: **2026-09-27** · Alcance: `conformance/reference-rs` vs `conformance/reference-ts`
sobre `conformance/vectors/v0/final` (**158 vectores** — 157 de base + vector
de regresión `env-029` añadido el 2026-09-27 para el RUST_BUG de ordenamiento
de replay) mediante el harness NDJSON independiente del lenguaje.

**Titular: 158 superados / 0 fallidos.** Cada vector oficial concuerda entre
las dos implementaciones.

Método: cada implementación fue ejecutada a través de
`conformance/harness/runner.py` como un worker NDJSON por stdin/stdout. Los
resultados de Rust están archivados en
`conformance/harness/differential-results-rs.json` (el archivo de salida por
defecto del runner `differential-results.json` sigue siendo el archivo
rastreado de TS y fue restaurado después de cada ejecución).

Las discrepancias encontradas *mientras se construía* la implementación en
Rust fueron clasificadas según las reglas del proyecto. La especificación
nunca se doblegó para coincidir con una implementación.

## RUST_BUG (encontrado y corregido en reference-rs)

1. **Análisis de la versión del envelope.** Rust aceptaba `nido/01.0`
   numéricamente como `(1,0)`; TS requiere el token exacto `nido/1.0`.
   Corregido: coincidencia exacta de token. (`"nido/01.0"` sigue
   normalizándose a `(1,0)` en *ambas* implementaciones cuando aparece como
   cota — el análisis numérico de `01` es `1` en ambas; la salida negociada
   es siempre el `nido/1.0` canónico.)
2. **Validación de delegación.** `max_uses` aceptaba `0`; se aceptaba
   `expires_at <= issued_at`; `scope.peers` se trataba como obligatorio;
   la lógica de atestación de padre-sin-peers estaba invertida. Corregido
   para coincidir con TS/spec: `max_uses` entero ≥ 1, `expires_at >
   issued_at`, `peers` opcional (ausente ⇒ el cuerpo firmado se normaliza a
   `null`), atenuación solo cuando el padre restringe peers, extensiones de
   scope desconocidas excluidas del cuerpo firmado.
3. **Precedencia de políticas.** En reglas empatadas, Rust prefería `ASK`
   sobre `AUTO`; la regla de TS es "la regla viva más permisiva gana" ⇒
   `AUTO` gana. Corregido, y se añadió soporte para `max_disclosure_units`.
4. **Desbordamiento de pila por anidamiento profundo (robustez).** El parser
   recursivo de Rust abortaba el proceso (SIGABRT, desbordamiento de pila)
   con entrada anidada a ~5k de profundidad — un crash disparable
   remotamente vía un envelope malicioso. TS falla cerrado (RangeError de V8
   → capturado → `PARSE_ERROR`, verificado empíricamente a 5k y 100k de
   profundidad). Corregido: `MAX_PARSE_DEPTH = 128` explícito → error tipado
   `NESTING_TOO_DEEP`; el canonicalizador tiene su propia guarda y es total.
   El nuevo ataque de invariante `inv7_deeply_nested_input_is_rejected_safely`
   cubre profundidades de 5k y 100k.

## TS_BUG (encontrado por lectura diferencial; TS aún no corregido)

5. **Frontera de expiración de políticas.** AMB-06 (`SPEC_AMBIGUITIES.md`)
   dice `now >= expires_at` ⇒ expirado *en todas partes*. Rust lo sigue.
   La política de TS usa `req.now <= r.expires_at` como prueba de regla viva,
   aceptando la igualdad. (El consentimiento y la delegación en TS sí
   expiran en la igualdad.) Ningún vector cubre `now == expires_at` para
   políticas. **Acción requerida:** confirmación de spec → nuevo vector en
   `vectors/v0/source/` → regenerar `final/` → corregir TS → re-verificar
   Rust.

## SPEC_AMBIGUITY (documentado, comportamiento congelado)

6. **Escapes RFC 8785 vs NIDO v0 (AMB-01).** RFC 8785 §3.2.2.2 requiere
   `\b \t \n \f \r` para cinco controles C0; NIDO v0 (texto de la spec,
   `reference-ts/canonicalize.ts`, vector `canon-003`, y ahora Rust) emite
   `\uXXXX` para *todos* los controles C0. El perfil v0 está congelado
   (cambiarlo cambiaría cada hash/firma); la desviación está documentada en
   `reference-rs/src/canon.rs`. `SPEC_AMBIGUITIES.md` AMB-01 necesita una
   actualización formal para registrarlo.
7. **Igualdad en envelope/cert skew.** El envelope de TS expira en
   `now > expires_at + skew`; Rust en `expires_at <= now - skew` — difieren
   exactamente en la igualdad. `env-026` cubre solo "1ms pasado el skew".
   Misma forma para la expiración de certificados (`now >` vs `now >=`).
   Necesita vectores de igualdad + clasificación formal.
8. **Orden de validación / envenenamiento de caché de replay.**
   `AGENT_PROTOCOL.md §8` ordena: parse → versión → suite cripto →
   firma+cert → timestamps → replay → tipo/payload. TS verifica timestamps
   antes que cert/firma; ambas implementaciones se desvían de §8 ahí
   (ningún vector distingue). **RUST_BUG encontrado por auditoría
   independiente 2026-09-27:** el `reference-rs` entregado insertaba
   `message_id` en el conjunto `seen` de replay *antes* de la verificación
   de firma — un envelope no autenticado envenenaba el conjunto para
   envelopes posteriores en el mismo lote, y la precedencia de errores era
   incorrecta (`DUPLICATE_MESSAGE` en lugar de `INVALID_SIGNATURE`). El texto
   del informe v1 anterior afirmaba incorrectamente que ya estaba corregido;
   el código contradecía la afirmación. **Corregido:** `seen` ahora se
   verifica después de la verificación de firma y solo se puebla en la ruta
   de éxito, reflejando `reference-ts` (`envelope.ts`: `seen.has` después
   de `edVerify`, `seen.add` en éxito). **Vector de regresión** `env-029`
   (source → final/ regenerado): envelope manipulado cuyo `message_id` está
   pre-sembrado en `ctx.seen` → ambas implementaciones deben responder
   `INVALID_SIGNATURE`. Probado empíricamente: el binario pre-fix respondía
   `DUPLICATE_MESSAGE`; el binario corregido responde `INVALID_SIGNATURE`;
   TS responde `INVALID_SIGNATURE`.
9. **Payload `delegation?`.** `AGENT_PROTOCOL.md §5.1` documenta
   `delegation` como campo opcional del payload `TASK_REQUEST`, pero
   `reference-ts` lo rechaza y Rust sigue a TS. Clasificación pendiente; el
   texto de la spec y ambas implementaciones discrepan.
10. **Precedencia de expiración consentimiento vs política.** El
    consentimiento de TS verifica expiración → agotado → vinculación; Rust
    verifica vinculación → expiración → agotado. Los vectores actuales son
    de fallo único, así que ambos pasan; se necesita un vector multi-fallo
    para fijar el orden observable.
11. **Coincidencia de campos prohibidos.** TS usa regex de subcadena
    `/prompt|instructions|system_prompt/i`; Rust coincide nombres de campo
    exactos en minúsculas. Ningún vector los distingue.
12. **Alcance de firma de certificados.** TS firma/verifica cuatro campos
    conocidos de cert; Rust firma todos los campos de cert excepto
    `signature`. Ningún vector distingue.
13. **Capas de revocación de delegación.** El verificador de cadena de
    ninguna implementación consulta el estado de revocación; la revocación
    la aplica la máquina de estados DELEGATION (`REVOKED` terminal). Un
    verificador que solo ejecute verificación de cadena aceptaría un token
    revocado pero no expirado. Igual en ambas → nota de capas v0, no
    divergencia.
14. **Redelivery de task-id (capas de INV-4).** El mismo `task_id` bajo un
    *nuevo* `message_id` es un mensaje nuevo en la capa de protocolo en
    ambas implementaciones; la dedup a nivel de tarea ("devolver el outcome
    registrado") vive por encima de la capa de protocolo (outbox del
    agente), no implementado en v0.

## UNSPECIFIED_BEHAVIOR (sin vector, ambas fallan cerrado)

- `message_type`s desconocidos del envelope distintos de `TASK_REQUEST`:
  TS valida todos los tipos documentados, Rust solo `TASK_REQUEST` (Rust
  rechaza el resto como desconocidos — falla cerrado, superficie más
  estrecha).
- TS acepta alias `TEST_KEYS` (`idA`, `idB`, `devA1`); Rust acepta solo
  pubkeys hex de 64 caracteres en minúsculas. Los 157 vectores usan solo
  hex, así que esto es territorio no probado diferencialmente.

## LO QUE SE PROBÓ

- Los 158 vectores oficiales producen veredictos byte-idénticos en dos
  implementaciones escritas independientemente (TS + Rust), incluido el
  vector de regresión `env-029` que fija replay-check-after-authentication.
- El formato f64 → string es bit-idéntico a `Number.prototype.toString` en
  20.026 patrones adversariales (0 discrepancias).
- 12 intentos explícitos de romper invariantes (request smuggling, spoofing
  de versión, ensanchamiento de token, reembolsos de presupuesto, ataques
  de parser, anidamiento a 100k de profundidad) fallan todos contra la
  implementación en Rust.

## LO QUE FALLÓ

- Un bug genuino de robustez encontrado y corregido: desbordamiento de pila
  por anidamiento profundo (RUST_BUG #4 arriba).
- Un bug genuino de ordenamiento encontrado por auditoría independiente y
  corregido: inserción del `seen` de replay antes de la autenticación
  (RUST_BUG, ítem 8 arriba) — el informe v1 afirmaba incorrectamente que ya
  estaba corregido; el código entregado demostró lo contrario. El vector de
  regresión `env-029` ahora fija el orden correcto.
- Un probable bug de TS encontrado, aún no corregido: expiración de política
  en la igualdad (TS_BUG #5) — necesita el pipeline spec→vector→fix.

## LO QUE QUEDA SIN VERIFICAR

- Ítems 5–14 arriba: cada uno necesita confirmación de spec, un nuevo vector
  en `source/`, regeneración de `final/`, y re-verificación en ambas
  implementaciones.
- No hay tercera implementación; no hay auditoría externa.
- Android (C-1) no tocado por este trabajo.
