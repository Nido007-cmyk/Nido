> **Idioma:** [English](../AUTONOMY_MODEL.md) · Español
# NIDO Autonomy Model — Especificación (borrador v0.1)

**Estado:** diseño, NO implementar todavía.

**Pregunta que responde:** ¿cómo pueden dos agentes NIDO descubrir qué
pueden hacer juntos, negociar una tarea y completarla con mínima
intervención humana **sin convertir autonomía en autoridad ilimitada**?

**Regla por encima de todas:**

> *A request can describe what another NIDO wants.*
> *It can never define what this NIDO is authorized to do.*

Principios inviolables: **EL MODELO NO ES NIDO**; mayor inteligencia nunca
implica mayor autoridad — la autoridad siempre la acota el usuario;
fail-closed; minimum disclosure.

**Ley adicional: `AUTONOMY MUST NEVER GROW SILENTLY`.** Ninguna
actualización de modelo, capability, protocolo o software amplía
automáticamente la autoridad concedida. Las reglas de autonomía fijan
(pin) `capability + versión` exactas: si aparece `availability.query/v2`
con más disclosure, o un modelo nuevo con más capacidades, las reglas
antiguas **no** se heredan en silencio — el sistema detecta la expansión
de scope y exige una nueva decisión explícita de política/consentimiento.
Lo ya concedido sigue valiendo para lo ya concedido, ni un bit más.

Este documento extiende `CAPABILITY_MODEL.md` (decisiones de política),
`AGENT_PROTOCOL.md` (envelopes, auditoría) y `MODEL_ROUTER.md`
(transparencia). No los contradice: los hace operativos en el tiempo.

---

## 1. Autonomy budget: autonomía limitada definida por el usuario

El usuario autoriza **categorías de comportamiento**, no prompts
individuales ni tareas sueltas. Una regla de autonomía es un contrato
firmado por el usuario (localmente) que dice: "este sujeto puede hacer
esto, bajo estas condiciones, hasta esta fecha".

### 1.1 Ejemplos normativos

El sistema debe poder expresar, como mínimo:

1. "Mi familia puede consultar mi disponibilidad automáticamente."
   → sujeto: grupo `familia`; capability: `availability.query/v1`;
   modo: `AUTO`; constraints: intervalo ≤ 48 h, granularidad ≥ 30 min.
2. "Mi esposa puede agregar artículos a nuestra lista compartida."
   → sujeto: peer (esposa); capability: `list.item.add/v1`;
   modo: `AUTO`; constraints: solo lista `compras-casa`.
3. "Otros NIDO pueden proponer eventos, pero nunca crearlos sin preguntarme."
   → sujeto: `any`; `calendar.event.propose/v1`: `ASK`;
   `calendar.event.create/v1`: `DENY` salvo `ASK` explícito por tarea.
4. "Nadie puede solicitar ubicación automáticamente."
   → sujeto: `any`; `location.request/v1`: `DENY` (o `ASK` cada vez).

### 1.2 Propiedades obligatorias de toda autonomía

- **Scoped:** la regla nombra sujeto + capability + versión + constraints.
  Nada fuera del scope está permitido. Sin wildcards sobre capabilities.
- **Revocable:** el usuario puede revocar en cualquier momento; la
  revocación surte efecto en el siguiente *node boundary* (ver §4.5).
- **Auditable:** cada ejecución bajo una regla genera eventos de auditoría
  que referencian la `rule_id` (ver §5).
- **Time-limited cuando corresponda:** `valid_until` obligatorio para
  reglas sobre sujetos no íntimos; recomendado siempre. Sin fecha de
  caducidad no hay regla permanente silenciosa.
- **Bounded by limits:** `limits` operativos (frecuencia, volumen,
  granularidad) heredados de la capability (`CAPABILITY_MODEL.md` §1) y
  reforzables por regla.

### 1.3 Dónde vive la decisión

La regla de autonomía **no** sustituye al Policy Engine: es su *input*.
Cada solicitud entrante se evalúa contra las reglas vigentes del usuario;
el resultado alimenta el pipeline (`CAPABILITY_MODEL.md` §4). Si no hay
regla aplicable → `DENY` (fail-closed). Las reglas son datos del usuario,
cifrados en reposo, visibles, exportables y borrables como el resto del
vault.

---

## 2. Clases de ejecución y políticas ricas

