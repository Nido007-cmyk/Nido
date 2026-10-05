> **Idioma:** [English](../CAPABILITY_NEGOTIATION.md) · Español
# NIDO Capability Negotiation — Especificación (borrador v0.1)

**Estado:** diseño, NO implementar todavía.

**Alcance:** cómo dos NIDO descubren qué pueden hacer juntos, negocian
una tarea de forma estructurada y la completan con mínima intervención
humana — sin que la autonomía se convierta en autoridad ilimitada.

**Regla por encima de todas:**

> *A request can describe what another NIDO wants. It can never define
> what this NIDO is authorized to do.*

La negociación produce **acuerdo sobre términos**, nunca autorización.
Después de un `ACCEPT`, cada Policy Engine decide localmente qué acción
final está permitida, pasando por el pipeline completo
(`CAPABILITY_MODEL.md` §4).

---

## 1. Discovery selectivo de capabilities

### 1.1 Modelo de pregunta conceptual

Un NIDO no necesita el catálogo completo de otro. Puede preguntar por una
capability concreta:

`CAPABILITY_QUERY{query_id, capability_filter: {name, version}}` →
respuesta **trivaluada**:

- `SUPPORTED` — la soporto con mi política por defecto.
- `UNSUPPORTED` — no la soporto (o no quiero que lo sepas; ver §1.3).
- `SUPPORTED_WITH_CONSTRAINTS` — la soporto bajo constraints públicos,
  con `constraints_summary` (ver §1.2).

Esto refina el `CAPABILITY_QUERY`/`CAPABILITY_RESPONSE` de
`AGENT_PROTOCOL.md` §5.2: la respuesta a una consulta dirigida es el
estado + resumen de constraints, no una lista.

### 1.2 `constraints_summary`: público, sin datos privados

```json
{
  "status": "SUPPORTED_WITH_CONSTRAINTS",
  "capability": "calendar.availability.query",
  "version": "v1",
  "constraints_summary": {
    "requires": "user_consent_per_request",
    "limits": { "max_interval_hours": 24, "max_queries_per_hour": 20 },
    "sensitivity": "medium"
  }
}
```

El resumen describe **política pública** (qué pedir, con qué límites),
nunca proveedor, aplicación, calendario, modelo, archivos, servicios
internos ni datos del usuario. Es una promesa de interface, no un
inventario.

### 1.3 Defensas contra fingerprinting vía discovery

El discovery es un canal de reconocimiento. Reglas:

1. **Respuestas mínimas y uniformes.** Los tres estados devuelven el mismo
   conjunto de campos; solo cambia el enum y el `constraints_summary`.
   Nada de tiempos, tamaños o detalles que distingan "no soportado" de
   "soportado pero oculto".
2. **Rate limiting.** El receptor limita queries de discovery por
   identidad emisora (defecto sugerido: 20/hora por peer, configurable).
   Excedido → `DISCOVERY_RATE_LIMITED`, fail-closed.
3. **Sin enumeración libre.** No se aceptan wildcards ni listados
   completos de desconocidos salvo que la política local lo permita. La
   consulta es por nombre+versión concretos.
4. **Política de discovery para extraños.** Cada NIDO configura, global y
   por peer: `answer` | `answer_minimal` (responder `UNSUPPORTED` a todo
   sin revelar nada) | `ignore`. Defecto para desconocidos:
   `answer_minimal`.
5. **Prohibición explícita de filtración.** Una respuesta de discovery
   NUNCA contiene: proveedor o modelo usado, app o servicio interno,
   calendarios/archivos existentes, rutas, identificadores internos,
   capabilities no preguntadas. Violación = bug de seguridad, no de UX.
6. **Discovery ≠ autorización.** Que B responda `SUPPORTED` no otorga a A
   ningún permiso; solo informa que la conversación puede continuar. La
   autorización ocurre por tarea en el Policy Engine.

