> **Idioma:** [English](ARCHITECTURE.md) · Español

# Arquitectura de NIDO

NIDO es un asistente personal con IA para Android que funciona por
completo en el teléfono. No hay cuenta, ni servidor, ni nube detrás:
el modelo de lenguaje, la base de conocimiento, la memoria y todas
las respuestas de seguridad viven en el aparato, y tras la
configuración inicial la app trabaja sin conexión. Este documento
describe cómo está construida la app hoy (versión 0.1.117). Para
saber qué hace, lee `README.es.md`; para compilarla, `AGENTS.es.md`.

## Reglas de diseño que el código hace cumplir

- **Sin conexión es el estado normal.** Las únicas peticiones de red
  que la app inicia son las descargas que empieza la propia persona
  (modelos y paquetes de conocimiento) y una comprobación opcional
  de actualizaciones. Toda petición pasa por una única API de salida
  y queda escrita en un registro de red que la persona puede
  consultar dentro de la app (`src/privacy/networkAudit.ts`).
- **El modelo es para conversar; la ayuda, no.** Las emergencias,
  las respuestas de crisis y buena parte de las peticiones de cada
  día las responde código determinista con textos fijos y
  verificados. Nunca esperan al modelo y funcionan aunque el modelo
  ni siquiera pueda cargarse.
- **Lo que se guarda es lo que pasó la revisión.** Una respuesta del
  modelo que llega al historial, a una exportación o a la lectura en
  voz alta es la respuesta después de que el juez de fundamentación
  la contrastó con sus fuentes, no la generación en bruto.
- **Privado por construcción.** Los datos personales viven en bases
  de datos cifradas en reposo. Nada personal sale del teléfono; la
  única excepción es el canal cifrado entre dos teléfonos que la
  persona abre a propósito (ver «Hablar con otro NIDO»).
- **Manda el hardware modesto.** La app se construye y se prueba
  pensando en teléfonos y tabletas corrientes, no en buques
  insignia: la elección de modelo, el tamaño de contexto y los
  presupuestos de memoria se reducen con honestidad en los aparatos
  pequeños en vez de fallar en silencio.

## Pila técnica

- **Carcasa**: Expo (React Native 0.86, React 19) con TypeScript,
  compilada como app nativa a medida. No puede correr en Expo Go:
  la app trae catorce módulos nativos propios (abajo) además de la
  inferencia nativa.
- **Inferencia**: `llama.rn` (los bindings de llama.cpp para React
  Native) ejecuta modelos GGUF en el aparato, con los pesos
  mapeados en memoria y la salida por flujo
  (`src/inference/LlamaEngine.ts`). Una capa de enrutado
  (`src/routing/`) planifica cada turno con reglas sencillas, nunca
  con el propio modelo, así que el mismo mensaje toma siempre la
  misma ruta.
- **Almacenamiento y búsqueda**: SQLite mediante `expo-sqlite`,
  cifrado con SQLCipher para los datos personales, con FTS5 para la
  búsqueda por palabras y un modelo de embeddings integrado para la
  búsqueda por vectores. Un módulo nativo (`modules/nido-vectors`)
  hace la búsqueda vectorial exacta sobre los embeddings de un
  paquete desde un índice mapeado en memoria.
- **Idiomas**: la interfaz, las respuestas fijas y la guía están
  escritas por completo en español, inglés y portugués
  (`src/i18n/locales/`), con pruebas automáticas de paridad entre
  los tres.

## Cómo obtiene respuesta un mensaje

1. **Primero, la seguridad y las rutas fijas.** Detectores
   deterministas (`src/routing/emergencyGate.ts`,
   `src/agent/loop/safetyAnswers.ts`) reconocen emergencias,
   autolesión, monóxido de carbono y otros temas urgentes y
   responden al momento con textos fijos y números verificados, sin
   cargar el modelo. Una emergencia escrita mientras otra respuesta
   se está generando también puede enviarse.
2. **Herramientas deterministas.** Recordatorios, notas, memoria,
   calendario, cálculos, temporizadores y peticiones parecidas las
   atienden los enrutadores y las herramientas del agente
   (`src/agent/`, `src/routing/`), que actúan sobre el almacén
   cifrado y responden en el idioma de la persona.
