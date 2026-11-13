> **Idioma:** [English](../../release/FDROID.md) · Español

# F-Droid: preparación (borrador de trabajo)

Estado: **preparado, sin enviar.** Entrar en F-Droid es la decisión D8 del
dueño, y él decide cuándo. Nada de este documento se ha enviado a
gitlab.com/fdroid/fdroiddata. Lo escribió el paquete NIDO-MANT-2026-11-13
(encargo 5) el 2026-11-13, a partir del árbol de la v0.1.95-alpha.

El borrador de la receta está en
[`docs/release/fdroid/team.nido.app.yml`](../../release/fdroid/team.nido.app.yml).

## 1. Lo que F-Droid pide y dónde está NIDO

| Requisito | Estado en la 0.1.95 | Qué falta |
|---|---|---|
| Sin librerías de rastreo ni de Google (Firebase, Play Services) | **No cumple.** El APK no las arranca, pero las lleva compiladas | §2 y §3 |
| Compilar todo desde fuente, con herramientas libres | **No cumple.** Varias dependencias llegan ya compiladas | §3.2 |
| Licencia libre | Cumple: MIT | — |
| Metadatos | Casi: fastlane/metadata/android en en-US, es-ES y pt-BR | La receta de fdroiddata (borrador hecho) |
| Firma de NIDO (compilación reproducible) | Posible: reproducible.yml ya compara dos compilaciones | Que el APK de la release sea la misma compilación que hará F-Droid (§3.4) |

El permiso INTERNET no es un requisito de F-Droid y queda fuera de este
documento: es una decisión de producto aparte.

## 2. Inventario: qué es de Google y de dónde viene

Fuente: `android-runtime-dependencies.txt` de la release v0.1.95-alpha (el
árbol `releaseRuntimeClasspath` que publica la propia CI) y los `.dex` del
APK publicado. Todo lo no libre cuelga de **dos** dependencias directas:

| Dependencia directa | Qué trae | Para qué la usa | ¿La usa NIDO? |
|---|---|---|---|
| `expo-notifications` 57.0.24 | `com.google.firebase:firebase-messaging:25.0.1`, y con él firebase-common, -components, -installations, -iid-interop, -datatransport, -encoders, -measurement-connector; `play-services-base`, `-basement`, `-cloud-messaging`, `-stats` y `-tasks`; `com.google.android.datatransport` (transport-api, -runtime, -backend-cct); `kotlinx-coroutines-play-services` | Notificaciones push (FCM): token de push y temas | **No.** NIDO usa solo notificaciones locales: programar, cancelar, canales, permiso y oyentes (`src/notify/notifications.ts`, `src/services/appReset.ts`). Nunca pide un token de push |
| `expo-application` 57.0.3, que trae expo-notifications | `com.android.installreferrer:installreferrer:2.2`, el Install Referrer de Google Play (`com/google/android/finsky` en el dex) | `getExpoPushTokenAsync` lee el applicationId | **No** directamente. Pero su JS hace `requireNativeModule` al importarse: quitarlo del autolinking rompería el arranque |

Los módulos propios de NIDO (`modules/*`) no declaran nada de Google. Lo
demás que vive bajo `com/google/` en el dex es libre: Material Components,
Gson, errorprone y Guava, todo Apache-2.0.

**Qué pierde la app sin Firebase:** nada de lo que hace hoy. Los
recordatorios son notificaciones locales (AlarmManager y NotificationManager
de Android), que no pasan por Firebase. Firebase no puede arrancar en NIDO
(el APK no lleva `google_app_id`) y su entrada del manifiesto se quitó en la
0.1.95. Lo único que desaparece es el push remoto, que NIDO no usa ni puede
usar sin servidor.

## 3. El sabor sin Google: dos caminos

### 3.1 Por qué no una variante aparte, sino el APK de siempre

F-Droid puede publicar el APK firmado por NIDO solo si su compilación
coincide byte a byte con la de la release (`Binaries` y
`AllowedAPKSigningKeys` en la receta). Si el APK sin Google fuera una
variante distinta de la de GitHub, F-Droid lo firmaría con su propia clave.
Entonces quien pase de un APK a otro tendría que desinstalar, y desinstalar
borra los modelos descargados (hasta unos 5 GB). Como NIDO no usa nada de lo
que se quita, la propuesta es que **el APK de la release sea el que va sin
Google**, sin sabores. Si el dueño prefiere una variante `foss` aparte, los
cambios de abajo valen igual, aplicados solo a esa variante, y la receta
perdería `Binaries` y `AllowedAPKSigningKeys`.

