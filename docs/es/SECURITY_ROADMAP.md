> **Idioma:** [English](../SECURITY_ROADMAP.md) · Español

# SECURITY_ROADMAP.md — NIDO

**Fecha:** 27 de septiembre de 2026. **Estado:** documento vivo; se actualiza con cada cambio.
**Principios:** privacy-first, zero-trust, local-first, offline-first, defense-in-depth.
**Regla de medición:** el progreso se mide por reducción verificable de superficie de ataque
y riesgo residual, no por número de features.

## Vocabulario de estado (no son equivalentes)

- `IMPLEMENTED` — el código existe.
- `AUTOMATED TESTED` — hay tests automatizados que lo cubren (positivos y negativos).
- `ANDROID COMPILED` — compiló en un build Android real.
- `PHYSICALLY TESTED` — probado en hardware real (dos teléfonos donde aplique).
- `EXTERNALLY AUDITED` — revisado por un tercero independiente.

Hoy **ningún** componente de seguridad de NIDO está en `EXTERNALLY AUDITED`.
Nada de lo aquí descrito debe leerse como "auditado", "a prueba de cuántica" o "imposible de vulnerar".

## Línea base actual (2026-09-27)

| Componente | Estado |
|---|---|
| Handshake v2 autenticado (Ed25519 + X25519 efímero + nonces) | IMPLEMENTED + AUTOMATED TESTED (423 tests) |
| QR v2 como raíz de confianza (spk ligada a identidad) | IMPLEMENTED + AUTOMATED TESTED |
| Claves de identidad en SecureStore (semillas, nunca en plaintext en disco app) | IMPLEMENTED + AUTOMATED TESTED |
| Anti-replay (nonces por handshake, ids únicos por mensaje, liveness) | IMPLEMENTED + AUTOMATED TESTED |
| Permisos Bluetooth por API (neverForLocation en 31+) | IMPLEMENTED (prebuild verificado, commit `33bbc6b`) |
| allowBackup=false | IMPLEMENTED |
| SQLCipher | **NO** — SQLite en plaintext |
| Biometría como gate criptográfico | **NO** — solo pendiente |
| FLAG_SECURE / política clipboard / notificaciones sin contenido | **NO** |
| dataExtractionRules (device-transfer) | **NO** |
| Migración tweetnacl → @noble/\* | **NO** |
| HKDF (hoy: SHA-512 ad-hoc en KDF) | **NO** |
| XChaCha20-Poly1305 (hoy: XSalsa20-Poly1305) | **NO** |
| Noise_XX | **NO** — documentado como migración futura |
| Híbrido PQ X25519+ML-KEM | **NO** — FUTURO, sin implementación auditada para RN |
| Compilación Android del módulo nido-p2p | **NO** — sin JDK/SDK en este entorno |
| Pruebas físicas entre dos teléfonos | **NO** |

---

## CRITICAL

### C-1. SQLCipher real para todo dato sensible en reposo
- **Amenaza:** robo/pérdida del teléfono, extracción forense, malware con acceso a archivos →
  lectura de mensajes, contactos, memoria del agente, sesiones.
- **Acción:** `expo-sqlite` con `useSQLCipher: true` (opción oficial, sin dependencia extra);
  clave maestra de 32 B en Keystore vía SecureStore; migración plaintext→encrypted con
  `sqlcipher_export`; apertura fail-closed (`PRAGMA key` + `SELECT` de prueba; si falla,
  error explícito, jamás plaintext silencioso ni DB nueva vacía).
- **Estado:** pendiente. Requiere build nativo para verificar (`PRAGMA cipher_version`).
- **Criterio de done:** IMPLEMENTED + AUTOMATED TESTED (lógica JS) + ANDROID COMPILED +
  PHYSICALLY TESTED (apertura, migración, rollback, clave incorrecta).

### C-2. Claves de identidad y de firma en Android Keystore con detección de nivel
- **Amenaza:** extracción de semillas de SecureStore en dispositivo comprometido.
- **Acción:** generar Ed25519/X25519 en Keystore; intentar StrongBox, fallback a TEE,
  registrar el `securityLevel` real y mostrarlo en la pantalla de estado de seguridad.
  Nunca asumir hardware sin comprobarlo (el emulador miente).
