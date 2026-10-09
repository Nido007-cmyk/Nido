# Revisión de ataques reales documentados — NIDO

**Fecha:** 2026-10-09
**Tipo:** Investigación (solo lectura, sin cambios de código)
**Alcance:** Ataques documentados contra sistemas similares a NIDO (mensajería E2E, P2P Bluetooth, SQLCipher, backups cifrados, approval gates) y qué fixes se implementaron.

---

## 1. Ataques contra protocolos de mensajería E2E (Signal / Double Ratchet / Noise)

### 1.1. Inyección de mensajes vía Sealed Sender (Signal, 2026)

**El ataque:** Un paper presentado en IACR News (marzo 2026) documentó dos ataques contra Signal. El más severo explotaba la función Sealed Sender (SSS): una combinación de dos errores en la implementación de Android — chequeos de clave faltantes y pérdida de contexto cuando el procesamiento criptográfico se distribuye entre múltiples componentes — permitía a un servidor malicioso inyectar mensajes arbitrarios en conversaciones 1:1 y grupales. El ataque era indetectable por los usuarios, no requería precondiciones, y la vulnerabilidad existía desde la introducción de SSS en 2018.

**El fix:** Signal lo reconoció y parcheó: la primera vulnerabilidad se corrigió 2 días después de la divulgación, la segunda a los 8 días. La lección general: las funciones nuevas de seguridad desplegadas sobre arquitecturas complejas rompen invariantes que el protocolo original garantizaba.

**¿NIDO lo tiene?** Parcialmente mitigado por diseño. NIDO no implementa "sealed sender" ni oculta identidades del remitente — las conexiones son manuales y explícitas entre contactos emparejados. El handshake NIDO v3 firma con Ed25519 el tuple completo (`"nido-hello-v3"|pk|eph|nonce|ts`) y el CONFIRM liga ambos nonces, lo que hace que un intermediario no pueda reinyectar mensajes de handshake de otra sesión. Sin embargo, NIDO no ha tenido una auditoría criptográfica externa; la lección de Signal aplica: cada feature nueva sobre el handshake debe re-verificar los invariantes.

Fuente: https://iacr.org/news/item/27948

### 1.2. Ataques al enclave SGX de Contact Discovery (Signal, 2026)

**El ataque:** El investigador V12 (agosto 2026) demostró dos bugs críticos en el enclave SGX que Signal usa para descubrimiento de contactos: un arbitrary read + RCE. El segundo era un TOCTOU clásico: el enclave verificaba que un objeto cliente fuera válido y luego lo marcaba como usado en dos operaciones separadas; un host hostil pausaba la ejecución entre ambas, liberaba el objeto legítimo y lo reemplazaba con datos controlados por el atacante, manipulando punteros de función del código de cifrado Noise y logrando ejecución de código dentro del enclave, extrayendo la clave privada Noise.

**El fix:** Signal forzó un solo worker por shard dentro del enclave y combinó la verificación de validez con el tracking de estado en una operación atómica.

**¿NIDO lo tiene?** No aplica directamente. NIDO es offline-first sin servidor: no hay enclaves remotos, no hay descubrimiento de contactos en la nube. El descubrimiento P2P es local (Bluetooth). La superficie de ataque equivalente en NIDO sería el parsing de frames P2P entrantes — y ahí NIDO ya tiene `adversarial.test.ts` y `hello.malformed.test.ts` que verifican que ningún input malformado cause crash ni aceptación inválida.

Fuente: https://cyberinsider.com/signal-flaws-allowed-rogue-servers-to-decrypt-users-contact-queries/

### 1.3. Key Compromise Impersonation (KCI) y replay en Double Ratchet

**El ataque:** Análisis formal con ProVerif del Double Ratchet (paper de criptografía aplicada) encontró dos ataques novedosos: un ataque de impersonación por compromiso de clave (KCI) y un ataque de replay, ambos posibles por la reutilización de claves de identidad y prekeys firmadas entre sesiones. El replay es posible específicamente porque ciertos mensajes se cifran solo con DHs que involucran la clave estática del receptor, sin contribución efímera del receptor.

**El fix propuesto:** Los autores propusieron no reutilizar prekeys entre sesiones y atar cada sesión a material efímero fresco de ambas partes.