### 3.2 Compilar desde fuente: cambios de configuración

Estos cambios afectan al APK de la release. Hace falta una compilación
Android de prueba antes de fusionarlos:

1. **Módulos expo desde fuente.** Cada `expo-*` trae su AAR ya compilado en
   `local-maven-repo/`, y el autolinking lo usa por defecto. En
   `package.json`:

   ```json
   "expo": {
     "autolinking": {
       "android": { "buildFromSource": [".*"] }
     }
   }
   ```

   La clave sale de `expo-modules-autolinking`
   (`ExpoAutolinkingConfig.buildFromSource`, `SettingsManager.configurePublication`).

2. **llama.rn desde fuente.** Su script de instalación descarga las `.so`
   ya compiladas de su release de GitHub. Hay que hacer `npm ci
   --ignore-scripts`; llama.rn es la única dependencia de producción con
   script de instalación (las otras dos, fsevents y node-llama-cpp, son de
   desarrollo). Además, `rnllamaBuildFromSource=true` en
   `android/gradle.properties`, escrito por un plugin de configuración (por
   ejemplo dentro de `withLlamaTrim`, vía `withGradleProperties`), para que
   la CI y F-Droid compilen igual. Con eso, `jniLibs.srcDirs = []` y CMake
   compila llama.cpp. Las librerías HTP y `libOpenCL.so` de `bin/` las saca
   ya `withLlamaTrim` (`ggml-hexagon/**`).
   *Sin medir:* cuánto tarda y cuánto ocupa una compilación nativa de
   llama.cpp desde fuente. La CI ya va justa de disco con arm64-v8a.

3. **Lo mismo en las dos workflows.** `android-apk.yml` y `reproducible.yml`
   tienen que compilar exactamente así (`--ignore-scripts`, propiedades y
   NDK 27.0.12077973), o la release y F-Droid no coincidirán.

### 3.3 Quitar Firebase y el Install Referrer

expo-notifications **compila** código Kotlin y Java que importa
`com.google.firebase.messaging.RemoteMessage` (8 ficheros),
`FirebaseMessaging` (2) y `FirebaseMessagingService` (1). expo-application
importa `InstallReferrerClient` e `InstallReferrerStateListener`. Excluir
las dependencias en Gradle sin más deja esas referencias colgando: R8 las
señala como clases que faltan y, si se silencian con `-dontwarn`, el fallo
pasa a la ejecución. Hay dos caminos:

**Camino A (recomendado): notificaciones locales propias.** Un módulo
nativo de NIDO (junto a `modules/exact-alarm`, que ya programa alarmas
exactas) sustituye a expo-notifications. Cubre lo que NIDO usa hoy:

- `scheduleNotificationAsync` y `cancelScheduledNotificationAsync`, más
  `cancelAll…` y `getAllScheduled…`;
- `setNotificationChannelAsync`, `requestPermissionsAsync` y
  `setNotificationHandler`;
- `getPresentedNotificationsAsync`, `dismiss…` y
  `addNotificationReceivedListener`.

Al salir expo-notifications sale también expo-application, y con ellos todo
lo de la tabla del §2. Es lo más limpio para F-Droid: no queda código de
Google ni en `node_modules` que el escáner tenga que borrar. Su coste:

- código nativo nuevo;
- migrar esos usos;
- repetir en el aparato la sección 5 de DEVICE_CHECKLIST (recordatorio con
  el teléfono bloqueado), más un reinicio del teléfono con recordatorios
  pendientes.

**Camino B (más corto y menos limpio): sustitutos libres.**

- Un módulo Android propio (MIT) con stubs de solo API para las tres clases
  de Firebase y las dos del Install Referrer. Los métodos devuelven null o
  lanzan `UnsupportedOperationException`; `RemoteMessage.Notification`
  necesita unos 25 getters.
