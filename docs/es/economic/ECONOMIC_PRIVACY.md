> **Idioma:** [English](../../economic/ECONOMIC_PRIVACY.md) · Español

# NIDO Economic Layer — Privacidad económica

**Estado:** RESEARCH / DESIGN ONLY. Sin implementación. Subordinado a
`../NIDO_PRINCIPLES.md` (§8: privacy negotiation, minimum disclosure) y a
`ECONOMIC_ARCHITECTURE.md` §4 (campos `privacy_requirements`).

Etiquetas de decisión: **[FROZEN PRINCIPLES]** · **[PROVISIONAL]** ·
**[EXPERIMENTAL]** · **[OPEN QUESTIONS]**.

---

## 1. Qué puede filtrar una economía de agentes

Cada interacción económica es una observación para el adversario. Inventario
honesto de superficies:

| Superficie | Qué filtra |
|---|---|
| **Quotes** | Demanda ("necesito render GPU urgente"), disposición a pagar, urgencia (TTL corto), frecuencia de solicitud. |
| **Purchase history** | Patrones de comportamiento, dependencias (a quién compro cómputo cada día), horarios de actividad. |
| **Timing** | Correlación temporal entre tareas (esta compra sigue a aquella tarea sensible), zona horaria, rutina. |
| **Capabilities ofrecidas** | Recursos del dispositivo (GPU, almacenamiento libre), servicios que el usuario vende, y por tanto pistas sobre su negocio/vida. |
| **Balances / techos** | Riqueza aproximada, tamaño del vault, límites (un `DECLINE` por límite cuenta cuánto *no* puedes pagar). |
| **Counterparties** | Grafo de relaciones económicas: con quién comercias es casi tan revelador como qué comercias. |
| **Disputas y reembolsos** | Fricción, insatisfacción, patrones de reclamación. |
| **Importes exactos** | Fingerprinting por importe (0.40 USD a las 03:12 es casi un identificador). |

**[FROZEN PRINCIPLES]** La privacidad económica se diseña con el mismo
rigor que la privacidad de datos: minimum disclosure por defecto, y cada
campo económico que sale del dispositivo debe estar justificado como
**necesario** para la transacción concreta, no como conveniente.

---

## 2. Minimum economic disclosure

Reglas de proyección (paralelas a `minimum_disclosure` de capabilities):

1. **Una quote revela solo lo de esa solicitud.** Nada de "catálogos de
   precios" en discovery público. El precio de una capability se entrega
   bajo solicitud autenticada, dentro de política, y solo para la
   capability pedida (ya establecido en `ECONOMIC_ARCHITECTURE.md` §4).
2. **El solicitante no anuncia su presupuesto.** `REQUEST_QUOTE` no incluye
   "puedo pagar hasta X": eso es regalar la negociación y filtrar el
   techo. El oferente cotiza a ciegas del presupuesto del comprador.
3. **Los motivos de DECLINE son uniformes.** Un `DECLINE` hacia el peer no
   distingue "sin fondos", "límite diario alcanzado", "peer no
   autorizado" o "precio alto". **[FROZEN PRINCIPLES]** Diferenciar el
   motivo filtra exactamente la información que el límite intentaba
   proteger (oráculo de límites: el atacante binariza tu presupuesto a
   base de quotes).
4. **Importes redondeados donde sea posible.** Los micro-importes con
   decimales arbitrarios son fingerprints. **[PROVISIONAL]** Los adapters
   pueden redondear a la unidad mínima con sentido económico del rail, y
   las quotes usan ticks de precio discretos, no continuos.
5. **Recibos locales por defecto.** El recibo completo vive en el
   dispositivo del que paga (y una vista mínima en el que cobra: qué
   capability, qué importe, qué `payment_id`). Ningún tercero los ve.
6. **Agregación con ruido de calendario.** Las ventanas deslizantes de
   límites (§2 de `ECONOMIC_POLICY_MODEL.md`) ya evitan bordes de
   calendario explotables; además, los reintentos de compra tras un
   `DECLINE` deben espaciarse con jitter para no permitir sondeo fino del
   momento exacto en que se libera presupuesto.

---

## 3. Probar capacidad de pago sin mostrar el balance

**[FROZEN PRINCIPLES]** Un peer no necesita conocer el balance completo
para saber que una operación autorizada puede liquidarse.

Diseño (conceptual, sin criptografía avanzada):

- El NIDO pagador emite una **atestación de capacidad** firmada con su
  clave de dispositivo: `{payment_id, amount, unit, budget_scope,
  expires_at, signature}`. Afirma: "mi Policy Engine autorizó este pago y
  mi vault lo cubre".
- El peer la verifica como lo que es: una **promesa firmada del pagador**,
  no una prueba matemática de fondos. Su valor real está en que es
  **vinculante localmente**: el diario del pagador ya reservó ese importe,
  y la atestación es evidencia firmada ante una disputa.
- En rails con liquidación atómica (el rail verifica fondos al asentar),
  la atestación es solo una cortesía previa: la verdad la dice el rail.
  En créditos offline bilaterales, la atestación **es** el mecanismo, y
  su riesgo está acotado por el techo bilateral pre-autorizado
  (`ECONOMIC_POLICY_MODEL.md` §6.1).

**[OPEN QUESTIONS]** ¿Pruebas de conocimiento cero de solvencia
("puedo pagar X sin revelar mi balance")? Conceptualmente deseables,
prácticamente prematuras: exigen un compromiso público del balance (que
filtra por sí mismo), circuitos por rail, y complejidad que hoy no podemos
auditar. Se registra como investigación futura, no como plan.