### 2.1 Clases base

| Clase | Significado | Mapeo a decisión de política |
|---|---|---|
| `AUTO` | Se ejecuta sin preguntar, si cumple constraints. | `ALLOW_FOR_CONTACT` / `ALLOW_UNDER_CONDITIONS` / `ALLOW_ONCE` |
| `ASK` | Requiere confirmación del usuario. | `ASK_USER` |
| `DENY` | Nunca, para ese sujeto. | `DENY` |

### 2.2 Políticas ricas (combinaciones soportadas)

- `AUTO under constraints` — automático solo si `constraints` se cumplen
  (horario, intervalo máximo, precisión, lista concreta…).
- `ASK once` — pregunta una vez por tarea/graph; la aprobación cubre los
  nodos de esa tarea (ligada por `task_id`, no reutilizable — RT-4).
- `ASK every time` — pregunta por cada ejecución individual.
- `ALLOW until date` — `AUTO`/`ASK once` con `valid_until` explícito.
- `ALLOW for this peer` — sujeto = identidad concreta; no se hereda a
  otros ni a grupos.
- `ALLOW while device nearby` — solo si hay proximidad verificada por el
  transporte local (Bluetooth/LAN); pensado para contextos físicos
  ("en casa").

### 2.3 Guía de UX: el usuario no es experto en seguridad

Las políticas se presentan en **lenguaje llano**, nunca como enums:

- Tarjeta por regla: *"Familia → puede ver cuándo estoy libre → siempre,
  sin preguntar · hasta el 31/12/2027 · [ver detalle] [revocar]"*.
- Al crear una regla, el sistema sugiere defaults por sensibilidad:
  `location.request` sugiere `ASK every time` o `DENY`; el usuario solo
  confirma o ajusta.
- Cada `ASK` muestra: quién pide, qué capability, **qué datos saldrían**
  (categorías, no contenido), y las opciones *"solo esta vez" / "siempre
  para este contacto" / "nunca"*.
- Anti-fatiga: agrupación de decisiones similares, precedentes sugeridos
  ("sueles permitir esto a Familia"), y expiración visible. Una regla
  `ASK every time` que se aprueba 20 veces seguidas sugiere —sin imponer—
  convertirse en `ASK once` o `AUTO under constraints`.
- **Atribución visible** (RT-3): todo lo que venga de un peer se muestra
  como *"de NIDO de X — no verificado"*, también dentro de los diálogos
  de confirmación.

---

## 3. Privacy budget: defensa contra acumulación

**Amenaza:** un peer hace 100 consultas individualmente permitidas
("¿disponible a las 5?", "¿5:15?", "¿5:30?"…) y reconstruye el calendario.
Cada respuesta respeta `minimum_disclosure`; el *conjunto* filtra.

### 3.1 Defensas (en capas, todas configurables por capability)

1. **Rate limits por (peer, capability, ventana):** p. ej.
   `availability.query`: 20 consultas/hora por peer. Superado → error
   `BUDGET_EXHAUSTED` con `retryable: true` y `retry_after_ms`.
2. **Granularidad mínima de consulta y de respuesta:** el ejecutor rechaza
   (`GRANULARITY_TOO_FINE`) o *redondea* intervalos por debajo de la
   granularidad mínima (p. ej. 30 min para disponibilidad). Preguntar
   "¿5:15?" devuelve la respuesta del bloque "5:00–5:30", idéntica a
   preguntar "¿5:00?": la reconstrucción fina se vuelve inútil.
3. **Disclosure budgets:** presupuesto de *unidades de información* por
   (peer, ventana). Cada respuesta descuenta según su entropía aproximada
   (nº de intervalos revelados × granularidad). Agotado → negativa por
   política hasta la siguiente ventana.
4. **Agregación / coarsening:** ante patrones de sondeo, el ejecutor puede
   degradar la respuesta: en vez de intervalos exactos, *"libre 2 de 4
   bloques"*; o fusionar huecos adyacentes. Sigue siendo útil para
   coordinar, inútil para reconstruir.
5. **Cooldowns:** tras N consultas en ventana corta, pausa obligatoria con
   backoff. El cooldown es por peer, no global (no se castiga a todos por
   uno).
6. **Negativa por política con patrón detectado:** heurística local de
   "sondeo sistemático" (barrido secuencial de intervalos). Si se detecta →
   `POLICY_DENIED` + sugerencia de una consulta amplia legítima. La
   heurística es conservadora: ante duda, degradar (coarsening) antes que
   denegar.

