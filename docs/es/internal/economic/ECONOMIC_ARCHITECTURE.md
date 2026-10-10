> **Idioma:** [English](../../../internal/economic/ECONOMIC_ARCHITECTURE.md) · Español

# NIDO Economic Layer — Arquitectura

**Estado:** RESEARCH / DESIGN ONLY. Ninguna línea de implementación.
No crea token, no integra blockchain, no cambia el protocolo actual
(`AGENT_PROTOCOL.md`, `CAPABILITY_MODEL.md` intactos), no toca Android.

**Relación con principios:** este documento está subordinado a
`../NIDO_PRINCIPLES.md`. En caso de conflicto, los principios mandan.
Referencias clave: §4 (separación de responsabilidades), §8
(horizonte largo, zero-trust, minimum disclosure, crypto agility).

**Clasificación de decisiones.** Cada decisión sustantiva lleva una de
estas etiquetas exactas:

- **[FROZEN PRINCIPLES]** — no se negocia sin revisión explícita del usuario.
- **[PROVISIONAL]** — decisión de diseño actual, revisable con evidencia.
- **[EXPERIMENTAL]** — hipótesis a validar, no asumir en ningún diseño dependiente.
- **[OPEN QUESTIONS]** — sin decisión; pregunta registrada para investigación futura.

---

## 1. Qué problema resuelve esta línea de investigación

Una futura red de agentes NIDO personales podría intercambiar trabajo,
recursos y capabilities entre sí: cómputo, almacenamiento, procesamiento
especializado, servicios. Si ese intercambio ocurre, debe ocurrir bajo las
mismas reglas de autoridad que todo lo demás en NIDO.

**[FROZEN PRINCIPLES]** La economía es una capa **opcional**. NIDO funciona
completamente sin token, sin blockchain, sin cuenta bancaria, sin servidor
central, y offline donde la tarea lo permite. Ninguna capability básica,
ningún flujo del protocolo y ninguna decisión de política puede depender
de la existencia de la capa económica. Un NIDO con la economía desactivada
es un NIDO completo, no una versión degradada.

**[FROZEN PRINCIPLES]** USER = AUTHORITY se aplica al dinero con la misma
fuerza que a los datos. El modelo puede **proponer** una transacción. El
**Policy Engine determina** si está permitida. **El usuario sigue siendo la
autoridad.** Ningún flujo económico puede mover valor sin una decisión
trazable de política o una confirmación explícita del usuario, según
corresponda.

---

## 2. Glosario

| Término | Significado en este documento |
|---|---|
| **Capability (primitiva económica)** | Una capability versionada con schema (`CAPABILITY_MODEL.md`) más un descriptor económico. Es la unidad de lo que se intercambia. |
| **Offer / Oferta** | DATA: un NIDO declara que puede ejecutar una capability bajo ciertos términos económicos. No es autoridad, no es compromiso. |
| **Quote / Cotización** | DATA: precio y condiciones concretos para una solicitud concreta, con TTL. Una quote no autoriza nada. |
| **Authorization / Autorización** | Decisión del Policy Engine local (o del usuario) de aceptar términos. Esto sí tiene consecuencias. |
| **Commitment / Compromiso** | Aceptación mutua registrada: el ejecutor reserva recursos, el solicitante reserva presupuesto. Aún no mueve valor. |
| **Settlement / Liquidación** | El **único** punto donde aparece un side effect económico: el valor cambia de manos. At-most-once por `payment_id`. |
| **Receipt / Recibo** | Registro local, firmado por el NIDO, de eventos y decisiones económicas. Nunca contiene chain-of-thought. |
| **Rail** | Mecanismo de movimiento de valor (fiat, stablecoin, créditos offline, …). Intercambiable. |
| **SettlementAdapter** | Rol abstracto que conecta la capa económica con un rail concreto, sin que el protocolo dependa del rail. |
| **Budget vault** | Presupuesto operativo separado de los fondos principales del usuario (ver `ECONOMIC_POLICY_MODEL.md`). |
| **Verification** | Comprobación de que el trabajo se realizó antes de liquidar. Modos varios; ninguno universal (ver `SETTLEMENT_ABSTRACTION.md`). |
| **Payment ID** | Identificador único (128 bits, generado por el pagador) que hace idempotente la liquidación. |

