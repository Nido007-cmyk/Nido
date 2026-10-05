> **Idioma:** [English](../SECURITY_INVARIANTS.md) · Español
# Protocolo NIDO — Invariantes de Seguridad (Suite de Conformidad v0)

Estos invariantes son el núcleo de seguridad normativo del protocolo de
agentes. Cada uno se enuncia con precisión y luego se desglosa como
**amenaza → escenario/ruta de explotación → mitigación → test**. Cada
invariante tiene cobertura ejecutable en `vectors/v0/final/` y/o
`__tests__/properties.test.ts`. Una implementación que viole cualquiera de
ellos es no conforme, sin importar cuántos vectores pase.

Etiquetas de estado usadas en este repo (nunca las suavices):
`IMPLEMENTED` · `AUTOMATED/UNIT TESTED` · `ANDROID COMPILED` ·
`EMULATOR TESTED` · `PHYSICAL DEVICE TESTED` · `EXTERNALLY AUDITED`

La suite de conformidad está actualmente `IMPLEMENTED` +
`AUTOMATED/UNIT TESTED` (referencia TypeScript). NO está auditada
externamente. La re-implementación de canonicalización en Python es una
segunda implementación PARCIAL (solo canonicalización + SHA-256).

---

## INV-1 · AUTHORITY_MONOTONICITY

**Enunciado.** Procesar un mensaje de un peer nunca puede aumentar aquello a
lo que ese peer está autorizado. La autoridad proviene solo de (a) reglas
de política local del usuario, (b) una cadena de delegación válida enraizada
en un ancla de confianza local, o (c) consentimiento explícito del usuario.
El contenido del mensaje es datos, nunca autoridad.

**Amenaza → ruta de explotación.** Un peer malicioso envía `TASK_REQUEST`
declarando `capability: calendar.contacts.read` con `version: v2`, o
incrusta campos `"mode": "AUTO"` / `"admin": true` en el payload, esperando
que el receptor trate el contenido del mensaje como permiso.

**Mitigación.**
- Las decisiones de política se calculan solo a partir de reglas LOCALES;
  el request solo aporta (subject, capability, version). Sujeto/capacidad/
  versión desconocidos → `DENY` (`decidePolicy`).
- La coincidencia de versiones es exacta: `v2` nunca satisface una regla
  fijada a `v1`.
- Los campos desconocidos dentro de tokens de delegación se ignoran y no
  otorgan nada.
- `__proto__` y otras claves mágicas se parsean como datos inertes
  (objetos de prototipo nulo); no pueden alterar el comportamiento del
  parser.

**Tests.** `pol-001` (sujeto desconocido), `pol-003` (desajuste de
versión), `pol-006/007` (versión `v2`/`null`), `neg-002`, `neg-006`,
`neg-008`, `neg-003` (campo desconocido del token ignorado), `canon-a05`
(`__proto__` es datos); propiedad: "la basura nunca autoriza" (1000 requests
aleatorios).

---

## INV-2 · AUTONOMY_NON_EXPANSION

**Enunciado.** Una actualización de software, modelo, capacidad o protocolo
nunca puede ensanchar silenciosamente la autoridad previamente otorgada.
Las nuevas versiones, nuevas capacidades y nuevos campos por defecto son
DENY hasta que el usuario (o una regla viva, no expirada) los autorice
explícitamente.

**Amenaza → ruta de explotación.** El peer (o un canal de actualización
comprometido) solicita `calendar.availability.query` en `version: v2`
después de que el usuario aprobara `v1`, confiando en que "mismo nombre de
capacidad" herede la aprobación anterior. O un nuevo campo opcional aparece
en una estructura firmada y una implementación antigua lo malinterpreta como
permiso.

**Mitigación.**
- Las reglas fijan tripletas exactas `(subject, capability, version)`; lo
  demás es DENY.
- Las versiones desconocidas de protocolo/capacidad fallan cerrado
  (`validateVersions`).
- La expiración es inclusiva (`now >= expires_at` ⇒ expirado) en delegación
  Y consentimiento — sin ventana de gracia de un milisegundo que competir
  (race).