### 1.4 Ejemplo normativo

A quiere coordinar una reunión con B. A no necesita saber las tools de B;
pregunta conceptualmente:

```
A → B: CAPABILITY_QUERY{calendar.availability.query, v1}
B → A: SUPPORTED_WITH_CONSTRAINTS{requires: user_consent_per_request,
       limits: {max_interval_hours: 24}}
```

A ya sabe que puede proponer una negociación de disponibilidad dentro de
esos límites, sin haber aprendido nada sobre el calendario, la app o el
modelo de B.

---

## 2. Negociación estructurada de tareas

### 2.1 Tipos de mensaje (payloads del envelope versionado)

Nuevos `message_type` del core (ver §5 para schemas):

- `NEGOTIATION_PROPOSE` — `{negotiation_id, capability,
  capability_version, terms, expires_at, max_rounds?}`. `terms` valida
  contra el `negotiation_terms_schema` declarado por la capability.
- `NEGOTIATION_COUNTER` — `{negotiation_id, round, terms, expires_at}`.
  Contrapropuesta estructurada (sin lenguaje natural).
- `NEGOTIATION_ACCEPT` — `{negotiation_id, accepted_terms}`. Acuerdo
  sobre términos. **No autoriza ejecución.**
- `NEGOTIATION_DECLINE` — `{negotiation_id, reason_code}`. Terminal.
- `NEGOTIATION_EXPIRE` — `{negotiation_id, reason: timeout|withdrawn}`.
  Emitido por cualquiera al vencer el timeout o retirar la negociación.

`negotiation_id`: 128 bits hex, clave de idempotencia del ciclo de
negociación (análogo a `task_id`). Un `PROPOSE` duplicado con el mismo
`negotiation_id` se deduplica, nunca abre dos negociaciones.

### 2.2 Máquina de estados

```
PROPOSED ──COUNTER──▶ COUNTERED ──COUNTER──▶ COUNTERED (rondas ≤ max_rounds)
   │                     │  │                      │
   │                     │  └────ACCEPT────▶ ACCEPTED (terminal: acuerdo)
   │                     │                         │
   │                     └────DECLINE───▶ DECLINED (terminal)
   ├────ACCEPT────▶ ACCEPTED
   ├────DECLINE───▶ DECLINED
   └────timeout───▶ EXPIRED (terminal; cualquiera puede emitir NEGOTIATION_EXPIRE)
```

- `ACCEPT` solo es válido desde `PROPOSED` o `COUNTERED`.
- `COUNTER` solo desde `PROPOSED`/`COUNTERED` y con `round` incremental;
  superado `max_rounds` → `NEGOTIATION_INVALID_TRANSITION`.
- Transición inválida, `negotiation_id` desconocido o expirado →
  `TASK_ERROR` con el código correspondiente, fail-closed.
- `ACCEPTED` es terminal **para la negociación**, no para la tarea: el
  siguiente paso es un `TASK_REQUEST` con los términos aceptados, que pasa
  por el pipeline completo del Policy Engine de cada lado. Cualquiera
  puede aún responder `POLICY_DENIED` o pedir `ASK_USER`.
- **Rondas contra el privacy budget (ronda 3, C-2):** cada `COUNTER`
  revela información sobre las constraints del que contrapropone; las
  rondas consumen disclosure budget del peer y los counters deben ser
  gruesos por política (franjas amplias, no minutos exactos). Una
  negociación no es un oráculo gratuito: `max_rounds` bajo por defecto.

### 2.3 Timeouts y expiración

- Todo `PROPOSE`/`COUNTER` lleva `expires_at` (obligatorio). Vencido sin
  respuesta → estado local `EXPIRED`; se puede emitir
  `NEGOTIATION_EXPIRE` como cortesía, pero la expiración es local y no
  depende de recibirlo.
- Tolerancia de reloj: la misma del protocolo (defecto 5 min,
  `AGENT_PROTOCOL.md` §4.1).