---

## 3. CAPABILITY IS THE ECONOMIC PRIMITIVE

**[FROZEN PRINCIPLES]** El activo fundamental de la economía NIDO **no es
un token**. Es una **capability que puede solicitarse, cotizarse,
negociarse, autorizarse, ejecutarse, verificarse y liquidarse**.

Consecuencias de diseño:

1. Todo intercambio económico se expresa como invocación de una capability
   versionada con schema (`nombre/versión`), nunca como transferencia
   abstracta de "valor".
2. El precio vive en el **descriptor económico** de la capability, no en el
   protocolo. El protocolo (`TASK_REQUEST` / `TASK_RESULT`) no sabe qué es
   dinero.
3. Un NIDO no "paga por pagar": paga por la **ejecución verificable** de
   una capability concreta, bajo términos cotizados y autorizados.
4. Esto hace que la economía herede gratis las propiedades del modelo de
   capabilities: versionado, minimum disclosure, sensitivity, human
   approval, delegación atenuada, idempotencia por `task_id`.

**[PROVISIONAL]** Las capabilities puramente económicas (p. ej.
`payment.settle/v1` como capability interna del NIDO local, nunca expuesta
a peers) se modelan con el mismo formato de capability, pero con
`sensitivity: high`, `human_approval: always` por defecto y
`delegation_permitted: false`. Exponer liquidación a un peer remoto sería
confundir al ejecutor con el custodio: el que ejecuta trabajo no es el que
mueve el dinero del usuario.

---

## 4. Descriptor económico de una capability

Una capability futura puede expresar de forma estructurada los siguientes
campos económicos. La lista es cerrada por versión del descriptor; añadir
campos es una nueva versión, nunca una extensión silenciosa.

| Campo | Significado |
|---|---|
| `cost` | `{amount, unit}`. `amount` es número decimal exacto como **string** (nunca float binario: ver ataque de redondeo en `ECONOMIC_REDTEAM.md`). `unit` es un identificador de unidad/moneda opaco para el protocolo. |
| `currency_unit` | Alias explícito de `unit` cuando la unidad es monetaria. El protocolo no valida monedas; el SettlementAdapter del rail sí. |
| `estimated_duration` | `{min_ms, max_ms}` o `unknown`. Compromiso informativo, no SLA, salvo que `conditions` diga lo contrario. |
| `resource_requirements` | Lo que el **ejecutor** necesita: `{compute_class, memory_mb_max, storage_mb_max, network_required: bool}`. Declarativo y auditable. |
| `conditions` | Lista cerrada de condiciones estructuradas (ventana horaria, límite de reintentos del solicitante, etc.). Texto libre prohibido como condición vinculante. |
| `privacy_requirements` | Qué datos del solicitante necesita la ejecución y con qué retención (ver `ECONOMIC_PRIVACY.md`). |
| `refundability` | `full` / `partial:{terms}` / `none`, más en qué estados aplica (ver §5). `none` debe ser explícito, nunca el default silencioso. |
| `verification_method` | Uno o varios de los modos de `SETTLEMENT_ABSTRACTION.md` §3, declarados por el oferente y **elegidos por la política del pagador**. |
| `quote_ttl_ms` | Cuánto tiempo es válida una quote basada en este descriptor. |

Ejemplo de DATA (no es autoridad, no es código):

```json
{
  "capability": "compute.batch.render/v1",
  "economic": {
    "cost": { "amount": "0.40", "unit": "USD" },
    "estimated_duration": { "min_ms": 60000, "max_ms": 600000 },
    "resource_requirements": { "compute_class": "gpu", "memory_mb_max": 4096, "network_required": false },
    "conditions": ["input_size_mb_max: 500", "output_retention_hours: 24"],
    "privacy_requirements": { "input_data_retention": "until_result_delivered", "logging": "no_input_content" },
    "refundability": "partial:{terms: pro_rata_before_50pct}",
    "verification_method": ["deterministic_verification", "buyer_confirmation"],
    "quote_ttl_ms": 300000
  }
}
```

