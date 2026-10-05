> **Idioma:** [English](../AGENT_PROTOCOL.md) · Español
# NIDO Agent Protocol — Especificación (borrador v0.1)

**Estado:** diseño, NO implementar todavía. Los envelopes actuales
(`chat`/`agent_task`/`agent_result`) NO se migran hasta que este diseño
sobreviva la revisión red-team.

**Objetivo:** una red privada de agentes personales interoperables. El
protocolo debe sobrevivir cambios de modelos, hardware, sistemas
operativos, transportes, criptografía, proveedores y lenguajes de
programación. **EL MODELO NO ES NIDO.**

**Principio de interoperabilidad futura:** escrito como si algún día
existieran Official NIDO Android/iOS, NIDO Desktop, NIDO Home y
implementaciones compatibles de terceros, todas intercambiando tareas con
esta misma especificación, sin compartir código interno.

---

## 1. Principios

1. **Independencia del modelo.** Los agentes intercambian intención
   estructurada, capabilities, constraints y resultados. **Nunca prompts
   internos.** Los prompts pertenecen a la implementación privada de cada
   agente. Un NIDO con un modelo totalmente diferente debe poder hablar
   con uno actual.
2. **Independencia del transporte.** Una `TASK_REQUEST` es idéntica viaje
   por Bluetooth, LAN, Wi-Fi Direct, Internet P2P o relay. Ver
   `TRANSPORT_ARCHITECTURE.md`.
3. **Seguridad end-to-end sobre transporte cero-confianza.**
   `TRANSPORT ≠ TRUST`.
4. **Crypto agility.** Ningún algoritmo es permanente. Versiones
   negociadas, sin downgrade silencioso.
5. **Fail-closed.** Versión desconocida, capability desconocida, firma
   inválida, expirado o fuera de política → rechazo, nunca ejecución.

### 1.1 Leyes fundamentales (frozen)

- `USER = AUTHORITY`
- `POLICY ENGINE = ENFORCEMENT`
- `MODEL = REASONING, NOT AUTHORITY`
- `TOOLS = CAPABILITIES`
- `TRANSPORT = DELIVERY, NOT TRUST`
- `REMOTE/EXTERNAL CONTENT = UNTRUSTED DATA`
- `MINIMUM DISCLOSURE BY DEFAULT`
- `A REQUEST CAN DESCRIBE WHAT ANOTHER NIDO WANTS. IT CAN NEVER DEFINE
  WHAT THIS NIDO IS AUTHORIZED TO DO.`
- `AUTONOMY MUST NEVER GROW SILENTLY`: ninguna actualización de modelo,
  capability, protocolo o software amplía automáticamente la autoridad
  concedida. Más autoridad exige una nueva decisión explícita de
  política/consentimiento.

---

## 2. Identidad multi-dispositivo

No se asume `1 persona = 1 teléfono = 1 clave para siempre`.

```
User/NIDO Identity  (clave de identidad de largo plazo, p. ej. Ed25519 hoy)
        ↓  firma certificados de dispositivo
Authorized Devices   (cada uno con su propio par de claves)
        ↓  handshake autenticado
Sessions             (claves efímeras por sesión)
```

- **Identidad NIDO:** par de claves de largo plazo. La clave pública
  (hex minúsculas, 32 bytes) ES la dirección del NIDO. Es lo que hoy viaja
  en el QR.
- **Certificado de dispositivo:** `{v, device_id, device_pubkey,
  identity_pubkey, issued_at, expires_at, device_label?, signature}` donde
  `signature` la produce la clave de identidad. Cada dispositivo tiene sus
  propias claves; comprometer un dispositivo **no** compromete la identidad.
- **Sesiones:** handshake autenticado entre *claves de dispositivo*, con el
  certificado ligando dispositivo→identidad. La autorización (policy) se
  evalúa sobre la **identidad**, no sobre el dispositivo.
- **Revocación:** (a) expiración corta de certificados (revocación
  implícita); (b) lista de revocación firmada por la identidad,
  distribuida peer-to-peer **en contacto directo** (gossip) — sin servidor
  central y **sin depender del relay**: un relay malicioso no puede
  suprimirla porque también viaja en el contacto directo.
- **Frescura de revocación (ronda 3, C-8):** las capabilities de
  `sensitivity: high` pueden exigir que la información de revocación del
  peer sea más fresca que un umbral de política; la expiración corta de
  certificados acota la ventana máxima de un dispositivo revocado.