**¿NIDO lo tiene?** Mitigado por diseño en el handshake: NIDO genera un ephemeral X25519 nuevo por handshake (`generateEphemeral`), el HELLO incluye nonce fresco con cache anti-replay (`nonceCache` / `defaultHelloNonceCache`), y la clave de sesión se deriva de ambos efímeros más las identidades. Un HELLO repetido no resucita sesiones (documentado en `nativeTransport.ts`). Queda como verificación pendiente: confirmar que los efímeros nunca se reutilizan entre intentos de reconnect (el `failHello` borra el secreto efímero con `fill(0)` — R7 — lo cual es buena hygiene).

### 1.4. Robo de claves de respaldo por ingeniería social (Signal/WhatsApp, 2026)

**El ataque:** En 2026, actores estatales rusos (documentado por FBI/CISA, AIVD/MIVD de Holanda) comprometieron miles de cuentas de Signal y WhatsApp sin romper el cifrado: se hacían pasar por "Signal Support Bot" y engañaban a las víctimas para que revelaran sus códigos de verificación SMS, PINs y — críticamente — sus **claves de recuperación de backup** de 64 caracteres. Con la clave de respaldo, accedían a años de historial de chats.

**El fix:** No hay fix criptográfico posible; es un problema de factor humano. Signal/Meta respondieron con educación al usuario ("Signal nunca te pedirá tu PIN por mensaje") y recomendando registration lock / verificación en dos pasos.

**¿NIDO lo tiene?** **Riesgo real y vigente.** NIDO muestra la DEK en un modal copiable (K4) y la guarda separada del backup por diseño. Un atacante que convenza al usuario de compartir su DEK obtiene acceso total al backup. Mitigaciones recomendadas:
- El modal de DEK debería advertir explícitamente "NIDO nunca te pedirá esta clave por ningún mensaje".
- Considerar advertencia persistente en la pantalla de backup.
- Este es el vector de ataque más probable contra NIDO en la práctica, no la criptografía.

Fuentes: https://www.reuters.com/world/europe/russia-backed-hackers-breach-signal-whatsapp-accounts-officials-journalists-2026-03-09/, https://cybersecuritynews.com/hackers-attacking-signal-users/

---

## 2. Ataques Bluetooth P2P

### 2.1. BlueBorne (2017, Armis)

**El ataque:** Colección de 8 vulnerabilidades en la implementación Bluetooth (no en el protocolo) que permitían RCE **sin emparejamiento y sin interacción del usuario**, con solo tener el Bluetooth encendido. Afectó miles de millones de dispositivos Android, iOS (<10), Windows y Linux. Tres de los flaws eran críticos: toma de control total del dispositivo e interceptación de comunicaciones.

**El fix:** Parches de vendors (Google, Apple, Microsoft, Linux). La mitigación para dispositivos sin parche: apagar el Bluetooth. El problema del "patch gap": muchos Android viejos e IoT nunca recibieron el parche.

**¿NIDO lo tiene?** **Dependencia del OS, no mitigable a nivel app.** NIDO usa el stack Bluetooth del sistema operativo; si la tablet tiene un OS sin parchar, BlueBorne u otros exploits de stack podrían comprometer el dispositivo completo, independientemente del cifrado de NIDO. Lo que NIDO sí hace bien: el handshake de aplicación (X25519 + Ed25519 con autenticación mutua) corre **sobre** el canal Bluetooth, así que incluso un atacante con MITM a nivel de enlace no puede leer ni forjar mensajes sin las claves de identidad — obtendría como máximo DoS. Recomendación: documentar que NIDO requiere un OS con parches de seguridad al día; no hay nada más que la app pueda hacer.

Fuente: https://www.securityscientist.net/blog/12-questions-and-answers-about-blueborne-bluetooth-vulnerability-2/

### 2.2. KNOB — Key Negotiation of Bluetooth (CVE-2019-9506)

**El ataque:** Un atacante MITM durante el emparejamiento podía forzar la negociación de la longitud de la clave de cifrado a un valor mínimo (1 byte de entropía efectiva), y luego forzar la clave por fuerza bruta. Afectaba el emparejamiento Bluetooth BR/EDR estándar.