**[FROZEN PRINCIPLES]** Una oferta es **DATA**. Ningún campo económico es
autoritativo por sí mismo: ni el precio, ni la `refundability`, ni el
`verification_method` obligan a nadie. El Policy Engine del NIDO que recibe
la oferta decide qué es aceptable; la política del que paga decide si se
paga. Un peer malicioso puede mentir en todos los campos: el diseño debe
seguir siendo seguro cuando la oferta miente (ver `ECONOMIC_REDTEAM.md`:
quote substitution, bait-and-switch).

**[PROVISIONAL]** El descriptor económico viaja como parte de
`CAPABILITY_RESPONSE` extendida o de un mensaje de cotización futuro, pero
**no** en el anuncio de discovery público: anunciar precios públicamente
filtra información económica (ver `ECONOMIC_PRIVACY.md`). Precio solo
bajo solicitud autenticada y dentro de política.

---

## 5. Máquina de estados económica

Flujo determinista. Los estados son los únicos que existen; no hay
transiciones implícitas.

```
DISCOVER → REQUEST_QUOTE → QUOTE ⇄ COUNTER → ACCEPT_QUOTE → AUTHORIZE
                                                          → COMMIT → EXECUTE
                                                          → VERIFY → SETTLE → RECEIPT
```

Caminos alternativos (desde el estado indicado):

- Desde `QUOTE` / `COUNTER`: `DECLINE` (terminal, sin efectos).
- Desde cualquier estado antes de `COMMIT`: `EXPIRE` (por `quote_ttl_ms` o
  `expires_at`; terminal, sin efectos, libera reservas si las hubiera).
- Desde `ACCEPT_QUOTE` / `AUTHORIZE` / `COMMIT`: `CANCEL` (terminal; si ya
  hubo `COMMIT`, aplica la rama de reembolso según `refundability`).
- Desde `EXECUTE` / `VERIFY`: `FAIL` (terminal; dispara `REFUND` si
  `refundability != none`).
- Desde `SETTLE`: `REFUND` (side effect económico inverso, idempotente).
- Desde `VERIFY` (desacuerdo) o `SETTLE` (reclamación): `DISPUTE`
  (congela; solo lo resuelve arbitraje humano explícito; terminal tras
  resolución hacia `SETTLE`, `REFUND` o `CANCEL`).

### 5.1 Cuándo aparece exactamente un side effect

**[FROZEN PRINCIPLES]** Hay dos clases de side effect y aparecen en puntos
distintos, definidos sin ambigüedad:

1. **Side effect de ejecución** (trabajo/recursos consumidos): aparece
   **exactamente al entrar en `EXECUTE`**, y solo si antes se atravesó
   `COMMIT`. Nada antes de `COMMIT` consume recursos del ejecutor más allá
   del coste trivial de responder mensajes. `CANCEL` antes de `COMMIT` no
   debe nada a nadie.

2. **Side effect económico** (el valor cambia de manos): aparece
   **exactamente al entrar en `SETTLE`**, una sola vez por `payment_id`,
   y solo si `VERIFY` concluyó según el modo de verificación que la
   **política del pagador** aceptó. Ningún otro estado mueve valor.
   `AUTHORIZE` y `COMMIT` solo crean **reservas** (reducción del
   presupuesto disponible, sin transferencia). Las reservas se liberan en
   `EXPIRE`, `DECLINE`, `CANCEL` (pre-`COMMIT`) y `FAIL`/`REFUND`.

**[FROZEN PRINCIPLES]** Un reintento **nunca** produce doble pago. La
liquidación es idempotente por `payment_id` (128 bits, generado por el
pagador, único por intención de pago):