**[PROVISIONAL]** Separación de identidades de liquidación: el NIDO puede
usar identificadores de settlement rotativos por peer (dentro del mismo
settlement profile) para que dos counterparties no correlacionen su
actividad por un identificador estable. Esto **no** es anonimato frente al
rail (el rail ve lo que ve) y **no** debe usarse para evadir reputación
(ver `ECONOMIC_REDTEAM.md` §18: la rotación para evadir historial negativo
es un ataque Sybil-like y se trata como tal).

---

## 4. Privacy requirements como campos de capability

Los `privacy_requirements` del descriptor económico
(`ECONOMIC_ARCHITECTURE.md` §4) se estructuran así (DATA):

| Campo | Significado |
|---|---|
| `input_data_needed` | Lista cerrada de categorías de datos que la ejecución requiere. |
| `input_retention` | `until_result_delivered` / `hours:N` / `none_stored`. |
| `logging` | `no_input_content` / `hashes_only` / `full_debug` (este último exige ASK_USER explícito). |
| `quote_visibility` | `private` (solo bajo solicitud) / `contacts` / `public`. Default: `private`. |
| `result_linkability` | Si el resultado puede correlacionarse con el solicitante por un tercero que observe el rail. |

**[FROZEN PRINCIPLES]** `quote_visibility: public` nunca es el default y
requiere decisión explícita del usuario oferente, informada de que un
precio público es un anuncio económico permanente y observable.

**[PROVISIONAL]** Un oferente puede declarar `input_retention:
none_stored` como compromiso; su cumplimiento no es verificable
remotamente por el comprador (es una promesa, no una prueba). El diseño lo
trata como señal para la política del comprador (p. ej. "solo compro a
oferentes con `none_stored` para datos sensibles"), no como garantía.

---

## 5. Fugas por agregación y metadatos

- **Frecuencia de quotes como señal de demanda.** Un oferente que recibe 50
  `REQUEST_QUOTE` al día de un NIDO aprende su patrón de consumo aunque
  nunca se cierre una compra. **[PROVISIONAL]** Mitigación: cacheo local
  de quotes recientes (no re-preguntar lo ya cotizado dentro del TTL) y
  agregación de solicitudes cuando el plan lo permite (group tasks piden
  de una vez).
- **Correlación tarea→pago.** Si cada `TASK_REQUEST` económico va seguido
  de un `SETTLE` observable en el mismo canal y con timing similar, un
  observador del transporte correlaciona tareas con pagos aunque el
  contenido vaya cifrado. **[PROVISIONAL]** Mitigación: desacoplar timing
  (jitter en `SETTLE`), y recordar que el transporte solo ve ciphertext
  (`TRANSPORT_ARCHITECTURE.md`): la correlación es por metadatos
  (tamaño/timing), no por contenido.
- **Grafo de counterparties.** **[FROZEN PRINCIPLES]** NIDO nunca publica
  su historial de counterparties. Ni en discovery, ni en reputación (ver
  redteam §18: la reputación es contextual y no requiere historial
  público global).

---

## Registro de decisiones

| # | Decisión | Clasificación |
|---|---|---|
| 1.1 | Privacidad económica con el mismo rigor que privacidad de datos | FROZEN PRINCIPLES |
| 2.1 | Quote solo bajo solicitud autenticada; sin catálogos públicos | FROZEN PRINCIPLES |
| 2.2 | `REQUEST_QUOTE` nunca anuncia presupuesto | FROZEN PRINCIPLES |
| 2.3 | Motivos de `DECLINE` uniformes hacia el peer (anti-oráculo de límites) | FROZEN PRINCIPLES |
| 2.4 | Ticks de precio discretos; redondeo donde el rail lo permite | PROVISIONAL |
| 2.5 | Recibos locales por defecto; vista mínima para la contraparte | PROVISIONAL |
| 3.1 | Atestación de capacidad firmada en vez de balance visible | FROZEN PRINCIPLES |
| 3.2 | La atestación es promesa vinculante, no prueba matemática | PROVISIONAL |
| 3.3 | ZK de solvencia: investigación futura, no plan | OPEN QUESTIONS |
| 3.4 | Identificadores de settlement rotativos por peer; no para evadir reputación | PROVISIONAL |
| 4.1 | `quote_visibility: private` por defecto; `public` exige decisión informada | FROZEN PRINCIPLES |
| 4.2 | `input_retention: none_stored` es promesa, no garantía verificable | PROVISIONAL |
| 5.1 | Cacheo de quotes y agregación contra señal de demanda | PROVISIONAL |
| 5.2 | Historial de counterparties nunca público | FROZEN PRINCIPLES |

## Preguntas abiertas (este documento)

1. ¿Qué granularidad de ticks de precio equilibra privacidad (anti-fingerprint)
   con utilidad económica (competencia real entre oferentes)?
2. ¿Puede un diseño de atestación de capacidad evolucionar a pruebas de
   solvencia con divulgación mínima sin un setup de confianza?
3. ¿Cómo se audita el cumplimiento de `input_retention: none_stored` por
   un oferente sin inspeccionar su dispositivo (imposible por diseño)?
4. ¿El jitter en `SETTLE` es suficiente contra correlación tarea→pago por
   un observador del transporte con visibilidad total del timing?