### 3.2 Evaluación honesta de privacidad diferencial

**Cuándo NO tiene sentido:** en consultas 1-a-1 donde el peer necesita una
respuesta exacta y útil (coordinar una reunión). Añadir ruido calibrado a
"¿estás libre el martes a las 6?" destruye la utilidad y da una falsa
sensación de privacidad: el atacante repite la consulta y promedia el
ruido. La DP no sustituye a rate limits + granularidad + budgets.

**Cuándo SÍ podría tener sentido (futuro, no ahora):**

- Estadísticas agregadas sobre muchos NIDO (p. ej. "¿cuántos contactos
  están libres el viernes?" con agregador de confianza o cómputo
  multipartito).
- Telemetría agregada opt-in del ecosistema (adopción de versiones).
- Respuestas de grupo (ver `GROUP_TASKS.md`): conteos de disponibilidad
  con ruido antes de revelar el intervalo ganador.

**Decisión:** no implementar DP automáticamente. Mantenerla como opción
explícita por capability futura, solo donde haya agregación real sobre
múltiples sujetos y un modelo de amenaza que lo justifique.

---

## 4. Task graph multi-capacidad

### 4.1 Ejemplo: "organiza una cena"

El modelo **propone** un grafo; el Policy Engine **autoriza cada nodo**:

```
n1  availability.query/v1      (peer: esposa)            AUTO
 │   → free_intervals
n2  meeting.negotiate/v1       (peer: esposa)            AUTO
 │   → agreed_slot  (depende de n1)
n3  places.search/v1           (local, solo mi NIDO)     AUTO
 │   → candidates   (depende de n2)
n4  preferences.ask/v1         (peer: esposa)            ASK once
 │   → choice       (depende de n3)
n5  calendar.event.propose/v1  (peer: esposa)            AUTO
 │   → proposal_id  (depende de n2, n4)
n6  calendar.event.create/v1   (peer: esposa)            DENY ←
     (depende de n5; la regla del usuario exige ASK explícito por tarea)
```

### 4.2 Schema de nodo

Cada nodo declara:

- `capability` + `capability_version`
- `dependencies`: `node_id`s previos (grafo acíclico; ciclos → `MALFORMED`)
- `required_authority`: bajo qué autoridad corre el nodo —
  `peer:<identity>` (la del solicitante original, nunca ampliada) o
  `user` (pasos puramente locales del propio NIDO)
- `data_inputs`: referencias a outputs de nodos previos
  (`"n1.output.free_intervals"`)
- `expected_outputs`: campos que el nodo producirá
- `side_effects`: `none` / `read` / `write` / `external` (heredado de la
  capability; el grafo no puede declararlo menor)

### 4.3 Reglas duras

1. **El modelo propone; el Policy Engine dispone, nodo por nodo.** Cada
   nodo se evalúa como si fuera un `TASK_REQUEST` independiente del
   solicitante original, con su capability, sus parámetros y su política.
2. **Nunca se concede permiso al grafo completo** por el hecho de que el
   modelo lo creó. Un grafo bien formado con un nodo no autorizado es un
   grafo parcialmente denegado, no una autorización global.
3. **El flujo de datos respeta minimum disclosure:** un nodo solo recibe
   los campos que la capability productora permite revelar; el grafo no
   puede "ensanchar" datos entre nodos.
4. **Contabilidad de disclosure del grafo (ronda 3, C-3):** el grafo en
   conjunto se contabiliza contra el privacy budget del solicitante, no
   solo nodo por nodo. Un `data_inputs` solo puede alimentar los inputs
   declarados del nodo destino; el output agregado del grafo se valida
   contra minimum disclosure antes de revelarse al peer. IFC
   (information-flow control) completo queda como investigación abierta:
   el diseño no promete lo que no puede verificar.
4. **La autoridad no crece con la profundidad:** `required_authority` de
   un nodo ⊆ autoridad del solicitante original. Un nodo no puede correr
   "como usuario" si lo pidió un peer (anti confused-deputy, RT-10).
5. **Idempotencia por nodo:** cada nodo tiene su propio `task_id`
   derivado (`graph_id + node_id`); re-ejecutar el grafo no duplica side
   effects (AGENT_PROTOCOL.md §9).

