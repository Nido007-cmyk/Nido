> **Idioma:** [English](../CAPABILITY_MODEL.md) · Español
# NIDO Capability Model — Especificación (borrador v0.1)

**Estado:** diseño, NO implementar todavía.

Una *capability* es un permiso estructurado, versionado y con schema que un
NIDO puede solicitar a otro NIDO. **Otro NIDO nunca obtiene
automáticamente una herramienta por ser contacto.** La política local
decide siempre.

---

## 1. Definición de capability

```json
{
  "name": "calendar.availability.query",
  "version": "v1",
  "description": "Consulta disponibilidad en un intervalo sin revelar eventos.",
  "input_schema": { "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {
      "interval_start": { "type": "integer" },
      "interval_end": { "type": "integer" }
    },
    "required": ["interval_start", "interval_end"],
    "additionalProperties": false },
  "output_schema": { "type": "object",
    "properties": {
      "free_intervals": { "type": "array",
        "items": { "type": "object",
          "properties": { "start": { "type": "integer" },
                          "end": { "type": "integer" } },
          "required": ["start", "end"] } }
    },
    "required": ["free_intervals"],
    "additionalProperties": false },
  "required_permissions": ["calendar.read.local"],
  "sensitivity": "medium",
  "minimum_disclosure": ["free_intervals[].start", "free_intervals[].end"],
  "human_approval": "conditional",
  "delegation_permitted": true,
  "max_delegation_depth": 1,
  "expiration_behavior": "result_valid_until_interval_end",
  "side_effects": "none"
}
```

Campos obligatorios de toda capability:

| Campo | Significado |
|---|---|
| `name` / `version` | Identificador + versión (`…/v1`). Versionado independiente del protocolo. |
| `input_schema` / `output_schema` | JSON Schema. `additionalProperties: false` por defecto. |
| `required_permissions` | Permisos locales que el ejecutor necesita (los concede el usuario, no el peer). |
| `sensitivity` | `low` / `medium` / `high`. Alimenta defaults de política y del Model Router. |
| `minimum_disclosure` | **Lista exacta** de campos que el resultado puede revelar. Todo lo demás está prohibido en el output. |
| `human_approval` | `never` / `conditional` / `always`. |
| `delegation_permitted` / `max_delegation_depth` | Si puede delegarse y cuántos saltos. |
| `limits` | Límites operativos que el ejecutor aplica **aunque** el input sea schema-válido: intervalo máximo, nº máximo de resultados, precisión mínima, etc. (RT-13: un schema válido no implica petición razonable). |
| `expiration_behavior` | Qué significa la expiración del resultado. |
| `side_effects` | `none` / `read` / `write` / `external`. Las de `write`/`external` exigen idempotencia. |

**Interoperabilidad semántica:** en diez años, un agente con una
arquitectura de IA totalmente diferente debe entender qué se solicita con
solo el nombre, la versión y los schemas. **El protocolo nunca depende de
lenguaje natural cuando puede existir un schema estable.**

---

## 2. Catálogo inicial (ejemplos normativos de disclosure)

| Capability | Input | Output permitido | Prohibido en output |
|---|---|---|---|
| `message.send/v1` | `{to_identity, text≤4000}` | `{message_id, delivered_at}` | — (el texto lo pone el emisor) |
| `availability.query/v1` | `{interval_start, interval_end}` | `{free_intervals[]}` | títulos, participantes, ubicación, notas, calendario completo |
| `calendar.event.propose/v1` | `{title, start, end, attendees?}` | `{proposal_id, conflicts: bool}` | eventos existentes |
| `calendar.event.create/v1` | `{…}` | `{event_id}` | — · `human_approval: always` |
| `file.request/v1` | `{file_id|query, purpose}` | `{offer: {file_id, name, size, mime}}` | contenido, rutas, listado completo |
| `file.send/v1` | `{file_id, transfer_token}` | `{received_bytes}` | otros archivos |
| `reminder.propose/v1` | `{text, at}` | `{proposal_id}` | — · crear exige aprobación |
| `location.request/v1` | `{purpose, precision}` | `{lat, lon, accuracy}` según `precision` | histórico · `sensitivity: high`, `human_approval: always`, `delegation_permitted: false` |
| `agent.task/v1` | `{goal, constraints, requested_capabilities[]}` | según sub-tarea | meta-capability: siempre pasa por policy; **solo** puede invocar las capabilities declaradas en `requested_capabilities[]`, cada una evaluada por separado (RT-1) |

Ejemplo canónico de minimum disclosure: ante
"¿disponible entre 5 y 7?", responder "disponible de 6 a 7" **sin**
nombre del evento, ubicación, participantes, notas ni calendario completo.
El schema de output lo hace estructuralmente imposible de filtrar por
accidente: `additionalProperties: false` + lista cerrada de campos.

---

## 3. Decisiones de política

Para cada par (peer identity, capability, contexto), la política local
devuelve una de:

- `DENY` — rechazo con `POLICY_DENIED`. Defecto para peers desconocidos y
  capabilities desconocidas.
- `ASK_USER` — se presenta al usuario (qué peer, qué capability, qué datos
  saldrían) y se ejecuta solo con aprobación explícita.
- `ALLOW_ONCE` — una ejecución; no crea precedente.
- `ALLOW_FOR_CONTACT` — permitido para ese contacto mientras la regla exista.
- `ALLOW_UNDER_CONDITIONS` — permitido si se cumplen constraints
  (horario, intervalo máximo, precisión de ubicación, etc.).

