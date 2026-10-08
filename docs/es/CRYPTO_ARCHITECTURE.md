> **Idioma:** [English](../CRYPTO_ARCHITECTURE.md) · Español
# CRYPTO_ARCHITECTURE.md — NIDO

**Fecha:** 8 de octubre de 2026 (actualizado; original 28 de septiembre de 2026).
**Protocolo vigente: handshake v3 + CONFIRM v1, KDF de sesión HKDF-SHA512.**
**Estado:** IMPLEMENTED + AUTOMATED TESTED (1985 tests). **No** PHYSICALLY TESTED
(dos dispositivos), **no** EXTERNALLY AUDITED.

Este documento describe con precisión el protocolo implementado hoy,
sus garantías, sus límites y la ruta de migración. No se afirma resistencia cuántica
ni auditoría externa: no existen. §4 se conserva como referencia v2; §4bis
describe el handshake R4 vigente (KDF, QR y framing sin cambios).

## 1. Versión del protocolo y domain separation

| Contexto | Dominio / versión | Uso |
|---|---|---|
| HELLO en el cable | `{t:"nido-hello", v:3}` (R4; §4bis) | `parseHello` rechaza `v != 3` antes de mutar ningún estado (corte duro, sin compat v1/v2). |
| Firma del HELLO | `"nido-hello-v3"` (prefijo del transcript) | Ed25519 sobre el transcript exacto de §4bis. |
| CONFIRM en el cable | `{t:"nido-confirm", v:1}` (R4; §4bis) | La ruta/sesión solo se establecen tras un CONFIRM válido. |
| KDF de sesión | `"nido-session-v2"` (salt), `"nido-session-key-v1"` (info) | HKDF-SHA512 (RFC 5869), 32 B de salida. Reemplazó el truncado directo de SHA-512 en octubre de 2026 (ver §12). |
| QR de emparejamiento | `"NIDO1:"` + `{v:2, app:"nido"}` | Raíz de confianza física. |
| Framing de sesión | `PROTOCOL_VERSION = 1` | `[u32 BE len][nonce 24 B][secretbox(JSON)]`, máx. 256 KiB. |

**No existe ningún otro contexto de firma ni de KDF en el sistema.** Una firma válida de
un contexto no puede reutilizarse en otro: los dominios son disjuntos y versionados.
Toda versión futura del protocolo exige bump explícito de `v` + tests negativos
(ver §9, política anti-downgrade).

## 2. Identidad

- **Clave de identidad de emparejamiento:** X25519 (`pk` de 32 B). Es el identificador
  estable del contacto (primary key en `p2p_contacts`).
- **Clave de firma de identidad:** Ed25519 (`spk` de 32 B, semilla de 32 B).
  **Separación de claves:** la misma clave nunca se usa para firmar y para DH.
  La Ed25519 solo firma HELLOs; la X25519 solo identifica (el DH de sesión usa
  **efímeras**, nunca la identidad).
- **Generación:** `generateSigningKeypair()` con CSPRNG (`expo-crypto` / `nacl.randomBytes`).
- **Almacenamiento:** la semilla Ed25519 (32 B) vive en SecureStore bajo la clave
  `nido_p2p_sign_sk` (cifrada por el Android Keystore; nunca en plaintext en el disco
  de la app, nunca en logs). La pública `spk` se publica en el QR.
- **Huella:** `fingerprint(pk)` legible para verificación verbal en persona.

## 3. Distribución y verificación de la signing public key (QR v2)

1. El QR contiene `NIDO1:{"v":2,"app":"nido","name","pk","spk"}` (`pk` = identidad X25519,
   `spk` = firma Ed25519). El encoder **siempre** genera v2.
2. El decoder acepta v1 para **lectura**, pero v2 exige `spk` válida (64 hex chars);
   un QR manipulado, truncado o sobredimensionado se rechaza sin crash.
3. `pairWith()` guarda `(pk, name, verified=1, sig_pk=spk)`. Rechaza el propio código.
4. **El QR es la raíz de confianza:** la `spk` almacenada es la única autoridad para
   aceptar HELLOs de ese `pk`. El handshake **nunca** confía en "el peer conoce el UUID"
   ni en la MAC Bluetooth: la identidad viene del `pk` firmado, no del transporte.

## 4. Handshake v2 (paso a paso)

Roles simétricos: cualquiera de los dos teléfonos puede iniciar (A = iniciador, B = receptor;
el protocolo no distingue).

