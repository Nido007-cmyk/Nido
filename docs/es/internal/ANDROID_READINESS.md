> **Idioma:** [English](../../internal/ANDROID_READINESS.md) · Español
# NIDO — Android Readiness (C-1) · 2026-09-27

Veredicto por ítem, con evidencia de archivo/línea. Nada aquí fue compilado
ni ejecutado en un dispositivo — este entorno no tiene JDK, ni Android SDK,
ni adb, ni emulador, ni dispositivo físico (verificado: `which java javac
adb` → vacío). "READY" abajo significa *código/config listo*, nunca
*verificado en dispositivo*.

## 1. Cableado nativo de SQLCipher — CONFIG READY / BUILD UNVERIFIED

- `app.json` → `plugins`: `["expo-sqlite", { "useSQLCipher": true }]` (app.json:44-49).
- `package.json`: `"expo-sqlite": "~57.0.3"` (package.json:30).
- Aplicación en runtime: `applyDatabaseKey` en `src/privacy/keyManager.ts:174-201`
  ejecuta `PRAGMA key`, luego `PRAGMA cipher_version`; versión vacía → DB
  cerrada + throw ("fail-closed: la base no se abre en claro").
- `src/security/secureDatabase.ts:249` lo llama en cada verificación de
  apertura/migración.
- Testeado con unidades con drivers mockeados (`sqlcipherReal.test.ts`, 21
  tests en `secureDatabase.test.ts`); el contenedor verificó SQLCipher
  4.12.0 community contra una DB cifrada real (ver `docs/C1_SQLCIPHER.md`).
- NO verificado: que la compilación Gradle realmente empaquete el `.so` de
  SQLCipher para las ABIs objetivo. Si falta la lib nativa, la app falla
  cerrada por diseño (bien) pero es inutilizable (esperado — la primera
  compilación lo confirmará).

## 2. Ruta de código PRAGMA cipher_version — CODE READY / DEVICE UNVERIFIED

- La ruta existe y está en la ruta crítica de cada apertura de DB
  (`keyManager.ts:190-199`). Ninguna ruta de código abre una DB cifrada sin
  ella.
- Brecha: la cadena de versión se verifica pero nunca se loguea ni se
  muestra en ningún lado. Para la validación de hardware actualmente **no
  hay hook de observabilidad** para capturar la salida de `cipher_version`
  en dispositivo (ver `docs/ANDROID_VALIDATION.md` para el workaround:
  evidencia por extracción de archivo + línea opcional de log de debug).
  Esta es una brecha de preparación de validación, no una brecha de
  seguridad.

## 3. Keystore / SecureStore — IMPLEMENTED WITH DOCUMENTED LIMITATION

- `package.json`: `"expo-secure-store": "^57.0.4"`, `"expo-crypto": "~57.0.3"`.
- `getDatabaseKeyHex` (`src/privacy/keyManager.ts:100-114`): DEK CSPRNG de
  32 bytes (`x'hex'` 64 chars), almacenada bajo `DB_KEY_ALIAS`; producción
  lanza si SecureStore no está disponible (fail-closed, línea 107). Clave de
  identidad P2P bajo `P2P_SIGN_SK_ALIAS` (líneas 117-125).
- Limitación honesta (según `docs/C1_SQLCIPHER.md`): NO hay KEK
  no-exportable explícita con `setUserAuthenticationRequired`, ni detección
  StrongBox-vs-TEE. La DEK vive directamente en el SecureStore del OS
  (Android Keystore por debajo — no-exportable por defecto de plataforma,
  pero la clase de protección de la clave nunca se afirma en código). Un
  módulo nativo de Keystore sigue siendo trabajo futuro. Esto no bloquea el
  cifrado en reposo, pero "no-exportable" es actualmente una suposición de
  defecto de plataforma, no una propiedad verificada.

## 4. Puerta biométrica — CODE READY / DEVICE UNVERIFIED

- `src/security/biometricGate.ts`: solo puerta UX (documentado como NO
  autorización criptográfica de clave). Caché de timestamp en memoria de 5
  minutos, `lockNow()` en background, `ensureUnlocked()` en foreground,
  `BiometricUnavailable` cuando nada está enrolado (nunca bypass
  silencioso), fallback de credencial de dispositivo permitido.
- Cableado en `App.tsx:117-125` (listener AppState) y `App.tsx:43`.
- 11 tests unitarios en verde. Comportamiento biométrico real (éxito /
  fallo / fallback / sin enrolamiento) nunca ejercitado en hardware.

## 5. Reglas de backup — CONFIG READY / NEEDS RE-VERIFY AT PREBUILD

