> **Idioma:** [English](../THREAT_MODEL.md) · Español

# THREAT_MODEL.md — NIDO

**Fecha:** 8 de octubre de 2026 (actualizado; original 27 de septiembre de 2026). **Alcance:** app Android (Expo SDK 57), 100% offline,
mensajería P2P por Bluetooth RFCOMM, memoria del agente en SQLite local.
**Fuera de alcance:** seguridad del OS Android en sí, del hardware, y de los modelos de IA
(auditoría de pesos: ver PRIVACY_MODEL.md).

Formato por amenaza: **activo → capacidad del atacante → ataque → mitigación → riesgo residual.**
Los identificadores (T-01…) enlazan con SECURITY_ROADMAP.md.

## Supuestos del modelo

1. El atacante **no** tiene la clave privada de identidad de la víctima salvo que se indique.
2. El QR se intercambia **en persona**; su integridad física es la raíz de confianza.
3. Bluetooth clásico expone MAC estable y nombre durante el discovery a observadores pasivos.
4. La base de datos de la app está **cifrada con SQLCipher** (DEK en el Android
   Keystore, fail-closed): el acceso al fichero por sí solo ya no entrega plaintext.

---

## T-01. Teléfono perdido (bloqueado)

- **Activo:** mensajes, contactos, memoria del agente, claves de identidad.
- **Capacidad:** acceso físico, sin credenciales; extracción lógica/forense básica.
- **Ataque:** conectar por USB / lector forense y copiar la base SQLite y ficheros.
- **Mitigación actual:** `allowBackup=false`; claves en SecureStore (cifradas por Keystore);
  la base de la app está cifrada con SQLCipher con DEK en el Keystore (fail-closed:
  sin la DEK la base es indistinguible de ruido).
- **Gap:** sin gate biométrico al abrir la app (H-6 pendiente).
- **Riesgo residual (hoy):** **BAJO-MEDIO** — un teléfono perdido bloqueado ya no expone
  el contenido de la base; las claves de identidad siguen protegidas por hardware. Tras H-6: BAJO.

## T-02. Teléfono robado desbloqueado

- **Activo:** todo lo anterior + sesiones activas en memoria.
- **Capacidad:** uso interactivo completo de la app.
- **Ataque:** leer mensajes, exportar datos, suplantar al usuario ante sus contactos.
- **Mitigación actual:** ninguna específica (la app abre sin autenticación).
- **Mitigación planificada:** H-6 (biometría al abrir + re-auth tras inactividad); M-1 (FLAG_SECURE
  no ayuda aquí, pero las confirmaciones H-4/M-3 sí para acciones destructivas).
- **Riesgo residual (hoy):** **ALTO**. Tras H-6: MEDIO (ventana entre desbloqueo y re-auth;
  un atacante con el dedo del usuario o coerción sigue entrando — fuera del modelo).

## T-03. Malware local / app maliciosa en el mismo dispositivo

- **Activo:** ficheros de la app, memoria del proceso, clipboard, notificaciones.
- **Capacidad:** ejecución como otra app (sandbox Android), o como root (ver T-04).
- **Ataque:** leer la DB, esnifar notificaciones, leer el clipboard, overlay sobre la app.
- **Mitigación actual:** sandbox de Android; `allowBackup=false`; notificaciones — *pendiente de auditar
  contenido*.
- **Mitigación planificada:** C-1 (la DB cifrada resiste a lectores con permiso de ficheros),
  M-1 (notificaciones sin contenido, clipboard sin secretos), H-5 (menos deps = menos riesgo
  de supply chain dentro del propio APK).
- **Riesgo residual:** MEDIO. Un malware con accesibilidad o root derrota cualquier defensa
  de app; el objetivo es que **no baste con leer ficheros**.

## T-04. Dispositivo rooteado / hooking (Frida)

- **Activo:** memoria del proceso, claves en uso.
- **Capacidad:** lectura/escritura total del dispositivo, bypass de checks client-side.
- **Ataque:** dumpear la clave maestra de SQLCipher de la RAM, hookear el prompt biométrico.
- **Mitigación:** detección **advisory** (M-2): avisar y endurecer (no cachear la clave maestra,
  re-auth frecuente). **No bloquear** (no es DRM). La biometría como booleano es hookable:
  la garantía real exige KEK con `setUserAuthenticationRequired` (FUTURO).
- **Riesgo residual:** **ALTO por diseño** — contra root local no hay defensa de app que valga;
  se documenta honestamente en lugar de prometer lo imposible.

## T-05. Atacante Bluetooth pasivo (observador cercano)

