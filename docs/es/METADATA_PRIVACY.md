> **Idioma:** [English](../METADATA_PRIVACY.md) · Español

# NIDO Metadata Privacy — Investigación y diseño (borrador v0.1)

**Estado:** investigación y diseño. NO implementar todavía.

**Posición oficial:** no se adopta una solución solo porque maximice
anonimato. NIDO prioriza **privacidad práctica y verificable**: garantías
que un usuario puede entender, un auditor puede comprobar y un teléfono
puede pagar en batería.

**Principios inviolables** (no negociables en ninguna propuesta de este
documento):

- `TRANSPORT ≠ TRUST`.
- El relay **nunca** obtiene: claves privadas (de identidad, dispositivo o
  sesión), plaintext de ningún envelope, capabilities privadas,
  permisos/políticas, ni autoridad de ningún tipo.
- Fail-closed: si una protección de metadatos no puede aplicarse, el
  mensaje no sale por una vía más débil en silencio.
- Sin downgrade silencioso de seguridad.

Este documento profundiza la pregunta abierta del relay
(`AGENT_PROTOCOL.md` §14.7, `TRANSPORT_ARCHITECTURE.md` §6) y el hallazgo
RT-8 del red-team.

---

## 1. Modelo de amenaza de metadatos

El contenido está protegido: todo envelope viaja dentro del canal AEAD de
la sesión y firmado a nivel de envelope (`AGENT_PROTOCOL.md` §4). El
adversario de metadatos no lee contenido; **observa el sobre**.

### 1.1 Qué aprende hoy un relay honest-but-curious

Por cada mensaje que enruta, el relay ve inevitablemente:

- **Cuándo:** timestamp de llegada/salida.
- **Cuánto:** tamaño del ciphertext (≈ tamaño del plaintext + overhead
  fijo del AEAD; el tamaño filtra estructura: un `TASK_PROGRESS` no mide
  lo mismo que un `file.send`).
- **Hacia dónde:** identificador de destino. Hoy: hash estable de la clave
  pública de identidad del destinatario (RT-8).
- **Desde dónde:** el endpoint de transporte de origen (socket/IP en el
  caso Internet; enlace local en Bluetooth/LAN).
- **Patrón en el tiempo:** frecuencia, horarios, ráfagas, silencios.

Con eso puede inferir, sin leer nada: grafo de contacto aproximado
("X habla con Y"), ritmos de actividad ("X e Y coordinan cada mañana"),
y cambios de comportamiento (un silencio súbito también es información).
**Nunca**: plaintext, claves, capabilities, políticas ni autoridad.

### 1.2 Qué puede hacer un relay malicioso (además de lo anterior)

- Descartar, retrasar, duplicar o reordenar (cubierto por idempotencia y
  duplicados, `AGENT_PROTOCOL.md` §9; como máximo degrada disponibilidad).
- Censura selectiva por destino.
- Correlación temporal fina entre origen y destino.
- Intentar suprimir revocaciones → **neutralizado**: la revocación también
  viaja en contacto directo y los certificados expiran (RT-9).

No puede: leer, forjar (firmas de dispositivo que no posee), ni convertir
su posición en privilegios (RT-9).

### 1.3 Observador de radio (Bluetooth/LAN)

Ve presencia de dispositivos y patrones de conexión locales. Mitigado
parcialmente con identificadores efímeros de discovery
(`TRANSPORT_ARCHITECTURE.md` §5); el alcance físico limita al adversario.

### 1.4 Qué es fundamentalmente irreducible (honestidad)

Sin infraestructura pesada, **tres fugas no se eliminan**:

1. **El hecho de la comunicación.** Si A envía a B por un relay, alguien
   que observe ambos extremos correlaciona por tiempo. Eliminar esto exige
   retardos artificiales + tráfico de cobertura (cover traffic): batería y
   ancho de banda que un teléfono personal no puede pagar de forma
   continua.
2. **El tamaño aproximado.** El padding a tamaños fijos lo reduce pero no
   lo elimina (y delata la clase de mensaje por frecuencia); el padding
   agresivo desperdicia batería/radio.