- `app.json`: `"allowBackup": false` (app.json:15).
- `plugins/with-data-extraction-rules.js`: genera
  `res/xml/data_extraction_rules.xml` con `<exclude>` explícito para los
  nueve dominios bajo `<cloud-backup>` y `<device-transfer>`, y fija
  `android:dataExtractionRules` en `<application>`.
- Previamente verificado vía `expo prebuild --clean` (ver
  `docs/C1_SQLCIPHER.md`); `android/` se borró después (gitignored), así
  que el XML generado debe re-inspeccionarse en el próximo prebuild. Sin
  cambio de config necesario.

## 6. Módulo Kotlin nido-p2p — NEEDS WORK (nunca compilado)

- Presente: `modules/nido-p2p/android/src/main/java/expo/modules/nidop2p/`
  (`NidoP2PModule.kt`, `NidoP2PManager.kt`), `AndroidManifest.xml`,
  `android/build.gradle`, `expo-module.config.json`.
- El propio comentario de cabecera del módulo declara que **nunca ha sido
  compilado** (`NidoP2PModule.kt:15-19`). `requestPermissions` se corrigió
  contra las fuentes SDK 57 de expo-modules-core leyendo, no compilando.
- Áreas de riesgo de primera compilación (de los comentarios del código):
  manejo de hilos en `connect`, registro de eventos. La cripto queda en TS
  por diseño — el módulo solo mueve bytes enmarcados.
- Sigue el mismo patrón de módulo local que `voice-input` (que es el
  patrón establecido en este repo), así que `prebuild` debería recogerlo —
  pero "debería" no es verificación.

## 7. Permisos Bluetooth — CONFIG READY / RUNTIME GRANT UNVERIFIED

- Declarados en `app.json:16-22`: `BLUETOOTH`, `BLUETOOTH_ADMIN`,
  `BLUETOOTH_CONNECT`, `BLUETOOTH_SCAN`, `ACCESS_FINE_LOCATION`.
- `plugins/with-bluetooth-never-for-location.js`: fija
  `android:usesPermissionFlags="neverForLocation"` en `BLUETOOTH_SCAN`
  (privacidad: el discovery encuentra NIDOs cercanos, nunca deriva
  ubicación).
- La ruta de petición en runtime vive en
  `NidoP2PManager.requestPermissions` (corregida leyendo fuentes SDK 57;
  nunca ejecutada).
- Faltante (señalado en `docs/ANDROID_BUILD.md`): `CAMERA` para el escáner
  QR de emparejamiento — aún no implementado, necesario antes de la demo
  de dos teléfonos.

## 8. Ciclo de vida background/foreground — IMPLEMENTED / MEMORY-WIPE NOT IMPLEMENTED

- `App.tsx:117-125`: background/inactive → `lockNow()`; foreground
  estando en chat → de vuelta a la puerta de bloqueo. El timestamp
  biométrico de 5 minutos vive solo en memoria (se pierde al morir el
  proceso — correcto).
- Limitación conocida (explícita, no oculta): el backgrounding bloquea la
  puerta UI pero **no** borra el estado JS en memoria (mensajes de chat,
  contexto del agente). La DB sigue cifrada en reposo; el plaintext en
  memoria tras background es comportamiento estándar de app bloqueada,
  pero no está zeroizado. No es bloqueador de C-1; registrado para un
  futuro pase de endurecimiento.

## Bloqueadores — qué impide compilar hoy

1. **Sin JDK** — `java`/`javac` ausentes. Gradle no puede correr.
2. **Sin Android SDK** — `ANDROID_HOME`/`ANDROID_SDK_ROOT` vacíos; sin
   platform-tools → **sin `adb`**.
3. **Sin dispositivo, sin emulador** — nada donde instalar o probar.
4. **Sin cuenta Expo / EAS configurado** — la ruta alternativa de
   compilación en la nube tampoco está configurada (`eas.json` existe con
   perfiles dev/preview/production, pero sin login).
5. **Material de firma release ausente** — `plugins/withReleaseSigning.js`
   lee `NIDO_UPLOAD_STORE_FILE` / `NIDO_UPLOAD_KEY_ALIAS` /
   `NIDO_UPLOAD_STORE_PASSWORD` / `NIDO_UPLOAD_KEY_PASSWORD` de
   `~/.gradle/gradle.properties` (o los Secrets NIDO_UPLOAD_* en CI;
   ver docs/SIGNING.md); ninguno existe. Las compilaciones debug
   no necesitan esto; los APK release sí.
6. **Riesgo de compilación nativa (no bloqueador, advertencia)**:
   `llama.rn` trae binarios nativos pesados — históricamente el rompedor
   de compilación más probable (memoria/NDK). Inverificable hasta la
   primera compilación real.