- **Activo:** metadatos (quién habla con quién, cuándo, cuánto).
- **Capacidad:** radio pasiva durante el discovery/conexión, sin interactuar.
- **Ataque:** correlacionar MACs estables con personas/lugares; inferir grafo social por
  patrones de conexión; leer nombres de dispositivo ("Galaxy de María").
- **Mitigación actual:** ninguna (nombre del dispositivo por defecto).
- **Mitigación planificada:** M-5 (nombre genérico rotatorio por sesión de discovery,
  discovery explícito con timeout, documentado en UX). El contenido va cifrado (no legible).
  El MAC nunca es identidad (regla de arquitectura).
- **Riesgo residual:** MEDIO. El MAC clásico **no se puede ocultar** (es estable por diseño
  del protocolo); la mitigación reduce la *legibilidad humana*, no la *observabilidad radio*.

## T-06. MITM activo en Bluetooth

- **Activo:** confidencialidad e integridad de la conversación.
- **Capacidad:** radio activa: interceptar, modificar, reinyectar frames; presentarse como peer.
- **Ataque:** sustituir la efímera del HELLO para forzar una clave de sesión conocida;
  alterar frames.
- **Mitigación actual:** HELLO v3 firmado + CONFIRM v1 con Ed25519 ligada al QR
  (IMPLEMENTED + AUTOMATED TESTED); la firma cubre `(pk|eph|nonce|ts)` — sustituir
  el efímero invalida la firma; clave de sesión vía HKDF-SHA512 (RFC 5869) sobre
  DH efímero-efímero + nonces canónicos; frames bajo XSalsa20-Poly1305 (AEAD) —
  la manipulación se descarta en silencio; las firmas de negociación
  (PROPOSE/ACCEPT/COUNTER/DECLINE) se anclan al `contact.sigPkHex` establecido
  por QR, no a la clave auto-declarada.
- **Tests:** `nativeTransport.test.ts` (MITM: sustitución de efímero; firma forjada),
  `adversarial.test.ts` (ciphertext corrupto, truncado, basura),
  tests de anclaje de negociación (PROPOSE/ACCEPT con clave no anclada rechazados, fail-closed).
- **Riesgo residual:** BAJO contra MITM de red. **No cubre** endpoint comprometido ni QR
  sustituido físicamente sin verificación de huella (ver T-08).

## T-07. Replay

- **Activo:** frescura de la sesión; cola de mensajes.
- **Capacidad:** capturar y reinyectar HELLOs y frames válidos.
- **Ataque:** reinyectar un HELLO para resucitar una sesión y desviar la cola; reinyectar
  un frame de chat para duplicar un mensaje.
- **Mitigación actual:** nonces frescos de 16 B por handshake ligados a la KDF (un HELLO
  repetido deriva una clave **distinta**); liveness: la cola solo se vacía hacia sesiones
  que produjeron un frame válido (el atacante no conoce la clave efímera y no puede
  producir `session_confirm`); ids de mensaje únicos con `seenIds` + deduplicación
  persistente en DB (sobrevive a reinicios).
- **Tests:** replay con ruta viva, cooldown ante HELLO duplicado en conexión nueva,
  nonces distintos → claves distintas, duplicado persistente.
- **Nota (red-team 2026-09-27):** un HELLO reinyectado >10 s después del cooldown sustituye
  la sesión viva por una fantasma sin liveness → DoS de disponibilidad (los frames reales
  fallan el AEAD). Sin impacto en confidencialidad. Mitigación: H-8 — **IMPLEMENTADO**:
  la ruta y la sesión se establecen solo tras un CONFIRM válido que prueba liveness
  en esta conexión (`session_confirm` bajo la clave derivada).
- **Riesgo residual:** BAJO.

## T-08. QR malicioso / sustitución física del QR

- **Activo:** raíz de confianza (la spk del contacto).
- **Capacidad:** pegar un QR propio sobre el QR legítimo; generar un QR con formato válido
  pero claves del atacante.
- **Ataque:** la víctima empareja la clave del atacante creyendo que es su contacto.
- **Mitigación actual:** el QR se verifica en persona; la huella (fingerprint) se muestra para
  verificación verbal; `pairWith` rechaza el propio código y payloads malformados/grandes.
- **Gap:** si el usuario no verifica la huella, la sustitución física no se detecta.
- **Mitigación planificada:** H-4 (flujo de verificación explícito: mostrar huella en lenguaje
  humano y exigir confirmación antes de guardar el contacto).
- **Riesgo residual:** MEDIO (depende del comportamiento del usuario; es inherente a
  cualquier trust-on-first-sight físico).

