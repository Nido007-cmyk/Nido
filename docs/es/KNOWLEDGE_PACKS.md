> **Idioma:** [English](../KNOWLEDGE_PACKS.md) · Español

# Knowledge packs

BOAR responde desde una base de conocimiento offline en el teléfono. Siempre tiene
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

## Poner un pack en tu teléfono

**Para probar, por USB** (un build de desarrollo de BOAR, depuración USB activada):

```bash
npm run pack:push -- build/knowledge-pack/<id>.sqlite
```

Copia el archivo al almacenamiento de la app y lo verifica. BOAR usa cualquier pack
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

## Cómo la app busca en un pack

Para cada pregunta, el índice de palabras clave del pack elige hasta 400 fragmentos
candidatos, y solo esos se comparan con el embedding de la pregunta. Los resultados
se fusionan con la base de conocimiento integrada, manteniendo como máximo 2 fragmentos
por artículo para que un artículo no desplace a otro tema. Comparar una pregunta con
cada embedding de un pack de 100k fragmentos tardaría segundos en el teléfono, así
que los candidatos vienen primero de las palabras clave. Un pack construido con un
modelo de embeddings distinto se ignora con un aviso, ya que sus embeddings no
coincidirían con los de la app.
