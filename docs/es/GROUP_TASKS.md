> **Idioma:** [English](../GROUP_TASKS.md) · Español

# NIDO Group Tasks — Especificación (borrador v0.1)

**Estado:** diseño, NO implementar todavía. **Sin criptografía de grupo
todavía**: este documento diseña la coordinación multi-parte sobre
canales pairwise existentes (sesiones 1:1 autenticadas). La criptografía
de grupo queda como pregunta abierta (§12.6).

**Dependencia futura:** `docs/CAPABILITY_NEGOTIATION.md` (aún no escrito)
definirá la semántica fina de `PROPOSE` / `COUNTER` / `ACCEPT` / `DECLINE` /
`EXPIRE`. Este documento la compone en contexto multi-parte; si hay
conflicto, la semántica de negociación manda y este documento se revisa.

**Principios inviolables:**

- **EL MODELO NO ES NIDO.**
- *"A request can describe what another NIDO wants. It can never define
  what this NIDO is authorized to do."*
- Cada Policy Engine decide **localmente**; el grupo no vota permisos.
- Minimum disclosure también **entre participantes**.
- `TRANSPORT ≠ TRUST`. Fail-closed.

---

## 1. Caso normativo

> "Encuentra cuándo podemos reunirnos los cuatro."

A, B, C y D quieren una hora común. **Ningún agente recibe los calendarios
de los demás.** Cada NIDO calcula su disponibilidad **localmente** (lee su
propio calendario, aplica su política) y revela únicamente lo necesario
para converger: intervalos compatibles o votos sobre franjas propuestas.

Lo que el grupo aprende al final: *"quedamos el martes 18:30–19:30"*.
Lo que el grupo **no** aprende: por qué B no podía a las 17:00, qué
calendario usa C, ni qué modelo corre D.

---

## 2. Modelo de tarea multi-parte

### 2.1 Identificadores y membresía

- `group_task_id`: 128 bits aleatorios, generado por el iniciador.
  Clave de idempotencia del ciclo de vida grupal (igual que `task_id`
  en `AGENT_PROTOCOL.md` §9).
- `members[]`: lista cerrada de identidades NIDO (clave pública de
  identidad, hex), en orden canónico (lexicográfico). **La membresía es
  fija al crear la tarea**: nadie entra a mitad sin reiniciar la
  negociación (evita inyección de participantes).
- Cada mensaje grupal es un envelope firmado del protocolo base
  (`AGENT_PROTOCOL.md` §4): `sender` = identidad + dispositivo +
  certificado, `signature` del dispositivo emisor. La autenticación de
  participantes **reutiliza** el modelo identidad→dispositivos→sesiones;
  no se inventa nada nuevo.
- Regla de admisión: un mensaje grupal de una identidad fuera de
  `members[]` → `INVALID_PARTICIPANT`, descarte silencioso + auditoría.

### 2.2 El coordinador NO es autoridad

Cualquier participante puede iniciar (y se convierte en coordinador).
El coordinador:

- **Sí hace:** propone franjas, agrega respuestas, recalcula ante
  abandonos, notifica el resultado.
- **No es:** no autoriza nada en nombre de otros, no concede permisos, no
  ejecuta tools ajenas, no revela datos de un participante a otro más allá
  de lo agregado/necesario.
- **Lo que aprende está limitado a lo revelado** (§3): ve exactamente lo
  que cada participante decidió revelar según su política, ni un bit más.
- **Sucesión determinista:** si el coordinador abandona o deja de
  responder (timeout), el siguiente miembro en el orden canónico de
  `members[]` puede asumir la coordinación anunciando
  `GROUP_COORDINATOR_TAKEOVER` firmado. Sin elecciones, sin votación de
  coordinador: el orden canónico lo decide.

### 2.3 Respuestas parciales

Un participante puede responder parcialmente sin romper la tarea:

- Responder solo a un subconjunto de franjas propuestas.
- Responder `SUPPORTED_WITH_CONSTRAINTS` (p. ej. "solo 30 min, no 60").
- Pedir más tiempo (`GROUP_DEFER` con nuevo `eta_ms`).

La tarea avanza con lo recibido; lo pendiente se rige por timeouts (§6).
Una respuesta parcial **nunca** se interpreta como aceptación del resto.

---

## 3. Modos de revelación: votar antes que recolectar

Dos modos, con distinta huella de privacidad. **El modo voto es el
defecto recomendado.**

### 3.1 Modo voto (defecto)

1. El coordinador propone franjas candidatas
   (`GROUP_PROPOSE`: lista de `{start, end}`).
2. Cada participante responde por franja: `SUPPORTED` / `UNSUPPORTED` /
   `SUPPORTED_WITH_CONSTRAINTS` — sin decir por qué.
