> **Idioma:** [English](../NETWORK_AUDIT.md) · Español

# NIDO — Auditoría de red (medida el 2026-11-24)

Medida contra el árbol que se publica como la próxima versión
(`main` en `1fd99f95`, el árbol final del lote del móvil; la
propia subida de versión aterriza en el PR de versión). El censo
anterior estaba fechado el 2026-09-27, dos meses y dieciséis
versiones atrás; este vuelve a correr cada conteo contra el
árbol vivo y lo sustituye.

Objetivo: verificar que la app no usa internet fuera de las
descargas explícitas que la persona inicia, y nombrar cada ruta
local por lo que es: local.

## Metodología (repetible, desde la raíz del repo)

```bash
# 1. Llamadas de red en JS/TS (sin tests):
grep -rln "fetch(\|globalThis.fetch\|new WebSocket\|EventSource\|XMLHttpRequest" src App.tsx --include="*.ts" --include="*.tsx" | grep -v "\.test\."
# 2. Subidas y actualizaciones por el aire:
grep -rn "uploadAsync\|expo-updates" src App.tsx package.json | grep -v "\.test\."
# 3. URLs remotas declaradas en el código (sin tests):
grep -rln "http://\|https://" src --include="*.ts" --include="*.tsx" | grep -v "\.test\."
# 4. Red en los módulos nativos:
grep -rln "HttpURLConnection\|OkHttp\|URLSession\|Socket" modules/*/android modules/*/ios
# 5. SDKs de telemetría/analítica en el manifiesto de paquetes:
grep -in "sentry\|amplitude\|mixpanel\|analytics\|segment\|posthog\|firebase" package.json
# 6. Puntos de descarga:
grep -rn "createDownloadResumable" src --include="*.ts" | grep -v test
```

## Resultado — cada ruta que sale del teléfono

Hay exactamente **un embudo de descarga**:
`src/models/ModelManager.ts` llama a `createDownloadResumable`
de expo-file-system (dos sitios), conducido por
`src/services/downloadManager.ts`. Toda descarga de la app pasa
por él, y todo destino sale del catálogo firmado de
`src/models/manifest.ts`: hoy, 33 pines SHA-256 y 11 revisiones
de origen fijadas en ese fichero.

| Superficie | Destino | Disparo | Verificación |
|---|---|---|---|
| Modelos de chat (LLM) | `huggingface.co` — los repos del catálogo (bartowski, unsloth, LiquidAI, google) | El toque de la persona: las descargas obligadas del asistente de inicio, o el botón de descarga de un modelo en Ajustes | SHA-256 por fichero en el catálogo; las descargas de Hugging Face resuelven una **revisión de commit fijada**, nunca la rama mutable |
| Modelos de embeddings | `huggingface.co` (bge-small de CompendiumLabs) y las releases de GitHub del proyecto (el e5 multilingüe) | El toque de la persona: activar una función de búsqueda, o su tarjeta en Ajustes | SHA-256 por fichero en el catálogo; revisión fijada donde el origen es Hugging Face |
| Paquetes de conocimiento | `github.com/Nido007-cmyk/Nido/releases` (knowledge-packs v17, v16, v6) | El toque de la persona sobre un paquete en Ajustes | SHA-256 por fichero en el catálogo |
| Índices de corpus | `raw.githubusercontent.com/Nido007-cmyk/Nido` (`corpus-standard.json`, `corpus-full.json`) | El toque de la persona sobre una descarga de corpus en Ajustes | SHA-256 por entrada en el catálogo |
| Un modelo que la persona añade desde Hugging Face | `huggingface.co`, en la dirección que la persona aporta | Sus propios gestos de añadir y descargar | La puerta de confianza: la descarga se comprueba contra el SHA-256 que la persona confirma para ese origen antes de que el modelo pueda cargar |
| Abrir un enlace | El navegador del sistema, fuera de la app | El toque de la persona, tras la tarjeta de confirmación | No es una llamada de la app: la app entrega un esquema de la lista permitida al sistema y no trae nada por sí misma |

Nada se descarga en segundo plano, por horario ni al abrir. Si
la persona nunca toca una descarga, la app no hace ninguna
petición a internet.

## Resultado — el cero medido

| Superficie | Hallazgo |
|---|---|
| `fetch` / WebSocket / EventSource / XMLHttpRequest en `src/` y `App.tsx` | **Ninguno** (el paso 1 de la metodología no devuelve ficheros) |
| Subidas (`uploadAsync`), actualizaciones por el aire (`expo-updates`) | **Ninguna**: ni las llamadas ni el paquete existen |
| SDKs de telemetría / analítica / reporte de fallos en `package.json` | **Ninguno** (el paso 5 no devuelve coincidencias) |
| Red en los 14 módulos nativos | Solo `nido-p2p`, y solo local (abajo). Los otros 13 módulos no abren ningún socket |
| Búsqueda web (Deep Research, respuestas) | Local: la descomposición y la recuperación corren contra el modelo del aparato y los corpus descargados. No hay búsqueda web en ninguna parte |

## Resultado — rutas locales, declaradas como locales

| Superficie | Ruta | Disparo |
|---|---|---|
| Relevo NIDO a NIDO | Bluetooth RFCOMM (`NidoP2PManager.kt`) o Wi-Fi en la misma subred: TCP + mDNS (`NidoLanManager.kt`), que solo acepta conexiones de direcciones privadas de la red local | Los gestos de emparejar y mensajear de la persona. Cifrado de extremo a extremo; nada transita por internet |

## El registro visible

Cada conexión de arriba queda escrita donde la persona puede
leerla: `src/privacy/networkAudit.ts` asienta inicios,
completaciones y fallos de descarga, conexiones LAN y Bluetooth
y el descubrimiento P2P en la base cifrada de la app, y la
tarjeta **Auditoría de red** de Ajustes enseña las últimas 500
entradas (solo host y ruta, nunca las cadenas de consulta). El
registro vive dentro del propio embudo: `ModelManager` asienta
sus descargas y el transporte P2P asienta sus conexiones, así
que ninguna ruta puede salir del teléfono sin pasar por la
pluma.

URLs que aparecen en el código pero nunca se llaman: los
enlaces de fuente de CDC y CPSC que se imprimen al pie de las
respuestas de seguridad, los textos de licencia de
`src/legal/licenses.ts` y los ejemplos trabajados dentro del
validador de enlaces y del catálogo de herramientas. Son texto
que la persona puede leer, no peticiones que la app haga.

## Conclusión

Tras las descargas que la persona elige, NIDO funciona sin
conexión. El único tráfico de internet es el embudo de arriba:
modelos, paquetes y corpus del catálogo desde dos anfitriones,
cada byte comprobado contra su pin. Sin telemetría, sin
analítica, sin sincronización, sin llamadas ocultas: medido, no
afirmado.

Nota: Expo añade `android.permission.INTERNET` al manifiesto en
el prebuild por defecto (las descargas lo necesitan). Cuando las
descargas terminan, ese permiso no lo usa nada más en tiempo de
ejecución; quitarlo rompería la descarga inicial, así que se
conserva a propósito y se documenta aquí.
