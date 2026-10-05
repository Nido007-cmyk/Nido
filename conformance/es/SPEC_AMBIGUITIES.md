> **Idioma:** [English](../SPEC_AMBIGUITIES.md) · Español
# Protocolo NIDO — Ambigüedades de la Spec (Suite de Conformidad v0)

Preguntas que los documentos dejaron abiertas, encontradas mientras se
construía la referencia ejecutable. Cada entrada: la pregunta, la
evidencia, la resolución adoptada para v0, y qué la reabriría. Regla: en
caso de duda, gana la lectura conservadora (fail-closed), y la elección se
registra aquí — nunca se hornea silenciosamente en el código.

---

## AMB-01 · Canonicalización: ¿qué RFC 8785?

**Pregunta.** ¿"JSON canónico" significa RFC 8785 (JCS) byte-idéntico?

**Evidencia.** Los documentos de diseño decían "JSON canónico" sin fijar el
perfil. Una primera implementación escapaba TODOS los caracteres de control
como `\uXXXX`, pero RFC 8785 §3.2.2.2 mantiene los escapes cortos de JSON
solo para `"` y `\` — y los caracteres de control no tienen forma corta en
JSON salvo `\b \t \n \f \r`, que JCS NO usa (usa `\uXXXX` para todos los
controles C0).

**Resolución (v0).** Ahora se REQUIERE y TESTEA cumplimiento pleno de RFC
8785: ordenamiento de claves por unidades de código UTF-16 (verificado
contra claves de plano astral), `\uXXXX` para todos los controles C0,
`Number.prototype.toString` de ECMAScript para números (testado
diferencialmente contra una segunda implementación sobre 516 floats + 26
vectores, 0 discrepancias).

**Reabrir si.** Alguna vez se necesita un perfil con formato numérico
diferente (p. ej. decimal128) — eso sería una nueva versión de
canonicalización, no un cambio silencioso.

## AMB-02 · Parser: ¿`__proto__` es especial?

**Pregunta.** ¿Una clave JSON llamada `__proto__` debe rechazarse o tratarse
como datos?

**Evidencia.** Un parser ingenuo basado en `{}` DESCARTABA silenciosamente
el campo (efecto secundario del setter de prototipo) — encontrado por
testing adversarial, no por revisión.

**Resolución (v0).** Los objetos parseados usan prototipos nulos;
`__proto__` es datos inertes como cualquier otra clave (`canon-a05`). La
detección de duplicados usa `hasOwnProperty`, así que
`{"__proto__":1,"__proto__":2}` sigue siendo `DUPLICATE_FIELD`.

**Reabrir si.** Nunca para el parser de referencia. Cualquier parser futuro
debe pasar `canon-a05`.

## AMB-03 · Alias de claves en vectores vs normatividad

**Pregunta.** Los vectores usan `alias:idA` para claves. ¿La resolución de
alias es parte del protocolo?

**Resolución (v0).** No. Los alias existen SOLO en los vectores `source/` y
el generador los resuelve a claves públicas literales en `final/`. El
protocolo nunca ve un alias. Documentado para que una segunda
implementación no "implemente" la resolución de alias como una
característica.

## AMB-04 · Forma de la API de registro de extensiones

**Pregunta.** ¿Cómo expresa un test "registrar la misma extensión dos
veces"?

**Resolución (v0).** Los vectores de extensión toman `attempts: string[]` y
devuelven resultados por intento (`results: ("ok" | error)[]`). Esto modela
el registro como con estado entre intentos dentro de una evaluación — igual
que se comporta un registro real.

## AMB-05 · Proyección de allow-list vacía

**Pregunta.** `projectDisclosed(value, [])` → `{}` o `null`?

**Evidencia.** `{}` ("no divulgó nada, con éxito") vs `null` ("nada que
divulgar"). `{}` es peligroso: el código downstream puede tratar cualquier
objeto como "hay contenido divulgado".

**Resolución (v0).** `null`. Una allow-list vacía significa que nada puede
salir del dispositivo, y `null` es inequívoco (`dis-004`).

## AMB-06 · Frontera de expiración: ¿inclusiva o exclusiva?

**Pregunta.** En exactamente `now == expires_at`, ¿un grant/token está
expirado?

**Evidencia.** La delegación usaba `now >= expires_at` (expirado); el
consentimiento usaba `now > expires_at` (aún válido). Una división
semántica de un milisegundo entre dos subsistemas — exactamente el tipo de
costura que un atacante compite (races).

**Resolución (v0).** UNIFICADO: `now >= expires_at` ⇒ expirado, en todas
partes (`con-009`, `del-008`). Fundamento: la expiración es una fecha límite
de seguridad; la lectura conservadora falla cerrado, y la uniformidad
elimina la costura.

**Fijación (2026-09-27, TS_BUG #5).** Esta resolución cubre las reglas de
política explícitamente: una regla de política con `expires_at` está *viva*
ssi `now < expires_at`, y *muerta* ssi `now >= expires_at`. Una regla sin
`expires_at` está viva (sin fecha límite). Esta fijación se deriva del "en
todas partes" de la resolución anterior — no del operador de comparación
actual de ninguna implementación.

**Reabrir si.** Un caso de uso demuestra que la frontera inclusiva causa
fallos reales Y una revisión entre subsistemas acepta el riesgo. No antes.

## AMB-07 · Lenguaje de paths de `projectDisclosed`

**Pregunta.** La sintaxis de paths (`a.b.c`, `arr[].field`) parece el inicio
de un DSL de consulta. ¿Debería crecer?

**Resolución (v0).** NO. El lenguaje de paths está congelado en exactamente
estas dos formas, documentado como provisional. Cualquier lenguaje de
proyección más rico sería una nueva versión de capacidad con su propio
modelo de amenaza (inyección, traversal).

## AMB-08 · Campos desconocidos del envelope: ¿ignorar o rechazar?

**Pregunta.** `env-002` permite campos desconocidos a nivel de envelope
pero el schema del payload los rechaza. ¿Inconsistente?

**Resolución (v0).** Intencionado y documentado: el envelope es el marco de
transporte compatible hacia adelante (ignorar campos desconocidos,
siguiendo la regla "must-ignore" para extensibilidad); el payload es la
sección crítica de seguridad (rechazar campos desconocidos — fallar cerrado
donde se decide la autoridad). Fundamento registrado en `envelope.ts`.

**Reabrir si.** Una futura versión del envelope necesita integridad sobre
campos de extensión — entonces el alcance de la firma cambia explícitamente.

## AMB-09 · ¿Qué se firma exactamente?

**Pregunta.** ¿La firma es sobre los bytes crudos o sobre bytes
re-canonicalizados?

**Resolución (v0).** Las firmas son sobre la forma canónica RECONSTRUIDA por
el verificador (parse → validar → canonicalizar → verificar).
Consecuencias, todas testadas: el orden crudo de claves es irrelevante
(`neg-001`); los campos duplicados se rechazan ANTES de canonicalizar
(`env-023`); los bytes canónicos que produjo el firmante deben igualar la
reconstrucción del verificador, o la verificación falla. Esto es lo que hace
la firma independiente del transporte (INV-3).

## AMB-10 · Enteros inseguros: ¿qué tan estricto?

**Pregunta.** `9007199254740993` se convierte silenciosamente en
`9007199254740992` como double. ¿Rechazar? ¿Y `1e21`, que SÍ es exactamente
representable?

**Evidencia.** Una regla general `>= 2^53 ⇒ rechazar` (primera
implementación) rechazaba erróneamente `1e21`. El testing diferencial contra
la implementación Python confirmó los casos sutiles.

**Resolución (v0).** Rechazar un literal de valor entero `>= 2^53` SSI su
valor decimal exacto difiere del valor exacto del double parseado
(comparación BigInt/Fraction). `9007199254740993` ⇒ `UNSAFE_INTEGER`;
`1e21` ⇒ legal, canonicaliza a `1e+21`. Los literales enormes de repr más
corta como `1.7976931348623157e308` son rechazados por AMBAS
implementaciones (su valor decimal exacto no es el double) — conservador y
consistente.

**Reabrir si.** Se adopta un tipo numérico decimal-exacto (cambio de versión
mayor).

---

## Registro de decisiones (v0, todas con cobertura de tests)

| # | Decisión | Vectores |
|---|---|---|
| AMB-01 | Canonicalización byte-exacta RFC 8785 | canon-001..a05, diferencial 26/26 + 516 floats |
| AMB-02 | `__proto__` es datos inertes | canon-a05 |
| AMB-05 | Allow-list vacía → `null` | dis-004 |
| AMB-06 | `now >= expires_at` ⇒ expirado, en todas partes | con-009, del-008, env-007/026, pol-013 |
| AMB-08 | Envelope: ignorar desconocidos; payload: rechazar | env-002 |
| AMB-09 | Firma sobre canónico reconstruido | neg-001, env-023/024 |
| AMB-10 | Regla de representabilidad exacta para enteros grandes | canon-b04, canon-e05 |