3. El coordinador agrega y anuncia la intersección.

**Disclosure por participante:** solo su voto sobre franjas propuestas.
Nadie revela su calendario, ni siquiera sus intervalos libres.

### 3.2 Modo recolecta (restringido)

1. El coordinador pide disponibilidad en una ventana
   (`GROUP_AVAILABILITY_REQUEST{window_start, window_end}`).
2. Cada participante responde con sus intervalos libres
   (capability `availability.query/v1`, minimum disclosure como en
   `CAPABILITY_MODEL.md` §2).
3. El coordinador calcula la intersección.

**Disclosure por participante:** sus intervalos libres en la ventana —
estrictamente más que el modo voto. Requiere política explícita
(`ALLOW_UNDER_CONDITIONS` o superior); el defecto es denegarlo y sugerir
el modo voto.

### 3.3 Regla de agregación mínima

El coordinador **no reenvía respuestas individuales** a otros
participantes. Comparte únicamente:

- el resultado agregado (intersección / franja elegida), o
- conteos anonimizados si la regla de consenso los requiere
  ("3 de 4 apoyan el martes 18:30"), nunca *quién* votó qué, salvo que la
  tarea lo exija explícitamente y la política de cada uno lo permita.

---

## 4. Canales: pairwise hoy, grupo mañana

### 4.1 Pairwise (diseño actual — sin cripto de grupo)

Cada par coordinador↔participante usa su **sesión 1:1** existente
(handshake autenticado, AEAD). El coordinador actúa como agregador de
mensajes firmados.

- **Qué aprende el coordinador:** exactamente lo revelado por cada
  participante (§3). No puede leer más: los envelopes van cifrados por
  sesión y firmados por el dispositivo emisor.
- **Qué ve cada participante:** sus propios mensajes + los agregados del
  coordinador. No ve mensajes ajenos (el coordinador no los reenvía).
- **Qué ve un observador del transporte:** ciphertext (ver
  `TRANSPORT_ARCHITECTURE.md` §3).

### 4.2 Canal de grupo (futuro — NO implementar)

Un canal con clave compartida donde todos ven todos los mensajes reduciría
el poder del coordinador como intermediario, pero exige acuerdo de clave
de grupo, forward secrecy multi-parte y gestión de membresía dinámica.
Ver pregunta abierta §12.6. **Decisión de diseño:** el protocolo grupal
debe funcionar idénticamente sobre pairwise; si algún día existe canal de
grupo, es un transporte lógico más, no un cambio de semántica.

### 4.3 Coordinador malicioso: límites duros

Un coordinador bizantino **puede, como máximo**:

- descartar, retrasar o duplicar mensajes (mitigado por timeouts §6,
  idempotencia por `message_id`/`group_task_id`, y seen-sets —
  `AGENT_PROTOCOL.md` §9);
- mentir en la agregación (p. ej. anunciar una intersección falsa).

**No puede:**

- leer más allá de lo revelado (cifrado por sesión + minimum disclosure);
- forjar la respuesta de un participante (firma del dispositivo emisor);
- otorgarse autoridad sobre otros (cada Policy Engine decide localmente);
- hacer que un participante ejecute algo no autorizado (la aceptación
  final es local, §7).

**Detección de agregación falsa:** cada participante verifica
localmente que la franja final anunciada sea compatible con lo que él
reveló. Si no lo es → `COORDINATOR_FAULT`, se aborta y se audita. La
verificación no requiere confiar en el coordinador.

---

## 5. Composición con negociación

(Depende de `CAPABILITY_NEGOTIATION.md` para la semántica fina; aquí el
ensamblaje multi-parte.)

- `GROUP_PROPOSE`: el coordinador propone a **todos** (una o varias
  franjas). Equivale a `PROPOSE` broadcast.
- `GROUP_COUNTER`: un participante contrapropone — **dirigida al
  coordinador**, que decide si la incorpora a una nueva ronda de
  `GROUP_PROPOSE`. Las contrapropuestas no se negocian peer-to-peer entre
  participantes (evita explosión combinatoria y filtraciones laterales).
- `GROUP_ACCEPT` / `GROUP_DECLINE`: por participante y por propuesta.
  `ACCEPT` significa "esta franja me vale **si** el grupo la elige"; la
  acción final con side effects (crear el evento) sigue requiriendo la
  decisión local del Policy Engine de cada uno.
- `GROUP_EXPIRE`: expiración de una propuesta o de la tarea completa.

**Regla de consenso** (anunciada por el coordinador en `GROUP_INVITE`,
inmutable después):

