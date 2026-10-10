> **Idioma:** [English](AGENTS.md) · Español

# AGENTS.md — compilar e instalar BOAR desde el código fuente

Este archivo es para un agente de codificación de IA (o cualquiera que
automatice un build) que necesita pasar de un checkout limpio a una app
funcionando en un dispositivo Android real — los comandos exactos y las
restricciones no evidentes que hacen fallar el camino ingenuo. Para saber
qué *es* la app y cómo está diseñada, lee primero `README.es.md` y
`ARCHITECTURE.es.md`; este archivo solo cubre la mecánica de
build/instalación.

## El dato que lo cambia todo: esta NO es una app de Expo Go

Los `plugins` de `app.json` **no** incluyen `expo-dev-client` (retirado el 2026-09-27;
ver `.github/workflows/android-apk.yml`), y este repo tiene siete
**módulos nativos personalizados** (`modules/bundled-assets`, `modules/download-wake-lock`,
`modules/exact-alarm`, `modules/nido-p2p`, `modules/nido-secure-dialog`,
`modules/ram-monitor`, `modules/voice-input`) además de `llama.rn` (inferencia LLM nativa). Nada de eso
funciona dentro de la app genérica Expo Go del Play Store. Cada build debe pasar
por `expo prebuild` para generar un proyecto Android nativo real, luego un
build nativo real (`expo run:android` o un build en la nube con EAS) — no existe
la ruta "`expo start` + escanear el QR con Expo Go" para esta app. Si te tienta
ejecutar `npx expo start` y esperar que funcione de forma autónoma: no lo hará —
solo arranca el bundler Metro, al que luego se conecta un build dev-client
(construido por alguna de las dos rutas siguientes).

## Requisitos previos

- Node.js (cualquier LTS reciente; desarrollado con Node 24) y npm.
- Una de estas opciones:
  - **Un Android SDK + NDK + JDK local** (Android Studio instala los tres) —
    necesario para `expo run:android` (compila e instala directamente en un
    dispositivo/emulador conectado por USB).
  - **Ningún Android SDK local** — usa en su lugar la ruta de build en la nube
    con EAS (`eas.json` ya está configurado; necesita una cuenta de Expo,
    `npx eas-cli login`, sin toolchain local).
- Un dispositivo Android físico con la depuración USB habilitada y `adb` capaz
  de verlo (`adb devices` lo lista), si instalas localmente en lugar de vía
  EAS. El bounty/proyecto al que apunta esta app exige explícitamente un
  dispositivo real, no solo un emulador, para la verificación final — pero un
  emulador funciona bien para iterar durante el desarrollo.

## Compilar desde el código fuente e instalar (ruta con Android SDK local)

```bash
git clone <repo-url>
cd aoair_app
npm install
npx expo prebuild -p android --clean   # generates ./android from app.json + plugins — gitignored, regenerate any time
npx expo run:android --device          # builds the native app AND installs it on the connected device
```

O vía el `Makefile` (`make help` lo lista todo):

```bash
make install        # npm install (+ tells you whether you have the Android SDK)
make run-android    # prebuild + run:android
```

**`--clean` en prebuild no es opcional después de tocar `app.json` o sus
plugins** (icono, nombre, cualquier configuración nativa). Sin él, `expo prebuild`
puede dejar un proyecto `android/` desactualizado con valores viejos embebidos,
y un simple `npm install` nunca lo arreglará — jamás toca `android/`. Ante la
duda, `--clean`.

`make setup` es el asistente interactivo para humanos (`scripts/setup.mjs`); un
agente debería usar en su lugar los comandos explícitos de arriba. Lee las
respuestas de stdin, así que se puede automatizar si hace falta (p. ej.
`printf '2\n1\n' | node scripts/setup.mjs`).

## APK release (sin necesidad de Metro)

```bash
npx expo prebuild -p android --clean
cd android && ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a
# -> android/app/build/outputs/apk/release/app-release.apk
```