**El fix:** El Bluetooth SIG actualizó la especificación para exigir una longitud mínima de clave (7 octetos); los vendors parchearon sus stacks para rechazar negociaciones por debajo del mínimo.

**¿NIDO lo tiene?** No aplica al canal de aplicación. NIDO no depende del cifrado del enlace Bluetooth para confidencialidad — deriva sus propias claves de sesión vía X25519 con claves de 256 bits fijas, sin negociación de longitud. Un downgrade KNOB del enlace no debilita el cifrado de NIDO.

### 2.3. BIAS — Bluetooth Impersonation Attack (CVE-2020-10135)

**El ataque:** Explotaba que los procedimientos de emparejamiento legacy y seguro no se autenticaban mutuamente de forma cruzada: un atacante podía impersonar un dispositivo previamente emparejado haciéndose pasar por él durante el establecimiento de conexión, sin conocer la clave de enlace.

**El fix:** Parches de OS que exigen autenticación mutua en el establecimiento de conexiones seguras.

**¿NIDO lo tiene?** Mitigado a nivel de aplicación. NIDO autentica cada handshake con firmas Ed25519 sobre nonces frescos de ambas partes; impersonar a un contacto requeriría su clave privada de identidad, no basta con spoofear la MAC Bluetooth. La capa de identidad de NIDO (pkHex por contacto emparejado) es independiente de la identidad Bluetooth.

### 2.4. CVE-2018-5383 — Invalid ECC key en emparejamiento

**El ataque:** Durante el emparejamiento BLE/SSP, un atacante podía enviar una clave pública ECC inválida (punto no en la curva) para forzar un secreto compartido predecible y hacer MITM.

**El fix:** Validación de que la clave pública recibida sea un punto válido en la curva antes del DH.

**¿NIDO lo tiene?** Verificar. NIDO usa X25519 para el DH efímero. X25519 (Curve25519 con solo coordenada X) es resistente por construcción a puntos inválidos — el "clamping" y la forma de Montgomery hacen que incluso inputs maliciosos produzcan un secreto compartido, aunque potencialmente débil si el peer es malicioso. Dado que NIDO autentica el ephemeral con firma Ed25519 de la identidad del peer, un atacante no puede sustituir el ephemeral sin la clave privada del contacto. **Acción recomendada:** confirmar que el ephemeral recibido se valida (longitud 32 bytes) antes de usarlo — el `hello.malformed.test.ts` sugiere que esto ya se prueba.

---

## 3. Ataques a SQLCipher / bases de datos móviles

### 3.1. CVE-2026-51936 — SQL injection en `sqlcipher_export`

**El ataque:** En SQLCipher antes de 4.15.0, la función `sqlcipher_export` (usada para copiar contenido entre bases, típicamente para convertir entre plaintext y cifrado) manipulaba el esquema dinámicamente y temporalmente desactivaba restricciones defensivas. Un parámetro de nombre de base de datos fuente manipulado permitía inyección SQL que burlaba el modo defensivo, permitiendo modificaciones directas a `sqlite_schema` y corrupción de la base.

**El fix:** SQLCipher 4.15.0 valida estrictamente el nombre de la base fuente.

**¿NIDO lo tiene?** **Verificar versión.** NIDO debe confirmar que su SQLCipher es >= 4.15.0. Además, NIDO debería auditar si usa `sqlcipher_export` en algún flujo (migración, backup). El backup de NIDO copia el archivo `.db` a nivel de fichero (no vía `sqlcipher_export`), lo que evita esta superficie. Pero cualquier uso de `ATTACH DATABASE` con nombres dinámicos debe revisarse.

Fuente: https://cvefeed.io/vuln/detail/CVE-2026-51936

### 3.2. PRAGMA injection (better-sqlcipher, 2026)

**El ataque:** Reporte de seguridad contra `better-sqlcipher` (usado por Threema): el método `pragma()` concatenaba input del usuario directamente en sentencias `PRAGMA` sin validación. SQLCipher expone PRAGMAs críticos (`key`, `rekey`, `cipher_salt`) — un atacante con acceso al handle de la DB (ej. dependencia npm comprometida) podía ejecutar `PRAGMA rekey = 'attacker_key'`, cambiando permanentemente la clave de cifrado y dejando al usuario legítimo sin acceso.

