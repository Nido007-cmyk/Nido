# Búsqueda multilingüe (español / portugués) — diseño

Estado: **implementado en la rama `feat/multilingual-search`** (pendiente: firma del catálogo y prueba en tablets). Fecha: 2026-10-11.

## Problema

La búsqueda por significado de NIDO usa `bge-small-en-v1.5` (solo inglés).
Una pregunta en español o portugués se compara con textos en inglés usando
un modelo que no entiende español: la parte "por significado" del RAG casi
no ayuda y todo descansa en la búsqueda por palabras (FTS5), que tampoco
cruza idiomas ("fotosíntesis" ≠ "photosynthesis").

## Modelo elegido: `intfloat/multilingual-e5-small`

| | multilingual-e5-small | granite-embedding-107m-multilingual |
|---|---|---|
| MIRACL nDCG@10 (media) | **59.3** | 55.9 |
| MTEB retrieval ES | **51.0** | 48.7 |
| Dimensión | 384 (igual que bge-small) | 384 |
| Licencia | MIT | Apache 2.0 |
| GGUF Q8_0 | ~126 MB | — |

Fuente: Granite Embedding Models, arXiv 2502.20204, tablas 3 y 5.

Descartados por tamaño/RAM en la Tab A9+: bge-m3 (568M), EmbeddingGemma-300M,
multilingual-e5-base/large.

## Hallazgos que obligan a hacerlo con cuidado

1. **Prefijos obligatorios.** E5 es asimétrico: los textos indexados llevan
   `passage: ` y las preguntas `query: `. Sin ellos la recuperación empeora;
   mezclarlos es peor que no usarlos.
2. **Escala de similitud distinta.** Con E5 un texto que no tiene nada que
   ver puntúa ~0.74 (con bge ~0.3–0.5). Los umbrales actuales
   (`MIN_SEMANTIC_SIMILARITY = 0.60`, `…_SINGLE_TERM = 0.70`, poda por
   margen) están calibrados para bge: con E5 dejarían pasar casi todo.
   Hay que tener umbrales **por modelo**, calibrados con datos, no a ojo.
3. **Pooling.** bge usa CLS; E5 usa media (mean pooling). llama.cpp lo toma
   de los metadatos del GGUF: la conversión debe declararlo bien.
4. **Conversión.** El script de llama.cpp falla con el tokenizer de XLM-R si
   no se ajusta la configuración. No usar GGUF de terceros sin verificar:
   convertir nosotros con el llama.cpp de la misma versión que trae llama.rn
   y comprobar paridad con el modelo original (coseno > 0.99 en un set fijo).
5. **El catálogo de descargas está firmado** (`src/models/manifestTrust.ts`):
   añadir el modelo o un paquete nuevo exige re-firmar con la clave del
   mantenedor (`scripts/sign-manifest.mjs`). La clave NO está en el repo ni
   en CI, a propósito. Sin firma, la app rechaza el catálogo al arrancar.
6. **Paquete Wikipedia Vital (50k artículos).** Trae los vectores
   precalculados con bge; no sirven con E5. Recalcularlos en el teléfono
   llevaría horas: hay que publicar una versión nueva del paquete con los
   vectores E5 (se puede generar en GitHub Actions reutilizando el texto del
   paquete actual, sin volver a descargar Wikipedia).

## Plan (sin romper nada)

1. **CI de conversión y paridad** (GitHub Actions): descargar
   `intfloat/multilingual-e5-small` en una revisión fijada, convertir a GGUF
   Q8_0 con el llama.cpp de llama.rn, comparar contra sentence-transformers,
   publicar el GGUF como asset de un release con su SHA-256.
2. **Calibración**: set de preguntas es/en/pt con su artículo correcto y
   preguntas sin respuesta en el corpus. Elegir umbrales y margen de E5 que
   mantengan la precisión actual en inglés y suban el recall en es/pt.
   Guardar el informe en el repo.
3. **App**:
   - el modelo de búsqueda pasa a ser un ajuste (`bge-small-en` | `e5-small`)
     con umbrales y prefijos por modelo;
   - "Mejorar la búsqueda en español y portugués" en Ajustes (opcional,
     explica descarga y tiempo);
   - cambio de modelo = re-indexar en el teléfono los paquetes Standard/Full
     y los documentos del usuario, sin borrar texto: mientras tanto sigue la
     búsqueda por palabras;
   - instalaciones nuevas en es/pt usan E5 desde el principio;
   - el sello `embedding_model_sha256` de la base se actualiza por un camino
     explícito de migración (hoy un cambio de modelo falla cerrado, a
     propósito).