- **Estado:** parcial (semillas en SecureStore). El movimiento a Keystore nativo va por el
  módulo `nido-p2p`.
- **Criterio de done:** securityLevel visible + tests de fallback + PHYSICALLY TESTED.

### C-3. Migrar la criptografía JS de tweetnacl a @noble/\*
- **Amenaza:** tweetnacl lleva ~6 años sin release (auditoría de 2017), sin XChaCha20,
  `tweetnacl-util` incompatible con RN. Es código crítico abandonado.
- **Acción:** `@noble/curves` (Ed25519/X25519), `@noble/ciphers` (XChaCha20-Poly1305),
  `@noble/hashes` (SHA-256/HKDF). Auditorías: Trail of Bits ago-2026, Cure53 sep-2024.
  Formatos de cable compatibles a nivel de bytes (mismo wire, distinta librería).
- **Estado:** pendiente. **No rompe** los 423 tests: se migran las primitivas, no el protocolo.
- **Criterio de done:** IMPLEMENTED + AUTOMATED TESTED (incl. vectores oficiales) + 423 tests en verde.

### C-4. Política explícita anti-downgrade y de versiones
- **Amenaza:** downgrade v2→v1, versión desconocida aceptada por compatibilidad.
- **Acción:** ya IMPLEMENTED (v1 rechazado con mensaje de actualización, versión desconocida
  rechazada). Mantener la regla: **ninguna versión antigua insegura se acepta en silencio**;
  toda versión nueva exige bump explícito + tests negativos.
- **Estado:** IMPLEMENTED + AUTOMATED TESTED.

## HIGH

### H-1. HKDF (RFC 5869) como KDF de sesión
- **Hoy:** `SHA-512("nido-session-v2" || DH || nonce_min || nonce_max)[0:32]` — construcción
  ad-hoc correcta pero no estándar; sin separación de claves por propósito.
- **Acción:** `HKDF-SHA-256(salt=hash_transcript, ikm=DH‖nonces, info="nido-sess-v1")` y claves
  separadas por propósito (`info` distinto para envío/recepción/confirmación).
- **Criterio de done:** IMPLEMENTED + AUTOMATED TESTED (vectores RFC 5869).

### H-2. XChaCha20-Poly1305 en lugar de XSalsa20-Poly1305
- **Motivo:** XSalsa20 no tiene AAD ni estándar IETF; XChaCha20 (nonces aleatorios de 24 B,
  con AAD para autenticar headers) es la recomendación 2026 para código nuevo.
- **Acción:** vía `@noble/ciphers` (C-3); autenticar el header del frame como AAD.
- **Criterio de done:** IMPLEMENTED + AUTOMATED TESTED (vectores del draft IRTF).

### H-3. dataExtractionRules: bloquear también device-transfer
- **Amenaza:** `allowBackup=false` no bloquea la transferencia dispositivo-a-dispositivo en Android 12+.
- **Acción:** config plugin con `res/xml/data_extraction_rules.xml` (`<cloud-backup/>` y
  `<device-transfer/>` vacíos) + test de manifiesto en prebuild.
- **Criterio de done:** IMPLEMENTED + prebuild verificado (sin SDK no hay más).

### H-4. Advertencia visible ante cambio de identity key del contacto
- **Amenaza:** el peer rota/reinstala su identidad; hoy la firma falla con mensaje genérico
  de "posible MITM", sin distinguir ataque de rotación legítima.
- **Acción:** detectar "firma inválida pero pk conocida con spk distinta" → pantalla en lenguaje
  humano: "La identidad de <nombre> cambió. Verifica su nuevo QR en persona antes de seguir."
  Flujo de re-verificación por QR. Protección contra rollback: nunca aceptar una spk antigua
  después de haber visto una nueva.
