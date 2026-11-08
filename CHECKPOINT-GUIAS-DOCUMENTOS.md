# CHECKPOINT · Pieza «Las guías se abren como documentos»

Carril de código de la casa (sin Claude), orden del dueño 2026-11-08.
Precisión de alcance del dueño (textual): «Solo lector de documentos de las
guías sin modelo». La puerta a nivel de App es únicamente el medio mínimo
para llegar al lector sin montar ChatScreen. Nada más entra.

## Base usada y delta (paso 0, verificado en disco)

- Worktree: `~/workspace/nido-guias-documentos`, rama
  `feature/guias-como-documentos`, creado desde `~/workspace/nido-importador`.
- Base exacta: `70aa7dd` (2026-11-07 19:19, «ci: el resto nombrado A4-02 se
  re-mide tras el re-cotejo»), la punta local más fresca de la casa: lleva la
  v0.1.80 publicada (commit de versión `46b985f`) y los ajustes de CI tras el
  re-cotejo de la v15. `package.json` = 0.1.80.
- Delta contra main de GitHub verificado por la casa el 2026-11-07
  (5bcda9ce): el objeto 5bcda9ce NO existe en ningún checkout local (git
  smart-HTTP está bloqueado en esta máquina; la casa publica por puente).
  La base local quedó en 70aa7dd el 2026-11-07 a las 19:19 y main se verificó
  en 5bcda9ce el mismo día con 6.286 pruebas verdes. Delta exacto: la rama
  remota entre el último commit importado y 5bcda9ce no está en disco; se
  declara NO MEDIBLE desde esta máquina. La pieza toca superficies que
  ninguna tanda reciente ha movido (App.tsx y el lector de packs), así que el
  riesgo de colisión al integrar es bajo; la integración la hace la casa por
  PR, como siempre.
- El worktree arrastra de `nido-importador` el fichero sin commitear
  `ACTA-IMPLEMENTACION.md` (entregable de la Pieza A, no código): no se toca
  ni se commitea en esta rama.

## Paso 0 · Mapa de datos (solo lectura, cerrado)

- App.tsx: `type Screen = "checking" | "wipe-recovering" | "wipe-blocked" |
  "startup-error" | "key-loss" | "vault-locked" | "locked" |
  "required-setup" | "chat"`. ChatScreen se monta solo con
  `screen === "chat"` y su `initModels()` carga LLM y embeddings al montar.
  Sin modelo, el desbloqueo enruta a `required-setup` (ModelSetupScreen,
  wizard intacto por alcance).
- Las guías de NIDO viven en los packs SQLite de `corpus/` (formato v2):
  tabla `guides` (id, key, lang, title, category, region, sources, verified)
  y tabla `chunks` (title, body, source, guide → guides.id). El texto
  completo de una guía = sus chunks unidos en orden, con la fila sin
  apartado primero (chunks.guide se añadió en el formato v2, 0.1.55).
- API existente que se reutiliza: `knowledgePacks()` y la apertura
  verificada `openPack()` en `src/rag/packs.ts` (controla existencia, estado
  del fichero y formato; no carga ningún motor: el SHA del modelo de
  embeddings solo gobierna la búsqueda vectorial, no la lectura).
- `readPackSource()` ya abre una guía entera desde un chunkId para
  SourceReader (dentro del chat). La lectura en sí nunca necesitó el modelo;
  faltaba la puerta.
- KnowledgeBaseScreen actual = atajo a documentos personales, no es el
  lector de guías. No se toca (rediseño de la Biblioteca fuera de alcance).
- i18n: `src/i18n/locales/{en,es,pt}.json`; la paridad la cobra
  `src/i18n/hygiene.test.ts` (mismas claves en los tres idiomas y toda
  clave literal de `t("…")` existe). Ya existe la sección `sourceReader`.
- Pruebas: unitarias con vitest (`npm test`); de componente con jest
  (`npm run test:components`, patrón `*.component.test.tsx`, jest.mock de
  módulos); typecheck con `npm run typecheck`.

## Decisiones de diseño (dentro del alcance preciso)

1. Datos: dos funciones nuevas en `src/rag/packs.ts`, sobre `openPack()`:
   `listPackGuides(packId)` (tabla guides, orden por id) y
   `readPackGuide(packId, guideId)` (chunks con `chunks.guide = guideId`,
   en orden; la fila de título exacto va primero si existe; si el pack no
   trae enlace guía→trozo, respaldo al emparejamiento por título que ya usa
   `readPackSource`). Devuelven null o lista vacía con honestidad cuando el
   pack no está, es de formato v1 o no trae guías.
2. Superficie: `src/ui/GuideLibraryScreen.tsx`, pantalla completa hermana:
   lista de packs instalados (los que se abren de verdad) con sus guías por
   idioma del pack; al tocar una guía, el lector ocupa la pantalla con el
   texto completo en un ScrollView (título, fuente y texto, como
   SourceReader pero sin resaltado ni modal). Cerrar vuelve a la lista;
   cerrar la lista vuelve a donde se entró. Sin buscador, sin favoritos.