3. **La existencia del grafo social a nivel de red.** El primer contacto
   (QR, introducción) y el enrutado necesitan *algún* identificador
   direccionable. Se puede rotar y opacar, pero no hacer desaparecer.

**Conclusión honesta:** NIDO garantiza confidencialidad de contenido,
autenticidad y cero fuga de autoridad frente al relay. La minimización de
metadatos es por capas y best-effort; la *desvinculación perfecta*
requiere una infraestructura (operadores de mixes, tráfico de cobertura
permanente) que NIDO explícitamente no quiere. Este documento diseña lo
que sí es práctico.

---

## 2. Conceptos investigados

### 2.1 Opaque routing identifiers

**Idea:** el relay enruta por identificadores opacos en lugar del hash
estable de la identidad. Dos variantes:

- (a) `route_id = H(identity_pubkey || epoch_salt)` con épocas
  sincronizadas por reloj (p. ej. rotación diaria).
- (b) **rendezvous IDs por par**: `KDF(session_key, "rendezvous" ||
  epoch)`, acordados en el handshake. Cada par A↔B usa un identificador
  distinto, inútil para correlacionar "quién habla con quién" a escala
  del relay.

**Evaluación:** (b) es estrictamente mejor: ni siquiera dos pares
distintos comparten identificador, y no requiere sincronizar épocas
globales. Coste bajo: una derivación por época. El relay sigue viendo
tamaño/tiempo, pero pierde el grafo estable. Requiere que el destinatario
registre sus rendezvous IDs vigentes en el relay (el registro mismo es
un ciphertext opaco para el relay si se hace sobre la sesión… en la
práctica, el registro se hace en el handshake directo o vía el relay con
un token — ver §2.5).

### 2.2 Rotating identifiers (discovery y sesión)

**Idea:** ningún identificador de larga duración en el medio:

- **Discovery (radio):** el nombre/anuncio Bluetooth y el registro mDNS
  rotan cada N minutos con valores aleatorios; el vínculo con la identidad
  solo se revela en el handshake autenticado (ya sugerido en
  `TRANSPORT_ARCHITECTURE.md` §5).
- **Sesión:** tras el handshake, los endpoints usan **alias de sesión
  efímeros** hacia el relay en lugar de cualquier identificador estable
  (RT-8, fix parcial ya adoptado en el protocolo).

**Evaluación:** coste casi nulo, ganancia real contra tracking pasivo por
radio y contra perfilado longitudinal por el relay. No protege contra
correlación temporal activa. Es la capa base: barata, verificable,
sin infraestructura.

### 2.3 Sealed-sender-like concepts (remitente sellado)

**Idea (inspirada en Signal):** el relay entrega al destinatario sin poder
determinar quién envió. En NIDO, la identidad del remitente ya viaja
*dentro* del ciphertext de la sesión; lo que el relay ve es el **origen
de transporte** (IP/socket). Un "sealed sender" real exigiría que el
origen de transporte tampoco sea vinculable: conexión anónima, hop
intermedio, o envío a través del propio destinatario.

**Evaluación honesta:** a mitad de camino no sirve de mucho — si el relay
ve la IP de origen, el "sellado" criptográfico es teatro. La versión
práctica para NIDO: el remitente puede optar por enviar vía un **contacto
mutuo como forwarder opaco** (ya previsto: introducción por contactos),
donde el forwarder solo ve ciphertext y un rendezvous ID. Ganancia
moderada, solo cuando el usuario lo pide; complejidad media (reenvío con
su propia idempotencia y expiración). No es un default: la mayoría del
tráfico NIDO es entre contactos conocidos donde el grafo ya es mutuo.

### 2.4 Private contact discovery

**Idea:** descubrir qué contactos están alcanzables (o presentarse a un
nuevo contacto) sin revelar el grafo social a un directorio.

- **PSI/PIR contra un directorio:** criptografía pesada (private set
  intersection, private information retrieval), requiere un servidor de
  directorio, rondas interactivas, coste de batería/computación alto.
