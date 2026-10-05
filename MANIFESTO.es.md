> **Idioma:** [English](MANIFESTO.md) · Español

# El manifiesto BOAR

*Un compañero de investigación offline para hoy, y un banco de trabajo para el que aún estamos esperando.*

## El sueño

Vitalik lo describió sin rodeos: una herramienta de investigación que vive en
tu teléfono, funciona sin señal alguna, y es más de la mitad de buena que la
búsqueda en internet más un modelo de IA de frontera. También esbozó cómo
podría funcionar: un modelo extremo de mixture-of-experts, alrededor de 100B
parámetros, la mayoría en disco, con menos de 1B despertando para cada token.

Ese modelo aún no existe. Nadie puede descargarlo hoy, y no podemos entrenarlo
nosotros mismos.

Construimos BOAR de todos modos.

## Qué es BOAR hoy

**Un compañero offline útil.** Instálalo, deja que descargue sus modelos una
vez, y pon tu teléfono en modo avión. Sigue respondiendo preguntas, explicando
cosas, comparando ideas y buscando en una base de conocimiento local, todo en
el dispositivo. Nada sale de tu teléfono. Sin cuenta, sin API, sin Google Play
Services.

**Un banco de trabajo honesto.** BOAR se mide a sí mismo. Cada respuesta
registra qué modelo corrió, cuánto tardó en cargar, cuánto hasta la primera
palabra, qué tan rápido generó, cuánta memoria usó y qué recuperó. Nuestros
primeros benchmarks en un teléfono real (Xiaomi, Dimensity 8300, 11.6 GB RAM)
se ven así:

| Modelo | Velocidad | Tiempo mediano de respuesta | Qué vimos |
|---|---|---|---|
| Qwen2.5-1.5B | ~11–17 tok/s | 10–21 s | Rápido, bien en preguntas simples, falla en síntesis; con el pack de Wikipedia, 6/6 preguntas de conocimiento correctas |
| LFM2.5-8B-A1B (MoE) | ~15 tok/s | 57 s | 8B total, ~1.5B activos: la generación más rápida y el único que resolvió la pregunta de RAM, pero piensa tanto que 4 de 17 respuestas se quedaron sin presupuesto |
| Phi-3.5-mini | ~4 tok/s | 73 s | Mejores comparaciones, lento, inventa citas |
| Qwen2.5-7B | ~3 tok/s | 107 s | Preciso, a menudo demasiado lento para terminar |
| Instella-MoE-16B | — | — | No cargó: arquitectura aún no soportada |

No es el sueño, y lo decimos. Cada número viene de un teléfono real, los
resultados crudos están en [docs/evidence](docs/evidence/), y cada ejecución es
reproducible desde este repositorio.

## En qué creemos

1. **Offline significa offline.** Una descarga en la configuración, luego nada.
   No "casi local", no "offline excepto cuando importa".
2. **Medir, no exagerar.** Una model card no es un benchmark. Los parámetros
   totales, los parámetros activos y las etiquetas "mobile-ready" significan
   poco hasta que un teléfono corre el modelo y anotamos lo que pasó, fallos
   incluidos.
3. **El teléfono decide.** El procesamiento del prompt, el ancho de banda de
   memoria, el calor y el runtime importan tanto como el modelo. Un modelo que
   piensa bien pero tarda dos minutos en empezar a hablar no sirve en una
   montaña.
4. **Útil ahora le gana a perfecto después.** 4–15 tok/s basta para saber cómo
   tratar una ampolla, de qué va un museo, o por qué no viene el tren, cuando no
   hay señal y nadie a quien preguntar.
5. **Abierto y reproducible.** Código, modelos, fuentes de datos y resultados
   de benchmarks están todos en el repo. Si nuestros números te parecen mal,
   ejecútalos tú mismo y cuéntanos.
6. **Debería ser divertido.** Ver un modelo nuevo arrancar en tu teléfono, ver
   si sobrevive las preguntas de razonamiento, comparar notas con otros: esa es
   la parte buena de construir esto.

## Únete

BOAR es una herramienta para cualquiera con curiosidad por lo que los
teléfonos pueden hacer de verdad.

- **Prueba un modelo nuevo antes de tu próximo viaje.** ¿Encontraste un GGUF
  prometedor en Hugging Face? Descárgalo desde el explorador de modelos de la
  app y hazle benchmark en tu propio teléfono:

  ```bash
  npm run eval:device -- --models <model>
  ```

  Obtienes tiempo de carga, tiempo hasta el primer token, tokens/seg, memoria
  pico y cada respuesta lado a lado. Ver
  [docs/es/EVAL_QUERIES.md](docs/es/EVAL_QUERIES.md).
- **Comparte tus resultados.** Teléfonos distintos, chips distintos, números
  distintos. Un resultado de tu dispositivo es un dato que nadie más tiene.
- **Rómpelo.** Haz las preguntas en las que un modelo de 1B falla. Encuentra
  dónde la recuperación trae sinsentidos. Abre un issue con la salida.
- **Construye las piezas que faltan.** Caché consciente de expertos para
  modelos mixture-of-experts haciendo streaming desde el almacenamiento.
  Paquetes de conocimiento offline más grandes. Mejor enrutamiento entre
  modelos pequeños y grandes. Cada una nos acerca al modelo soñado corriendo
  aquí.

Para empezar: [README.es.md](README.es.md) para la app,
[AGENTS.es.md](AGENTS.es.md) para compilar desde el código fuente.

## El trato

Cuando el modelo soñado llegue por fin, un enorme modelo mixture-of-experts que
corre desde el almacenamiento de un teléfono y piensa como un modelo de
frontera, debería tener un lugar donde aterrizar: una app, mediciones reales, y
gente que ya sabe cómo probarlo.

Hasta entonces: mantén tu teléfono cargado, empaca BOAR, y ve a algún lugar sin
señal.

🐗