- Una negociación expirada nunca puede reabrirse: se inicia una nueva con
  nuevo `negotiation_id`.

### 2.4 Ejemplo normativo (sin lenguaje natural)

A propone reunión el martes 17:00–20:00; B contrapropone 18:30–19:30; A
acepta. Después cada Policy Engine decide:

```
A → B: NEGOTIATION_PROPOSE{
         negotiation_id: "…", capability: "calendar.event.propose", version: "v1",
         terms: { window_start: 1790…, window_end: 1790…, duration_min: 60 },
         expires_at: … }
B → A: NEGOTIATION_COUNTER{
         negotiation_id: "…", round: 1,
         terms: { window_start: 1790…+90min, window_end: 1790…+150min, duration_min: 60 },
         expires_at: … }
A → B: NEGOTIATION_ACCEPT{ negotiation_id: "…", accepted_terms: { …mismos… } }
```

Acuerdo alcanzado. Ahora:

```
A → B: TASK_REQUEST{ capability: "calendar.event.propose/v1",
                     parameters: { title: "…", start: …, end: … } }
B: policy local → ASK_USER (su usuario confirma) → TASK_ACCEPT → ejecuta → TASK_RESULT
```

Si la política de B dijera `DENY` para ese peer, el `ACCEPT` de la
negociación no serviría de nada: **el acuerdo no es autorización**.

### 2.5 `negotiation_terms_schema`

Cada capability negociable declara un `negotiation_terms_schema` (JSON
Schema, `additionalProperties: false`). Sin schema de términos declarado,
la capability no es negociable y un `NEGOTIATION_PROPOSE` se rechaza con
`NEGOTIATION_NOT_SUPPORTED`. Los términos son datos estructurados;
cualquier texto libre dentro de `terms` se trata como dato no sensible
(regla RT-2) y nunca como instrucción.

---

## 3. Sistema de extensiones

### 3.1 Core pequeño, capabilities independientes

- **Core (estable):** envelope, validación de protocolo, tipos base
  (`TASK_*`, `CAPABILITY_*`, `CONSENT_*`, `NEGOTIATION_*`), delegación,
  versionado, idempotencia, auditoría.
- **Extensión:** toda capability nueva, todo `message_type` nuevo fuera
  del core, todo `negotiation_terms_schema` nuevo. Cada extensión lleva
  `{extension_name, extension_version, schemas}` y versiona
  independientemente del core.

### 3.2 Regla dura: ninguna extensión salta el Policy Engine

1. Todo payload de extensión entra por el **mismo pipeline**: validación
   de protocolo → validación de capability → evaluación de política →
   consentimiento → ejecución → resultado filtrado.
2. Un `message_type` de extensión desconocido → rechazo fail-closed
   (`UNKNOWN_MESSAGE_TYPE`), nunca "paso directo".
3. Una extensión **no puede** declarar privilegios de tool: solo declara
   capabilities, y cada capability se ejecuta bajo la política local con
   el sandbox de tools (`CAPABILITY_MODEL.md` §4, RT-14).
4. **Anti-shadowing (ronda 3, C-10):** la identidad de una capability es
   `nombre + versión` exactos. Una extensión **no puede** registrar un
   nombre del core (ni prefijos que lo imiten) con semántica de disclosure
   distinta; la colisión se rechaza en validación de capability. Pedir
   `availability.query/v1` invoca siempre la definición del core, nunca
   una "v1-ext" oportunista.
4. Una extensión no puede modificar el pipeline, la política de otro peer
   ni los campos del envelope firmados por terceros.
5. El `constraints_summary` y los metadatos de una extensión son
   descriptivos; la política local decide si los cree (ver §4).

### 3.3 Compatibilidad

- Extensiones versionadas con deprecación y sunset como las capabilities
  (`AGENT_PROTOCOL.md` §6).