- **Introducción por contacto mutuo:** A pide a B (contacto común) que
  presente a C; B solo revela lo que A y C consienten. Sin directorio
  global, sin servidor.
- **QR presencial:** el primer contacto no deja rastro en ninguna red.

**Evaluación:** para la red NIDO (contactos elegidos a mano, QR como
raíz de confianza), la introducción por contacto mutuo + QR cubre el
caso de uso real sin infraestructura. PSI/PIR resuelven un problema que
NIDO no tiene (directorio global). **Rechazado** salvo que un caso de
uso futuro lo exija explícitamente.

### 2.5 Blind routing tokens (tokens ciegos de enrutado)

**Idea (firmas ciegas, Chaum):** el relay (o el destinatario) emite tokens
de enrutado con firma ciega: el emisor obtiene un token sin que el emisor
pueda vincular *emisión* con *uso*. Al enviar, presenta el token; el relay
verifica la firma pero no sabe para quién se emitió ni cuándo.

**Evaluación:** desvincula "quién pidió capacidad de envío" de "quién
envió qué", cerrando el perfilado por emisión de tokens. Además los tokens
son un mecanismo **anti-DoS natural**: sin token válido no hay enrutado
(complementa el rate limiting de `AGENT_PROTOCOL.md` §8). Costes: el relay
debe operar un emisor de firmas ciegas (esquema estándar y auditado,
p. ej. RSA ciego — sin criptografía propia), gestión de expiración y
doble-uso de tokens, y una ronda extra de emisión. No oculta
tamaño/tiempos. **Candidato serio para fase 2**: ganancia real,
infraestructura mínima (el propio relay, sin terceros), complejidad
moderada.

### 2.6 Mixnet / onion routing

**Idea:** retardos, reordenado y múltiples saltos con capas de cifrado
(estilo Nym/Tor) para resistir adversarios globales pasivos.

**Evaluación honesta:**

- *Privacidad ganada:* alta contra adversario de red global, la mejor de
  esta lista.
- *Latencia:* segundos a minutos por mensaje — incompatible con
  negociación interactiva de tareas.
- *Batería:* keep-alives, cover traffic y múltiples saltos; inasumible
  como default en móvil.
- *Complejidad:* enorme (selección de mixes, directorios, reputación,
  sincronización).
- *DoS:* los mixes son frágiles y centralizables; ¿quién opera los nodos?
  Introduce la dependencia de infraestructura que NIDO rechaza por
  principio ("ningún componente asume un servidor").
- *Tradeoff final:* maximiza anonimato a costa de todo lo demás.

**Rechazado explícitamente** para NIDO: el coste (latencia, batería,
infraestructura, complejidad) no se justifica para una red de agentes
personales entre contactos conocidos, donde el adversario realista es un
relay curioso o un observador local, no un adversario global pasivo.
Queda como investigación, no como dirección.

---

## 3. Matriz comparativa

| Concepto | Privacidad ganada | Latencia | Batería | Complejidad | Resistencia DoS | Infraestructura |
|---|---|---|---|---|---|---|
| Rendezvous IDs por par (§2.1b) | Alta contra perfilado longitudinal del relay | Nula | Despreciable | Baja | Neutra | Ninguna |
| Rotating identifiers (§2.2) | Media-alta (radio + longitudinal) | Nula | Despreciable | Baja | Neutra | Ninguna |
| Sealed-sender vía forwarder (§2.3) | Moderada, solo bajo demanda | +1 salto | Baja | Media | Empeora levemente (abuso del forwarder) | Ninguna (usa contactos) |
| PSI/PIR discovery (§2.4) | Alta (pero problema ajeno) | Alta | Alta | Alta | Pobre | Servidor de directorio — **rechazado** |
| Blind routing tokens (§2.5) | Media-alta (desvincula emisión/uso) | +1 ronda de emisión | Baja | Media | **Mejora** (token = anti-spam) | Emisor en el propio relay |
| Mixnet/onion (§2.6) | Máxima | Segundos-minutos | Alta | Muy alta | Pobre | Operadores de mixes — **rechazado** |

---

## 4. Recomendación por fases

