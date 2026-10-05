> **Idioma:** [English](../../economic/ECONOMIC_POLICY_MODEL.md) · Español

# NIDO Economic Layer — Modelo de políticas

**Estado:** RESEARCH / DESIGN ONLY. Sin implementación. Subordinado a
`../NIDO_PRINCIPLES.md` y a `ECONOMIC_ARCHITECTURE.md` (la máquina de
estados y la primitiva CAPABILITY se definen allí).

Etiquetas de decisión: **[FROZEN PRINCIPLES]** · **[PROVISIONAL]** ·
**[EXPERIMENTAL]** · **[OPEN QUESTIONS]**.

---

## 1. Políticas económicas humanas como reglas estructuradas

El usuario expresa su voluntad económica como un **conjunto de reglas
estructuradas**, evaluadas por código determinista en el Policy Engine.
El modelo puede ayudar a redactarlas o explicarlas; **nunca las crea,
modifica ni interpreta de forma vinculante**.

Ejemplos canónicos (valores por defecto, ver §3):

| Regla (lenguaje humano) | Forma estructurada |
|---|---|
| AUTO under $1/task | `{effect: ALLOW, scope: {per_task_max: {amount: "1.00", unit: "USD"}}}` |
| AUTO up to $5/day | `{effect: ALLOW, scope: {per_day_max: {amount: "5.00", unit: "USD"}}}` |
| ASK above $5 | `{effect: ASK_USER, scope: {per_task_min: {amount: "5.00", unit: "USD"}}}` |
| DENY subscriptions | `{effect: DENY, scope: {recurring: true, explicit_grant: false}}` |
| DENY unknown peers | `{effect: DENY, scope: {peer_class: "unknown"}}` |
| ALLOW family | `{effect: ALLOW, scope: {peer_group: "family"}, limits: {...}}` |
| ALLOW this business until date | `{effect: ALLOW, scope: {peer: "<id>", until: "<ts>"}, limits: {...}}` |
| ASK every recurring payment | `{effect: ASK_USER, scope: {recurring: true}}` |

**[PROVISIONAL]** Los umbrales por defecto (`$1`, `$5`) son valores
iniciales razonables, no verdades. El usuario los ajusta; el diseño solo
exige que **existan** umbrales y que el default ante la duda sea pedir
(ASK_USER) o denegar, nunca permitir en silencio.

**[FROZEN PRINCIPLES]** Ningún pago recurrente u oculto puede crearse sin
autorización explícita del usuario para **esa** recurrencia (o para una
subscripción nombrada y acotada que el usuario aprobó como tal). Una
capability que intente convertir un pago único en recurrente es un ataque
(ver `ECONOMIC_REDTEAM.md`: hidden recurring payment), no una feature.

### 1.1 Qué debe mostrar un ASK_USER económico

**[PROVISIONAL]** Toda solicitud de confirmación al usuario incluye, como
mínimo: importe exacto + unidad, peer (identidad, no alias bonito),
capability y versión, método de verificación aceptado, `refundability`,
qué límite de política lo ha escalado a ASK, y qué pasaría en `FAIL`
(reembolso o no). Sin estos campos, el consentimiento no es informado y el
Policy Engine no debe presentarlo.

---

## 2. Combinación de límites

Los límites se combinan en **todas** estas dimensiones a la vez:

- `per_task` — tope por intención de pago (`payment_id`).
- `per_peer` — tope por identidad contraparte, por ventana temporal.
- `per_capability` — tope por `capability/version`.
- `per_day` / `per_month` — ventanas deslizantes en tiempo local del
  dispositivo.