3. **Clasificación por significado.** Una puerta semántica
   (`src/routing/semanticGate.ts`) suma clasificación por
   significado a las listas de palabras en los temas de salud y
   emergencia, usando los mismos vectores de búsqueda que la
   recuperación.
4. **Recuperación.** Cuando una pregunta necesita conocimiento, la
   búsqueda híbrida (FTS5 más vectores) mira en el corpus integrado,
   en los paquetes de conocimiento instalados y en los documentos
   de la propia persona (`src/rag/`), y las mejores fuentes viajan
   con la pregunta dentro del contexto del modelo.
5. **Responde el modelo.** La generación sale token a token, con
   presupuestos de contexto y de salida que el enrutador fija según
   la ruta (`src/routing/router.ts`).
6. **El juez la revisa.** El juez de fundamentación
   (`src/rag/grounding.ts`) compara la respuesta con las fuentes
   que recibió: lo que no tiene apoyo se retira o la respuesta cae
   a un texto seguro, y una comprobación de fuentes
   (`src/rag/sourceCheck.ts`) señala las cifras que contradicen a
   una fuente. Solo la respuesta juzgada se enseña, se guarda, se
   exporta o se lee en voz alta.

## Conocimiento

- Dentro de la app viaja un corpus inicial de 858 temas
  (`assets/corpus/corpus.json`) que se indexa en el primer
  arranque, así que la app responde preguntas de conocimiento sin
  conexión desde el primer minuto.
- **Los paquetes de conocimiento** son ficheros SQLite con los
  textos, un índice FTS5 y los embeddings. La configuración ofrece
  cuatro niveles (mínimo, estándar, completo, enciclopedia). Dos
  paquetes, NIDO Esencial y NIDO Local, viajan dentro del APK y se
  instalan en el primer arranque; el resto se descarga cuando se
  pide. Cada paquete se verifica por SHA-256 contra un catálogo
  firmado antes de aceptarse (`src/models/manifest.ts`,
  `src/models/manifestSignature.ts`).
- **La biblioteca de la persona**: los documentos que importa (la
  extracción de texto de PDF y el OCR corren en el aparato,
  `src/services/documentImporter.ts`) se indexan de la misma manera
  y solo responden ante su dueño.

## Memoria, bóveda y respaldos

- Los chats, la memoria, las notas, los recordatorios y los
  contactos se guardan en bases de datos cifradas con SQLCipher
  (`src/security/databaseManager.ts`). La clave de la base se
  envuelve con una clave de hardware guardada en el Android
  Keystore; tras un reinicio, usarla pide el PIN, el patrón o la
  huella fuerte de la persona (`src/security/keyVault.ts`,
  `modules/nido-keyvault`).
- Un respaldo copia la base todavía cifrada, con un manifiesto de
  sumas de verificación; la persona guarda la clave aparte, en
  papel o donde elija. Ninguna mitad sirve sin la otra, y ningún
  servidor ve jamás ninguna de las dos (`src/security/backup.ts`).
- El borrado de pánico destruye primero la base, la bóveda y las
  claves de la conexión entre teléfonos, y después todo lo demás.

## El agente y sus permisos

El agente (`src/agent/`) trabaja mediante herramientas: puede poner
recordatorios, guardar notas y memoria, leer el calendario, hacer
cálculos, gestionar tareas programadas y más. Cada herramienta tiene
un permiso que la persona controla, cada acción queda escrita en un
registro que puede revisar, y las acciones destructivas preguntan
antes mediante un diálogo nativo cuya ventana está protegida contra
capturas de pantalla (`modules/nido-secure-dialog`). Los
recordatorios suenan con alarmas exactas (`modules/exact-alarm`,
`modules/nido-notify`), sin Firebase y sin servicios de Google de
por medio.

La guía integrada («Aprende a usar NIDO», `src/guide/`) enseña cada
función con ejemplos que la persona puede enviar. Sus lecciones
viven en los ficheros de idioma como el resto del texto, y las
pruebas envían cada ejemplo de cada lección, en los tres idiomas,
por los enrutadores reales: una lección no puede prometer algo que
la app ya no hace.

## Hablar con otro NIDO