## T-09. Peer comprometido

- **Activo:** confidencialidad futura de la conversación.
- **Capacidad:** control total del dispositivo del contacto.
- **Ataque:** leer mensajes futuros; suplantar al contacto ante la víctima.
- **Mitigación actual:** forward secrecy del contenido pasado (efímeros por sesión: comprometer
  la identidad **después** no descifra sesiones pasadas — ver CRYPTO_ARCHITECTURE.md).
- **Gap:** sin post-compromise security: con la clave de firma del peer, el atacante puede
  seguir suplantándolo en futuros handshakes hasta que la víctima rote/re-empareje.
- **Mitigación planificada:** H-7 (rotación y revocación en un gesto, re-emparejamiento por QR).
- **Riesgo residual:** MEDIO-ALTO (inherente a mensajería sin servidor: no hay CRL central;
  la recuperación es social, por QR).

## T-10. Cambio de identity key del contacto (legítimo o ataque)

- **Activo:** continuidad de la confianza.
- **Capacidad:** el peer reinstala la app (nueva clave) o un atacante intenta el rollback.
- **Ataque:** hacer pasar una clave nueva como legítima, o reinyectar una clave antigua
  después de una rotación (rollback de identidad).
- **Mitigación actual:** fail-closed (la firma no verifica → conexión rechazada).
- **Gap:** el mensaje de error no distingue "posible ataque" de "tu contacto reinstaló la app";
  no hay protección explícita contra rollback a una spk antigua ya vista.
- **Mitigación planificada:** H-4 (advertencia visible en lenguaje humano + re-verificación por
  QR; pin de la spk más reciente y rechazo de spks anteriores).
- **Riesgo residual (hoy):** MEDIO (el rechazo es seguro, pero la UX empuja al usuario a
  re-escanear sin verificar, lo que anula la protección).

## T-11. Archivo malicioso (importación, modelo de voz/IA, backup)

- **Activo:** integridad del proceso, datos.
- **Capacidad:** entregar un fichero que la app procesa (modelo, documento, backup).
- **Ataque:** modelo con SHA distinto (sustitución), backup manipulado, documento que explota
  un parser.
- **Mitigación actual:** parcial (límites de tamaño en QR/framing; parsers defensivos en P2P).
- **Mitigación planificada:** hash pinneado y verificación antes de cargar cada modelo
  (whisper/STT, TTS, LLM); validación estricta de todo input (QR, HELLO, frames, ficheros);
  ningún parser con formato complejo sin límites.
- **Riesgo residual:** MEDIO hasta cerrar la verificación de modelos.

## T-12. Dependencia comprometida (supply chain)

- **Activo:** integridad del build y del runtime.
- **Capacidad:** publicar versión maliciosa de un paquete; typosquatting; takeover de maintainer.
- **Ataque:** exfiltrar claves o mensajes desde dentro de la app.
- **Mitigación actual:** lockfile commiteado; 38 dependencias directas.
- **Mitigación planificada:** H-5 (gitleaks, `min-release-age=3`, `npm audit signatures`,
  SBOM CycloneDX por release, osv-scanner offline); C-3 (sacar tweetnacl abandonada);
  checklist de vetting para nuevas deps (2+ red flags → alternativa/inline).
- **Riesgo residual:** MEDIO (npm audit no ve malware; Socket.dev solo bajo demanda por ser SaaS).

## T-13. Máquina de build comprometida

- **Activo:** integridad del APK que instala el usuario.
- **Capacidad:** modificar el código durante el build o firmar con otra clave.
- **Ataque:** APK troyanizado con la firma legítima.
- **Mitigación actual:** `withReleaseSigning.js` (la clave de firma vive en `~/.gradle`, nunca en el repo).
- **Mitigación planificada:** M-6 (reproducible builds: pinning + `SOURCE_DATE_EPOCH` + doble build
  byte-idéntico); publicar SHA-256 del APK (FUTURO, modelo F-Droid).
- **Riesgo residual:** MEDIO-ALTO (sin reproducible builds no hay forma independiente de
  verificar que el APK corresponde al código fuente).

## T-14. Adversario cuántico futuro (harvest-now-decrypt-later)

- **Activo:** confidencialidad a largo plazo de conversaciones capturadas hoy.
- **Capacidad:** capturar tráfico Bluetooth hoy; computador cuántico criptográficamente
  relevante en el futuro.
- **Ataque:** descifrar retroactivamente las sesiones X25519.
- **Mitigación actual:** ninguna específica (X25519 es vulnerable a HNDL en teoría).
- **Contexto honesto:** el modelo HNDL es más débil en Bluetooth que en Internet (requiere
  proximidad física durante la sesión para cosechar). No es la amenaza prioritaria frente a
  T-01/T-02/T-03.