- Los nombres de extensión desconocidos que ensombrecen (shadow)
  capacidades core se rechazan al registrar (`EXTENSION_SHADOWING`).

**Tests.** `pol-003`, `ver-002/003/004`, `ext-001`, `del-006` (intercambio
de capacidad), `con-009` (expiración en frontera), `neg-006`.

---

## INV-3 · TRANSPORT_INDEPENDENCE

**Enunciado.** Las propiedades de seguridad (autenticación, autorización,
presupuestación de privacidad, idempotencia) se cumplen idénticamente sin
importar el transporte (Bluetooth, LAN, relay, IPC). Cambiar de transporte
nunca reinicia la contabilidad, nunca eleva la confianza y nunca evita un
chequeo.

**Amenaza → ruta de explotación.** Un peer agota su presupuesto de
privacidad por Bluetooth y luego reabre la "misma" conversación por un
enlace relay/TCP esperando un presupuesto fresco. O un atacante reenvía un
envelope capturado por otro transporte para ejecutar una tarea dos veces.

**Mitigación.**
- Los presupuestos se clavean por **identidad**, no por conexión ni
  transporte; la contabilidad de referencia no tiene ninguna entrada de
  transporte.
- La protección de replay se clavea por `message_id` (por remitente),
  independiente de cómo llegaron los bytes.
- La verificación de firma es sobre la forma canónica, que no contiene
  metadatos de transporte.

**Tests.** `neg-004` (cambiar de transporte no reinicia el presupuesto),
`env-016` (replay), `idem-002` (task_ids duplicados); propiedad:
monotonicidad del presupuesto.

---

## INV-4 · RETRY_SAFETY

**Enunciado.** Reintentar un mensaje (mismo `message_id`) o re-enviar una
tarea (mismo `task_id`) nunca multiplica los efectos secundarios. Los
duplicados se detectan y se confirman sin re-ejecución: efectos secundarios
como-máximo-una-vez, entrega como-mínimo-una-vez.

**Amenaza → ruta de explotación.** La duplicación de red (o un peer
malicioso retransmitiendo) hace que una tarea se ejecute dos veces: doble
evento de calendario, doble mensaje enviado, doble disclosure cargado al
presupuesto.

**Mitigación.**
- Los receptores rastrean los `message_id`s vistos por remitente
  (`DUPLICATE_MESSAGE`).
- La ejecución de tareas se clavea por `task_id`; el segundo envío devuelve
  el outcome registrado en lugar de re-ejecutar.
- El consumo de presupuesto ocurre una vez por tarea aceptada, no una vez
  por entrega.

**Tests.** `env-016`, `idem-001/002/003/004`; propiedad: los duplicados
nunca aumentan `executed_count` (300 secuencias aleatorias).

---

## INV-5 · DISCLOSURE_ACCOUNTING

**Enunciado.** Cada disclosure de datos del usuario a un peer se cuenta
contra un presupuesto de privacidad explícito, por identidad, dentro de una
ventana de tiempo. Muchos disclosures individualmente "pequeños" no pueden
sumar más allá del presupuesto. El disclosure mínimo es la proyección por
defecto; lo que no está en la allow-list se descarta, nunca se envía.