`plugins/withReleaseSigning.js` lo firma con la clave nombrada por
`NIDO_UPLOAD_STORE_FILE`, `NIDO_UPLOAD_KEY_ALIAS`, `NIDO_UPLOAD_STORE_PASSWORD`
y `NIDO_UPLOAD_KEY_PASSWORD` en `~/.gradle/gradle.properties` (nunca en el
repo). Sin ellas, el build release se firma en modo debug, lo cual está bien
para tu propio teléfono. Un APK firmado con otra clave no puede instalarse
sobre un BOAR existente: Android exige desinstalar primero, lo que borra los
modelos descargados por la app. Un primer build release tarda unos 40 minutos.

## Sin Android SDK local: compila vía EAS en su lugar

```bash
npm install
npx eas-cli login                                      # one-time, needs an Expo account
npx eas-cli build --platform android --profile preview # builds an installable .apk in the cloud
```

o `make build-eas`. Esto produce un `.apk` descargable (ver el perfil `preview`
de `eas.json`) — descárgalo y haz `adb install <archivo>.apk`, o transfiérelo
al dispositivo directamente.

## Después de instalar: la app no es usable de inmediato — falta un paso

El primer arranque muestra una **pantalla de configuración obligatoria y única**
que descarga el modelo por defecto (Qwen2.5-1.5B + un modelo de embeddings,
alrededor de 1 GB en total) — este es el único acceso a red requerido por la
app, y la app está bloqueada detrás de él
(`ModelManager.requiredModelsPresent()` en `src/models/ModelManager.ts` decide
si se muestra la pantalla de chat o el asistente de configuración). Si estás
automatizando un flujo desatendido de instalación-y-verificación, esta descarga
tiene que completarse (o pre-siembras los archivos — ver la siguiente sección)
antes de que la app sea usable de otro modo. Tras esa primera configuración, la
app funciona completamente offline.

### Omitir la descarga en la app (pre-sembrar modelos)

Si ya tienes los archivos de pesos GGUF en la máquina donde compilas, puedes
embebirlos en el propio APK en lugar de descargarlos en el primer arranque —
ver la sección "Pre-seeding models you already have locally" de
`docs/es/MODELS.md` para los nombres/checksums exactos y el flujo
`scripts/setup-models.sh` + `assets/models/` + `withBundledModels.js`. Esta es
una ruta de build genuinamente distinta (embebe ~3.2 GB en el APK, sin necesidad
de red en tiempo de ejecución), no la predeterminada — úsala solo si evitar la
descarga en la app importa para tu escenario.

## Verificar el build sin dispositivo (lo que un agente sin acceso a un dispositivo puede comprobar realmente)

```bash
npm run typecheck   # tsc --noEmit — must be clean
npm test            # vitest run — the full unit suite, native-module-dependent
                     # code (expo-sqlite/llama.rn/expo-file-system) is deliberately
                     # untested here; see src/rag/pure.ts and its siblings for
                     # what IS unit-tested and why
```

Ninguna de las dos prueba que el build/la instalación nativa funcione de
verdad — solo prueban que la capa JS/TS es internamente consistente. No hay
forma de verificar una instalación en un dispositivo real sin un dispositivo
real; no declares éxito solo con typecheck/tests si la tarea era específicamente
compilar/instalar.

## Medir el rendimiento de modelos en un teléfono conectado

Con un teléfono por USB, un agente puede ejecutar la evaluación de principio a
fin sin que nadie toque la pantalla. Guía completa:
[docs/es/DEVICE_EVALUATION.md](docs/es/DEVICE_EVALUATION.md).

```bash
adb devices                                  # exactly one device, state "device"
curl -s http://localhost:8081/status         # "packager-status:running" (Metro)
npm run eval:device -- --dry-run             # see every adb command first
npm run eval:device -- --models <name>       # run; results in eval-results/<date>/
npm run eval:summary -- --report <jsonl>     # report from a saved run
```

Antes y durante una ejecución:

- **Comprueba que el teléfono no esté ocupado.** `eval:device` recarga la app.
  No lo ejecutes, reinstales, fuerces la detención ni recargues mientras una
  descarga de modelo esté en curso (`adb shell dumpsys power | grep
  BOAR:ModelDownload`, o un archivo creciendo en `adb exec-out run-as
  team.sopa.aoair ls -l files/models`); las descargas no pueden reanudarse tras
  un reinicio. Es posible que el dueño del teléfono lo esté usando: pregunta
  primero.
- **No edites archivos fuente de la app durante una ejecución.** Metro los
  hot-reload en la app en ejecución, lo que puede interrumpir la evaluación.
  Documentos y scripts están bien.
- **Mantén la pantalla encendida.** Bloquear el teléfono pone la app en segundo
  plano. Si el teléfono no acepta `settings put global
  stay_on_while_plugged_in`, envía `adb shell input keyevent KEYCODE_WAKEUP`
  cada 30 segundos durante la ejecución y luego deténlo.
- **Usa `--queries greeting-1` para una prueba rápida** de un modelo nuevo (¿carga?,
  ¿qué formato de prompt recibe?) antes de una ejecución completa de 17 preguntas.
- **Reporta solo lo que el teléfono midió.** El JSONL es la fuente de verdad;
  un modelo que no carga se registra como fallos, no se omite.

Para comprobar un GGUF de Hugging Face antes de que nadie lo descargue, lee su
cabecera (los primeros MB) buscando `general.architecture` y
`tokenizer.chat_template`: la arquitectura debe ser compatible con el build de
llama.rn en `node_modules`.

## Construir un paquete de conocimiento

Guía completa: [docs/es/KNOWLEDGE_PACKS.md](docs/es/KNOWLEDGE_PACKS.md).

```bash
npm run pack:build -- --limit 200 --id test-pack   # quick check that the pipeline works
npm run pack:build                                 # the full Vital Articles level 5 pack
npm run pack:push -- build/knowledge-pack/<id>.sqlite  # copy onto a USB-connected dev build
```

- Un build completo de nivel 5 tarda horas (descargar ~50k introducciones, luego
  embedder); ejecútalo en segundo plano y deja que se reanude si se interrumpe,
  ya que cada paso queda cacheado en `build/knowledge-pack/<id>/`.
- Los packs deben embedderse con el modelo de la app
  (`assets/models/embedding.gguf`, verificado por SHA-256); la app ignora los
  packs construidos con otro.
- No commitees packs `.sqlite` a git; van a un asset de release (ver la guía).

## Problemas comunes

- **Pantalla en blanco/blanca, o "Failed to connect to `<LAN IP>`" tras arrancar
  Metro**: casi siempre es aislamiento cliente/AP del Wi-Fi (común en hotspots
  de teléfono y muchos routers) que impide que el teléfono y la máquina de
  desarrollo se alcancen entre sí, aun en la misma red. La depuración USB no se
  ve afectada. Solución: fuerza Metro por el túnel USB `adb reverse` en lugar
  del Wi-Fi — `npx expo start --localhost` (o `make start`, que ya lo hace).
- **`ClassNotFoundException: expo.modules.splashscreen.SplashScreenManager`
  en los logs**: una pista falsa — una excepción capturada, inofensiva y
  esperada de una comprobación de dependencia blanda dentro de
  `expo-dev-launcher`, no un problema real de build. No pierdas tiempo
  persiguiéndola.
- **Un directorio `android/` desactualizado causando errores raros de build tras
  editar `app.json`**: ver la nota de `--clean` más arriba.
- **No ejecutes comandos destructivos de git/reset nativo para "arreglar" un
  problema de build** (`rm -rf android`, force-pushes, etc.) sin comprobar
  primero `git status` y entender por qué falló realmente el build — la mayoría
  de los fallos de build aquí son los dos puntos anteriores, no algo que
  requiera arrasar el estado del repo.