Ejemplo: el NIDO de la esposa puede `availability.query` (`ALLOW_FOR_CONTACT`),
puede `calendar.event.propose` (`ASK_USER`), pero `calendar.event.create`
requiere su confirmación (`human_approval: always`) y **nunca** puede leer
el calendario completo (ninguna capability lo permite).

---

## 4. Contrato del Policy Engine (definir ahora, implementar después)

Toda solicitud entrante sigue este pipeline, en código, sin excepciones:

```
peer autenticado
  → validación de protocolo (firma, versión, expiración, schema)
  → validación de capability (¿existe? ¿versión soportada?)
  → evaluación de política (DENY/ASK/ALLOW_* + cadena de delegación si la hay)
  → consentimiento si se requiere (usuario local)
  → ejecución de la tool
  → resultado filtrado por minimum_disclosure
```

**Nunca:** `contenido remoto → modelo → ejecución de tool`.

- **Modelo ≠ autoridad.** El modelo puede *proponer* parámetros o *resumir*
  resultados para mostrarlos, pero la autorización es código determinista.
- **El peer ≠ autoridad.** Un peer autenticado tiene exactamente los
  permisos que la política local le otorga, ni uno más.
- **Confused deputy:** una tarea del peer X se ejecuta con la autoridad de
  X, nunca con la del usuario. Las tools verifican "¿X tiene capability C
  con estos parámetros?" — no "¿la petición está bien formada?". Otro NIDO
  no puede usar mi NIDO para hacer algo que él mismo no tiene autorizado.
- **Procedencia hacia terceros (RT-10):** toda acción con efectos sobre un
  tercero (p. ej. A pide a B que escriba en el calendario de C) lleva la
  `delegation_chain` con el issuer original; **el NIDO afectado evalúa la
  cadena**, no solo la identidad del ejecutor directo. Sin cadena válida →
  rechazo.
- **La delegación nunca anula un DENY (RT-5):** la política local se evalúa
  sobre el issuer original **y** cada intermediario; un `DENY` en cualquier
  punto corta la cadena.
- **Sandbox de tools (RT-14):** las tools se ejecutan con el mínimo
  privilegio de su capability y su salida se valida contra `output_schema`
  antes de salir del dispositivo.

---

## 5. Trust boundary: prompt injection

Niveles de confianza del contenido:

1. **SYSTEM** — el usuario y sus políticas locales. Única autoridad.
2. **AGENT_LOCAL** — salida estructurada del propio modelo; se valida
   contra schemas antes de usarse.
3. **PEER** — autenticado vía protocolo, pero **UNTRUSTED DATA**.
4. **EXTERNAL** — web, archivos, QR, modelo remoto, tool externa.
   Sin autenticar: **UNTRUSTED DATA**.

Reglas:

- El contenido PEER/EXTERNAL es **dato**. El modelo puede analizarlo,
  resumirlo y mostrarlo. **No puede convertirlo por sí mismo en
  privilegios.**
- Toda tool call derivada de contenido PEER/EXTERNAL debe pasar la
  evaluación de política **como si el peer la hubiera pedido en un
  `TASK_REQUEST` estructurado**. El modelo propone; el Policy Engine dispone.
- **Ataque indirecto** (debe detenerse):
  un NIDO manda un archivo → el archivo contiene instrucciones maliciosas →
  el modelo las interpreta → intenta usar una tool → **el Policy Engine
  evalúa la tool contra los permisos del peer y la deniega** (el peer no
  tiene esa capability, o requiere `ASK_USER`). La escalada muere en la
  evaluación, no en la "inteligencia" del modelo.
- El texto libre del peer (descripciones, notas de progreso) se renderiza
  como texto citado, nunca se interpola en prompts privilegiados del
  sistema. Separación sintáctica entre datos y plantillas de sistema.
- **Atribución visible (RT-3):** todo contenido de origen peer/externo debe
  mostrarse con atribución ("de NIDO de X — no verificado"). El modelo
  puede citarlo, nunca presentarlo como hecho propio. Así se cierra el
  engaño al usuario a través del modelo.

---

## 6. Discovery con privacidad

`CAPABILITY_QUERY` → `CAPABILITY_RESPONSE` anuncia **solo**
`{name, version, description}` pública. Un NIDO puede decir
"soporto `calendar.availability.query/v1`" sin revelar qué calendario usa,
qué modelo tiene, qué archivos existen ni qué servicios conectó. El anuncio
es una promesa de interface, no un inventario.

La negociación fina (¿qué parámetros aceptas?) ocurre por tarea, no en el
anuncio.

---

## 7. Minimum disclosure formal

Cada capability declara `minimum_disclosure` como lista cerrada de rutas
de campos. El ejecutor:

1. Calcula el resultado completo localmente (p. ej. lee el calendario).
2. Proyecta **solo** los campos listados.
3. Valida el resultado contra `output_schema` (`additionalProperties: false`
   lo garantiza estructuralmente).
4. Registra `disclosure_summary` en auditoría (categorías, no contenido).

La negociación de privacidad (pedir menos de lo máximo) es propiedad
permanente: el solicitante puede pedir un intervalo menor o menor precisión,
y el ejecutor puede responder con un subconjunto aún menor.

---

## 8. Preguntas abiertas

1. ¿Lenguaje de constraints para `ALLOW_UNDER_CONDITIONS`? (¿Reglas
   declarativas simples o un mini-DSL versionado?)
2. ¿Las policies por defecto deben venir firmadas/actualizables, o son
   100% locales y manuales?
3. ¿`agent.task/v1` necesita sub-schemas por "tipo de tarea" para no
   convertirse en un agujero genérico?
4. ¿Cómo se presenta al usuario una decisión `ASK_USER` sin fatiga de
   diálogos? (Agrupación, precedentes sugeridos, expiración de reglas.)