- **Roles de dispositivo (RT-11):** `primary` — custodia la clave privada
  de identidad y emite certificados de dispositivo; `secondary` — solo
  posee su certificado, no puede emitir. Robar un secondary → se revoca su
  certificado y la identidad sobrevive. Pérdida de todos los primaries →
  rotación con mecanismo de recuperación (pregunta abierta §14.6).
- **Rotación de identidad:** declaración firmada con la clave anterior:
  `{old_pubkey, new_pubkey, reason, ts, sig_old}`. Cadena verificable sin
  autoridad central. Los contactos verifican la cadena al siguiente
  contacto; un salto sin firma válida se rechaza.
- **Evolución del QR (conceptual, no implementar):** el QR actual lleva la
  clave pública de identidad. El QR v2 llevaría `{v:2, identity_pubkey,
  device_cert, relay_hints?, expires_at}` — verificable 100% offline.
  Un QR v1 sigue siendo aceptado como "identidad sin cert de dispositivo"
  durante la transición, con política configurable.

---

## 3. Crypto agility

- Toda estructura firmada/cifrada declara `crypto_suite`, p. ej.
  `nido-crypto/1` = `{sig: ed25519, kx: x25519, aead: chacha20poly1305,
  hash: sha256}`. Registro versionado en esta especificación; `nido-crypto/2`
  queda reservado para migración post-cuántica.
- **Negociación:** los peers anuncian suites soportadas; se elige la más
  alta común. La política local define una suite mínima aceptable.
- **Sin downgrade silencioso:** si no hay suite común aceptable → error
  `UNSUPPORTED_CRYPTO`, fail-closed. Un atacante que fuerce una suite débil
  provoca fallo, no degradación.
- **Transcript binding (RT-7):** los parámetros negociados (versión del
  protocolo + suite) deben confirmarse **dentro** del transcript
  autenticado del handshake (al estilo TLS Finished). La negociación previa
  a la autenticación es manipulable por un MITM; sin confirmación
  autenticada → `UNSUPPORTED_CRYPTO` / `UNSUPPORTED_VERSION`.
- Las claves llevan su suite; la rotación de algoritmos no invalida la
  identidad lógica (la cadena de rotación puede cruzar suites).

---

## 4. Wire format

- **Codificación canónica:** JSON con canonicalización **RFC 8785 (JCS)**:
  claves ordenadas, sin espacios, UTF-8. Toda firma se calcula sobre el
  JSON canónico del envelope **sin** el campo `signature`.
- **Racional:** debuggeable, test vectors triviales, implementable en
  cualquier lenguaje. Una futura codificación binaria deberá preservar
  reglas de canonicalización equivalentes.
- **Cifrado:** el envelope completo viaja **dentro** del canal cifrado de
  la sesión (AEAD con la clave de sesión del handshake). El transporte solo
  ve ciphertext (ver `TRANSPORT_ARCHITECTURE.md`).
- **Firma (capa agente):** cada envelope va firmado por la **clave del
  dispositivo emisor** (no solo cifrado por la sesión). Esto da autenticidad
  independiente del transporte: vale para delegación diferida, auditoría y
  reenvío por relays que solo ven ciphertext.

### 4.1 Envelope

```json
{
  "protocol_version": "nido/1.0",
  "message_type": "TASK_REQUEST",
  "message_id": "9f2c…(128 bits hex)",
  "task_id": "7a11…(128 bits hex, clave de idempotencia)",
  "nonce": "3d9e…(128 bits hex, frescura)",
  "created_at": 1790000000000,
  "expires_at": 1790000060000,
  "sender": {
    "identity_pubkey": "ab12…(hex)",
    "device_id": "44aa…(hex)",
    "device_cert": { "v": 1, "device_id": "…", "device_pubkey": "…",
      "identity_pubkey": "…", "issued_at": 1789990000000,
      "expires_at": 1821526000000, "signature": "…" }
  },
  "recipient_identity": "cd34…(hex)",
  "crypto_suite": "nido-crypto/1",
  "payload": { "…específico del tipo…": "…" },
  "delegation_chain": [ "…" ],
  "signature": "…(firma del dispositivo emisor sobre el canónico sin este campo)"
}
```

Reglas:

- `message_id`: único por envelope. **Detección de duplicados** (seen-set).
- `task_id`: clave de **idempotencia** del ciclo de vida de la tarea. Un
  `TASK_REQUEST` reintentado lleva el mismo `task_id`; el receptor no
  ejecuta dos veces (ver §9).
- `nonce`: 128 bits aleatorios; liga la firma contra replay entre contextos.
- `created_at`/`expires_at`: ms desde epoch. `expires_at` **obligatorio**
  en `TASK_REQUEST`, tokens de delegación y `CONSENT_REQUEST`. Tolerancia
  de reloj configurable (defecto: 5 min); expirado → `EXPIRED`.
- `recipient_identity`: identidad del NIDO destino (no un dispositivo:
  cualquier dispositivo autorizado puede recibir).
- `device_cert`: puede omitirse si el receptor ya lo tiene cacheado y
  vigente; si falta y no hay caché → `UNKNOWN_DEVICE` (se puede pedir por
  un mensaje de presentación fuera de este protocolo o re-escanear QR).
- Campos desconocidos a nivel de envelope → se **ignoran** (extensibilidad);
  campos desconocidos dentro de `payload` → **rechazo** (el schema manda).
- **Prohibido:** cualquier campo cuyo nombre o semántica sea "prompt",
  "instructions", "system_prompt" u orden imperativa al agente receptor.
  La validación de protocolo lo rechaza con `FORBIDDEN_FIELD`. El texto
  libre del peer es **dato**, nunca instrucción (ver `CAPABILITY_MODEL.md`).

---

## 5. Tipos de mensaje

### 5.1 Ciclo de vida de tarea

```
REQUESTED → ACCEPTED → IN_PROGRESS → RESULT
   ↓           ↓            ↓            ↓
REJECTED    CANCELLED    ERROR      (EXPIRED en cualquier punto)
```

- `TASK_REQUEST` — payload: `{capability, capability_version, parameters
  (schema de la capability), consent_requirement: none|explicit,
  idempotency_key (= task_id), ttl_ms, delegation?}`.
- `TASK_ACCEPT` — `{task_id, accepted_capability_version, eta_ms?}`.
  Compromiso de ejecución; no implica resultado. El solicitante DEBE
  verificar que `accepted_capability_version` coincide con la solicitada
  (o con lo negociado); una versión distinta no pedida → se trata como
  `UNSUPPORTED_VERSION`.
- `TASK_REJECT` — `{task_id, reason_code, retryable: bool, detail?}`.
  `detail` es solo para depuración: **nunca** contiene datos sensibles.
- `TASK_PROGRESS` — `{task_id, progress_pct?, note?}`. Progreso sin
  convertir el protocolo en streaming; `note` es texto libre **no
  sensible** (se audita; se prefieren códigos/enums a texto libre).
- `TASK_RESULT` — `{task_id, result (schema de output de la capability,
  filtrado por minimum disclosure), disclosure_summary}`.
- `TASK_CANCEL` — `{task_id, reason?}`. Del solicitante; best-effort: si
  ya se ejecutó un side effect, se responde `TASK_ERROR`/`TASK_RESULT`
  según el caso, nunca se finge cancelación.
- `TASK_ERROR` — `{task_id, error_code, retryable: bool, detail?}`.
  Códigos: `UNKNOWN_CAPABILITY`, `UNSUPPORTED_VERSION`,
  `UNSUPPORTED_CRYPTO`, `POLICY_DENIED`, `CONSENT_DENIED`, `EXPIRED`,
  `INVALID_SIGNATURE`, `UNKNOWN_DEVICE`, `FORBIDDEN_FIELD`,
  `DUPLICATE_TASK`, `DELEGATION_INVALID`, `MALFORMED`.

### 5.2 Discovery y consentimiento

- `CAPABILITY_QUERY` — `{query_id, capability_filter?}`. Pide la lista de
  capabilities soportadas. Sin autenticación previa más allá del canal.
- `CAPABILITY_RESPONSE` — `{query_id, capabilities: [{name, version,
  description, input_schema_ref?, sensitivity}]}`. **Anuncia sin filtrar**:
  solo nombre/versión/descripción pública — nunca qué apps, calendarios,
  modelos, archivos o servicios hay detrás.
- `CONSENT_REQUEST` — `{consent_id, action_description (estructurada),
  capability, parameters_summary, expires_at}`. "¿Autorizarías X?" sin
  ejecutarlo. El receptor lo presenta a **su** usuario.
