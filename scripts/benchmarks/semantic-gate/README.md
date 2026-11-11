# Puerta de salud y emergencia por significado: entrenamiento y examen

Instrumento del estudio `docs/ESTUDIO_PUERTA_SEMANTICA_0.1.93.md`.
Entrena el clasificador lineal de `src/routing/semanticGate.ts` sobre
los vectores de los modelos de búsqueda exactos del catálogo y lo
examina con una tanda de frases que no se usó para entrenar.

El motor es llama.cpp en CPU (`llama-cpp-python`, medido con la
0.3.16), no llama.rn. Por eso la app comprueba la paridad en el
teléfono antes de usar los pesos (`src/services/semanticDanger.ts`).

## Archivos

- `lexical_battery.json`: las tres primeras tandas (las de la batería
  de la lista de palabras). Entrenamiento.
- `training_extra.py`: la tanda 5. Entrenamiento.
- `exam_and_anchors.py`: la tanda 4 (H4, E4, G4), el EXAMEN, y las
  frases ancla de la primera prueba descartada.
- `anchors_eval.py`: la variante con frases ancla (descartada).
- `train.py`: entrena y elige el umbral por validación cruzada.
- `export.py`: escribe los pesos y los vectores del examen.
- `*.train.json`, `*.res.json`: resultados en bruto.

## Correr

Carpeta de trabajo `W` con `W/gguf/e5.gguf` y `W/gguf/bge.gguf` (los
archivos del catálogo, huella comprobada), `W/sem/batt.json` (copia de
`lexical_battery.json`) y estos guiones en `W/sem/`.

    python -I train.py W e5.gguf "query: " e5
    python -I train.py W bge.gguf "" bge
    python -I export.py W

`export.py` deja `W/sem/weights.json` (va a
`src/routing/semanticGateWeights.ts`) y `W/sem/fixtures.json` (va a
`src/routing/__fixtures__/semanticGateExam.json`).

Si se cambia un modelo de búsqueda del catálogo, hay que volver a
entrenar: los pesos van atados a la huella del archivo y una prueba
falla si no coinciden.