Dos teléfonos con NIDO pueden intercambiar mensajes y tareas
delegadas por Wi-Fi local o Bluetooth (`src/p2p/`,
`modules/nido-p2p`). El canal va cifrado de extremo a extremo con
NaCl: un par de claves de identidad X25519, un handshake firmado con
Ed25519, claves de sesión efímeras por conexión y XSalsa20-Poly1305
para los mensajes (`src/p2p/crypto.ts`), con un componente
poscuántico en el intercambio de claves (`src/p2p/pq.ts`). El
emparejamiento se confirma comparando una huella en un diálogo
nativo, y las delegaciones que llegan caen en una bandeja de
aprobación: nada de otro teléfono se ejecuta sin aprobación.

## Módulos nativos

Catorce módulos locales bajo `modules/` cubren lo que React Native
no alcanza: `bundled-assets` (copia a disco los paquetes que viajan
en el APK), `download-wake-lock`, `exact-alarm`, `nido-cpr` (el
metrónomo de la práctica de RCP y el medidor de ritmo por cámara),
`nido-keyvault`, `nido-launch` (accesos directos, destino de
compartir y el mosaico de ajustes rápidos), `nido-notify`,
`nido-ocr`, `nido-p2p` (el transporte Bluetooth; la criptografía
vive en `src/p2p/`), `nido-pdf-text`, `nido-secure-dialog`,
`nido-vectors`, `ram-monitor` (la memoria real del proceso que
enseña el monitor del sistema) y `voice-input` (reconocimiento de
voz sin conexión mediante el reconocedor propio del aparato).

## Pruebas y verificación

Cada pull request corre en CI el comprobador de tipos y la suite
automática entera, además del escaneo de secretos y la paridad de
movimiento de la práctica de RCP. La corrida que construyó la
0.1.117 pasó 9.975 pruebas automáticas: 9.808 en vitest repartidas
en 559 ficheros y 167 pruebas de componentes en jest, sin ningún
fallo. Las reglas de comportamiento que nunca deben cambiar en
silencio están escritas en la constitución
(`docs/NIDO_CONSTITUTION.md`) y se comprueban por script;
`conformance/` y `formal/` guardan el material de conformidad y el
formal. Las pruebas automáticas no sustituyen a un teléfono de
verdad: las versiones 0.1.114 y 0.1.115 también pasaron por las
manos del dueño en una Galaxy Tab A9+ física.

## Estructura de carpetas

```
App.tsx / index.ts        puntos de entrada; la puerta de configuración y luego el chat
src/
  routing/                planificación de rutas, puerta de emergencia, puerta semántica
  agent/                  herramientas, registro de acciones, respuestas fijas de seguridad
  rag/                    recuperación, juez de fundamentación, comprobación de fuentes
  inference/              la envoltura de llama.rn, presupuestos de memoria y presión
  models/                 catálogos de modelos y paquetes, manifiesto firmado, descargas
  security/               bases cifradas, bóveda de claves, respaldo y restauración
  privacy/                gestor de claves, el registro de auditoría de red
  p2p/                    cripto entre teléfonos, handshake, delegación
  guide/                  la estructura y las promesas de la guía integrada
  i18n/                   los ficheros de idioma: español, inglés y portugués
  ui/                     pantallas y componentes
  services/               historial de chat, importación de documentos, citas, investigación
  voice/ cpr/ notify/     voz de entrada y salida, práctica de RCP, notificaciones
modules/                  los catorce módulos nativos locales
knowledge-packs/          las fuentes de los paquetes y el libro de releases
assets/corpus/            el corpus inicial integrado
docs/                     documentos de diseño, seguridad y producto
scripts/                  herramientas de construcción, paquetes y verificación
.github/workflows/        los flujos de CI, releases y paquetes
```

## Origen y licencia

NIDO nació como un fork de BOAR, una app de investigación de IA sin
conexión, y desde entonces se ha extendido mucho: las rutas de
seguridad, el juez de fundamentación, la memoria cifrada, los
paquetes de conocimiento, la guía y el canal entre teléfonos son
obra de NIDO. El proyecto se publica bajo la licencia MIT (ver
`LICENSE`); `ATTRIBUTION.md` conserva el crédito de BOAR y de cada
pieza de terceros sobre la que se apoya la app.
