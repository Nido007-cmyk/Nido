> **Idioma:** [English](../NETWORK_AUDIT.md) · Español

# NIDO — Auditoría de red (2026-09-27)

Objetivo: verificar que la app no usa internet fuera de las descargas
explícitas de modelos/corpus que el usuario inicia en la configuración.

## Metodología (repetible)

```bash
cd ~/workspace/nido-app
# 1. Llamadas de red en JS/TS (excluye tests):
grep -rln "fetch(\|globalThis.fetch" src App.tsx --include="*.ts" --include="*.tsx" | grep -v "\.test\."
# 2. URLs remotas:
grep -rln "http://\|https://" src --include="*.ts" | grep -v "\.test\."
# 3. Red en código nativo de los módulos:
grep -rn "HttpURLConnection\|OkHttp\|URL(" modules/*/android --include="*.kt"
# 4. SDKs de telemetría/analítica en package.json:
grep -in "sentry\|amplitude\|mixpanel\|analytics" package.json
# 5. Descargas de archivos:
grep -rn "createDownloadResumable\|downloadAsync" src --include="*.ts" | grep -v test
```

## Resultado

| Superficie | Hallazgo |
|---|---|
| `fetch` / axios / WebSocket / EventSource en `src/` | **Ninguno** |
| URLs `http(s)` en `src/` | Solo `src/models/manifest.ts`: URLs de descarga de modelos (HuggingFace) y corpus (raw.githubusercontent.com). Son datos de configuración, no llamadas. |
| Red en Kotlin de `modules/*` | **Ninguna** (`nido-p2p` solo usa Bluetooth; los demás módulos no tocan red) |
| SDKs de analítica/telemetría | **Ninguno** |
| Descargas de archivos | Un único punto: `src/models/ModelManager.ts` → `expo-file-system` `createDownloadResumable`, solo con las URLs del manifest y **solo cuando el usuario pulsa descargar** en la configuración inicial |
| Deep Research | Local: descompone con el LLM del teléfono y recupera del corpus local (RAG). No hay búsqueda web. |
| P2P NIDO | Cero red por diseño: RFCOMM Bluetooth entre dispositivos; el handshake y los mensajes nunca salen del enlace local |

## Conclusión

La app es funcionalmente offline después de la configuración inicial. El
único tráfico de red posible es el que el usuario provoca a propósito para
descargar modelos. No hay telemetría, ni analítica, ni llamadas ocultas.

Nota: Expo añade `android.permission.INTERNET` al manifiesto en el prebuild
por defecto (lo necesitan las descargas de modelos). Cuando los modelos ya
estén descargados, ese permiso no se usa en tiempo de ejecución; quitarlo
del manifiesto rompería la descarga inicial, así que se conserva a
conciencia y documentado aquí.