**El fix:** Whitelist de PRAGMAs permitidos / validación estricta de input.

**¿NIDO lo tiene?** **Aparentemente protegido.** En NIDO, los `PRAGMA key` se construyen con la DEK en hex hardcodeado en el formato (`PRAGMA key = "x'<dek hex>'"`) desde `keyManager.ts` y `secureDatabase.ts` — no hay concatenación de input de usuario en PRAGMAs. **Acción recomendada:** grep de auditoría para confirmar que ningún `PRAGMA` se construye con strings de origen externo (nombres de backup, input de UI). El diseño F-KEY-1 (rotación vía `PRAGMA rekey`) debe implementarse con el mismo cuidado: la nueva clave debe venir del generador seguro, nunca de input sin validar.

Fuente: https://github.com/threema-ch/better-sqlcipher/issues/5

### 3.3. Clave vacía aceptada como passphrase

**El hallazgo:** Un investigador documentó que `PRAGMA key = ""` produce un error específico, mientras que una clave incorrecta es aceptada en el momento y falla después al intentar descifrar una página. No es un ataque, pero es relevante para UX de error.

**¿NIDO lo tiene?** NIDO verifica la clave con lectura de prueba tras aplicarla (`applyDatabaseKey` + verificación), que es el patrón correcto.

---

## 4. Fallos de cifrado de backups — incidentes reales

### 4.1. Phishing de claves de respaldo (Signal, 2026)

Descrito en 1.4 arriba. Es el incidente de "backup encryption failure" más relevante: el cifrado no falló, el humano falló. **Es también el riesgo #1 para NIDO.**

### 4.2. Lecciones generales de la industria

- **WhatsApp E2E backup (2021):** WhatsApp introdujo backups cifrados E2E con clave de 64 dígitos o password. El modelo es correcto, pero la usabilidad de la clave larga empuja a los usuarios a guardarla en lugares inseguros (screenshots, notas sin cifrar). NIDO tiene el mismo tradeoff con su DEK.
- **Regla de oro:** un backup cifrado es tan seguro como el almacenamiento de su clave. NIDO lo hace bien al separar backup y clave en ubicaciones distintas y advertirlo en la UI.

**Recomendaciones para NIDO:**
1. Añadir al modal de DEK: "NIDO nunca te pedirá esta clave. Si alguien la pide, es un fraude."
2. Considerar Shamir Secret Sharing o fragmentación opcional para usuarios avanzados (futuro).
3. El diseño F-KEY-1 (rotación) es la respuesta correcta al escenario "mi clave se filtró".

---

## 5. Ataques a approval gates / delegación de tareas

### 5.1. GHSA-F7WW-2725-QVW2 — TOCTOU approval bypass en OpenClaw (2026)

**El ataque:** Vulnerabilidad de severidad alta (CWE-367) en el framework de asistente AI OpenClaw: el flujo de aprobación de `system.run` permitía a un atacante local eludir las restricciones de aprobación manipulando symlinks en el CWD entre la fase de aprobación y la fase de ejecución. El administrador aprobaba un path benigno; el atacante re-apuntaba el symlink a `/root` o `/etc` antes de que el comando ejecutara.

**El fix (commit 78a7ff2, versión 2026.2.26):** Endurecer las aprobaciones de exec rechazando symlinks mutables en el path — canonicalización con `realpath` + `O_NOFOLLOW` como barrera TOCTOU.

**¿NIDO lo tiene?** **Protegido contra esta variante específica, con defensa en profundidad:**
- NIDO implementa el close del TOCTOU R5: `ApprovalGate.approve()` re-verifica que la negociación siga en estado ACCEPTED en el momento de aprobar (no solo al registrar).
- F-DELEG-4 hizo el gate fail-closed sin provider.
- Anti-loopjacking: snapshot profundo de los bytes aprobados; mutar el objeto del llamador tras registrar no cambia lo aprobado (testeado).
- Anti-replay F-DELEG-2: un taskId ejecutado no puede re-aprobarse.
- La diferencia clave con OpenClaw: NIDO no ejecuta paths del filesystem vía la delegación — el executor es sandboxed con `maxToolCalls` y `resultSizeLimit` (F-DELEG-1). No hay symlink que re-apuntar porque no hay paths.