- **Estado:** pendiente (el rechazo fail-closed ya existe; falta la UX).
- **Criterio de done:** IMPLEMENTED + AUTOMATED TESTED + texto revisado por humano.

### H-5. gitleaks + endurecimiento de supply chain básico
- **Acción:** gitleaks v8 en pre-commit; `.npmrc` con `min-release-age=3`; `npm audit signatures`;
  SBOM CycloneDX por release (`npm sbom`); osv-scanner offline en CI/manual.
- **Criterio de done:** IMPLEMENTED (cero riesgo de runtime).

### H-6. Biometría como gate UX (capa 1)
- **Acción:** `expo-local-authentication` para abrir la app y acciones sensibles.
- **Límite honesto:** es solo UX; la garantía criptográfica real (KEK con
  `setUserAuthenticationRequired`) es un módulo nativo FUTURO. Documentarlo así en la UI,
  no venderlo como "cifrado biométrico".
- **Criterio de done:** IMPLEMENTED + ANDROID COMPILED + PHYSICALLY TESTED.

### H-7. Compromiso de claves: recovery y revocación
- **Amenaza:** clave de identidad comprometida → el atacante puede suplantar en futuros handshakes.
- **Acción:** rotación de identidad en un gesto (nueva Ed25519 + nuevo QR), revocación local
  (marcar contacto como "identidad revocada", bloquear sesión), y guía de re-emparejamiento.
  Forward secrecy del contenido pasado: ya la dan los efímeros (ver CRYPTO_ARCHITECTURE.md).
- **Estado:** pendiente.