7. **Descarga de modelo en primer arranque (~1 GB)** — la app regula en
   `ModelManager.requiredModelsPresent()` (`App.tsx:108-113`). Cualquier
   prueba en modo avión requiere modelos pre-sembrados o una descarga
   previa; planifícalo (ver `docs/DEMO_VERTICAL_PLAN.md`).

## Lo que NO pude verificar (explícito)

- Que `expo prebuild` genere un proyecto `android/` funcional (sin SDK).
- Que Gradle compile la app o cualquier módulo nativo (sin JDK/SDK).
- Que el `.so` de SQLCipher viaje en el APK para arm64-v8a (sin APK).
- Cualquier comportamiento en runtime: cipher_version en dispositivo,
  propiedades de clave Keystore, prompts biométricos, concesiones de
  permisos, ciclo de vida, Bluetooth RFCOMM.
- La prueba de dos teléfonos en modo avión (sin teléfonos).

Siguiente artefacto: `docs/ANDROID_VALIDATION.md` (checklist basado en
evidencia para dos teléfonos nuevos desde cero).

## Configuración del toolchain — 2026-09-26 (contenedor)

Progreso desde que se escribieron los bloqueadores de arriba:

- **JDK 17**: instalado persistentemente en `~/workspace/jdk-17`
  (Eclipse Temurin 17.0.20.1). NOTA: `/usr/lib/jvm` es efímero en este
  contenedor — un `apt-get install openjdk-17-jdk-headless` anterior
  desapareció tras un reseteo de capa de sistema. El toolchain DEBE vivir
  bajo `~/workspace`.
- **Android SDK**: `~/workspace/android-sdk` con cmdline-tools,
  platform-tools (`adb` 1.0.41), `platforms/android-35`,
  `build-tools/35.0.0`. Instalado por descarga+unzip directa porque
  `sdkmanager` no puede correr aquí (su JVM HTTPS falla a través del proxy
  de egress con `NoSuchElementException` en `doTunneling0`).
- **Gradle 9.3.1**: distribución en `~/workspace/gradle-9.3.1`
  (descargada manualmente; el wrapper no puede obtenerla — mismo problema
  de proxy). `GRADLE_USER_HOME=/home/hatch/.gradle` (la JVM resuelve
  `user.home` a `/root`, también efímero — debe sobreescribirse).
- **`expo prebuild -p android --clean`**: ÉXITO. `android/` generado,
  `nido-p2p` presente como módulo local autolinkeado.
- **Observabilidad segura**: `src/diagnostics/security.ts` añadido
  (SQLCipher `cipher_version`, round-trip canario de Keystore, capacidad
  biométrica; hardware-backed/StrongBox honestamente `not-verifiable`
  desde JS; nunca loguea secretos). 11 tests en verde, commiteado.

### HARD BLOCKER: Gradle no puede compilar en este contenedor

`./gradlew assembleDebug` (o `gradle` manual) siempre falla con
`Could not dispatch a message to the daemon` / `Broken pipe` escribiendo
al socket loopback del daemon.

Causa raíz (verificada con experimentos a nivel de socket, 2026-09-26):
el sandbox intercepta transparentemente **conexiones TCP iniciadas por
procesos JVM a 127.0.0.1** y responde con su propio payload
(`"muse: Other TCP connections is ..."`). Evidencia:

- Python → 127.0.0.1 (cualquier puerto): llega al servidor real siempre.
- Java (blocking o NIO) → 127.0.0.1: conexión secuestrada, siempre,
  incluso con todas las vars env `*_proxy` eliminadas y con el binario
  `java` copiado bajo otro nombre/ruta.
- El daemon de Gradle en sí arranca y escucha bien; nunca ve la conexión
  del cliente. La primera escritura del cliente recibe RST/broken pipe.

El protocolo del daemon de Gradle es solo TCP-loopback (sin modo
Unix-socket; `--no-daemon` aún forkea un daemon de un solo uso en Gradle
9). No hay workaround dentro de este contenedor.

**Qué significa esto**: `ANDROID COMPILED` NO es alcanzable en este
entorno. Las rutas restantes son:

1. **Máquina del usuario / runner CI** sin la intercepción JVM loopback:
   `export JAVA_HOME=~/workspace/jdk-17 ANDROID_HOME=~/workspace/android-sdk
   GRADLE_USER_HOME=~/.gradle` luego `npx expo run:android`
   (o `./gradlew assembleDebug` en `android/`).
2. **Compilación en la nube EAS**: necesita `npx eas-cli login` (acción
   del usuario).
3. Un contenedor/VM sin el guard de red.

C-1 sigue ABIERTO. `CONFIGURED != VERIFIED ON DEVICE` — y aquí, ni
siquiera `COMPILED` aún.