1. **A → B (por el socket RFCOMM):** `HELLO = {t:"nido-hello", v:2, pk_A, eph_A, nonce_A, sig_A}`
   - `eph_A`: pública X25519 **efímera** recién generada (secreto solo en RAM).
   - `nonce_A`: 16 B aleatorios frescos por handshake.
   - `sig_A = Ed25519_sign(sk_A, transcript)`, con el **transcript exacto**:
     ```
     "nido-hello-v2" | hex(pk_A).toLowerCase() | hex(eph_A).toLowerCase() | hex(nonce_A).toLowerCase()
     ```
     separados por `|`, codificado en UTF-8. La firma liga la efímera y el nonce a la
     identidad verificada por QR.
2. **B verifica:**
   - `parseHello`: JSON válido, `t` correcto, `v == 2` (v1 → error "actualiza su app";
     otro → "versión desconocida"), formatos hex estrictos (64/64/32/128 chars).
   - `pk != mi_propia_pk` → rechazo (anti-reflection).
   - `findContactByPk(pk)` → debe existir (desconocido → rechazo + cierre).
   - `contact.sig_pk` debe existir (contacto legacy sin spk → rechazo fail-closed con
     instrucción de re-escanear el QR).
   - `Ed25519_verify("nido-hello-v2|pk|eph|nonce", sig, contact.sig_pk)` → si falla,
     rechazo ("posible ataque de intermediario") + cierre de la conexión.
   - Cooldown: si ya hay ruta viva con ese peer y el último handshake fue hace <10 s,
     el HELLO duplicado se rechaza sin sustituir la sesión.