- El diario de liquidación (settlement journal) está indexado por
  `payment_id`. La primera transición a `SETTLE` ejecuta la transferencia
  y guarda el recibo.
- Cualquier reintento posterior con el mismo `payment_id` devuelve el
  recibo guardado **sin** tocar el rail. No hay "re-liquidar": el estado
  `SETTLE` es terminal para ese `payment_id`.
- `REFUND` es un side effect separado e idempotente por `refund_id`,
  permitido solo desde `SETTLED`. Un reembolso no "des-hace" el pago en el
  diario: lo compensa con una entrada nueva.
- Esto replica a nivel económico la disciplina de `task_id` del protocolo
  (INV-4 RETRY_SAFETY): at-most-once en side effects, at-least-once en
  entrega de recibos.

**[PROVISIONAL]** `payment_id` y `task_id` son identificadores distintos
con propósitos distintos: `task_id` idempotencia de **ejecución**,
`payment_id` idempotencia de **liquidación**. Una tarea puede tener cero o
una liquidación; una liquidación referencia exactamente una tarea
(origen del cargo), nunca una cadena abierta.

### 5.2 Tabla de transiciones (resumen normativo)

| Desde | Evento | Hacia | Side effect |
|---|---|---|---|
| `DISCOVER` | solicitud de cotización | `REQUEST_QUOTE` | ninguno |
| `REQUEST_QUOTE` | quote recibida y válida | `QUOTE` | ninguno |
| `QUOTE` | contraoferta | `COUNTER` | ninguno |
| `COUNTER` | nueva quote / aceptación | `QUOTE` / `ACCEPT_QUOTE` | ninguno |
| `QUOTE` | rechazo | `DECLINE` | ninguno (terminal) |
| `QUOTE`/`COUNTER`/`REQUEST_QUOTE` | timeout | `EXPIRE` | ninguno (terminal) |
| `ACCEPT_QUOTE` | decisión de política/usuario | `AUTHORIZE` | reserva de presupuesto (local) |
| `AUTHORIZE` | compromiso mutuo | `COMMIT` | reserva de recursos (ejecutor) |
| `AUTHORIZE`/`COMMIT` | cancelación | `CANCEL` | libera reservas; si post-`COMMIT`, evalúa `refundability` |
| `COMMIT` | inicio de trabajo | `EXECUTE` | **side effect de ejecución** |
| `EXECUTE` | trabajo completo / fallido | `VERIFY` / `FAIL` | ninguno nuevo / dispara reembolso |
| `VERIFY` | verificación OK | `SETTLE` | **side effect económico (único)** |
| `VERIFY` | desacuerdo | `DISPUTE` | congela |
| `SETTLE` | registrado | `RECEIPT` | ninguno (registro) |
| `SETTLED` | reembolso autorizado | `REFUND` | side effect económico inverso (idempotente) |
| `DISPUTE` | arbitraje humano | `SETTLE` / `REFUND` / `CANCEL` | según resolución |

**[PROVISIONAL]** `DISPUTE` requiere siempre un humano en el bucle. No se
diseña arbitraje automático: un algoritmo que decide disputas de dinero es
una autoridad que nadie otorgó.

---

## 6. Agents can earn: el NIDO como oferente

**[PROVISIONAL]** Un usuario puede permitir que su NIDO **ofrezca**
capabilities a otros (cómputo, almacenamiento, procesamiento
especializado, servicios de negocio, servicios automatizados). Esto es
opt-in explícito, desactivado por defecto, y se configura con:

- **qué** puede ofrecer: lista cerrada de `capability/version`.
- **a quién**: peers permitidos (identidades concretas, o clases de
  relación: familia, negocio conocido). Default: nadie.
- **cuándo**: ventanas horarias, y nunca cuando el dispositivo esté en uso
  interactivo salvo autorización explícita.
- **límites**: por tarea, por peer, por día (tiempo de cómputo, bytes,
  número de ejecuciones).