### H-8. No sustituir la sesión viva hasta que la nueva demuestre liveness
- **Amenaza:** HELLO capturado reinyectado >10 s después del último handshake (fuera del
  cooldown) sustituye la sesión viva por una fantasma → DoS de disponibilidad
  (red-team 2026-09-27, CRYPTO_ARCHITECTURE.md §11 ataque #5). Sin impacto en
  confidencialidad: la clave es distinta y sin liveness la cola no se desvía.
- **Acción:** mantener la sesión actual servida hasta que la nueva complete
  `session_confirm`; solo entonces sustituir. Conservar el cooldown de 10 s.
- **Estado:** hallazgo documentado + test del cooldown; mitigación pendiente.
- **Criterio de done:** IMPLEMENTED + AUTOMATED TESTED (replay >10 s no interrumpe
  la sesión viva; la nueva la sustituye solo tras liveness).

## MEDIUM

### M-1. FLAG_SECURE selectivo + política de clipboard + notificaciones sin contenido
- Pantallas sensibles (QR de pairing, inbox, mensajes): sin screenshots ni miniatura en el
  switcher. Clipboard: no auto-copiar secretos; `EXTRA_IS_SENSITIVE` (API 33+) y limpieza
  tras timeout. Notificaciones: "Nuevo mensaje de NIDO", jamás el texto.
- Requiere pequeño módulo nativo o config plugin; verificar en prebuild.

### M-2. Detección de root advisory (no bloqueo)
- Avisar del riesgo elevado y endurecer manejo de claves en memoria; **no bloquear** el
  dispositivo rooteado (no convertir seguridad en DRM). Play Integrity se RECHAZA
  (requiere red; incompatible con offline-first).

### M-3. Crash reporting 100% local y opt-in
- Solo stack traces sanitizados en el dispositivo, visor en la app, export manual por el
  usuario. Cero telemetría de red. Sanitizar antes de persistir (sin mensajes, claves,
  contactos, SQL).

### M-4. Ratchet simétrico por mensaje (forward secrecy fina)
- Hoy: forward secrecy por sesión (efímeros). Mejora: derivar clave por mensaje con HKDF
  y borrar la anterior (~20 líneas, sin la complejidad del Double Ratchet).
- **No** implementar Double/Triple Ratchet parcial (veredicto de la investigación).

### M-5. Nombre Bluetooth genérico rotatorio + discovery explícito
- El MAC clásico es estable y nunca se randomiza: no usarlo como identidad (ya es regla),
  usar nombre "NIDO"+sufijo aleatorio por sesión de discovery, discovery solo bajo acción
  explícita con timeout corto, y documentarlo en la UX.

### M-6. Reproducible builds (base)
- Pinning completo (Expo, lockfile, Gradle wrapper+sha256, JDK 17, NDK), `SOURCE_DATE_EPOCH`,
  doble build local byte-idéntico en CI. EAS Build no garantiza bit-for-bit: no prometerlo.

## EXPERIMENTAL / FUTURE

### X-1. Híbrido post-cuántico X25519 + ML-KEM-768
- **Estado del estándar:** sólido (RFC 10024, X-Wing, PQXDH desplegado por Signal).
- **Estado de las librerías para RN:** `@noble/post-quantum` **no auditada independientemente**,
  sin tiempo constante en JS. **No apta para producción.**
- **Decisión:** ADOPT LATER. Diseño: el componente clásico auditado permanece como base;
  la rama ML-KEM añade protección harvest-now-decrypt-later cuando exista implementación
  auditada (o binding nativo BoringSSL/AWS-LC). El cable ya debe ser cripto-ágil
  (byte de versión + suite) para enchufarlo sin romper compatibilidad.
- **Criterio de activación explícito:** auditoría independiente de la librería ML-KEM en
  JS/Hermes, o módulo nativo con BoringSSL. Hasta entonces: EXPERIMENTAL opt-in como máximo.

### X-2. Migración del handshake a Noise_XX
- El handshake v2 actual (firmado, simple, con primitivas estándar) es el "protocolo seguro
  más sencillo" que la investigación recomienda mantener. Noise_XX es el framework correcto
  a largo plazo (rev. 34 estable, vectores oficiales), pero no existe librería Noise
  standalone auditada para RN; adaptarlo es trabajo de precisión.
- **Decisión:** ADOPT LATER con vectores oficiales como tests. No copiar PQXDH ni el
  Triple Ratchet a mano.

### X-3. Key attestation offline
- Probar con criptografía (cadena de attestation contra raíces de Google embebidas) que una
  clave nació en StrongBox/TEE, sin red. Complejidad alta; FUTURO.

### X-4. BLE con direcciones aleatorias como transporte alternativo
- Reduciría el tracking por MAC estable del Bluetooth clásico. Cambiar de transporte es
  caro; hoy RFCOMM es lo implementado. FUTURO.

### X-5. Firmas post-cuánticas (ML-DSA) para identidad
- Pueden esperar: una firma clásica no es vulnerable a harvest-now-decrypt-later (forjarla
  requiere el computador cuántico en el momento del ataque). FUTURO.

---

## POST-QUANTUM SECURITY / CRYPTO-AGILITY — ROADMAP ONLY

> **Estado: NO IMPLEMENTADO. Línea de roadmap futuro, no trabajo activo.**
> Todo lo descrito en esta sección es arquitectura futura. La seguridad real de NIDO hoy
> es exclusivamente la de la sección "Línea base actual" de este documento.
> No se implementa, cambia ni reemplaza ninguna criptografía actual por esta sección.
> No toca el build Android ni abre una línea activa de investigación.

**Objetivo:** preparar NIDO para una transición futura a criptografía post-cuántica,
especialmente para: identidad NIDO, comunicaciones P2P, intercambio de claves, firmas,
rotación de identidad y protección frente a escenarios *harvest now, decrypt later*.

**Alcance futuro (diseño, no implementación):**
- Estándares post-cuánticos establecidos (p. ej. ML-KEM / FIPS 203 para KEM,
  ML-DSA / FIPS 204 para firmas) — solo estándares finalizados, nunca candidatos en
  evaluación.
- Transición híbrida classical + post-quantum (lo clásico auditado sigue como base;
  la rama PQ añade protección cuando exista implementación auditada).
- Negociación segura de algoritmo/versión entre peers, con protección anti-downgrade
  (extiende la regla de C-4: ninguna suite antigua insegura se acepta en silencio).
- Rotación y revocación de claves/identidad compatibles con el cambio de algoritmo
  (extiende H-7: la identidad NIDO debe sobrevivir a migraciones criptográficas sin
  quedar permanentemente ligada a un único algoritmo).
- Compatibilidad entre versiones durante la transición (el cable ya debe ser
  cripto-ágil: byte de versión + identificador de suite).
- Funcionamiento offline / local-first: la transición no puede depender de un
  servidor central, PKI externa ni red.

**Longevidad de la identidad:** el modelo de datos ya contempla `crypto_version`,
rotación de claves y crypto-agility como diseño futuro (ver `DATA_MODEL.md`). La
identidad NIDO debe poder migrar de algoritmo sin perder continuidad ni obligar a
re-emparejar a todos los contactos desde cero, salvo que la amenaza lo exija.

**Criterios de activación (todos deben cumplirse antes de implementar):**
1. Base Android sólida y validada (build + pruebas físicas superadas).
2. Implementación PQ con auditoría independiente (o binding nativo auditado,
   p. ej. BoringSSL/AWS-LC) — ver criterio de X-1.
3. Estándares finalizados y estables; reevaluación explícita del estado de
   librerías para React Native/Hermes en ese momento.

**Explícitamente fuera de alcance hoy:** implementar ML-KEM/ML-DSA, cambiar
primitivas actuales, tocar el módulo nativo o el build Android, o abrir una
línea de investigación activa. Ver también X-1 (híbrido X25519+ML-KEM) y X-5
(firmas ML-DSA) para el estado técnico detallado.

**Nota de dirección (2026-09-27, Vitalik Buterin / Lean Ethereum):** la meta
pública de Ethereum es "seguridad criptográfica por siglos, vía esquemas
basados en hash", reemplazando la criptografía de curva elíptica que una
computadora cuántica grande rompería; los estándares NIST ya están
finalizados (ML-KEM/FIPS 203, ML-DSA/FIPS 204, Falcon) y el clúster de
protocolo de Ethereum apunta a diciembre 2029 para PQ-readiness. Para NIDO,
esto fija una preferencia de diseño futuro: cuando la crypto-agility se
active, las **firmas hash-based (tipo SPHINCS+) son candidatas prioritarias
para la identidad de larga vida** — su seguridad descansa en hashes, no en
problemas de retículos, lo que las hace la apuesta más conservadora para una
identidad que debe durar décadas. Esto es dirección, no implementación; los
criterios de activación de arriba siguen mandando.

---

## Tabla de decisión por tecnología

| Tecnología | Decisión | Beneficio concreto | Amenaza que resuelve | Madurez estándar | Madurez librerías (RN) | Complejidad | Impacto Android | Tamaño/rend. | Riesgo impl. | Plan de migración |
|---|---|---|---|---|---|---|---|---|---|---|
| @noble/\* (curves/ciphers/hashes) | **ADOPT NOW** | Primitivas auditadas y mantenidas | Lib cripto abandonada (tweetnacl) | Alta (RFC 8032, CFRG) | Alta (ToB 2026, Cure53 2024) | Baja | Ninguno (JS puro, Hermes OK) | ~3 KB tree-shakeable | Bajo | Swap directo, mismo wire; vectores oficiales como tests |
| HKDF RFC 5869 | **ADOPT NOW** | KDF estándar + separación por propósito | Reutilización de claves entre contextos | Alta (RFC 5869) | Alta (@noble/hashes) | Baja | Ninguno | Despreciable | Bajo | Cambiar KDF de sesión; bump de versión de handshake |
| XChaCha20-Poly1305 | **ADOPT NOW** | AAD + nonces aleatorios seguros | Reutilización de nonce; headers no autenticados | Alta (draft IRTF + despliegue) | Alta (@noble/ciphers) | Baja-Media | Ninguno | Despreciable | Bajo | Vía C-3; header como AAD |
| SQLCipher (expo-sqlite) | **ADOPT NOW** | Cifrado real en reposo | Forense, robo, malware con acceso a ficheros | Alta (SQLCipher 4) | Alta (oficial Expo) | Media | Requiere rebuild nativo | +~MBs en APK | Medio | sqlcipher_export; fail-closed; clave en Keystore |
| Keystore StrongBox→TEE | **ADOPT NOW** | Claves no exportables en hardware | Extracción de claves | Alta (API 28+) | Nativo (módulo propio) | Media-Alta | Requiere HW real para probar matriz | Nulo | Medio | Intentar StrongBox, fallback TEE, exponer nivel |
| dataExtractionRules | **ADOPT NOW** | Bloquea device-transfer | Fuga por migración de dispositivo | Alta (API 31+) | Config plugin | Baja | Solo manifiesto | Nulo | Bajo | Plugin + test de prebuild |
| gitleaks + .npmrc + SBOM | **ADOPT NOW** | Sin secretos en repo; SBOM por release | Fuga de credenciales; supply chain opaca | Alta | Herramientas maduras | Baja | Ninguno | Nulo | Bajo | Pre-commit + CI/manual |
| Biometría UX (expo-local-auth) | **ADOPT NOW** (capa UX) | Fricción contra miradas ajenas | Shoulder surfing casual | Alta | Oficial Expo | Baja | Requiere build | Pequeño | Bajo | Prompt al abrir; documentar límite |
| Biometría criptográfica (KEK) | **ADOPT LATER** | La biometría autoriza la clave de verdad | Bypass del prompt por hook | Alta (Keystore) | Requiere módulo nativo propio | Alta | Nativo + UX fallback | Nulo | Medio | Módulo nido-p2p; invalidar al re-enroll |
| Noise_XX | **ADOPT LATER** | Handshake estándar, analizado | Handshake ad-hoc (aunque simple y sano) | Alta (rev. 34) | Media (solo vía libp2p) | Alta | Ninguno (JS) | Pequeño | Alto | Implementar contra vectores oficiales; auditoría externa antes de prod |
| Ratchet simétrico/msg | **ADOPT LATER** | Forward secrecy por mensaje | Compromiso de clave de sesión a mitad de charla | Alta (construcción estándar) | Propia (~20 líneas) | Baja | Ninguno | Nulo | Bajo | HKDF por mensaje + borrado |
| ML-KEM-768 híbrido | **EXPERIMENTAL** | Protección HNDL best-effort | Adversario cuántico futuro que cosechó hoy | Alta (FIPS 203, RFC 10024) | **Baja** (sin auditoría indep. en JS) | Media | Nativo o JS puro | +~1-2 KB por handshake | **Alto** | Cable cripto-ágil ya; activar solo con criterio cumplido |
| PQXDH | **REJECT** (hoy) | — | — | Alta | Nula para RN (libsignal: "uso externo no soportado", AGPL, no corre en Hermes) | — | Inviable | — | — | Reevaluar si aparece binding auditado |
| Double/Triple Ratchet | **REJECT** | — | La FS por mensaje se logra con ratchet simétrico | Alta | — | Alta | — | — | Alto | No implementar parcial |
| XSalsa20 nuevo código | **REJECT** | — | — | Media (sin IETF) | — | — | — | — | — | Mantener solo por compatibilidad |
| libsodium-wrappers (RN) | **REJECT** | — | — | Alta (en C) | Baja en RN (Hermes sin WASM → asm.js lento) | — | — | Grande | — | noble en JS; nativo solo si el rendimiento lo exige (react-native-quick-crypto) |
| Play Integrity | **REJECT** | — | — | Alta | Requiere red + Play Services | — | Incompatible con offline-first | — | — | Detección root advisory + attestation offline (futuro) |
| Google TTS como vía principal | **REJECT** | — | — | — | Sin garantía documentada de cero red | — | — | — | — | sherpa-onnx + Piper es_ES offline |
| Sentry/cloud crash reporting | **REJECT** | — | — | — | — | — | — | — | — | Crash reporting local opt-in |

## Métrica de progreso (por hito)

Cada hito debe poder responder: ¿qué ataque es ahora más caro o imposible, contra qué
atacante, y qué riesgo residual queda? Si no puede responderlo, no es un hito de seguridad.