4. **Paquete Vital v2** con vectores E5 (Actions), asset + entrada firmada.
5. **Firma del catálogo** con la clave del mantenedor.
6. Prueba en las dos tablets (RAM, tiempo de re-indexado, preguntas es/pt)
   antes de publicar.

## Riesgos

- RAM: +~90 MB residentes frente a bge (126 vs 37 MB). Medir en la Tab A9+.
- Tiempo de re-indexado: similar al primer indexado. Opcional y reanudable.
- Si la calibración no mejora es/pt de forma medible, no se publica.

## Implementación (2026-10-11)

### Modelo (CI, `.github/workflows/multilingual-e5.yml`)
- `intfloat/multilingual-e5-small` @ `614241f622f53c4eeff9890bdc4f31cfecc418b3`,
  convertido con el llama.cpp de llama.rn 0.13.0-rc.6 (b11192, `171e884`).
- El modelo es `BertModel` con el tokenizador SentencePiece de XLM-R: el
  conversor estándar falla. `scripts/multilingual/convert_e5.py` usa los
  pesos BERT (posiciones desde 0) con el escritor de vocabulario XLM-R del
  propio conversor. Pooling MEAN verificado en los metadatos del GGUF.
- Paridad contra sentence-transformers (73 textos es/en/pt, con prefijos):
  coseno mínimo **0.9994** (Q8_0). GGUF Q8_0: 132 441 664 bytes,
  sha256 `802c868f…6e474cde`. La conversión es determinista (mismo sha en
  dos ejecuciones).

### Calibración (`scripts/multilingual/calibration-queries.json`)
120 preguntas con respuesta + 30 de una palabra + 60 sin respuesta, en
es/en/pt, escritas a mano. Se simula el filtro tal como lo corre la app.
Corpus integrado (1 300 artículos):

| | es | pt | en | fuentes falsas |
|---|---|---|---|---|
| bge hoy | 50% | 48% | 98% | 23% |
| e5 (piso 0.81) | 82% | 90% | 100% | 15% |

Una palabra: es/pt de 17% a 83%, sin falsos ("hola", "gracias"…).
Informe completo con Wikipedia Vital: `docs/design/calibration/`.

### App
- `src/rag/embeddingProfile.ts`: prefijos y umbrales por modelo (por sha del
  catálogo). bge conserva exactamente 0.60 / 0.70 / margen 0.4.
- `src/rag/embeddingSwitch.ts`: cambio explícito y ordenado (cargar →
  borrar vectores y re-sellar en una transacción → Ajustes → reconstruir);
  si algo falla, vuelve al modelo anterior.
- `src/rag/db.ts`: la base se sella con el modelo **activo**. Vectores de
  otro modelo **del catálogo** (respaldo viejo, Ajustes perdidos) se
  descartan y se rehacen; un sello desconocido sigue fallando cerrado.
  Un vector solo se guarda si la base está sellada para el modelo que lo
  calculó.
- `src/rag/reembed.ts`: reconstrucción en segundo plano, reanudable; la
  búsqueda por palabras funciona mientras tanto.
- `modules/nido-vectors`: índice plano int8 mapeado en memoria junto al
  paquete y búsqueda exacta por coseno en Kotlin (probado contra numpy:
  `modules/nido-vectors/test/run.sh`). Con e5 los paquetes se buscan
  completos (una pregunta en español no comparte palabras con un artículo
  en inglés); con bge la búsqueda de paquetes no cambia.
- Ajustes → Base de conocimiento: tarjeta "Búsqueda en español y
  portugués". El asistente inicial la activa en es/pt **solo con base nueva**.
- Paquete Vital v2 (`wiki-vital5-e5`): mismo texto, vectores e5. Licencia
  CC BY-SA 4.0 ("compilado por NIDO" + Wikipedia), aviso dentro del SQLite y
  en `LICENSE-ATTRIBUTION.txt`. No puede ser MIT por el ShareAlike.