- `CONSENT_RESULT` — `{consent_id, decision: granted|denied|expired,
  grant_scope?}`. Un `granted` lleva `grant_scope: {capability,
  parameters_hash, peer, max_uses, expires_at}` (RT-4): el `TASK_REQUEST`
  posterior que lo referencia debe coincidir en capability y hash de
  parámetros; reutilización cruzada → `POLICY_DENIED`. No es un cheque en
  blanco.

---

## 6. Negociación de versiones

- El handshake (o el primer envelope) intercambia
  `{min_protocol, max_protocol}`. Se elige la mayor común; sin
  intersección → `UNSUPPORTED_VERSION`, fail-closed. La confirmación final
  va ligada al transcript autenticado (ver §3, transcript binding).
- Las capabilities versionan independiente (`…/v1`, `…/v2`); el
  `CAPABILITY_RESPONSE` anuncia las soportadas; el solicitante elige.
- **Deprecación:** una versión puede marcarse deprecated con fecha de
  sunset; las implementaciones DEBEN avisar y NO deben auto-degradar la
  seguridad para acomodar un peer antiguo.

---

## 7. Delegación

Token de delegación (firmado por el issuer):

```json
{
  "v": 1, "issuer_identity": "…", "subject_identity": "…",
  "capability": "calendar.availability.query", "capability_version": "v1",
  "scope": { "peers": ["…"], "max_uses": 3 },
  "constraints": { "time_window": ["…", "…"], "purpose": "…" },
  "issued_at": …, "expires_at": …,
  "max_depth": 1,
  "parent_hash": "…|null",
  "signature": "…"
}
```

- `max_depth`: profundidad máxima de re-delegación. **Prohibida la
  delegación infinita** (defecto: 1, es decir, sin re-delegación salvo
  autorización explícita).
- Viaja en `delegation_chain` (ordenada issuer→subject). El ejecutor
  verifica **toda** la cadena: firmas, expiraciones, scopes, constraints y
  que la capability delegada ⊆ capability solicitada.
- **Expiración monótona (ronda 3, C-6):** ningún eslabón puede expirar
  después que su padre; `max_uses` se decrementa a lo largo de la cadena.
  Re-delegar rápido no extiende la vida efectiva más allá de la raíz.
- **Revocación:** por expiración corta + lista de revocación firmada por el
  issuer (gossip entre contactos). Sin CRL central.
- Caso de uso: "mi NIDO pide disponibilidad a otros NIDO en mi nombre".
  El peer ve quién es el issuer original y bajo qué constraints actúa el
  intermediario. Un eslabón no puede ampliar lo delegado.

---

## 8. Validación de protocolo (pipeline de entrada)

Todo envelope entrante, antes de cualquier lógica de negocio:

1. Parse + canonicalización válida.
2. `protocol_version` soportada.
3. `crypto_suite` aceptable por política.
4. Firma válida (dispositivo) + `device_cert` vigente y encadenado a la
   identidad declarada.
5. `created_at`/`expires_at` dentro de tolerancia (replay/expiración).
6. `message_id` no visto (duplicados).
7. `message_type` conocido; `payload` valida contra su schema;
   sin campos prohibidos (`FORBIDDEN_FIELD`).
8. **Rate limiting (RT-12, ronda 3 C-7):** el receptor limita la tasa por
   **identidad** emisora, agregada **a través de todos los transportes**
   en la capa de protocolo — saltar de Bluetooth a LAN no reinicia
   contadores. Lo malformado se descarta antes de cualquier trabajo caro.
   El default-deny para desconocidos es barato por diseño.

Solo entonces pasa al Policy Engine (ver `CAPABILITY_MODEL.md`).
**Nunca:** contenido remoto → modelo → tool.

---

## 9. Offline queueing, idempotencia y entregas

- **Outbox persistente** (cifrado en reposo): tareas no entregadas
  sobreviven reinicios.
- **Idempotencia:** el receptor mantiene `executed_tasks: task_id →
  resultado`. Un `TASK_REQUEST` con `task_id` ya ejecutado devuelve el
  resultado cacheado (o `DUPLICATE_TASK` si aún está en curso), **nunca
  re-ejecuta** un side effect.
- **Duplicados de transporte:** `message_id` en seen-set con TTL; un frame
  repetido se descarta en silencio.
- **Reintentos:** backoff con jitter; `expires_at` manda: expirado → se
  descarta y se notifica `EXPIRED` si hay canal.