- **Mitigación planificada:** X-1 (híbrido X25519+ML-KEM-768, activación condicionada a
  implementación auditada); cripto-agilidad desde ya (versión + suite en el cable).
- **Riesgo residual:** MEDIO (aceptado y documentado; no se promete "quantum-proof").

## T-15. Extracción forense (laboratorio)

- **Activo:** todo lo persistente.
- **Capacidad:** desoldar memoria, bypass de bloqueo, exploits forenses comerciales.
- **Ataque:** lectura directa de flash.
- **Mitigación:** C-1 + C-2 (con StrongBox/TEE, la clave no sale del hardware; la DB es
  indistinguible de aleatoria sin ella). Borrado seguro: `deleteIdentity` elimina semillas;
  el borrado físico en flash con wear-leveling no se puede garantizar — se documenta.
- **Riesgo residual:** MEDIO con C-1/C-2 (un laboratorio con exploit de TEE sigue siendo
  un riesgo; fuera del modelo para un usuario normal).

## T-16. Shoulder surfing / miradas ajenas

- **Activo:** contenido en pantalla, QR de emparejamiento.
- **Capacidad:** observación visual casual.
- **Ataque:** leer mensajes por encima del hombro; fotografiar el QR de pairing.
- **Mitigación:** H-6 (biometría al abrir), M-1 (FLAG_SECURE en pantallas sensibles),
  notificaciones sin contenido.
- **Riesgo residual:** BAJO-MEDIO (el QR fotografiado a distancia es un vector real:
  el emparejamiento debe hacerse en entorno controlado).

## T-17. Fuga por notificaciones / clipboard / screenshots

- **Activo:** texto de mensajes, códigos, huellas.
- **Capacidad:** otra app (Notification Listener), lectura de clipboard, malware de screenshots.
- **Ataque:** el texto del mensaje aparece en la notificación visible en pantalla bloqueada;
  un secreto copiado queda en el clipboard global.
- **Mitigación planificada:** M-1 (notificaciones genéricas, `EXTRA_IS_SENSITIVE` + limpieza
  de clipboard, FLAG_SECURE selectivo).
- **Riesgo residual (hoy):** MEDIO (pendiente de auditar qué muestra hoy cada notificación).

## T-18. DoS por radio / batería

- **Activo:** disponibilidad.
- **Capacidad:** proximidad radio.
- **Ataque:** flood de HELLOs/frames basura para agotar batería o bloquear el handshake.
- **Mitigación actual:** cooldown de handshake (10 s por peer), timeout de 15 s, frames
  malformados descartados sin respuesta, límite de 256 KiB por frame; **rate limit
  de handshakes entrantes: máx. 5 inicios por MAC cada 60 s, verificado antes de
  generar el efímero y firmar** (un dispositivo cercano no puede quemar CPU/crypto
  de la víctima a bajo costo).
- **Riesgo residual:** BAJO-MEDIO (el Bluetooth es inherentemente molestable por radio;
  no se gasta batería en crypto cara antes de validar barato: primero versión/tamaño,
  la firma Ed25519 solo tras lookup de contacto).

## T-19. Peer emparejado malicioso (ataques de negociación / delegación)

- **Activo:** las autorizaciones de la víctima (grants de tareas, memoria, acciones
  limitadas por scope).
- **Capacidad:** emparejado por QR; claves válidas de identidad y firma; puede enviar
  frames arbitrarios válidos a nivel protocolo; las firmas verifican (el atacante
  principal en las rondas red-team de octubre 2026).
- **Ataque:** swap de propuesta (re-PROPOSE del mismo `negotiationId` con scopes
  escalados mientras la víctima lee la tarjeta); forja de negociación con clave
  auto-generada tras compromiso de clave de sesión; replay de token de delegación
  entre sesiones; envenenamiento de memoria del peer (`task:remember` inyectando
  instrucciones persistentes en el contexto del agente del dueño); loopjacking
  (sustituir el payload aprobado entre aprobación y ejecución); agotamiento de
  memoria con aprobaciones pendientes ilimitadas.