### 4.4 Semántica de fallo parcial

Estados por nodo: `proposed → authorized → running → done | denied |
failed | skipped`.

- Un nodo `DENY` bloquea **solo** las ramas que dependen de él (transitiva-
  mente): sus dependientes pasan a `skipped` con motivo `NODE_DENIED`.
- El trabajo independiente ya permitido **no se destruye**: nodos `done`
  en ramas no afectadas conservan sus resultados.
- El resultado del grafo es **parcial y honesto**: `{status:
  partial, nodes: {n1: done, …, n6: denied, …}}`. Nunca se finge éxito
  total ni se oculta el DENY.
- Reintento: solo de nodos `failed`/`skipped` cuya causa desapareció
  (p. ej. el usuario luego aprueba n6 con `ASK`); los `done` con side
  effects no se re-ejecutan.

### 4.5 Revocación a mitad de tarea

- El Policy Engine revalida la regla de autonomía **en cada node
  boundary**, no solo al inicio del grafo.
- Regla revocada → los nodos pendientes que la necesitaban pasan a
  `skipped` con error `AUTONOMY_REVOKED`; se notifica al solicitante.
- Un nodo en vuelo termina su llamada atómica actual (no se interrumpe un
  write a mitad), pero su resultado **no se revela** al peer si la
  revelación dependía de la regla revocada.
- Los side effects irreversibles ya completados **permanecen** y se
  reportan honestamente en la cadena de explicabilidad (§5). La revocación
  no reescribe el pasado; impide el futuro.

---

## 5. Explainability: "¿por qué hiciste eso?"

NIDO responde con una **cadena verificable de decisiones y eventos**,
generada desde el registro de auditoría — nunca con el chain-of-thought
del modelo.

### 5.1 Formato de la cadena

```json
{
  "task_id": "7a11…",
  "chain": [
    {"event": "task.received", "from_identity": "ab12…", "at": 1790000000000},
    {"event": "graph.proposed", "by": "model:local-qwen2.5-1.5b", "nodes": 6},
    {"event": "policy.decision", "node": "n1", "capability": "availability.query/v1",
     "decision": "AUTO", "rule_id": "rule-7"},
    {"event": "policy.decision", "node": "n6", "capability": "calendar.event.create/v1",
     "decision": "DENY", "rule_id": "rule-3", "reason": "requires explicit ASK"},
    {"event": "consent.requested", "node": "n4", "to": "user"},
    {"event": "consent.granted", "node": "n4", "by": "user", "scope": "task 7a11…, once"},
    {"event": "tool.executed", "node": "n1", "local": true},
    {"event": "result.disclosed", "node": "n1", "to_identity": "ab12…",
     "disclosure": "availability intervals (2 blocks)"}
  ]
}
```

En lenguaje llano para el usuario:

> *El NIDO de María pidió coordinar una cena. Su NIDO propuso 6 pasos.
> La política permitió 4 automáticamente (regla "Familia"), 1 pidió tu
> confirmación (la aprobaste solo para esta tarea) y 1 fue denegado (crear
> el evento requiere tu aprobación explícita). Se reveló a María:
> intervalos de disponibilidad (2 bloques). Nada más.*

### 5.2 Reglas

- Se registran **decisiones y eventos**, no razonamiento privado del
  modelo. Prohibido exponer chain-of-thought, prompts internos o
  deliberación del modelo.
- La cadena es verificable: cada evento referencia `task_id`, `node_id`,
  `rule_id` y `grant_scope` cuando aplica; las firmas del envelope
  permiten a un tercero (el propio usuario, un auditor) comprobar origen.
- Sin contenido sensible: categorías de disclosure, nunca parámetros
  completos (AGENT_PROTOCOL.md §11).

---

## 6. Parte máquina-verificable (borradores)