- **precio/condiciones**: descriptor económico por capability ofrecida.
- **recursos máximos**: techo duro de CPU/memoria/almacenamiento/batería
  que una tarea ofrecida puede consumir. **[FROZEN PRINCIPLES]** Una tarea
  de un peer nunca puede exceder el techo configurado, aunque la quote lo
  "permita".
- **datos que jamás pueden utilizarse**: lista de exclusión dura (p. ej.
  contenido de mensajes, calendario, ubicación, claves). **[FROZEN
  PRINCIPLES]** Los datos excluidos no entran al entorno de ejecución de
  la tarea ofrecida por ningún camino: ni como input, ni como contexto del
  modelo, ni como side-channel de logs.

**[FROZEN PRINCIPLES]** La tarea ofrecida se ejecuta con la **autoridad del
comprador** (confused deputy, `CAPABILITY_MODEL.md` §4), nunca con la del
dueño del dispositivo. El NIDO oferente es un ejecutor sandboxed de la
capability vendida, no un agente con los privilegios del usuario.

**[EXPERIMENTAL]** Precios dinámicos (ajuste por demanda) — no diseñado;
un precio que cambia solo es una superficie de manipulación (ver redteam:
bait-and-switch).

---

## 7. Group tasks: comprar a varios proveedores

Flujo: `plan → quote multiple providers → choose → authorize budgets →
execute graph → verify nodes → settle nodes`.

**[FROZEN PRINCIPLES]** El Policy Engine valida **cada gasto y cada nodo**
por separado. Aceptar un task graph completo **nunca** concede presupuesto
ilimitado ni autorización en bloque:

1. Cada nodo del grafo lleva su propia quote y su propio `payment_id`.
2. El presupuesto total autorizado es la **suma explícita** de los nodos
   aprobados, más una reserva de contingencia **también explícita**
   (porcentaje o tope absoluto fijado por política, default 0).
3. Un nodo que excede su quote no puede "tomar prestado" del presupuesto
   de otro nodo. Sobre-coste de un nodo → nuevo `REQUEST_QUOTE` →
   nueva decisión de política.
4. `SETTLE` por nodo: un nodo verificado liquida aunque otro falle. No hay
   "todo o nada" salvo que la política del usuario lo exija explícitamente
   para ese grafo (y aun así, cada liquidación sigue siendo idempotente
   por su `payment_id`).

**[PROVISIONAL]** El planificador (modelo) propone el grafo; el Policy
Engine lo autoriza nodo por nodo. El modelo nunca reescribe quotes ni
fusiona presupuestos: eso sería autoridad disfrazada de optimización.

---

## 8. Crypto agility: identidad desacoplada del dinero

**[FROZEN PRINCIPLES]** La identidad NIDO (clave de largo plazo,
certificados de dispositivo, cadena de rotación) **no es una wallet** y no
está acoplada a ningún rail, proveedor de pagos, blockchain, moneda o
mecanismo de liquidación. Una persona debe poder cambiar de wallet, de
proveedor, de blockchain, de moneda y de rail **sin cambiar su identidad
NIDO** y sin re-emparejar contactos.

Diseño (conceptual):

- Las credenciales de pago viven en un **settlement profile** separado,
  custodiado localmente (mismo nivel de protección que las claves de
  identidad, pero claves distintas, rotación independiente).
- La identidad NIDO firma **autorizaciones de gasto** (qué `payment_id`,
  cuánto, a quién, bajo qué política); el settlement profile ejecuta el
  movimiento en el rail. Perder/rotar el perfil no invalida la identidad,
  y comprometer el perfil no entrega la identidad.
- Los peers nunca necesitan la clave del settlement profile: solo ven la
  autorización firmada por la identidad y la prueba de liquidación del
  rail.

**[FROZEN PRINCIPLES]** La rotación de credenciales de pago nunca requiere
rotación de identidad, y la rotación de identidad nunca expone
automáticamente las credenciales de pago al nuevo dispositivo: el usuario
las re-autoriza explícitamente.

---

## 9. Lo que este diseño se niega a hacer (non-goals)