- **Mitigación actual (todo IMPLEMENTED + AUTOMATED TESTED, octubre 2026):**
  PROPOSEs con `negotiationId` duplicado se rechazan fail-closed con reserva
  **sincrónica** del ID antes del primer await (cierra el bypass por concurrencia);
  firmas de negociación ancladas al `contact.sigPkHex` establecido por QR; tokens
  de delegación ligados a la sesión de transporte (verificación bidireccional
  estricta de `sessionTag`); ApprovalGate liga la aprobación humana a los bytes
  exactos mostrados (hash re-verificado al aprobar, timeout = denegar, un solo
  consumo, liveness re-verificado sincrónicamente, tope por peer con barrido de
  expirados, hash/tamaño/preview del documento en la tarjeta); facts de origen
  peer fuera del contexto de conversación del dueño y `remember_fact` exige
  confirmación humana con contenido no confiable (fail-closed sin UI);
  firewall de scopes limita la ejecución delegada a los tres scopes v1 de forma
  estructural, no por prompting.
- **Gap:** el feature flag de delegación está OFF (son rutas latentes endurecidas);
  la tarjeta de aprobación humana sigue siendo el eslabón más débil — lo que la
  tarjeta no muestra se confía implícitamente.
- **Riesgo residual:** **MEDIO** (los controles del protocolo aguantan; el factor
  humano es irreducible).

## T-20. RCE en el stack Bluetooth bajo la capa de la app (pre-auth, sin interacción)

- **Activo:** todo el dispositivo (y con él, todas las garantías de la capa de app).
- **Capacidad:** radio cercana; exploits en `com.android.bluetooth`
  (CVE-2025-0075 / CVE-2025-22403 / CVE-2025-22410: RCE use-after-free en SDP).
- **Ataque:** comprometer el stack Bluetooth antes de cualquier emparejamiento o handshake.
- **Mitigación actual:** ninguna posible en la app — la crypto E2E de la capa de app
  (claves de sesión X25519 independientes) hace irrelevantes los ataques de clave
  de enlace (KNOB, BIAS) para la confidencialidad, pero un RCE del stack compromete
  el *dispositivo*, y ahí las garantías de la app colapsan.
- **Mitigación operativa:** nivel mínimo de parche de seguridad Android **2025-03-05**
  documentado (ver notas de seguridad del transporte P2P en `docs/PRIVACY.md`).
- **Riesgo residual:** **MEDIO** (aceptado; mitigado operativamente, no en código).

## Matriz de riesgo residual actual

| Amenaza | Riesgo hoy | Tras roadmap CRITICAL/HIGH |
|---|---|---|
| T-01 teléfono perdido | BAJO-MEDIO (C-1 hecho) | BAJO (con H-6) |
| T-02 robado desbloqueado | ALTO | MEDIO |
| T-03 malware local | MEDIO-ALTO | MEDIO |
| T-04 root/hooking | ALTO | ALTO (aceptado, documentado) |
| T-05 observador BT pasivo | MEDIO | MEDIO (MAC estable: irreducible) |
| T-06 MITM | BAJO | BAJO |
| T-07 replay | BAJO | BAJO |
| T-08 QR malicioso | MEDIO | MEDIO (factor humano) |
| T-09 peer comprometido | MEDIO-ALTO | MEDIO |
| T-10 cambio de identity key | MEDIO | BAJO (con H-4) |
| T-11 archivo malicioso | MEDIO | BAJO (con hash pinneado) |
| T-12 supply chain | MEDIO | MEDIO-BAJO |
| T-13 build machine | MEDIO-ALTO | MEDIO (con M-6) |
| T-14 cuántico futuro | MEDIO | MEDIO-BAJO (con X-1) |
| T-15 forense | MEDIO (C-1 hecho) | MEDIO |
| T-16 shoulder surfing | MEDIO | BAJO-MEDIO |
| T-17 notif/clipboard | MEDIO | BAJO |
| T-18 DoS radio | BAJO-MEDIO | BAJO-MEDIO |
| T-19 peer emparejado malicioso | MEDIO | MEDIO (factor humano irreducible) |
| T-20 RCE stack BT (bajo la app) | MEDIO | MEDIO (operativo: nivel de parche) |

**Lectura ejecutiva:** el endurecimiento de octubre 2026 + dos rondas red-team
movieron el riesgo residual del protocolo de forma decisiva: los controles de
T-06/T-07/T-18/T-19 están IMPLEMENTED + AUTOMATED TESTED. El ALTO restante hoy
es T-02 (teléfono robado **desbloqueado** — se corrige con H-6 biometría, el
siguiente hito que más riesgo elimina por esfuerzo). T-04 (root) queda ALTO por
diseño y documentado. T-20 se acepta operativamente (nivel de parche del
dispositivo). Nada aquí está AUDITADO EXTERNAMENTE — ver
`docs/es/security/AUDITS_2026-10.md` para qué cubrieron las dos rondas
adversariales internas y qué excluyeron explícitamente.