**Amenaza → ruta de explotación.** Un peer (o un agente comprometido) emite
una larga serie de consultas individualmente inocentes ("¿estás libre a las
6?", "¿…a las 6:15?", …) cuyas respuestas agregadas reconstruyen el
calendario del usuario. O un bug de proyección filtra un campo que no
estaba en la allow-list.

**Mitigación.**
- `consumeBudget`: contabilidad por identidad y por ventana; los reintentos,
  reingresos y cambios de transporte no la recargan.
- `graphDisclosure`: contabilidad agregada sobre grafos de disclosure; se
  verifica la suma — no cada nodo — contra el presupuesto.
- `projectDisclosed`: proyección estricta por allow-list; allow-list vacía
  ⇒ `null` (nada divulgado); valores no objeto ⇒ `null`.

**Tests.** `bud-001..007`, `dis-001..006`, `gra-001..005`, `neg-004`,
`neg-009` (once disclosures minúsculos aún denegados); propiedad:
monotonicidad del presupuesto dentro de una ventana.

---

## INV-6 · DELEGATION_ATTENUATION

**Enunciado.** Una autoridad delegada solo puede mantenerse igual o
reducirse a lo largo de la cadena: scope más estrecho, expiración más corta,
nunca más amplia. Un delegatario no puede delegar lo que no se le dio, no
puede extender la expiración más allá de la de su delegante, y no puede
ensanchar el conjunto de peers. La revocación es terminal y no puede
deshacerse reenviando un token más antiguo.

**Amenaza → ruta de explotación.** Alice delega disponibilidad de calendario
al NIDO de Bob (máx 2 usos, peers=[Bob], expira el viernes). El NIDO de Bob
acuña un nuevo token para Carol con máx 99 usos, o con expiración el próximo
año, o reenvía el token original después de que Alice lo revocara.

**Mitigación.**
- La verificación de cadena chequea, por salto: firma del emisor declarado,
  emisor == sujeto anterior (vinculación), scope ⊆ scope del padre
  (subconjunto max_uses/peers), `expires_at` ≤ `expires_at` del padre,
  capacidad idéntica, `now < expires_at`.
- La revocación es una transición terminal de máquina de estados; un token
  revocado nunca vuelve a ser válido.

**Tests.** `del-001..009`, `neg-003`, `neg-007` (uso tras revocar); máquinas
de estado `sm-012/013`.

---

## INV-7 · FAIL_CLOSED

**Enunciado.** Cualquier entrada que la implementación no entienda
positivamente es rechazada. No hay parsing de "mejor esfuerzo", ni fallback
indulgente, ni descarte silencioso de campos, ni permitir-por-defecto. La
entrada malformada, ambigua, expirada o aún-no-válida produce un error
tipado, nunca una aceptación parcial.

**Amenaza → ruta de explotación.** El atacante envía: JSON con campos
duplicados (contrabando de dos valores para una clave), basura final tras
el documento JSON, sustitutos solitarios / caracteres de control sin
escapar, enteros que pierden precisión (`9007199254740993`), una clave
`__proto__` esperando prototype pollution, un envelope con versión
desconocida, o un mensaje fuera de su ventana de validez — esperando que
algo de esto se cuele como "suficientemente cercano".

**Mitigación.**
- Parser JSON estricto: rechaza duplicados, datos finales, sustitutos
  solitarios, controles sin escapar, enteros inseguros (con chequeo BigInt
  exacto para que `1e21` siga siendo legal), números no finitos.
- Objetos de prototipo nulo: las claves mágicas son datos inertes.
- Orden de validación del envelope: parse → schema → timestamps → replay →
  certificado → firma. Cualquier fallo ⇒ error tipado antes de que se tome
  cualquier decisión de autoridad.
- Eventos/máquinas de estado desconocidos ⇒ `INVALID_TRANSITION` /
  `UNKNOWN_MACHINE`, nunca una aceptación no-op.

**Tests.** `canon-e01..e07`, `canon-a01/a04/a05`, `env-001..027`,
`sm-015/016/017`, `neg-007`; propiedades: el parser nunca lanza (2000
entradas fuzz), los recorridos de máquinas de estado nunca lanzan, los
estados terminales permanecen terminales.

---

## Cómo leer un fallo

Si un vector falla, la clasificación es:

1. **Bug de referencia** — la referencia TypeScript implementa mal la regla
   pretendida. Corrige la referencia, regenera los vectores, documenta en
   SPEC_AMBIGUITIES.
2. **Bug de vector** — el `expected` del vector fuente codifica una
   expectativa errónea. Corrige la fuente, regenera.
3. **Ambigüedad de spec** — la regla pretendida es genuinamente poco clara.
   NO adivines: registra en `SPEC_AMBIGUITIES.md`, elige la lectura
   conservadora (fail-closed) y marca el vector en consecuencia.
4. **Desacuerdo de segunda implementación** — investiga como (3); nunca
   resuelvas automáticamente a favor de ninguno de los dos lados.

La suite mide **reducción de superficie de ataque verificada**, no cantidad
de características. Una release que añade vectores y corrige un invariante
es progreso; una release que añade capacidades sin nueva cobertura de
invariantes no lo es.