- **Entrega tardía:** un `TASK_RESULT` que llega tras la expiración local
  se acepta solo si la tarea sigue abierta; si no, se descarta con evento
  de auditoría (`late_result_dropped`).
- **Cancelación:** se propaga best-effort; no garantiza deshacer side
  effects ya ocurridos (cada capability declara su semántica).
- **Fallo parcial:** `TASK_PROGRESS` puede reportar `completed_items` /
  `failed_items` con schemas por capability; nunca se reintenta a ciegas
  lo ya confirmado.
- **Un solo ejecutor (RT-6):** para capabilities con `side_effects !=
  none`, el solicitante usa el primer `TASK_ACCEPT` recibido y envía
  `TASK_CANCEL` a los demás aceptantes (dos dispositivos del mismo NIDO
  podrían aceptar la misma tarea). Hasta que exista coordinación entre
  dispositivos, se recomienda un dispositivo primario por capability con
  side effects.

---

## 10. Tareas de larga duración

Una tarea puede durar segundos, horas o días. `TASK_PROGRESS` permite
informar sin streaming obligatorio. El solicitante puede fijar
`ttl_ms` y `progress_interval_hint`; el ejecutor puede responder
`TASK_ERROR`/`TASK_REJECT` si no puede comprometerse. La expiración no
borra la obligación de no duplicar side effects (ver §9).

---

## 11. Auditoría

Eventos locales (cifrados en reposo, visibles/exportables/borrables por el
usuario; ver `MODEL_ROUTER.md` para la pantalla de actividad):

```
{ts, event: task.received, peer_identity, capability, capability_version,
 policy_decision, disclosure_summary, transport, model_used, device_id}
```

**Sin contenido sensible:** se registra *qué* capability y *qué categorías*
de datos salieron (`disclosure: availability interval`), nunca títulos de
eventos, textos de mensajes ni parámetros completos.

---

## 12. Conformance suite (futura)

Una implementación compatible debe demostrar:

- parse correcto y canonicalización (JCS) — test vectors incluidos abajo;
- firmas válidas/inválidas (vectores con claves fijas);
- manejo de versiones (acepta `nido/1.0`, rechaza `nido/9.9`);
- idempotencia (`task_id` repetido no re-ejecuta);
- rechazo de malformados, capability desconocida, `FORBIDDEN_FIELD`;
- rechazo de downgrade (suite débil ofrecida → `UNSUPPORTED_CRYPTO`);
- schemas de capabilities (input válido/inválido).

### Vector de test 1 — canonicalización

Entrada (claves desordenadas, espacios):
`{ "b": 2, "a": 1 }` → canónico: `{"a":1,"b":2}`.

### Vector de test 2 — envelope mínimo firmado

(Claves de ejemplo — NO usar en producción.)
`device_seed`: `0001…00` (32 bytes) → pubkey `…` *(a generar al publicar
la suite)*. El envelope canónico sin `signature`, firmado con Ed25519,
debe producir la firma del vector. *(Vectores completos al estabilizar
`nido/1.0`.)*

---

## 13. Migración desde los envelopes actuales (nota, sin implementar)

`agent_task`/`agent_result` actuales son el embrión. La migración futura:
`agent_task` → `TASK_REQUEST{capability: agent.task/v1, …}`;
`agent_result` → `TASK_RESULT`. **No hacerlo hasta que este diseño
sobreviva la revisión.**

---

## 14. Preguntas abiertas

1. ¿Gossip de revocaciones entre contactos es suficiente, o se necesita un
   canal de emergencia (p. ej. QR de revocación)?
2. ¿`device_cert` inline siempre, o caché con `UNKNOWN_DEVICE` + re-solicitud?
   (Compromiso entre tamaño y robustez offline.)
3. Tolerancia de reloj en dispositivos sin red durante días: ¿5 min es
   viable o se necesita ventana mayor con nonces más estrictos?
4. ¿El relay futuro debe soportar "buzón" (store-and-forward) o solo
   reenvío en caliente? (Afecta a §9.)
5. Formato binario futuro (¿CBOR con canonicalización?) — no decidir aún.
6. Mecanismo de recuperación ante pérdida de todos los dispositivos
   `primary`: ¿código de recuperación impreso, contactos de confianza,
   otro? (RT-11.)
7. Tokens de enrutado ciegos para que el relay no perfile frecuencia de
   contacto por hash de destino estable (RT-8).