- No define tokenomics, supply, precio ni incentivos de ningún token.
- No selecciona blockchain, moneda o rail.
- No añade mensajes al protocolo actual ni cambia `TASK_REQUEST`.
- No implementa nada en Android ni en `src/`.
- No promete prevención de double-spend offline imposible (ver
  `ECONOMIC_POLICY_MODEL.md` §6 y `ECONOMIC_REDTEAM.md`).
- No diseña arbitraje automático de disputas.
- No convierte métricas económicas (volumen, balance) en reputación,
  confianza o autoridad (ver `ECONOMIC_REDTEAM.md` §18).

---

## 10. Principio final

**NIDO MAY NEGOTIATE VALUE.
NIDO MAY EXCHANGE VALUE.
NIDO MAY EARN VALUE.**

**BUT NIDO NEVER OWNS THE USER'S AUTHORITY.**

**THE MODEL MAY PROPOSE A TRANSACTION.
THE POLICY ENGINE DETERMINES WHETHER IT IS PERMITTED.
THE USER REMAINS THE AUTHORITY.**

---

## Registro de decisiones

| # | Decisión | Clasificación |
|---|---|---|
| 3.1 | La economía es capa opcional; NIDO completo sin ella | FROZEN PRINCIPLES |
| 3.2 | USER=AUTHORITY aplicado al dinero; modelo propone, Policy Engine dispone | FROZEN PRINCIPLES |
| 4.1 | CAPABILITY es la primitiva económica, no un token | FROZEN PRINCIPLES |
| 4.2 | `payment.settle` como capability interna, nunca expuesta a peers | PROVISIONAL |
| 5.1 | La oferta es DATA; ningún campo económico es autoridad | FROZEN PRINCIPLES |
| 5.2 | Precio solo bajo solicitud autenticada, no en discovery público | PROVISIONAL |
| 6.1 | Side effect de ejecución exactamente en `EXECUTE` (tras `COMMIT`) | FROZEN PRINCIPLES |
| 6.2 | Side effect económico exactamente en `SETTLE`, at-most-once por `payment_id` | FROZEN PRINCIPLES |
| 6.3 | Reintento nunca produce doble pago (journal por `payment_id`, recibo cacheado) | FROZEN PRINCIPLES |
| 6.4 | `payment_id` ≠ `task_id`; una liquidación referencia una tarea | PROVISIONAL |
| 6.5 | Disputas siempre con humano en el bucle; sin arbitraje automático | PROVISIONAL |
| 7.1 | Ofertas del usuario: opt-in, techos de recursos duros | FROZEN PRINCIPLES (techos) / PROVISIONAL (resto) |
| 7.2 | Datos excluidos jamás entran al entorno de ejecución ofrecido | FROZEN PRINCIPLES |
| 7.3 | Tarea ofrecida corre con autoridad del comprador (confused deputy) | FROZEN PRINCIPLES |
| 7.4 | Precios dinámicos no diseñados | EXPERIMENTAL (no asumir) |
| 8.1 | Cada nodo de un group task se autoriza y liquida por separado | FROZEN PRINCIPLES |
| 8.2 | Aceptar un grafo nunca concede presupuesto ilimitado | FROZEN PRINCIPLES |
| 9.1 | Identidad NIDO desacoplada de wallet/rail/moneda; rotación independiente | FROZEN PRINCIPLES |

## Preguntas abiertas (este documento)

1. ¿El descriptor económico debe viajar dentro de `CAPABILITY_RESPONSE` o
   en un mensaje de cotización separado con su propio ciclo de vida?
2. ¿Qué granularidad de `compute_class` es suficiente sin filtrar el
   hardware real del dispositivo (privacidad vs. utilidad de la quote)?
3. ¿Cómo se expresa `refundability: partial` de forma estructurada y
   verificable sin un lenguaje de condiciones Turing-completo?
4. ¿Debe existir un límite global de "valor en vuelo" (reservas no
   liquidadas) además de los límites por tarea/día?
