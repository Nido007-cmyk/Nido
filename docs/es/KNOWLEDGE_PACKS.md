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

El resultado:

```
build/knowledge-pack/<id>.sqlite        the pack
build/knowledge-pack/<id>.sqlite.json   its size, SHA-256, article and chunk counts
```

El texto de Wikipedia es CC BY-SA 4.0; conserva la atribución si compartes un pack.

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
