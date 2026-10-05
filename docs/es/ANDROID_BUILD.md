> **Idioma:** [English](../ANDROID_BUILD.md) · Español
# Validación Android real — estado y bloqueos (2026-09-27)

## Veredicto
NIDO **no se puede compilar ni probar en este entorno**. Todo lo verificado
hasta ahora (357 tests, typecheck) es lógica TypeScript pura: no demuestra
que el APK compile, instale o funcione.

## Qué falta exactamente
1. **Android SDK**: no instalado (`ANDROID_HOME`/`ANDROID_SDK_ROOT` vacíos).
   Se necesita: Android SDK Platform 35 + Build-Tools 35 + Platform-Tools.
2. **JDK 17+**: `java` no existe en el contenedor. Requerido por Gradle.
3. **Dispositivo físico o emulador**: no hay ninguno conectado (`adb` ausente).
   El Bluetooth RFCOMM de la Fase E **no funciona en emulador**: exige 2
   teléfonos reales.
4. **Cuenta EAS** (alternativa): no configurada. Con EAS se podría compilar
   en la nube sin SDK local, pero seguiría faltando hardware para Bluetooth.

## Ruta de desbloqueo (cuando haya máquina con SDK o EAS)
```bash
# 1. Instalar SDK + JDK 17, aceptar licencias
# 2. En ~/workspace/nido-app:
npx expo prebuild -p android --clean   # obligatorio tras tocar app.json
npx expo run:android                   # compila e instala (debug)
# o: eas build --platform android --profile preview --local
```
`app.json` ya declara `team.nido.app`, `allowBackup: false` y el plugin
`withReleaseSigning` para el APK release.

## Permisos declarados (app.json → AndroidManifest vía prebuild)
- Existentes (Fases B–D): calendario, contactos, notificaciones, micrófono
  (voice-input), almacenamiento (document picker).
- Añadidos para Fase E (este cambio): `BLUETOOTH`, `BLUETOOTH_ADMIN`
  (máx. API 30), `BLUETOOTH_CONNECT` y `BLUETOOTH_SCAN` (API 31+),
  `ACCESS_FINE_LOCATION` (descubrimiento BT en API ≤ 30). El escaneo pide
  además `neverForLocation` donde aplique.
- Pendiente de añadir al implementar el escáner QR: `CAMERA`.

## Riesgos de compilación conocidos (no verificables sin SDK)
- `llama.rn@0.13.0-rc.4` trae binarios nativos pesados; es el candidato nº 1
  a romper el build (memoria/NDK).
- Los módulos locales (`voice-input`, futuro `nido-p2p`) deben seguir el
  patrón del módulo existente o `prebuild` los ignorará.
- `expo-sqlite` **no incluye SQLCipher**: el build release necesita la
  variante con cipher o el arranque fallará cerrado (by design).

## Checklist de validación física (para el día del teléfono)
- [ ] APK instala y arranca sin red (modo avión desde el primer arranque).
- [ ] Descarga de modelo solo a petición, con SHA-256 verificado.
- [ ] Auditoría de red vacía tras 10 min de uso sin descargas.
- [ ] TTS/STT funcionan en modo avión.
- [ ] Emparejamiento QR + chat entre 2 teléfonos (solo Bluetooth, sin Wi-Fi).
- [ ] La base `nido_memory.db` no se lee sin la clave (inspección con adb).