Fuente: https://dev.to/cverports/ghsa-f7ww-2725-qvw2-ghsa-f7ww-2725-qvw2-toctou-approval-bypass-in-openclaw-via-symlink-rebinding-2nmf

### 5.2. Post-approval commit injection (CICD-SEC-1)

**El ataque:** En pipelines CI/CD, si las aprobaciones no se descartan al hacer push de nuevos commits (`dismiss_stale_reviews_on_push: false`), un contribuidor obtiene aprobación para un cambio benigno y luego inyecta commits maliciosos que se mergean con la aprobación vieja. Es un TOCTOU a nivel de proceso.

**¿NIDO lo tiene?** Análogo cubierto: el equivalente en NIDO sería "aprobar una tarea y que el peer cambie el contenido antes de ejecutar". NIDO lo cierra de dos formas:
1. El snapshot es inmutable (deep freeze en `register`).
2. El executor verifica el hash del snapshot antes de ejecutar (anti-loopjacking).
3. `TASK_CANCEL` inbound invalida la negociación incluso después de aprobada (R5/I2).

### 5.3. Vectores restantes a considerar para NIDO

- **Fatiga de aprobación:** si el usuario recibe muchas tarjetas de aprobación, empezará a aprobar sin leer (como los diálogos UAC). Mitigación: rate-limit de solicitudes por peer, agrupación, y mostrar siempre el hash/identidad del peer de forma prominente.
- **Peer comprometido post-emparejamiento:** si el dispositivo del contacto es comprometido, el atacante hereda su identidad. NIDO no tiene revocación de contacto documentada — **considerar una función "desemparejar/revocar" que invalide la identidad del peer**.
- **Replay de TASK_REQUEST:** cubierto por F-DELEG-2 (task IDs anti-replay) y nonces de handshake.

---

## Resumen: estado de protecciones en NIDO

| Ataque | Severidad original | ¿NIDO protegido? | Acción |
|---|---|---|---|
| Sealed Sender injection (Signal) | Crítica | ✅ Por diseño (sin SSS) | Re-verificar invariantes en cada feature nueva del handshake |
| Enclave SGX TOCTOU (Signal) | Crítica | ✅ No aplica (sin servidor) | — |
| KCI + replay (Double Ratchet) | Alta | ✅ Handshake con efímeros frescos + nonce cache | Confirmar no-reutilización de efímeros en reconnect |
| Phishing de clave de backup | Alta (práctica) | ⚠️ **Riesgo vigente** | Añadir advertencia anti-fraude al modal DEK |
| BlueBorne | Crítica | ⚠️ Depende del OS | Documentar requisito de OS parchado |
| KNOB | Alta | ✅ No aplica (sin negociación de longitud) | — |
| BIAS | Alta | ✅ Auth mutua Ed25519 a nivel app | — |
| CVE-2018-5383 (ECC inválida) | Media | ✅ Probable (X25519 + firma) | Confirmar validación de longitud del ephemeral |
| CVE-2026-51936 (sqlcipher_export) | Media | ✅ Probable (backup a nivel fichero) | Confirmar versión SQLCipher ≥ 4.15.0 |
| PRAGMA injection | Alta | ✅ PRAGMAs sin input de usuario | Auditar F-KEY-1 cuando se implemente |
| TOCTOU approval bypass (OpenClaw) | Alta | ✅ R5 + fail-closed + snapshot inmutable | — |
| Post-approval injection | Media | ✅ Hash check pre-ejecución | — |
| Fatiga de aprobación | Media | ❌ No mitigado | Rate-limit + identidad prominente (futuro) |
| Peer comprometido post-pairing | Alta | ❌ Sin revocación | Función desemparejar/revocar (futuro) |

## Prioridades recomendadas

1. **Advertencia anti-fraude en el modal DEK** — el ataque más probable en la práctica (5 min de trabajo).
2. **Confirmar versión SQLCipher ≥ 4.15.0** — chequeo de 2 minutos.
3. **Revocación de contactos** — diseño para después del APK público.
4. **Rate-limit de approval cards** — mitigación de fatiga (futuro).