3. Puerta mínima en App.tsx: `"library"` se añade a `Screen`. Entradas:
   (a) en `required-setup`, un botón secundario bajo el wizard que abre la
   biblioteca sin salir del flujo (volver cierra la capa y regresa al
   wizard); (b) en `locked`, el desbloqueo sin modelo va al wizard como hoy
   y el botón (a) cubre el acceso; con modelo listo el desbloqueo va al chat
   como hoy y NO se añade navegación nueva dentro del chat. La biblioteca se
   renderiza como capa sobre el contenido cuando `libraryOpen`, sin cambiar
   el estado de pantalla de fondo: ChatScreen no se monta si no era ya la
   pantalla activa, y si lo era, queda intacto debajo.
   Nota: con esto, en una instalación sin modelo el usuario desbloquea, ve el
   wizard (como hoy) y puede abrir la biblioteca a leer; el modelo no se
   carga en ningún paso de esa ruta.
4. Cadenas nuevas bajo la clave `guideLibrary` en en/es/pt (título, abrir
   chat, sin packs, sin guías, error de lectura, fuente, volver). El lector
   reutiliza `sourceReader.source` y `common.done` donde encajan. Sin
   guiones largos en ningún texto nuevo.

## Fuera de alcance (anotado, no se hace)

- Buscador dentro de la biblioteca; favoritos o marcadores; historial de
  lectura; compartir o exportar guías.
- Rediseño de la Biblioteca actual (KnowledgeBaseScreen) ni de la
  navegación o el Drawer del chat.
- Tocar el wizard (ModelSetupScreen), ChatScreen o `initModels()`.
- Lector para el corpus semilla de la app (Wikipedia de assets/corpus) ni
  para documentos personales: la pieza es el lector de las guías de los
  packs, que es lo que el dueño nombró.
- La Pieza B y la nota de apoyo (otro paquete).
- Push, PR y publicación: commit local y la casa integra.

## Estado por paso

- [x] Paso 0: base, worktree, mapa de datos, checkpoint.
- [x] Paso 1: API de lectura en packs.ts + pruebas unitarias.
  `listPackGuides` y `readPackGuide` añadidas a `src/rag/packs.ts` sobre
  `openPack()`; `src/rag/packGuides.test.ts` nuevo: 7 pruebas verdes a la
  primera (lista en orden, documento entero con la fila sin apartado
  primero, respaldo por título sin enlace guía→trozo, pack ausente, pack
  v1, guía inexistente, y cero llamadas a `llamaEngine.load` ni a
  `embeddingEngine.load` en toda la ruta). Nota de entorno: el worktree usa
  `node_modules` enlazado al de `nido-importador` (mismo árbol base);
  vitest sale con exit 0 medido por fichero de log, sin tuberías.
- [x] Paso 2: GuideLibraryScreen + puerta en App.tsx + i18n ES/EN/PT.
  Ajuste sobre la decisión 3: en vez de un estado de pantalla nuevo, la
  biblioteca es una capa (`libraryOpen`) pintada solo sobre `chat` o
  `required-setup` ya desbloqueados; al re-bloquear la app la capa
  desaparece con su pantalla madre y el gate biométrico nunca queda
  tapado. Entrada visible: botón «Leer las guías» bajo el wizard en
  `required-setup`. Dentro del chat no se añade navegación (fuera de
  alcance): la capa también puede abrirse sobre el chat, pero ningún
  botón nuevo vive dentro de ChatScreen. Paridad i18n cobrada por
  hygiene.test.ts (verde) y tsc limpio tras el paso.
- [x] Paso 3: pruebas de componente (la ruta no monta ChatScreen ni motores).
  `GuideLibraryScreen.component.test.tsx`: 5 verdes (lista, lectura
  entera y vuelta, estado vacío, error de lectura, cero cargas de motor).
  Dos hallazgos de entorno, no de la pieza: (1) jest sin vm-modules no
  soporta `import()` dinámico, y esta pantalla nació con importación
  diferida al estilo de SourceReader, que por eso mismo no tiene prueba
  de componente; la pantalla pasó a import estático de `../rag/packs`
  (módulo sin motores: la cadena de packs no carga llama.rn ni el motor
  de embeddings, verificado por tsc y por las propias pruebas); (2) el
  mock de `./theme` en jest necesita exportar también calmSpacing y
  calmRadii porque `theme/index.ts` los re-exporta desde `./calm`, la
  misma ruta que importa la pantalla.
- [x] Paso 4: suite completa + typecheck + commit local.
  Cierre medido en el worktree (2026-11-08): vitest completo exit 0,
  382 ficheros y 6.293 pruebas verdes (la casa verificó 6.286 en main el
  2026-11-07: +7 son las pruebas nuevas de esta pieza, sin regresiones);
  jest de componentes exit 0, 17 suites y 70 pruebas (65 de base + 5
  nuevas); `tsc --noEmit` exit 0. La base local no traía ningún fallo.

## Qué queda fuera (declarado)

- La ronda física del dueño: abrir la app sin modelo, tocar «Leer las
  guías» y leer una guía entera en su tableta. La prueba automatizada
  cubre la lógica y la superficie; el ojo del dueño cierra la pieza,
  como siempre.
- La integración a main (PR y puente) la hace la casa; esta rama no se
  ha pusheado ni ha tocado ninguna otra.
- Entrada al lector desde dentro del chat: la capa ya puede pintarse
  sobre el chat, pero añadir un botón dentro de ChatScreen o su Drawer
  era rediseño de navegación, fuera del alcance preciso del dueño. Si
  la casa lo quiere, es una pieza pequeña aparte.
