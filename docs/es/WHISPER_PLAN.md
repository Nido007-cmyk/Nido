> **Idioma:** [English](../WHISPER_PLAN.md) · Español

# NIDO — Plan STT offline real (whisper.cpp)

> Estado: investigación completada 2026-09-27. **No instalado ni probado**:
> requiere build nativo (sin Android SDK en este entorno).

## El problema que resuelve

El STT actual (`modules/voice-input`) envuelve el `SpeechRecognizer` del
sistema con `EXTRA_PREFER_OFFLINE`. Eso tiene dos fallos graves para una app
"100% offline y privada":

1. **Depende de un servicio del sistema** (normalmente el de Google). En
   GrapheneOS / ROMs sin Google no existe y el botón de voz simplemente no
   funciona. El módulo ya devuelve `isAvailable() = false` ahí en vez de
   fingir, pero el resultado para el usuario es "sin voz".
2. **`EXTRA_PREFER_OFFLINE` es una sugerencia, no una garantía**: el servicio
   del OEM puede igual mandar audio a la nube. No hay forma de auditarlo.

La entrada de voz debe funcionar sin Google, sin red y de forma auditable.
Eso es whisper.cpp corriendo en el propio teléfono.

## Decisión: `whisper.rn` 0.7.4

Binding React Native de whisper.cpp (mybigday/whisper.rn), verificado en
npm el 2026-09-27:

- Versión 0.7.4, descripción "React Native binding of whisper.cpp".
- Android: Gradle + CMake + NDK compilan `librnwhisper.so` (whisper.cpp como
  submódulo). Soporta Old y New Architecture.
- Expo: requiere prebuild (nuestro flujo ya es `expo prebuild --clean` +
  build nativo; no usamos Expo Go).
- API: `initWhisper({ filePath })`, `transcribe()`, `RealtimeTranscriber`
  para dictado en vivo; trae mock para Jest (`whisper.rn/jest-mock`).
- Solo depende de `safe-buffer` en npm. Probado en producción por terceros
  con Expo + New Architecture (p. ej. apps de subtítulos offline).
- Alternativa descartada: `@synervoz/edgespeech` (SDK comercial con plugin
  Expo). Funciona, pero introduce binarios cerrados y cuenta comercial;
  choca con el principio de auditabilidad de NIDO.

Riesgo a verificar en el primer build: compatibilidad fina con Expo SDK 57
/ RN 0.86. Si `whisper.rn` no compila, el plan B es un módulo Expo propio
que compile whisper.cpp directamente (mismo patrón que `llama.rn` ya usa
para llama.cpp en este repo).

## Modelos (español)

El usuario habla español → modelo **multilingüe** (los `.en` solo sirven
para inglés). Estrategia en dos niveles, descargables a demanda con el
`ModelManager` existente (igual que los LLM: el usuario pulsa descargar):

| Modelo | Tamaño aprox. | Uso |
|---|---|---|
| `ggml-tiny` multilingüe (+q8_0) | ~75 MB | Por defecto: rápido, español aceptable para comandos y dictado corto |
| `ggml-base` multilingüe (+q8_0) | ~145 MB | Opción de calidad en ajustes de voz |

No se empaquetan en el APK (duplicarían su tamaño); se descargan una vez
desde HuggingFace y quedan en los archivos de la app, como los GGUF.

## Integración propuesta

1. `npx expo install whisper.rn` (+ `expo-audio` para grabar; hoy no está
   en `package.json`).
2. Permiso `RECORD_AUDIO`: ya declarado por `modules/voice-input`; pedirlo
   en runtime antes de grabar (el flujo actual de `VoiceInputButton` sirve
   de base).
3. `src/voice/whisperSTT.ts`:
   - `initWhisper` perezoso con el modelo descargado (tiny por defecto).
   - Grabar con `expo-audio` a WAV 16 kHz mono → `transcribe()` al soltar
     el botón (v1 simple y robusta); `RealtimeTranscriber` como mejora v2.
   - Cadena de fallback honesta: whisper → módulo `VoiceInput` del sistema
     → mensaje claro "voz no disponible" (nunca fingir).
4. `VoiceInputButton` usa la nueva cadena sin cambiar su API.
5. `docs/ANDROID_BUILD.md`: añadir el paso de descarga del modelo STT.

## Validación en hardware (obligatoria)

- [ ] Compila con `whisper.rn` en el prebuild limpio.
- [ ] Con **modo avión activado**: dictar 10 frases en español → transcripción
      correcta sin red (la prueba que el STT actual no puede pasar).
- [ ] En un teléfono sin servicios de Google: el botón de voz funciona
      (whisper) aunque `VoiceInput.isAvailable()` sea falso.
- [ ] Tiempo de respuesta aceptable en gama media con `tiny` (< 2 s para
      frases cortas); documentar la medición real.
- [ ] Batería/RAM durante transcripción: sin anomalías en `SystemMonitor`.

## Costes honestos

- APK/almacenamiento: +75–145 MB solo si el usuario descarga el modelo STT.
- RAM/CPU durante la transcripción (medir en hardware, no estimar aquí).
- Complejidad de build: un binding nativo más (NDK). Mismo riesgo ya
  asumido con `llama.rn`.