- Un NIDO antiguo que recibe una extensión que no entiende falla
  explícitamente (`UNKNOWN_CAPABILITY` / `UNSUPPORTED_VERSION`), sin
  downgrade silencioso.

---

## 4. Preparación para futura economía de agentes (larguísimo plazo)

**No se diseña ni se implementa ningún pago.** Ni blockchain, ni tokens,
ni payment logic. Solo se evita cerrar arquitectónicamente la puerta:
`TASK` y `CAPABILITY` pueden llevar metadatos **descriptivos**:

```json
"economy_hint": {
  "cost": { "amount": "0", "currency": "USD", "basis": "per_request" },
  "resource_requirements": ["network-egress"],
  "estimated_duration_ms": 30000,
  "conditions": ["requires_contact_consent"]
}
```

Reglas:

1. **Descriptivo, no autoritativo.** Estos campos son *afirmaciones
   auto-reportadas* del otro lado: informan a la UX ("esta capability
   declara un coste") y a la política local, pero **nunca definen
   autorización ni obligación**. Un peer malicioso puede mentir
   (`cost: 0`); la política local decide si le cree y cuánto.
2. **La política local manda.** Un coste declarado no autoriza cargos; una
   duración estimada no concede tiempo; unas conditions declaradas no
   sustituyen la evaluación local.
3. **Validación como dato.** Los campos validan contra schema (forma),
   nunca contra realidad (fondo). Van en auditoría como "declarado por el
   peer", no como hechos.
4. **Puerta abierta, nada más.** Si algún día existe una economía de
   agentes (otro usuario, un negocio, un vehículo, una casa, un servicio),
   estos campos son el gancho donde engancharla sin rediseñar el
   protocolo. Hasta entonces son informativos.

---

## 5. Parte máquina-verificable

### 5.1 JSON Schemas (draft 2020-12, `additionalProperties: false`)

```json
{
  "$defs": {
    "hex128": { "type": "string", "pattern": "^[0-9a-f]{32}$" },
    "millis": { "type": "integer", "minimum": 0 },

    "NegotiationPropose": {
      "type": "object",
      "properties": {
        "negotiation_id": { "$ref": "#/$defs/hex128" },
        "capability": { "type": "string", "minLength": 1 },
        "capability_version": { "type": "string", "pattern": "^v[0-9]+$" },
        "terms": { "type": "object" },
        "expires_at": { "$ref": "#/$defs/millis" },
        "max_rounds": { "type": "integer", "minimum": 1, "maximum": 10, "default": 5 }
      },
      "required": ["negotiation_id", "capability", "capability_version", "terms", "expires_at"]
    },

    "NegotiationCounter": {
      "type": "object",
      "properties": {
        "negotiation_id": { "$ref": "#/$defs/hex128" },
        "round": { "type": "integer", "minimum": 1 },
        "terms": { "type": "object" },
        "expires_at": { "$ref": "#/$defs/millis" }
      },
      "required": ["negotiation_id", "round", "terms", "expires_at"]
    },

    "NegotiationAccept": {
      "type": "object",
      "properties": {
        "negotiation_id": { "$ref": "#/$defs/hex128" },
        "accepted_terms": { "type": "object" }
      },
      "required": ["negotiation_id", "accepted_terms"]
    },

    "NegotiationDecline": {
      "type": "object",
      "properties": {
        "negotiation_id": { "$ref": "#/$defs/hex128" },
        "reason_code": { "enum": ["terms_unacceptable", "policy_would_deny",
                                 "no_longer_needed", "other"] }
      },
      "required": ["negotiation_id", "reason_code"]
    },

    "NegotiationExpire": {
      "type": "object",
      "properties": {
        "negotiation_id": { "$ref": "#/$defs/hex128" },
        "reason": { "enum": ["timeout", "withdrawn"] }
      },
      "required": ["negotiation_id", "reason"]
    },

    "DiscoveryCheck": {
      "type": "object",
      "properties": {
        "query_id": { "$ref": "#/$defs/hex128" },
        "capability": { "type": "string", "minLength": 1 },
        "capability_version": { "type": "string", "pattern": "^v[0-9]+$" }
      },
      "required": ["query_id", "capability", "capability_version"]
    },

    "DiscoveryCheckResponse": {
      "type": "object",
      "properties": {
        "query_id": { "$ref": "#/$defs/hex128" },
        "capability": { "type": "string" },
        "capability_version": { "type": "string" },
        "status": { "enum": ["SUPPORTED", "UNSUPPORTED", "SUPPORTED_WITH_CONSTRAINTS"] },
        "constraints_summary": {
          "type": "object",
          "properties": {
            "requires": { "type": "string" },
            "limits": { "type": "object" },
            "sensitivity": { "enum": ["low", "medium", "high"] }
          },
          "additionalProperties": false
        }
      },
      "required": ["query_id", "capability", "capability_version", "status"]
    }
  }
}
```

Notas: `terms` valida además contra el `negotiation_terms_schema` de la
capability; `constraints_summary` nunca lleva datos privados (§1.2). Todos
estos payloads viajan dentro del envelope firmado y canonicalizado
(RFC 8785) de `AGENT_PROTOCOL.md` §4.

### 5.2 Códigos de error (extienden `AGENT_PROTOCOL.md` §5.1)

| Código | Cuándo |
|---|---|
| `NEGOTIATION_UNKNOWN` | `negotiation_id` desconocido |
| `NEGOTIATION_EXPIRED` | negociación expirada o `expires_at` vencido |
| `NEGOTIATION_INVALID_TRANSITION` | `ACCEPT`/`COUNTER` en estado no permitido, `round` no incremental, `max_rounds` superado |
| `NEGOTIATION_NOT_SUPPORTED` | la capability no declara `negotiation_terms_schema` |
| `NEGOTIATION_TERMS_MISMATCH` | `accepted_terms` no coincide con los últimos términos |
| `DISCOVERY_RATE_LIMITED` | excedido el límite de queries de discovery |
| `DISCOVERY_FORBIDDEN` | la política local no responde discovery a este peer |
| `UNKNOWN_MESSAGE_TYPE` | `message_type` de extensión no registrado |

### 5.3 Vectores de conformance (futuros)

- Canonicalización + firma de un `NEGOTIATION_PROPOSE` (mismas reglas que
  `AGENT_PROTOCOL.md` §12; vectores completos al estabilizar `nido/1.0`).
- Transiciones válidas/inválidas de la máquina de estados (§2.2).
- `NEGOTIATION_TERMS_MISMATCH` ante `accepted_terms` alterados.
- Discovery: `SUPPORTED_WITH_CONSTRAINTS` sin filtración; rate limit
  ante ráfaga; `answer_minimal` ante desconocidos.
- Extensión desconocida → `UNKNOWN_MESSAGE_TYPE`, fail-closed.

---

## 6. Preguntas abiertas

1. ¿`max_rounds` por defecto 5 es razonable, o debe ser por capability?
2. ¿Deben las contrapropuestas (`COUNTER`) revelar menos que la propuesta
   inicial para limitar la reconstrucción por rondas? (Relación con
   privacy budgets: ver `AUTONOMY_MODEL.md`.)
3. ¿El `constraints_summary` debería firmarse por separado para
   permitir cacheo entre peers sin re-preguntar?
4. Negociación multi-ronda sobre relay con latencia de días: ¿timeouts
   adaptativos o el solicitante fija `expires_at` generosos siempre?
5. ¿Un registro de extensiones necesita algún mecanismo de nombres
   globalmente únicos sin autoridad central? (p. ej. `dominio-invertido/`
   como en Java/Kotlin.)
6. La negociación grupal (A↔B↔C↔D) queda fuera de este documento: ver
   `GROUP_TASKS.md`.