- `unanimity` — todas las franjas aceptadas por todos (defecto para
  reuniones);
- `quorum(n)` — al menos `n` aceptaciones (útil si alguien abandona, §8);
- `coordinator_picks` — el coordinador elige entre las aceptadas con
  criterio determinista anunciado (p. ej. "la más temprana").

**Selección:** con varias franjas aceptadas, se aplica el criterio
anunciado. El criterio es público y determinista para que cualquier
participante pueda verificar el resultado.

---

## 6. Timeouts y quorum

- **Timeout por participante** (`response_timeout_ms`, anunciado en el
  invite; defecto sugerido: 24 h para tareas humanas): sin respuesta →
  el participante se marca `UNRESPONSIVE`. No se asume aceptación ni
  rechazo: según la regla de consenso, o se espera, o se recalcula sin él.
- **Timeout global** (`expires_at` del grupo): expiración → `GROUP_EXPIRE`
  a todos los que sigan alcanzables + evento de auditoría.
- **Quorum mínimo** (`min_participants`): si los miembros activos caen por
  debajo → `QUORUM_LOST`, la tarea falla de forma explícita (fail-closed).
  Nunca se "completa" una reunión de cuatro con dos sin que la política de
  cada uno lo acepte de nuevo.

---

## 7. La aceptación final es local

El consenso grupal produce una **propuesta final**, no una orden. Cada
NIDO, al recibir `GROUP_RESULT{chosen_slot}`:

1. Verifica que la franja sea compatible con lo revelado (anti
   `COORDINATOR_FAULT`).
2. Pasa por **su** Policy Engine la acción con side effects
   (`calendar.event.create/v1` → típicamente `ASK_USER` /
   `human_approval: always`).
3. Solo entonces crea el evento localmente.

Un `ACCEPT` en la negociación **nunca** equivale a autorización de la
acción final. Autonomía ≠ autoridad.

---

## 8. Abandono de un participante a mitad del proceso

1. El participante envía `GROUP_WITHDRAW{group_task_id, reason?}` firmado
   (o simplemente deja de responder hasta el timeout → `UNRESPONSIVE`).
2. El coordinador notifica al resto: `GROUP_PARTICIPANT_UPDATE` (quién
   salió, sin motivo sensible; `reason` es enum, nunca texto libre con
   datos privados).
3. **Recálculo:** se reevalúa la regla de consenso con los miembros
   restantes. Con `quorum(n)` la tarea puede continuar; con `unanimity`
   y un miembro menos, o se re-propone o falla con `QUORUM_LOST`.
4. **Lo ya revelado no se puede "des-revelar":** los intervalos o votos
   que el participante compartió antes de salir **siguen conocidos** por
   el coordinador. Esto se documenta como límite honesto del diseño: el
   abandono detiene *futura* revelación, no borra el pasado. Por eso el
   modo voto (§3.1) es el defecto: minimiza lo que hay que lamentar.
5. Si el que abandona es el coordinador → sucesión determinista (§2.2) o
   `COORDINATOR_LOST` si nadie asume antes del timeout.

---

## 9. Máquina de estados (tarea grupal)

```
INVITED ──(todos aceptan invite / quorum invita)──▶ COLLECTING
   │  (rechazo / timeout global)
   ▼
COLLECTING ──(respuestas suficientes)──▶ NEGOTIATING
   │  ◀──(GROUP_COUNTER incorporada: nueva ronda)──┘
   │  (PARTICIPANT_WITHDREW → recalcular; si quorum insuficiente)
   ▼
NEGOTIATING ──(regla de consenso satisfecha)──▶ CONSENSUS_REACHED
   │
   ▼
CONSENSUS_REACHED ──(GROUP_RESULT a cada miembro)──▶ FINALIZING_LOCAL
   │   (cada Policy Engine decide: crear / pedir confirmación / denegar)
   ▼
COMPLETED  (todos los activos finalizaron localmente)
   │
   └──▶ FAILED (QUORUM_LOST | CONSENSUS_TIMEOUT | COORDINATOR_FAULT | EXPIRED)
   └──▶ CANCELLED (GROUP_CANCEL del coordinador o de cualquier miembro
                   para su propia participación)
```

Notas:

- `FINALIZING_LOCAL` no es un estado compartido: cada NIDO lo recorre en
  privado. El grupo solo ve `GROUP_DONE` / `GROUP_DECLINED_FINAL` por
  participante, sin motivos sensibles.
- Un `DENY` local en la fase final **no invalida** el consenso para los
  demás: cada uno decide su propia acción. El grupo reporta finalización
  parcial de forma explícita.

### 9.1 Códigos de error específicos de grupo