3. **B → A:** su propio HELLO firmado (mismo procedimiento). Ambos lados verifican.
4. **Derivación de sesión (ambos lados):**
   ```
4. **Derivación de sesión (ambos lados), HKDF-SHA512 (RFC 5869)** —
   `deriveSessionKeyV2` (`src/p2p/crypto.ts`):
   ```
   DH   = X25519(mi_eph_secret, su_eph_public)
   IKM  = DH || nonce_min || nonce_max      (orden canónico por comparación de
                                            bytes: ambos lados derivan la misma
                                            clave sin importar quién inició)
   PRK  = HKDF-Extract(salt="nido-session-v2", IKM)
   K    = HKDF-Expand(PRK, info="nido-session-key-v1", 32)
   ```
   HMAC-SHA512 se implementa sobre el auditado `nacl.hash` (TweetNaCl no exporta
   primitiva HMAC). Los secretos intermedios (`DH`, input IKM) se limpian con
   `fill(0)` tras derivar, y el secreto efímero del llamante se borra in-place en
   **todas** las salidas del handshake (éxito, timeout, firma inválida,
   desconexión) — higiene de forward secrecy en memoria, verificada por tests.
   (Nota histórica: antes de octubre de 2026 este paso usaba
   `SHA-512(dominio || DH || nonces)[0:32]`; el corte de KDF es limpio — ambos
   peers deben correr el mismo código, y un mismatch falla cerrado en
   `session_confirm`, nunca de forma insegura.)
5. **Confirmación de sesión (liveness):** cada lado envía `session_confirm` (AEAD bajo K).
   La cola de mensajes **solo** se vacía hacia sesiones que produjeron al menos un frame
   válido (liveness). Un HELLO repetido por un atacante crea a lo sumo una sesión fantasma
   bajo la cual jamás llega un frame válido: ningún mensaje encolado se pierde en ella.

## 4bis. Handshake R4: HELLO v3 + CONFIRM (vigente; delta sobre §4)

R4 (2026-09-28) cierra el residual de secuestro de ruta B/F1: un HELLO por
sí solo jamás puede modificar la tabla de rutas. El KDF (`"nido-session-v2"`),
el emparejamiento QR y el framing (§5) no cambian.

1. **A → B:** `HELLO = {t:"nido-hello", v:3, pk_A, eph_A, nonce_A, ts_A, sig_A}`
   - `ts_A`: segundos Unix, firmado. Transcript exacto:
     ```
     "nido-hello-v3" | hex(pk_A).toLowerCase() | hex(eph_A).toLowerCase() | hex(nonce_A).toLowerCase() | ts_A
     ```
2. **B verifica** (fail-closed, en orden): JSON/forma válida; `t`/`v`
   (`v != 3` → rechazo antes de mutar estado); formatos hex estrictos;
   `pk != mi_propia_pk`; `|now - ts| ≤ 600` s (`HELLO_TS_SKEW_S`,
   provisional); el contacto existe con `sig_pk`;
   `Ed25519_verify("nido-hello-v3|pk|eph|nonce|ts", sig, contact.sig_pk)`;
   **claim atómico** de `(pk, nonce)` en la tabla SQLCipher persistente
   `hello_nonce_cache` — un único `INSERT`; un conflicto UNIQUE ES la
   señal de replay → rechazo. Después B envía su CONFIRM y no cambia nada
   más: **aún no hay ruta ni sesión.**
3. **B → A:** `CONFIRM = {t:"nido-confirm", v:1, pk_B, cn: nonce_B, pn: nonce_A, sig_B}`
   con `sig_B = Ed25519_sign("nido-confirm-v1|pk_B|cn|pn")`. (Y A → B
   simétricamente: `CONFIRM_A(cn=nonce_A, pn=nonce_B)`.) `cn` es siempre el
   nonce PROPIO del que envía el CONFIRM; `pn` es el nonce del receptor.
4. **A verifica el CONFIRM:** la identidad coincide con la `pk` del HELLO
   pendiente (mata la reflexión); `cn` == nonce del peer en ESTA conexión;
   `pn` == MI nonce fresco en ESTA conexión (transcript binding); la firma
   verifica con `contact.sig_pk`. **Solo entonces:** establece la ruta
   (`pkToMac`/`macToPk`) y deriva la sesión exactamente como en el paso 4
   de §4. Sin CONFIRM en 10 s (`CONFIRM_WAIT_MS`) → timeout fail-closed,
   conexión cerrada, sin ruta.
5. **Marcado simultáneo:** si ya existe una ruta confirmada con el peer en
   otro socket, ambos lados calculan
   `K = min(nonce_local, nonce_peer) ‖ max(nonce_local, nonce_peer)` por
   socket (lexicográfico, byte a byte) y conservan el de menor `K` —
   determinista sin importar el orden de llegada.

## 5. Sesión: lifetime, mensajes, anti-replay

- **Lifetime:** la sesión vive en RAM (`messenger.sessions`). Nace en `completeHandshake`,
  se **sustituye** por la del siguiente handshake con el mismo peer, y no se persiste.
  `handleDisconnect` no la borra de inmediato (el reintento de envío falla seguro y el
  mensaje queda en cola); el próximo handshake la reemplaza con clave nueva.
- **Mensajes:** `XSalsa20-Poly1305` (secretbox) con nonce aleatorio de 24 B por mensaje.
  (Migración pendiente a XChaCha20-Poly1305 con AAD: H-2.)
- **Anti-replay:** `nonce` fresco por handshake (la clave cambia aunque se repita el HELLO);
  `id` único por mensaje + `seenIds` en memoria + deduplicación persistente en DB
  (un reinicio no re-entrega); frames con AEAD inválida, destinatario incorrecto o
  remitente suplantado se descartan en silencio.
- **Tamaños:** frame máximo 256 KiB; mensaje de chat máximo 4000 chars; QR con límites.

## 6. Qué persiste y qué no

| Dato | Dónde | Cifrado hoy |
|---|---|---|
| Semilla Ed25519 identidad | SecureStore (`nido_p2p_sign_sk`) | Sí (Keystore) |
| Clave privada X25519 identidad | SecureStore | Sí (Keystore) |
| Contactos `(pk, name, sig_pk)` | SQLite `p2p_contacts` | **Sí** — SQLCipher, DEK en Android Keystore (alias `nido_db_key`), fail-closed |
| Mensajes (inbox/outbox) | SQLite `p2p_messages` | **Sí** — SQLCipher, misma DEK, fail-closed |
| Sesiones (clave K) | RAM | n/a (nunca en disco) |
| Efímeras y nonces de handshake | RAM | n/a (nunca en disco; borrados en todas las salidas del handshake) |
| `seenIds` anti-replay | RAM (+ DB para duplicados persistentes) | Parcial |

**Consecuencia:** la base de datos de la app está cifrada en reposo (hito C-1
completo). Sin la DEK del Keystore, la base es indistinguible de ruido.

## 7. Comportamiento ante cambio de identity key

- Si el peer cambia su clave (reinstalación legítima) o un atacante intenta suplantarlo,
  la firma del HELLO **no verifica** contra la `spk` almacenada → conexión rechazada,
  fail-closed. No hay aceptación silenciosa.
- **Gap conocido (H-4):** el error actual no distingue "posible ataque" de "tu contacto
  reinstaló la app", y no hay pin de "última spk vista" contra rollback. La UX debe guiar
  la re-verificación del QR **en persona**, en lenguaje humano, antes de sustituir la spk.

## 8. Si SecureStore/Keystore falla

- **Al firmar (iniciar handshake):** `getSigningKeypair()` propaga el error → el `connect()`
  / `onConnected` lo captura → evento `onError("No se pudo iniciar el handshake: …")`
  y la conexión se cierra al agotarse el timeout de 15 s. **Fallo limpio, sin crash,
  sin handshake a medias.**
- **Al verificar:** solo se necesita la `spk` **pública** del contacto (SQLite). Si la DB
  no abre, no hay handshake: fail-closed.
- **Si el Keystore se invalida** (p. ej. cambio de bloqueo en algunos dispositivos): las
  semillas se vuelven ilegibles → la identidad no puede firmar → hay que regenerar
  identidad y re-emparejar por QR. Es el comportamiento correcto (no hay forma segura
  de "recuperar" una clave que el hardware protege); la UX debe explicarlo (H-7).

## 9. Si una clave de identidad se compromete *después*

- **Contenido pasado:** PROTEGIDO (forward secrecy). Las sesiones usaron X25519
  **efímero**; la clave de identidad (firma) nunca participó en la derivación de K.
  Comprometer la Ed25519 después **no** descifra conversaciones pasadas.
- **Futuro:** NO PROTEGIDO (sin post-compromise security). Con la clave de firma, el
  atacante puede firmar HELLOs y suplantar al dueño ante sus contactos hasta que estos
  roten/revoquen (H-7). No existe "curación" automática: la recuperación es rotar la
  identidad y re-emparejar por QR en persona.
- **La firma Ed25519 comprometida no afecta a otros contextos:** no hay otros usos de
  esa clave (separación de claves, §2) y el dominio de firma es único (§1).

## 10. Política anti-downgrade

1. **Ninguna versión insegura se acepta en silencio.** v1 se rechaza con mensaje explícito
   de actualización; versión desconocida se rechaza.
2. Toda versión nueva del protocolo exige: bump de `v`, entrada en la tabla de §1,
   tests negativos de rechazo de la versión anterior, y nota de migración (o rechazo
   permanente si la anterior era insegura).
3. El cable será cripto-ágil (versión + suite) para la futura rama híbrida PQ sin
   romper la regla 1.

## 11. Red-team del handshake (2026-09-27)

Ataques intentados contra la implementación real (`src/p2p/`), con resultado.
Formato: amenaza → escenario → mitigación → test.

| # | Ataque | Resultado |
|---|---|---|
| 1 | Downgrade v2→v1 (HELLO `v:1`) | **Rechazado.** `parseHello` lanza "handshake antiguo… actualiza su app" y se cierra la conexión. Test: `nativeTransport.test.ts` "roundtrip firmado y rechazos". |
| 2 | Versión desconocida (`v:99`, `v:"2"`) | **Rechazado.** "HELLO de versión desconocida". Test: `nativeTransport.test.ts` (casos de rechazo). |
| 3 | Reflection (reenviar mi propio HELLO) | **Rechazado.** `pk == mi_pk` → "Es mi propio dispositivo". Test: "HELLO con mi propia pk → rechazado". |
| 4 | Intercambio sender/receiver | **No aplicable / seguro por diseño.** El HELLO no tiene campos sender/receiver separados: la identidad es el `pk` firmado. Un HELLO válido de Alice siempre autentica como Alice, lo reenvíe quien lo reenvíe. |
| 5 | Reutilizar HELLO de otra sesión (nueva conexión) | **Neutralizado en confidencialidad; DoS de disponibilidad residual (ver nota).** <10 s tras el último handshake: el duplicado se rechaza por cooldown sin tocar la sesión viva (test: "HELLO capturado y repetido en otra conexión → cooldown lo rechaza"). >10 s: el handshake "completa" con mi `nonce` fresco → deriva una **clave distinta** (test: "nonces distintos → claves distintas"); el atacante no conoce el secreto efímero del peer y no puede producir `session_confirm` → sin liveness → **la cola no se vacía ni se desvía**. Nota: en la ventana >10 s la sesión fantasma **sustituye** a la viva en el mapa (los frames del peer real fallan el AEAD y se descartan) → DoS transitorio de disponibilidad que se cura con el próximo handshake. Mitigación planificada: H-8 (no sustituir la sesión viva hasta que la nueva demuestre liveness). Severidad: BAJA (requiere proximidad radio; un jammer logra lo mismo sin criptografía). |
| 6 | Nonce válido con efímera distinta (MITM) | **Rechazado.** La firma cubre `(pk\|eph\|nonce)`; sustituir `eph` invalida la firma. Test: "MITM: efímero sustituido tras la firma". |
| 7 | Firma válida usada para otro peer (pk de Bob, firma de Alice) | **Rechazado.** El lookup es por `pk` del HELLO y la verificación usa la `spk` de **ese** contacto. Test: "firma forjada con otra clave → rechazada". |
| 8 | QR antiguo después de rotar identidad | **Rechazado (fail-closed).** El contacto guarda la `spk` antigua; los HELLO firmados con la clave nueva no verifican. Pendiente H-4 para la UX de re-verificación. |
| 9 | Dos conexiones simultáneas A↔B | **Converge por diseño** (no probado físicamente). Ambos derivan la misma K por el orden canónico de nonces; `pkToMac` queda con la última ruta; el cooldown de 10 s evita sustitución por HELLO duplicado. Riesgo: socket redundante (costo radio, no seguridad). **Requiere prueba física (P7).** |
| 10 | Restart a mitad del handshake | **Fail-closed.** Efímeros y nonces están solo en RAM y se pierden; la sesión no existe; los mensajes siguen en `queued` en la DB y se envían tras el próximo handshake completo. Sin leak, sin aceptación parcial. |
| 11 | Mensajes de sesión anterior tras reconectar | **Descartados.** La nueva sesión tiene clave nueva (nonces frescos); los frames viejos fallan el AEAD → `null` en silencio. Test: `adversarial.test.ts` (ciphertext corrupto / sesiones). |

**Conclusión del red-team:** no se encontró forma de romper la autenticación, la
confidencialidad ni el anti-replay del handshake v2 con los ataques de la lista.
Los puntos 9 y 10 requieren confirmación física (P7). La migración a Noise_XX (X-2)
queda como trabajo futuro con vectores oficiales; el v2 actual es el "protocolo seguro
más sencillo" que la investigación recomienda mantener hasta entonces.

## 12. Endurecimiento de seguridad de octubre 2026 (era del protocolo v3 + CONFIRM v1)

Dos rondas red-team adversariales (8 de octubre de 2026; resúmenes en
`docs/es/security/AUDITS_2026-10.md`) atacaron el handshake, el KDF, la cadena
de tokens, la capa de negociación y las fronteras de confianza de la delegación.
Todos los hallazgos accionables fueron corregidos; la criptografía en sí no fue
vulnerada en ninguna ronda. Cambios desde §11:

- **KDF:** el truncado directo de SHA-512 fue reemplazado por HKDF-SHA512
  (RFC 5869) (§4 paso 4). La confusión de KDF entre versiones falla cerrada en
  `session_confirm`.
- **Higiene de efímeros:** el secreto efímero se borra en todas las salidas del
  handshake (éxito, timeout, firma inválida, desconexión); el slot pendiente del
  handshake se reserva sincrónicamente antes del primer await (sin efímeros
  huérfanos por frames concurrentes).
- **Endurecimiento de negociación:** los PROPOSE con `negotiationId` existente se
  rechazan (fail-closed), con reserva **sincrónica** del ID antes del primer await
  para que PROPOSEs concurrentes con el mismo ID no evadan el chequeo; todas las
  firmas de negociación se anclan al `contact.sigPkHex` establecido por QR (el
  handshake ya anclaba los HELLOs; la negociación ahora iguala).
- **Tokens de delegación (feature flag OFF):** ligados a la sesión de transporte
  (`sessionTag`, verificación bidireccional estricta — mata el replay entre
  sesiones dentro de la ventana de expiración); `attenuateToken` verifica la
  cadena antes de extenderla.
- **ApprovalGate:** la aprobación humana queda ligada a los bytes exactos mostrados
  en la tarjeta (snapshot profundo al registrar, hash re-verificado al aprobar,
  timeout = denegar, un solo consumo); `approve()` re-verifica el estado de la
  negociación sincrónicamente (sin TOCTOU); aprobaciones pendientes con tope por
  peer y barrido de expirados; la tarjeta muestra hash, tamaño y preview del
  documento (marcado como no confiable) para `task:summarize`.
- **Frontera de confianza de memoria:** los facts de origen peer quedan fuera del
  contexto de conversación del dueño (allowlist `getOwnerFacts()`); `remember_fact`
  exige confirmación humana cuando el contexto de la herramienta contiene contenido
  no confiable (fail-closed sin UI de confirmación).
- **Rate limiting pre-autenticación:** máx. 5 inicios de handshake por MAC cada
  60 s, verificado antes de generar el efímero y firmar.
- **Operativo:** nivel mínimo de parche de seguridad Android **2025-03-05**
  documentado (clase RCE SDP de Bluetooth bajo la capa de la app,
  CVE-2025-0075/22403 — sin fix posible en la app).

**Estado honesto:** no existe auditoría criptográfica externa; no se ha hecho
prueba física con dos dispositivos; no se ha probado inyección de prompts
adaptativa contra el modelo on-device. Ver `docs/es/security/AUDITS_2026-10.md`
para las listas completas de verificado y no cubierto.