- `per_asset` — tope por unidad/rail (p. ej. "máximo 20 USD/mes en
  rail X").

**[FROZEN PRINCIPLES]** Todos los límites aplicables deben satisfacerse
**conjuntivamente**: el gasto permitido es el mínimo común, es decir, el
más restrictivo gana. Un gasto que exceda **cualquiera** de ellos se deniega
o se escala a ASK_USER según la regla. No existe "el límite diario no
aplica porque el límite por tarea lo permite": las dimensiones no se
compensan entre sí.

**[FROZEN PRINCIPLES]** Los límites se contabilizan por **identidad del
peer**, no por dispositivo, transporte o sesión (paralelo directo a INV-3
TRANSPORT_INDEPENDENCE e INV-5 DISCLOSURE_ACCOUNTING del protocolo). Cambiar
de Bluetooth a LAN no reinicia el presupuesto diario con un peer.

**[PROVISIONAL]** Ventanas deslizantes (`per_day` = últimas 24h, no día
calendario) para evitar el truco de "gastar el tope a las 23:59 y otra vez
a las 00:01".

### 2.1 Nunca auto-ampliar

**[FROZEN PRINCIPLES]** Una actualización de modelo, de software, de
capability o de protocolo **jamás** amplía automáticamente los límites
económicos (extensión económica de INV-2 AUTONOMY_NON_EXPANSION):

- Una capability nueva (o una versión nueva `v2` de una existente) tiene
  **cero** presupuesto hasta que el usuario la autorice explícitamente.
- Un cambio de defaults en una actualización se aplica solo a reglas
  creadas después, o se presenta al usuario como decisión nueva. Nunca se
  reescriben silenciosamente las reglas existentes.
- El modelo no puede proponer "ajustar tus límites por conveniencia" y que
  eso tenga efecto: cualquier cambio de límites es una acción de política
  que exige confirmación explícita del usuario (presentación según §1.1).

---

## 3. Budget vault: presupuesto operativo separado

**[FROZEN PRINCIPLES]** Un agente nunca necesita —y nunca debe tener—
autoridad ilimitada sobre los fondos del usuario. El diseño separa:

- **Fondos principales (principal):** el patrimonio del usuario. El NIDO
  **no** tiene autoridad de gasto sobre ellos por ningún camino
  automático. Todo movimiento desde el principal exige confirmación
  explícita del usuario, caso por caso.
- **Budget vault (operativo):** una asignación acotada que el usuario
  fondea deliberadamente (cantidad, unidad, ventana temporal). Solo sobre
  el vault operan las reglas AUTO/ASK. El vault es lo único que el Policy
  Engine puede comprometer sin preguntar cada vez.

Dimensiones del vault (todas configurables, todas con default
conservador):

| Presupuesto | Alcance | Default sugerido |
|---|---|---|
| `spending` | tope global del vault por ventana | definido por el usuario al fondear |
| `session` | tope por sesión de tarea (un `task_id` raíz y sus sub-nodos) | `per_task` × factor, o 0 (desactivado) |
| `capability` | tope por `capability/version` | 0 hasta autorización explícita |
| `peer` | tope por identidad contraparte | clase `unknown`: 0 |
| `time` | ventanas día/mes (deslizantes) | ver §2 |

**[PROVISIONAL]** El vault se implementa como **registro contable local**
firmado por el dispositivo, no como custodia separada en el rail: lo que
lo hace real es que el Policy Engine **niega** el gasto que lo exceda,
antes de que el SettlementAdapter actúe. Si el rail permite gastar por
fuera del vault (p. ej. la wallet real tiene más fondos), el diseño exige
que el adapter opere **solo** con las credenciales del settlement profile
acotado al vault (ver `ECONOMIC_ARCHITECTURE.md` §8). Un adapter con acceso
a fondos ilimitados invalida todo este modelo: es un fallo de
configuración, no un caso soportado.

### 3.1 Emergency revoke

**[FROZEN PRINCIPLES]** Existe una acción única, local e inmediata de
**revocación de emergencia**: congela todo gasto futuro (vacía las
autorizaciones pendientes, bloquea nuevos `AUTHORIZE`, revoca las
credenciales del settlement profile en el dispositivo). Es local-first:
funciona sin red. No deshace liquidaciones ya asentadas en el rail (nadie
puede prometer eso), pero impide **toda** autorización nueva desde ese
instante. Debe ser accesible en ≤2 toques desde la pantalla principal.

### 3.2 Límites offline

**[PROVISIONAL]** El usuario puede pre-autorizar un **techo de gasto
offline** (sub-límite del vault, p. ej. $2) usable sin conectividad. Al
alcanzarlo, el gasto posterior queda en `hold` hasta tener conectividad.
El diario offline es de un solo escritor por dispositivo (§6); gastar
offline en dos dispositivos a la vez contra el mismo vault es un riesgo
conocido y acotado por el techo (ver §6 y redteam: multi-device double
spend).

---

## 4. Recibos (receipts)

**[FROZEN PRINCIPLES]** Todo evento económico con side effect genera un
recibo: un registro **verificable** de **eventos y decisiones**, nunca de
chain-of-thought del modelo. El recibo debe poder responder, sin ambigüedad:

1. qué se **solicitó** (capability, versión, parámetros resumidos, peer),
2. qué se **cotizó** (quote aceptada: importe, unidad, `refundability`,
   método de verificación, TTL),
3. qué **autorizó la política** (regla aplicada, límites evaluados,
   decisión: AUTO/ASK_USER + referencia al consentimiento),
4. qué **confirmó el usuario** (si hubo ASK: timestamp, alcance exacto
   confirmado),
5. qué se **ejecutó** (`task_id`, resultado resumido según minimum
   disclosure),
6. qué se **verificó** (modo de verificación, evidencia mínima),
7. qué se **pagó** (`payment_id`, importe final, rail, referencia del
   rail),
8. qué se **devolvió** (si aplica: `refund_id`, importe, motivo).

Propiedades del recibo:

- Firmado por la **clave del dispositivo** que autorizó/ejecutó (no repudio
  local; verificable por el usuario en otro de sus dispositivos).
- Encadenado por `payment_id`: solicitud → autorización → liquidación →
  reembolso forman una cadena auditable, no entradas sueltas.
- Almacenado cifrado en reposo, visible/exportable/borrable por el usuario
  (misma disciplina que la auditoría del protocolo, `AGENT_PROTOCOL.md`
  §11).
- **[FROZEN PRINCIPLES]** El recibo nunca contiene: prompts, razonamiento
  del modelo, datos sensibles del usuario más allá del resumen mínimo
  necesario, ni claves o material de firma.

**[PROVISIONAL]** El recibo es una **atestación local**, no una verdad
global: prueba qué decidió y registró *este* NIDO. Frente a un peer, el
recibo propio + la referencia del rail son la evidencia; no se diseña un
"recibo global" sin un tercero de confianza (eso sería recentralizar).

---

## 5. Recurrencia y subscripciones

**[FROZEN PRINCIPLES]** (reiterado por ser superficie de ataque clásica):

- Cada cobro recurrente exige autorización explícita: o bien el usuario
  aprobó **esa** subscripción nombrada (capability, importe o fórmula de
  importe acotada, frecuencia, fecha de fin o condición de fin), o bien
  cada cobro pasa por ASK_USER.
- Una subscripción aprobada **no** puede ampliar unilateralmente su
  importe, frecuencia o alcance: cualquier cambio es una autorización
  nueva.
- La cancelación de una subscripción es una acción local inmediata
  (como el emergency revoke, pero de alcance limitado): impide futuras
  autorizaciones aunque el peer siga intentando cobrar.
- `DENY` por defecto a cualquier patrón que huela a recurrencia no
  declarada (mismo peer + misma capability + cadencia regular sin grant
  de subscripción).

---

## 6. Economía offline: clasificación honesta

Dos NIDO en modo avión con Bluetooth pueden necesitar intercambiar valor
(p. ej. pagar por cómputo del otro). Este diseño **no promete prevención
de double-spend imposible**. Clasificación:

| Operación | Offline | Notas |
|---|---|---|
| **Ejecutar** trabajo | ✅ sí | Local por definición. |
| **Autorizar** gasto (decisión de política) | ✅ sí | La política es local; se registra en el diario con timestamp y `payment_id`. |
| **Registrar** intención/recibo | ✅ sí | Diario local cifrado; encadenado por `payment_id`. |
| **Liquidar** en rail externo | ❌ no | Requiere conectividad con el rail. Sin excepción. |
| **Liquidar** en créditos offline | ⚠️ provisional | Solo si el rail es un sistema de créditos locales pre-fondeados entre esos dos NIDO (ver §6.1). |
| **Asentar diferido** (promesa de liquidación) | ✅ sí, como promesa | Se registra `SETTLE_DEFERRED`: compromiso firmado de liquidar al recuperar conectividad. **No es final**: es deuda registrada, no pago. |
| Disputa con humano remoto | ❌ no | Requiere canal con el humano. En offline, `DISPUTE` congela localmente. |
| Verificación determinista | ✅ sí | Si el modo lo permite (hash, prueba). |
| Confirmación del comprador | ✅ sí | Si el comprador está presente (es el caso Bluetooth típico). |

### 6.1 Créditos offline (provisional, acotado)

**[EXPERIMENTAL]** Dos NIDO pueden mantener un **libro bilateral de
créditos**: cada uno pre-autoriza un techo (p. ej. $5) y los intercambios
offline mueven saldos dentro de ese techo, con diario firmado por ambos.
Límites honestos de este diseño:

- Solo funciona entre pares con relación establecida (no con desconocidos:
  el riesgo de impago lo asume el que acepta el crédito).
- El techo pre-autorizado **es** la pérdida máxima aceptada. No hay
  prevención criptográfica de double-spend sin un tercero o sin
  conectividad: hay **acotación de daño**.
- Al recuperar conectividad, los diarios se reconcilian contra el vault;
  discrepancias → `DISPUTE` con humanos.
- Multi-dispositivo: cada dispositivo lleva su propio sub-diario con
  sub-techo; el vault no se excede porque la suma de sub-techos ≤ techo
  offline (§3.2). **[OPEN QUESTIONS]** ¿Reconciliación automática segura
  entre dispositivos del mismo usuario sin doble cómputo? Sin resolver,
  el default es conservador: un solo dispositivo gasta offline a la vez
  (los demás ven el techo como agotado hasta sincronizar).

**[FROZEN PRINCIPLES]** Nunca se presenta un `SETTLE_DEFERRED` o un
movimiento de créditos offline como "pago final" al usuario. La UI
distingue: `pagado` (asentado en rail) vs. `pendiente de asentar`
(compromiso registrado) vs. `crédito bilateral` (saldo entre pares). La
ambigüedad aquí es fraude por diseño de UX.

---

## Registro de decisiones

| # | Decisión | Clasificación |
|---|---|---|
| 1.1 | Reglas económicas estructuradas; el modelo no las crea ni modifica | FROZEN PRINCIPLES |
| 1.2 | Umbrales $1/$5 como defaults iniciales | PROVISIONAL |
| 1.3 | Recurrencia oculta prohibida; subscripción exige grant explícito | FROZEN PRINCIPLES |
| 1.4 | Contenido mínimo del ASK_USER económico | PROVISIONAL |
| 2.1 | Límites conjuntivos en todas las dimensiones (el más restrictivo gana) | FROZEN PRINCIPLES |
| 2.2 | Contabilidad por identidad de peer, no por transporte/dispositivo | FROZEN PRINCIPLES |
| 2.3 | Ventanas deslizantes (no calendario) | PROVISIONAL |
| 2.4 | Ninguna actualización amplía límites automáticamente | FROZEN PRINCIPLES |
| 3.1 | Separación principal vs. budget vault; el agente nunca toca el principal solo | FROZEN PRINCIPLES |
| 3.2 | Vault como registro contable local + adapter acotado al vault | PROVISIONAL |
| 3.3 | Emergency revoke: acción única, local, inmediata | FROZEN PRINCIPLES |
| 3.4 | Techo de gasto offline pre-autorizado; exceso en hold | PROVISIONAL |
| 4.1 | Recibo de eventos+decisiones, nunca chain-of-thought | FROZEN PRINCIPLES |
| 4.2 | Recibo firmado por dispositivo, encadenado por `payment_id` | PROVISIONAL |
| 4.3 | Recibo como atestación local, no verdad global | PROVISIONAL |
| 5.1 | Recurrencia: autorización explícita, sin ampliación unilateral, cancelación local | FROZEN PRINCIPLES |
| 6.1 | Liquidación en rail externo requiere conectividad, sin excepción | FROZEN PRINCIPLES |
| 6.2 | `SETTLE_DEFERRED` es promesa registrada, no pago final | FROZEN PRINCIPLES |
| 6.3 | Créditos offline bilaterales con techo = pérdida máxima aceptada | EXPERIMENTAL |
| 6.4 | UI distingue pagado / pendiente / crédito bilateral | FROZEN PRINCIPLES |

## Preguntas abiertas (este documento)

1. ¿Cómo se fondea el vault en la práctica sin convertir el fondeo en una
   fricción que el usuario evita (y por tanto deja todo en ASK_USER
   fatigado)?
2. ¿Reconciliación multi-dispositivo del diario offline sin doble cómputo
   ni servidor: qué protocolo mínimo la haría segura?
3. ¿Deben los recibos tener un formato canónico firmable interoperable
   entre implementaciones NIDO (JCS como en el protocolo), o basta el
   formato local?
4. ¿Qué evidencia mínima de verificación es suficiente para que un
   `SETTLE` automático (sin ASK) sea defendible ante una reclamación
   posterior del usuario?
