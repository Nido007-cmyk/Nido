> **Idioma:** [English](../DESIGN_REDTEAM_3.md) · Español
# Red-team del diseño — ronda 3: ataques encadenados

**Método:** encadenar superficies que individualmente parecen permitidas —
capability discovery, negotiation, privacy budget, delegation, multi-device,
group tasks, task graphs, model router, transports, consent, revocation,
extensions — buscando escaladas que solo aparecen en la composición.

Formato: `threat → exploit path → architectural mitigation → future
conformance test`. Se marca qué hallazgos **cambiaron el spec**.

---

## C-1. Fragmentación del privacy budget entre capabilities

**Threat →** el disclosure budget se evade repartiendo el sondeo entre
varias capabilities.
**Exploit path →** el atacante intercala `availability.query` (10
queries/h), rondas de `NEGOTIATION_COUNTER` (cada una filtra constraints)
y `calendar.event.propose` con ventanas de prueba. Cada contador va por
separado; en conjunto reconstruyen el calendario (S2 × S5).
**Mitigation →** **los disclosure budgets se agregan por (identidad,
ventana) a través de capabilities**, no por capability. Las rondas de
negociación consumen budget (fix aplicado en
`CAPABILITY_NEGOTIATION.md`). **[SPEC CAMBIADO]**
**Conformance test →** secuencia mixta query/negotiate/propose debe
agotar el budget agregado y devolver `BUDGET_EXHAUSTED` aunque ningún
contador individual se haya excedido.

## C-2. COUNTER como oráculo de constraints

**Threat →** las contrapropuestas filtran progresivamente el conjunto
factible del peer.
**Exploit path →** A propone 20 ventanas distintas en negociaciones
separadas; cada `COUNTER` de B ("no puedo antes de las 18:30") estrecha el
retrato de su agenda. Ninguna ronda viola su política aislada.
**Mitigation →** counters gruesos por política + rondas contra budget
(C-1) + `max_rounds` bajo por defecto + el receptor puede responder
`DECLINE` sin contraproponer (no está obligado a informar). **[SPEC
CAMBIADO]** (`CAPABILITY_NEGOTIATION.md`).
**Conformance test →** 20 negociaciones simuladas: la información
acumulada sobre la agenda real no supera la granularidad declarada.

## C-3. Exfiltración por composición en el task graph

**Threat →** cada nodo pasa la política; la composición exfiltra.
**Exploit path →** modelo remoto comprometido propone: n1
`availability.query` (permitido) → n2 `message.send` a identidad del
atacante con los intervalos como "info de scheduling" (permitido: el peer
tiene `message.send`). Ningún nodo es malicioso aislado; el flujo de datos
es el ataque (S8 × S7).
**Mitigation →** contabilidad de disclosure del grafo **en conjunto**
contra el budget del solicitante + `data_inputs` solo a inputs declarados
+ validación del output agregado antes de revelar. IFC completo se declara
investigación abierta, no promesa. **[SPEC CAMBIADO]**
(`AUTONOMY_MODEL.md` §4.3).
**Conformance test →** grafo "benigno por nodos, exfiltrante en conjunto"
debe ser denegado o recortado en el nodo que cruza el budget agregado.

## C-4. Lavado de consentimiento vía delegación y grupo

**Threat →** una autorización estrecha se ensancha cruzando contextos.
**Exploit path →** A obtiene de B consentimiento para `availability.query`
→ B delega a C (`max_depth: 1`) → C lleva la delegación a una tarea grupal
donde D (sin relación con A) se beneficia de los datos revelados.
**Mitigation →** el `scope` de delegación incluye allowlist de peers y
**no cruza fronteras de grupo** sin scope explícito; cada participante del
grupo evalúa al issuer original (RT-10); la delegación nunca anula un DENY
local. **[SPEC ACLARADO]** (ya estaba en el diseño; se añade test).
**Conformance test →** delegación presentada en un grupo fuera de su
scope → `DELEGATION_INVALID`; D no recibe datos.

## C-5. Expansión silenciosa de autonomía por actualización

**Threat →** una update legítima amplía autoridad sin que el usuario lo
note.
**Exploit path →** el usuario permitió `availability.query/v1` (intervalos
gruesos). Llega `v2` con disclosure más fino + un modelo nuevo que
"entiende mejor" las reglas. Las reglas antiguas se aplican por nombre a
la v2 → el peer obtiene más datos con el mismo permiso (variante: un
modelo con tool-use ampliado interpreta reglas viejas de forma más
permisiva).
**Mitigation →** **nueva ley: `AUTONOMY MUST NEVER GROW SILENTLY`.** Las
reglas fijan `capability + versión` exactas; nueva versión o más
capacidades → detección de expansión de scope → nueva decisión explícita.
Lo concedido sigue valiendo para lo concedido, ni un bit más. **[SPEC
CAMBIADO]** (`AUTONOMY_MODEL.md`, `AGENT_PROTOCOL.md` §1.1).
**Conformance test →** instalar capability v2 con reglas solo para v1 →
toda petición v2 devuelve `POLICY_DENIED` (no heredado) hasta re-consentimiento.