| Código | Significado |
|---|---|
| `PARTICIPANT_WITHDREW` | un miembro abandonó; se adjunta recálculo o `QUORUM_LOST` |
| `QUORUM_LOST` | miembros activos < `min_participants`; fail-closed |
| `CONSENSUS_TIMEOUT` | no se alcanzó la regla de consenso antes de `expires_at` |
| `INVALID_PARTICIPANT` | mensaje de identidad fuera de `members[]` |
| `COORDINATOR_FAULT` | agregación inconsistente con lo revelado (detectado localmente) |
| `COORDINATOR_LOST` | el coordinador no responde y nadie asumió la sucesión |
| `DUPLICATE_VOTE` | mismo participante vota dos veces la misma franja (se usa el primero) |
| `STALE_PROPOSAL` | mensaje sobre una ronda de propuesta ya superada |

**Un voto por identidad (ronda 3, C-9):** el voto se clavea por
**identidad**, no por dispositivo: un participante que abandona y se
reincorpora (mismo u otro dispositivo) no vota dos veces ni reinicia sus
disclosure budgets. `DUPLICATE_VOTE` también cubre el re-voto tras
reincorporación.

---

## 10. Auditoría (sin contenido sensible)

Por tarea grupal, cada NIDO registra localmente:

```
{ts, event: group.invite_sent|group.invite_received|group.vote_cast|
        group.withdraw|group.result|group.failed,
 group_task_id, members_count, coordinator, consensus_rule,
 my_disclosure: <categorías reveladas>, policy_decision,
 transport, device_id}
```

Se audita *qué categorías* se revelaron ("votos sobre 3 franjas"),
nunca el contenido ("voté que no al martes porque…"). Un participante
puede responder después "¿por qué hiciste eso?" con esta cadena
(ver `AUTONOMY_MODEL.md` para explainability).

---

## 11. Composición con el resto de la arquitectura

- **Policy Engine:** cada mensaje grupal entrante pasa el pipeline de
  `CAPABILITY_MODEL.md` §4. `GROUP_AVAILABILITY_REQUEST` se evalúa como
  `availability.query/v1` contra la política local del receptor.
- **Privacy budget:** las rondas de votación/recolecta consumen presupuesto
  de disclosure (ver `AUTONOMY_MODEL.md`); un coordinador que pida 100
  rondas para reconstruir calendarios se topa con rate limits y negativa
  por política.
- **Transporte:** los mensajes grupales son envelopes normales; viajan por
  cualquier transporte (`TRANSPORT_ARCHITECTURE.md`). El grupo no sabe ni
  le importa si B está por Bluetooth y C por LAN.
- **Modelo:** el modelo local puede *sugerir* franjas candidatas o
  redactar el resumen para el usuario; **nunca** decide votos, acepta
  propuestas ni autoriza revelación. Reasoning ≠ Authority.

---

## 12. Preguntas abiertas

1. ¿Debe `members[]` soportar adición tardía con re-consentimiento de
   todos (útil: "invitemos también a E"), o la rigidez actual es la
   protección correcta?
2. En modo recolecta, ¿debería el coordinador probar criptográficamente
   que la intersección anunciada es correcta sin revelar inputs
   (intersección privada de conjuntos)? ¿Vale la complejidad para el caso
   de uso?
3. ¿Cómo se presenta al usuario una negociación grupal sin fatiga
   ("3 grupos te esperan")? ¿Bandeja de propuestas con expiración visible?
4. ¿`GROUP_DEFER` necesita límites (un participante no puede posponer
   indefinidamente una tarea con quorum)?
5. ¿Tiene sentido un "modo silencioso" donde los votos se agregan sin que
   el coordinador vea votos individuales (agregación ciega)? ¿O es
   over-engineering frente al modo voto simple?
6. **¿Qué criptografía de grupo evaluar en el futuro (sin implementarla
   ahora)?** Candidatos a estudiar: **MLS (RFC 9420)** — estándar IETF
   para messaging de grupo con forward secrecy y post-compromise security,
   pero diseñado para grupos grandes y con cierta complejidad operativa;
   **sender keys estilo Signal** — más simple para grupos pequeños y
   estables, pero peor PCS ante compromiso; **seguir en pairwise** —
   simplicidad máxima y el diseño actual ya funciona así, a costa de
   confiar en el coordinador como agregador. Criterios de evaluación
   cuando toque: forward secrecy y PCS reales, costo de CPU/batería en
   móvil, complejidad de implementación auditable, gestión de membresía
   dinámica, y que **nunca** otorgue al grupo autoridad sobre el Policy
   Engine local. Ninguna opción se adopta por maximizar anonimato teórico;
   NIDO prioriza privacidad práctica y verificable.
