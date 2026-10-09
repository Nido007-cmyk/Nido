> **Idioma:** [English](README.md) · Español

# NIDO: tu agente, tu mundo

Asistente personal de IA que vive **100% en tu teléfono Android**. Privacidad
total por diseño: cero red tras la instalación, memoria cifrada en el
dispositivo, sin cuentas, sin nube, sin analítica.

Derivado de [BOAR](https://github.com/rferrari/boar-app) (MIT), ver
[ATTRIBUTION.es.md](ATTRIBUTION.es.md). NIDO se construye sobre la base
offline de BOAR con una arquitectura de agente original, memoria persistente
cifrada y privacidad por diseño.

## Idiomas de la documentación

El inglés es el idioma canónico de la documentación de este repositorio. Las
traducciones al español viven en un árbol espejo con rutas relativas
idénticas: `docs/X.md` → `docs/es/X.md`, `conformance/X` → `conformance/es/X`,
y los archivos raíz usan el sufijo `.es.md` (la contraparte en inglés de este
archivo es [README.md](README.md)).

Cada documento lleva una línea de navegación de idioma al inicio con enlace a
su contraparte.

## Qué hace

- **Chat local** con un LLM en el dispositivo (llama.cpp vía llama.rn).
- **Memoria persistente**: hechos, preferencias, personas y diario, cifrados
  con SQLCipher, clave en el Android Keystore.
- **Herramientas locales**: notas, recordatorios, hora del dispositivo, abrir
  apps. Ninguna toca la red (manifiesto en `src/agent/tools/manifest.ts`).
- **Bucle de agente** pensar → actuar → observar (`src/agent/loop/`), con
  validación determinista de cada llamada a herramienta.
- **RAG local**: tus documentos indexados en el teléfono (heredado de BOAR).
- **Auditoría de red**: cada conexión que la app hace queda registrada y
  visible en Ajustes (`src/privacy/networkAudit.ts`).
- **Español** como idioma principal.

## Privacidad: cómo NIDO difiere de BOAR

| Área | NIDO |
|---|---|
| Ajustes y SQLite en claro | Cifrado (SQLCipher + Keystore) |
| Backup de Google activado | `allowBackup=false` |
| Buscador de modelos (filtra intereses por red) | Eliminado |
| URLs `resolve/main` sin fijar | Revisiones fijadas (`pinnedSourceUrl`) |
| sha256 nunca verificado tras descargar | Verificación automática (≤256 MB) + bajo demanda |
| Sin visibilidad de red | Registro de auditoría en Ajustes |
| Telemetría persistente | Eliminada |

Detalles en [docs/es/PRIVACY.md](docs/es/PRIVACY.md).

**Auditorías de seguridad (oct 2026):** el protocolo P2P y el diseño de
delegación pasaron por una revisión de seguridad y dos rondas de auditoría
adversarial; todos los hallazgos accionables se corrigieron con tests de
regresión. Resumen público:
[docs/es/security/AUDITS_2026-10.md](docs/es/security/AUDITS_2026-10.md).
Para reportar una vulnerabilidad: [SECURITY.md](SECURITY.md).

## Estado actual

**Alpha (oct 2026):** 2314 tests automatizados en verde, `tsc` limpio. La
validación física en dos dispositivos está pendiente, la ejecución delegada
de tareas viene con su feature flag apagado, y aún no hay auditoría
criptográfica externa. Los APKs precompilados se distribuyen directamente
por ahora para pruebas en dispositivo.

## Instalación

Los APKs firmados y precompilados se distribuyen directamente por ahora
para pruebas en dispositivo (instala encima de la app existente: la firma
release conserva identidad, contactos y modelos descargados; para una pasada
de validación física se recomienda instalación limpia para descartar estado
viejo; ambos dispositivos deben usar el mismo build para P2P). Habrá GitHub
Releases públicos cuando se complete la validación física en dos dispositivos.

## Compilar e instalar

No funciona en Expo Go (módulos nativos: llama.rn, SQLCipher, etc.).
Necesitas Android SDK + NDK + JDK, o EAS.

```bash
npm install
npx expo prebuild -p android --clean
npx expo run:android --device
```

APK release:

```bash
npx expo prebuild -p android --clean
cd android && ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a
```

Verificación sin dispositivo (no prueba la instalación real):

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest — 2314 tests: agente, privacy, routing, rag, p2p
```

Guía completa de build en [AGENTS.es.md](AGENTS.es.md).

## Estructura

```
src/
  agent/        Capa de agente NIDO: memoria, herramientas, bucle
  privacy/      Auditoría de red
  inference/    LlamaEngine (heredado de BOAR, sin cambios)
  rag/          RAG híbrido local (heredado; db.ts → cifrado pendiente)
  models/       Catálogo + descargas (endurecido: auditoría, sha256, pins)
  services/     Descargas, documentos, resúmenes…
  ui/           Chat, ajustes, pantallas
  i18n/         locales/es.json ← idioma principal
```

## Licencia

MIT, ver [LICENSE](LICENSE) y [ATTRIBUTION.es.md](ATTRIBUTION.es.md).