## C-6. Estiramiento de expiración por re-delegación rápida

**Threat →** cadenas de re-delegación extienden indefinidamente una
autorización corta.
**Exploit path →** delegación raíz expira en 1 h; el intermediario
re-delega cada 50 min con expiración "nueva" de 1 h, encadenando
autorización efectiva infinita dentro de `max_depth` si el issuer no
limita.
**Mitigation →** **expiración monótona decreciente**: ningún eslabón puede
expirar después que su padre; `max_uses` se decrementa en la cadena. **[SPEC
CAMBIADO]** (`AGENT_PROTOCOL.md` §7).
**Conformance test →** cadena donde un hijo declara `expires_at` posterior
al padre → `DELEGATION_INVALID` en verificación.

## C-7. Salto de transporte para evadir rate limits

**Threat →** los límites por transporte se reinician cambiando de medio.
**Exploit path →** el atacante alterna Bluetooth → LAN → relay; cada
transporte lleva su contador y ninguno se dispara (RT-12 ×
`TRANSPORT_ARCHITECTURE.md`).
**Mitigation →** rate limits y budgets **por identidad, agregados en la
capa de protocolo** a través de todos los transportes. **[SPEC CAMBIADO]**
(`AGENT_PROTOCOL.md` §8).
**Conformance test →** ráfaga repartida en 3 transportes contra la misma
identidad → el límite agregado se dispara igual.

## C-8. Ventana de revocación en transporte raro

**Threat →** un dispositivo revocado sigue actuando donde la revocación
aún no llegó.
**Exploit path →** la tablet revocada (S13) deja de usarse por Bluetooth
(donde el gossip ya la mató) y ataca por relay, donde los peers aún no
recibieron la lista.
**Mitigation →** expiración corta de certificados (acota la ventana por
diseño) + **frescura de revocación exigible**: capabilities `high`
pueden exigir info de revocación más fresca que un umbral. **[SPEC
CAMBIADO]** (`AGENT_PROTOCOL.md` §2).
**Conformance test →** `location.request` con revocación del peer más
antigua que el umbral → se exige revalidación antes de ejecutar.

## C-9. Reincorporación grupal para doble voto y reset

**Threat →** withdraw + rejoin = votar dos veces o estrenar budget.
**Exploit path →** C vota, abandona (S6), se reincorpora con otro
`device_id` y vota de nuevo la misma franja; o su budget de disclosure se
"reinicia".
**Mitigation →** voto y budgets **por identidad, no por dispositivo**;
reincorporación no resetea nada; `DUPLICATE_VOTE` cubre el re-voto. **[SPEC
CAMBIADO]** (`GROUP_TASKS.md`).
**Conformance test →** secuencia withdraw → rejoin → vote → `DUPLICATE_VOTE`;
el budget consumido antes del withdraw sigue consumido.

## C-10. Extensión que sombrea una capability del core

**Threat →** una extensión registra `availability.query/v1` con disclosure
más débil y suplanta a la del core.
**Exploit path →** el peer anuncia "soporto `availability.query/v1`"
pero su implementación es una extensión oportunista que devuelve títulos
de eventos. La política del ejecutor permitió por nombre.
**Mitigation →** **anti-shadowing**: identidad = nombre + versión exactos
del core; colisión → rechazo en validación. **[SPEC CAMBIADO]**
(`CAPABILITY_NEGOTIATION.md` §3.2).
**Conformance test →** registrar extensión con nombre del core →
rechazo; pedir `v1` invoca siempre la definición del core.

## C-11. Divergencia de política entre dispositivos

**Threat →** el atacante dirige la petición al dispositivo con la política
más débil.
**Exploit path →** el usuario tiene móvil (política estricta, ASK siempre)
y desktop (regla antigua `ALLOW_FOR_CONTACT` olvidada). El atacante
descubre el desktop por LAN y lo usa como puerta blanda (S4 × multi-device).
**Mitigation →** la política es **por identidad** y debe converger entre
dispositivos; hasta que exista sync de políticas, las capabilities
`sensitivity: high` se atienden solo en el dispositivo primary. Divergencia
detectada → aviso al usuario. **[SPEC AÑADIDO como restricción temporal]**.
**Conformance test →** (futuro) dos dispositivos con políticas
divergentes → el secundario rechaza `high` con `POLICY_DIVERGED`.

---

## Veredicto ronda 3

11 cadenas analizadas. **9 cambiaron o aclararon el spec** (C-1, C-2, C-3,
C-5, C-6, C-7, C-8, C-9, C-10, C-11 — C-4 ya estaba cubierto y quedó atado
a test). Patrón dominante: **los ataques viven en la composición** —
ningún chequeo aislado los ve; las mitigaciones agregan contabilidad por
identidad (no por dispositivo/transporte/capability) y pinning de versiones.
Dos áreas siguen sin cierre verificable: IFC completo entre nodos (C-3
parcial) y sync de políticas multi-dispositivo (C-11 temporal).