### 6.1 JSON Schema — regla de autonomía (`autonomy.rule/v1`)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "autonomy.rule/v1",
  "type": "object",
  "properties": {
    "rule_id":      {"type": "string"},
    "v":             {"const": 1},
    "subject":       {"type": "object",
                      "properties": {
                        "type": {"enum": ["peer", "group", "any"]},
                        "identity": {"type": "string"},
                        "group": {"type": "string"}},
                      "required": ["type"], "additionalProperties": false},
    "capability":          {"type": "string"},
    "capability_version":  {"type": "string", "pattern": "^v[0-9]+$"},
    "mode":        {"enum": ["AUTO", "ASK", "DENY"]},
    "ask_mode":    {"enum": ["every_time", "once_per_task", "once"]},
    "constraints": {"type": "object", "additionalProperties": true},
    "limits":      {"type": "object",
                    "properties": {
                      "max_queries_per_hour": {"type": "integer", "minimum": 1},
                      "min_granularity_minutes": {"type": "integer", "minimum": 1},
                      "disclosure_units_per_day": {"type": "integer", "minimum": 1},
                      "cooldown_ms": {"type": "integer", "minimum": 0}},
                    "additionalProperties": false},
    "proximity":   {"enum": ["any", "nearby"]},
    "max_uses":    {"type": ["integer", "null"], "minimum": 1},
    "valid_from":  {"type": "integer"},
    "valid_until": {"type": ["integer", "null"]},
    "revocable":   {"const": true},
    "created_by":  {"const": "user"},
    "created_at":  {"type": "integer"}
  },
  "required": ["rule_id", "v", "subject", "capability", "capability_version",
               "mode", "revocable", "created_by", "created_at"],
  "additionalProperties": false
}
```

### 6.2 JSON Schema — task graph (`autonomy.taskgraph/v1`)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "autonomy.taskgraph/v1",
  "type": "object",
  "properties": {
    "graph_id":    {"type": "string"},
    "task_id":     {"type": "string"},
    "proposed_by": {"type": "string"},
    "nodes": {"type": "array", "minItems": 1, "items": {
      "type": "object",
      "properties": {
        "node_id": {"type": "string"},
        "capability": {"type": "string"},
        "capability_version": {"type": "string", "pattern": "^v[0-9]+$"},
        "parameters": {"type": "object"},
        "dependencies": {"type": "array", "items": {"type": "string"}},
        "required_authority": {"type": "string"},
        "data_inputs": {"type": "array", "items": {"type": "string"}},
        "expected_outputs": {"type": "array", "items": {"type": "string"}},
        "side_effects": {"enum": ["none", "read", "write", "external"]}
      },
      "required": ["node_id", "capability", "capability_version",
                   "dependencies", "required_authority", "side_effects"],
      "additionalProperties": false
    }}
  },
  "required": ["graph_id", "task_id", "proposed_by", "nodes"],
  "additionalProperties": false
}
```

### 6.3 Códigos de error (borrador, aditivos a AGENT_PROTOCOL.md §5.1)

| Código | Cuándo | `retryable` |
|---|---|---|
| `AUTONOMY_DENIED` | Ninguna regla de autonomía lo permite. | `false` |
| `AUTONOMY_REVOKED` | La regla se revocó a mitad de tarea (§4.5). | `false` |
| `BUDGET_EXHAUSTED` | Rate limit / disclosure budget agotado (§3.1). | `true` (+`retry_after_ms`) |
| `GRANULARITY_TOO_FINE` | Consulta por debajo de la granularidad mínima. | `true` (reintentar más grueso) |
| `NODE_DENIED` | Un nodo del graph fue denegado; ramas dependientes en `skipped`. | `false` |
| `GRAPH_MALFORMED` | Ciclos, autoridad creciente, side effects declarados a la baja. | `false` |

---

## 7. Preguntas abiertas

1. ¿Las reglas de autonomía deben firmarse con la clave de identidad
   (auditoría fuerte, multi-dispositivo) o basta el almacenamiento local
   cifrado?
2. ¿Cómo se sincronizan reglas entre dispositivos del mismo usuario sin
   crear un canal que un secondary comprometido pueda abusar?
3. Heurística de "sondeo sistemático" (§3.1.6): ¿qué falsos positivos son
   aceptables antes de degradar a coarsening?
4. ¿El `ASK once` por graph necesita un consentimiento estructurado
   distinto del `CONSENT_RESULT` por tarea, o basta ligarlo al `task_id`
   del graph?
5. ¿Unidades de disclosure (§3.1.3): entropía aproximada, conteo simple de
   campos, o presupuesto por capability definido por el usuario?
6. En graphs largos (días), ¿la revalidación por node boundary necesita
   además revalidación temporal (la regla expiró entre nodos)?
7. ¿La cadena de explicabilidad debe ser exportable/firmada para
   disputas entre usuarios ("tu NIDO hizo X")?
