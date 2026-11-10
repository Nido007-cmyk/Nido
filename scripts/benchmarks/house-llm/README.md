# Banco de generación «en casa» (fuera del teléfono)

Instrumento del estudio `docs/ESTUDIO_RESPUESTAS_0.1.92.md`: genera con
el archivo GGUF exacto del catálogo y con los mensajes que arma el
código real de la ruta fija, y lee las respuestas con métricas
calculadas por programa.

No es la app en un teléfono: el motor es llama.cpp en CPU
(`llama-cpp-python`), no llama.rn. Sirve para comparar variantes de
prompt y de muestreo con el mismo modelo, no para medir tiempos.

## Preparar

Una carpeta de trabajo `W` con:

- `W/gguf/qwen3-0.6b-q4km.gguf`: el archivo de la revisión fijada en
  `src/models/manifest.ts` (comprobar tamaño y sha256 contra el catálogo).
- `W/bench/cases.json`: copia de `cases.json` de esta carpeta, o
  regenerado con el volcado (ver abajo).
- Un entorno de Python con `llama-cpp-python` (medido con la 0.3.16).

## Regenerar los casos desde el código de la app

Copiar `dump-cases.vitest.ts.txt` a `src/zzBenchDump.test.ts` y correr
`BENCH_OUT=W/bench/cases.json npx vitest run src/zzBenchDump.test.ts`.
Borrar el archivo después: no forma parte de la suite.

## Correr

    python -I bank_variants.py W 8 W/bench/res1.json " <nota nueva>"
    python -I bank_system_and_reasoning.py W 8 W/bench/res2.json
    python -I calculation_reasoning.py W 6 W/bench/res3.json 410
    python -I analyze.py W/bench/res1.json

`results/` guarda las salidas en bruto del estudio de la 0.1.92.
