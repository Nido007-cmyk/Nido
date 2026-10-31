> **Idioma:** [English](../KNOWLEDGE_PACKS.md) · Español

# Knowledge packs

NIDO responde desde una base de conocimiento offline en el teléfono. Siempre tiene
la pequeña integrada (unos 5.300 artículos cortos derivados de Wikipedia). Un
**knowledge pack** añade muchos más artículos en un solo archivo listo para usar:
texto, un índice de búsqueda por palabras clave y embeddings, todo construido en un
ordenador para que el teléfono no tenga que indexar nada.

## Usar el pack listo

El asistente de configuración ofrece el pack Wikipedia Vital Articles como descarga
opcional, y Ajustes → Offline Knowledge Base también lo lista. No necesitas nada
de lo siguiente salvo que quieras un pack mayor o personalizado.

## Construir el tuyo

Necesitas un ordenador con Node.js y este repositorio (`npm install` hecho), y una
conexión a internet para la construcción (el teléfono sigue offline).

```bash
npm run pack:build                        # Wikipedia Vital Articles level 5 (~50k articles, ~2-3 hours)
npm run pack:build -- --level 4           # level 4 (~10k articles, ~30 minutes)
npm run pack:build -- --titles my.txt     # your own list: one Wikipedia article title per line
npm run pack:build -- --limit 200         # a quick test build
npm run pack:build -- --help              # all options
```

O con make: `make knowledge-pack` (nivel 5) o `make knowledge-pack-small` (nivel 4).

Lo que hace el constructor:

1. Obtiene la lista de títulos: cada artículo enlazado desde las listas de
   [Vital Articles](https://en.wikipedia.org/wiki/Wikipedia:Vital_articles) de Wikipedia
   en el nivel elegido, o tu propia lista.
2. Descarga la introducción de cada artículo a través de la API de Wikipedia.
3. Divide las introducciones en fragmentos de unos 600 caracteres (máximo 3 por
   artículo).
4. Incrusta cada fragmento con el mismo modelo bge-small-en-v1.5 que usa la app
   (`assets/models/embedding.gguf`, descargado y verificado por checksum si falta),
   usando llama.cpp a través de `node-llama-cpp`. Los embeddings de escritorio y
   teléfono coinciden (similitud coseno 0.9999).
5. Escribe un archivo SQLite con los fragmentos, un índice de palabras clave FTS5 y los
   embeddings (8-bit), más metadatos.

Durante la incrustación, `node-llama-cpp` puede avisar de que tokenizar y
detokenizar el modelo "resulted in a different text". Es esperado para este modelo (su
tokenizador pone el texto en minúsculas) y no afecta a los embeddings.

Cada paso se cachea en `build/knowledge-pack/<id>/`, así que si la construcción se
detiene puedes ejecutar el mismo comando de nuevo y continúa donde lo dejó.

La publicación es atómica: el pack y sus JSON laterales se construyen sobre un
hermano `.tmp` y se renombran sobre el destino solo cuando están completos, así
que una construcción que falla a mitad nunca destruye la edición buena que ya
estaba en esa ruta.

El resultado:

```
build/knowledge-pack/<id>.sqlite        the pack
build/knowledge-pack/<id>.sqlite.json   its size, SHA-256, article and chunk counts
```

El texto de Wikipedia es CC BY-SA 4.0; conserva la atribución si compartes un pack.

### Los packs de guías de NIDO

El constructor también acepta guías en Markdown en vez de títulos de
Wikipedia:

```bash
npm run pack:build -- --guides knowledge-packs/nido-esencial --id nido-esencial --embedding e5
```

Cada guía es un fichero `.md` con cabecera (`title`, `lang`, `sources` y,
si hace falta, `category`) y secciones que empiezan con `##`. Cada sección
se convierte en uno o más trozos llamados «Título de la guía — Sección»;
las secciones muy cortas (una introducción de una línea, la nota de
cierre) se pliegan en una vecina. La licencia y la atribución del pack
dicen que el texto lo escribió NIDO desde las fuentes citadas (CC BY 4.0).

`knowledge-packs/nido-esencial/` es el pack propio de NIDO: 58 guías en
cada uno de español, inglés y portugués (el portugués llegó en la 0.1.65)
de primeros auxilios, salud en casa, desastres y supervivencia, escritas
desde la Cruz Roja, la AHA, la OMS, UNICEF, los CDC, FEMA y otras guías
públicas (cada guía cita sus fuentes). `scripts/check-pack-retrieval.mjs`
comprueba que las preguntas reales (`retrieval-checks.json`) encuentran
la guía correcta, y CI (`.github/workflows/knowledge-pack.yml`) lo
construye y lo comprueba. Es el primero de una familia de packs de guías,
todos publicados juntos en la release `knowledge-packs-v6`: `nido-local`
(números de emergencia y avisos de 69 países, en español e inglés, con su
tabla de datos verificados), `nido-ninos`, `nido-crisis` (con las líneas
de crisis verificadas de 14 países), `nido-sin-servicios`, `nido-hogar`,
`nido-desastres`, `nido-campo` y `nido-viaje`, cada uno en español, inglés
y portugués. Las ediciones corregidas de `nido-local`, `nido-crisis` y
`nido-viaje` se publicaron en la release `knowledge-packs-v7` con la
0.1.66: en `nido-local` cada dato queda citado a una fuente oficial
alcanzable, y en `nido-crisis` y `nido-viaje` se corrigieron los
metadatos de recuperación de una guía de cada uno. Una edición
corregida más de `nido-local` se publicó en la release
`knowledge-packs-v8` con la 0.1.67: su dato de Portugal cita ahora la
frase exacta de su fuente.

### Formato v2: preguntas indexadas y datos verificados (0.1.55)

Una guía de Markdown puede declarar en su cabecera `id` (igual en todos los
idiomas, p. ej. `local-chile`), `region` (código ISO 3166-1), `verified` (fecha
de la última comprobación) y `questions` (preguntas reales que responde,
separadas por `|`). Cada sección puede añadir las suyas con una línea
`<!-- preguntas: … | … -->`. Se indexan con la sección (texto y embedding) pero
no se muestran; las preguntas de `retrieval-checks.json` deben ser distintas,
para que la prueba siga midiendo la búsqueda de verdad.

La carpeta del pack puede llevar `facts.json`: regiones (nombres, frase «en X»,
alias) y datos, cada uno con `key`, `region`, `value`, `label` en es/en/pt y una
`source` con `title`, `url`, la cita exacta (`quote`) de esa página y la fecha
`checked`. El constructor rechaza un dato al que le falte algo. La app responde
«¿a qué número llamo en X?» desde esta tabla, sin búsqueda ni modelo, y cita la
fuente y la fecha. `scripts/check-pack-claims.mjs` vuelve a abrir cada fuente y
comprueba que la cita sigue ahí; `.github/workflows/pack-claims.yml` lo ejecuta
cada semana.

Un pack v2 (`meta.formatVersion = 2`) añade las tablas `guides`, `regions`
y `facts` y la columna `chunks.keys`; las versiones antiguas de la app lo
siguen leyendo como antes.

## Poner un pack en tu teléfono

**Para probar, por USB** (un build de desarrollo de NIDO, depuración USB activada):

```bash
npm run pack:push -- build/knowledge-pack/<id>.sqlite
```

Copia el archivo al almacenamiento de la app y lo verifica. NIDO usa cualquier pack
válido en su carpeta `corpus/` desde la siguiente pregunta, sin cambios de código.

**Para todos los que instalen tu build**, añádelo al catálogo para que la app pueda
descargarlo:

1. Sube el archivo `.sqlite` a algún lugar público, por ejemplo como asset de un
   GitHub Release (los archivos de más de 100 MB no pueden ir en el propio repositorio git).
2. Añade una entrada a `CORPUS_CATALOG` en `src/models/manifest.ts` con
   `kind: "corpus"`, `format: "sqlite-pack"`, `filename: "corpus/<id>.sqlite"`,
   y el tamaño y SHA-256 del resumen `.json`.
3. Para ofrecerlo en el asistente de configuración, añade su id a los `corpusPackIds`
   de un tier (`TIERS` en el mismo archivo).

## Cuando un pack tiene una versión nueva

Una versión nueva de la app puede traer una versión nueva de un pack del
catálogo (otro tamaño y otra SHA-256 en el catálogo firmado). El pack que ya
está en el teléfono no se borra: sigue siendo exactamente el archivo que se
verificó al instalarlo, así que la app lo sigue usando, también sin conexión,
y en la lista de Packs aparece **Actualización disponible**. Las respuestas con
números de emergencia sacadas de él avisan de que vienen de una versión
anterior del pack, junto a la fecha en que se comprobó cada fuente. La versión
nueva reemplaza al archivo viejo solo cuando termina de descargarse y su
SHA-256 queda verificada; si la descarga falla o se corta, el pack viejo se
queda. Un archivo de pack que cambió después de instalarse (cualquier otro
contenido) no cuenta como versión anterior: se borra, como antes. Los modelos
mantienen la comprobación estricta.

## Publicar una versión nueva de un pack

Un archivo de una release de NIDO publicada no se sustituye nunca. Cada versión
de la app solo acepta los bytes exactos que nombra su propio catálogo firmado,
así que sobrescribir un archivo en la misma dirección deja sin descarga a todas
las apps anteriores que apuntan a él (pasó una vez: se republicó
`knowledge-packs-v5/nido-local.sqlite` para la 0.1.58 y la 0.1.57 dejó de poder
bajarlo). Una versión nueva de un pack va a una release nueva
(`knowledge-packs-v6`, `v7`…): se cambia `RELEASE_TAG` en
`.github/workflows/knowledge-pack.yml`, el `sourceUrl` de
`src/models/manifest.ts` apunta a ella, se vuelve a firmar el catálogo y se
añaden la dirección y la SHA-256 nuevas a `knowledge-packs/release-ledger.json`.
Nunca se edita una línea existente: `src/models/packReleaseLedger.test.ts` falla
si una dirección del catálogo que ya está en el registro tiene otra huella.

## La ficha de edición

Cada construcción escribe una **ficha de edición** junto al pack —
`<pack>.sqlite.edition.json` — y el resumen de la construcción
(`<pack>.sqlite.json`, el documento del que el catálogo firmado
toma el tamaño y la SHA-256) nombra la huella de la propia ficha,
la edición y su estado. La ficha es el registro editorial de la
edición, el estándar de catálogo de Blobs (ver ATTRIBUTION.md):
de qué edición de la fuente se construyó y su bloqueo, los
derechos de redistribución, los idiomas realmente presentes, el
editor, la política de actualización, los recuentos de documentos
y registros, el tamaño del archivo, la huella del paquete, una
**huella normalizada del conjunto de registros** (que identifica
exactamente qué registros entraron, sin hashear gigabytes en un
teléfono), la atribución, las limitaciones conocidas y los
**casos de recuperación versionados** que prueban la edición
(cada fichero de casos con su SHA-256 y su recuento).

La mitad de la ficha es humana y la otra mitad calculada. La
humana vive en un **descriptor `edition.json`** en el propio
árbol del pack (o con `--edition FILE`): edición de la fuente,
derechos, política de actualización, limitaciones conocidas y los
ficheros de casos. El constructor calcula el resto y valida el
conjunto: una ficha a la que le falta algo se escribe igualmente,
marcada **`draft`** (borrador); una completa es
**`release-ready`** (lista). Borrador es el estado honesto del
registro para las ediciones planeadas o sin revisar: nunca se
presenta como lista. Una edición publicada sigue inmutable (ver
el registro de liberaciones arriba): un pack corregido es una
edición nueva con una ficha nueva, nunca una editada.

## Pasar un pack a otro teléfono (sin internet)

Desde la 0.1.56, un NIDO puede pasar un pack del catálogo (por ejemplo
NIDO Esencial, unos 1,1 MB) a un contacto conectado por Bluetooth o Wi-Fi
local: pestaña Packs → Compartir. Las reglas:

- Solo viajan los **packs del catálogo**: los que tienen un SHA-256 en el
  catálogo firmado de NIDO. Los construidos a mano (`local-…`) nunca se
  ofrecen.
- Quien envía comprueba que su fichero instalado sigue coincidiendo con
  el SHA-256 del catálogo antes de ofrecerlo.
- Quien recibe solo ve ofertas de packs del catálogo, e instala el
  fichero solo si sus bytes coinciden exactamente con el SHA-256 del
  catálogo: el mismo fichero que habría descargado. Un pack con un solo
  byte cambiado (por ejemplo, una instrucción de primeros auxilios
  alterada) se rechaza.
- El fichero nuevo se escribe junto al viejo y se intercambia al final;
  si algo falla, el pack anterior se queda en su sitio.
- Los dos teléfonos deben llevar versiones con el mismo catálogo: un
  pack de otra versión del catálogo se rechaza.
- Los packs de más de 100 MB (los de Wikipedia) no se pueden compartir
  así.

## Cómo la app busca en un pack

Para cada pregunta, el índice de palabras clave del pack elige hasta 400 fragmentos
candidatos, y solo esos se comparan con el embedding de la pregunta. Los resultados
se fusionan con la base de conocimiento integrada, manteniendo como máximo 2 fragmentos
por artículo para que un artículo no desplace a otro tema. Comparar una pregunta con
cada embedding de un pack de 100k fragmentos tardaría segundos en el teléfono, así
que los candidatos vienen primero de las palabras clave. Un pack construido con un
modelo de embeddings distinto se ignora con un aviso, ya que sus embeddings no
coincidirían con los de la app.

### Con la búsqueda multilingüe activada

Con la búsqueda multilingüe activada (Ajustes → Base de conocimiento offline),
NIDO usa el modelo de embeddings multilingual-e5-small y la versión multilingüe
del pack Vital (`wiki-vital5-e5`). Una pregunta en español no comparte palabras
clave con un artículo en inglés, así que los candidatos por palabras clave no
bastan: la app construye, una sola vez y en segundo plano, un índice vectorial
de todo el pack y busca en él entero. Hasta que ese índice está listo, vuelve a
la búsqueda por palabras clave.

e5 da una similitud alta a casi cualquier par de textos, así que un piso fijo
dejaba pasar artículos sin relación. Desde la 0.1.36 el mejor resultado además
tiene que **destacar**: debe superar por un margen la media de los resultados
10–50 de la misma pregunta (`distinctGap` / `packDistinctGap` en
`src/rag/embeddingProfile.ts`). Si nada destaca, la pregunta no tiene respuesta
en el pack y no se muestra ninguna fuente. El margen se calibra en CI
(`.github/workflows/multilingual-e5.yml`, `scripts/multilingual/e5_pipeline.py`)
con preguntas en español, inglés y portugués, incluidas preguntas sin respuesta
en la base. Con el valor elegido (0.03), las fuentes falsas bajaron del 20 % al
10 % en la base integrada y del 33 % al 22 % con el pack Vital, sin perder
ninguna respuesta correcta.

## Decisiones de contenido

### Enfriado de quemaduras: al menos 10 minutos en Esencial, 20 minutos en Niños (decidido el 2026-10-31)

La guía de quemaduras de Esencial dice enfriar la quemadura bajo agua
corriente **al menos 10 minutos**; la guía de quemaduras en niños dice
**20 minutos**. Las dos cifras se quedan, por la decisión que aquí se
registra, porque cada guía sigue su propia fuente citada y las dos no se
contradicen en la práctica:

- Esencial cita a la familia de la Cruz Roja. Las *International First Aid,
  Resuscitation and Education Guidelines 2020* de la IFRC fijan la acción
  clave para quemaduras así: «Cool the burn with running water for at least
  10 minutes, ideally 20 minutes». La guía recoge ese mínimo.
- La guía de Niños cita al NHS. *Burns and scalds* (NHS, página revisada
  por última vez el 31 de marzo de 2026) instruye: «Hold the burn or scald
  under cool running water for 20 minutes. Do this as soon as possible,
  within 3 hours of it happening». La guía sigue esa instrucción fija
  entera, incluida la ventana de 3 horas, para el lector al que sirve.

Veinte minutos cumple «al menos 10 minutos», así que quien enfría la
quemadura de un niño según la guía de Niños también cumple el mínimo de
Esencial. La guía de Niños ya lleva una nota que nombra la diferencia y
dice seguir sus 20 minutos para un niño. Regla para guías futuras: recoge
la cifra de la fuente que citas; donde dos packs cubran el mismo acto para
lectores distintos, la guía específica lleva la cifra de su propia fuente
y una nota que señale la diferencia, en vez de forzar una sola cifra en
ambas.