### Fase 1 — Dirección de diseño ahora (sin infraestructura, coste ~nulo)

1. **Rendezvous IDs por par** como identificador de enrutado hacia el
   relay, derivados en el handshake (`KDF(session_key, "rendezvous" ||
   epoch)`), rotados por época. Sustituyen al hash estable de identidad
   (cierra el residual de RT-8 en lo práctico).
2. **Alias de sesión efímeros** tras el handshake + **rotación de
   identificadores de discovery** (radio/mDNS) cada N minutos.
3. El relay sigue siendo **ciphertext-only y reemplazable**; estas capas
   no le dan ni le quitan autoridad.

Nada de esto requiere cambiar los principios ni el envelope: vive en la
capa de sesión/transporte.

### Fase 2 — Investigación abierta (decidir con un caso de uso real)

4. **Blind routing tokens**: prototipar el emisor de firmas ciegas en el
   relay y medir coste real de la ronda de emisión antes de comprometerse.
   Su valor anti-DoS puede justificarlo por sí solo.
5. **Sealed-sender bajo demanda** vía forwarder (contacto mutuo): solo si
   aparece un caso de uso que lo pida; nunca como default.

### Rechazado explícitamente (con justificación)

6. **Mixnet/onion de propósito general:** latencia de segundos-minutos,
   batería, complejidad y dependencia de operadores de nodos contradicen
   los principios (sin servidores asumidos, offline-first, privacidad
   práctica). El adversario que lo justificaría (global pasivo) no es el
   adversario de diseño de NIDO.
7. **Directorio global con PSI/PIR:** resuelve descubrimiento a escala de
   miles de millones; NIDO descubre por QR e introducciones consentidas.
   Infraestructura y coste sin beneficio correspondiente.
8. **Cover traffic permanente / padding agresivo:** batería y radio
   desperdiciadas contra un adversario que el modelo de amenaza no exige.
   Padding leve y oportunista (p. ej. redondeo de tamaños por clases) sí
   es aceptable y barato; el documento lo permite sin exigirlo.

---

## 5. Lo que el relay nunca obtiene (reafirmación)

Aunque se equivoque la configuración de metadatos, la arquitectura
garantiza por construcción:

- Sin claves privadas de ningún nivel (identidad, dispositivo, sesión).
- Sin plaintext: AEAD de sesión + firma de envelope; el relay no posee
  claves.
- Sin capabilities privadas: el `CAPABILITY_RESPONSE` anuncia
  nombre/versión/descripción pública; el inventario real nunca sale.
- Sin autoridad: el relay no firma, no delega, no evalúa políticas; un
  mensaje "del relay" no es un mensaje válido en el protocolo.

---

## 6. Tests futuros de conformance (metadata)

- El log de un relay de pruebas no contiene ningún byte parseable como
  envelope (fuzz contra el corpus de vectores).
- Dos épocas distintas producen `route_id` distintos para el mismo par;
  el relay no puede vincularlos sin la `session_key`.
- Rotación de identificadores de discovery: capturas de radio en t y t+N
  no se vinculan.
- Un token ciego usado no se vincula con su emisión (test de
  desvinculación con claves de prueba).

---

## 7. Preguntas abiertas

1. Longitud de época para rendezvous IDs: ¿horas o días? (Compromiso
   entre unlinkability y coste de re-registro ante el relay.)
2. ¿Quién emite los blind tokens si hay múltiples relays? ¿Federación de
   emisores o uno por relay?
3. ¿El forwarder (contacto mutuo) debe ser explícitamente consentido por
   el destinatario final, o basta el consentimiento del forwarder?
4. Padding por clases de tamaño: ¿qué granularidad es "barata y útil"
   (p. ej. potencias de 2 hasta 64 KiB)?
5. ¿Debe el usuario ver en Privacy Activity el relay usado y los
   identificadores vigentes? (Transparencia vs. complejidad de UI.)
6. Ante un adversario que controla *además* la red local (router
   doméstico comprometido), ¿qué capa adicional barata queda? (Respuesta
   probable: ninguna barata; documentarlo como límite aceptado.)