- `resolutionStrategy.dependencySubstitution` en todos los proyectos,
  escrito desde un plugin de configuración, que cambia
  `com.google.firebase:firebase-messaging` y
  `com.android.installreferrer:installreferrer` por ese módulo.

Riesgos:

- las líneas originales siguen en los `build.gradle` de `node_modules`, y
  la receta tendría que reescribirlas en `prebuild`;
- F-Droid puede objetar stubs en espacios de nombres de Google;
- el código de push muerto sigue en el APK.

**Dónde se vuelve necesaria una compilación Android** (no se puede correr
desde este carril):

- tras cualquiera de los dos caminos, `./gradlew assembleRelease` con R8,
  y comprobar que no queda nada de `com/google/firebase`,
  `com/google/android/gms`, `com/google/android/datatransport` ni
  `com/google/android/finsky` en los `.dex` (el mismo escaneo que se hizo
  sobre la 0.1.95);
- y las compilaciones desde fuente del §3.2.

Los diffs de A o B no se dejan aplicados porque cambian el APK y no se
pueden probar aquí.

### 3.4 Reproducible con la firma de NIDO

`reproducible.yml` ya compila dos veces y compara con
`scripts/compare-apk.py`. El día que el APK salga sin Google y desde fuente,
la prueba es lanzarlo con `release_tag` de esa versión. Si coincide, la
receta puede llevar `Binaries` y `AllowedAPKSigningKeys`. La huella del
certificado de NIDO, comprobada contra el APK de la v0.1.95-alpha (firma v2,
un certificado), es:

`4bd73b2f31ce7e66ff3e2c03cd2ff44eabb38dc9e6eef178d8ad7795b50160cf`

## 4. Lo que F-Droid podría marcar aunque todo lo anterior esté hecho

- **NonFreeAdd** (promueve complementos no libres). El catálogo ofrece
  `lfm2.5-8b-a1b-q4km` bajo la «LFM Open License v1.0», que no es una
  licencia libre reconocida. Los demás modelos son MIT o Apache-2.0, y los
  packs CC BY 4.0 o CC BY-SA 4.0. Es una etiqueta, no un rechazo; quitarla
  sería quitar ese modelo del catálogo en la versión de F-Droid, y eso lo
  decide el dueño.
- **NonFreeNet** no aplica: NIDO no depende de ningún servicio de red no
  libre para funcionar. Las descargas son ficheros firmados de GitHub
  releases.

## 5. Pasos para el día de la decisión

1. **Configuración nueva (§3.2 y §3.3):** rama aparte, compilación Android
   de prueba, escaneo del dex sin Google, y `reproducible.yml` en verde con
   la configuración nueva.
2. **Versión sin Google:** release como siempre, por PR, con la CI en verde
   y la triple coincidencia.
3. **Pasada en el aparato:** DEVICE_CHECKLIST completa, con especial
   atención a la sección 5 (notificaciones) y a un reinicio con
   recordatorios pendientes.
4. **Prueba local con fdroidserver:** clonar fdroiddata, copiar el borrador
   a `metadata/team.nido.app.yml` y ajustar versionName, versionCode y
   commit. Después:
   - `fdroid readmeta` y `fdroid lint team.nido.app`;
   - `fdroid build -v -l team.nido.app`, en el buildserver o en un
     contenedor `fdroidserver`;
   - cerrar los «VERIFICAR» del borrador: Node 24, subdir con `android/`
     generado y nombre del APK de salida;
   - `fdroid scanner` sin hallazgos.
5. **Merge request a fdroiddata:** solo con el visto bueno del dueño, que
   es la decisión D8, y con la receta que pasó el punto 4.

## 6. Incertidumbres

- La lista de categorías vigente de fdroiddata no se comprobó desde aquí.
- No se sabe qué versión de Node trae el buildserver de F-Droid.
- Cuánto tarda y cuánto ocupa la compilación de llama.cpp desde fuente.
- Si las comprobaciones de `withLlamaTrim` en el ensamblado (que borra
  `ggml-hexagon/`) toleran que `bin/` no exista. Por cómo está escrito
  `syncRNLlamaHtpAssets` (`onlyIf` el directorio existe) debería, pero no
  está probado.
- Si F-Droid aceptaría los stubs del camino B.
