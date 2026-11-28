# Orden del prompt del agente: antes y después de la 0.1.122 (auditoría S-2)

Medición hecha el 2026-11-28 para la sospecha S-2 de la auditoría: el reorden
de la 0.1.122 (memoria y fecha detrás del catálogo de herramientas) no tenía
ninguna medición de conducta, solo pruebas sobre el texto.

## Método

- Modelo: Qwen2.5-0.5B-Instruct Q4_K_M, el mismo fichero del catálogo
  (`qwen2.5-0.5b-instruct-q4km`), con node-llama-cpp 3.22.3 en CPU.
- Prompts: `buildSystemPrompt` de la 0.1.121 (commit 329ccd40, orden viejo)
  contra el de la 0.1.123 (orden nuevo), nivel de catálogo `full`, con la
  misma memoria (hija Lucía, alergia a la penicilina, trabajo) en es/en/pt.
- 24 peticiones: 8 por idioma (recordatorio, nota, porcentaje, dos preguntas
  sobre la memoria y la fecha con intención «actuar»; dos «guarda que…» con
  intención «recordar»).
- Temperatura 0, 80 tokens, un solo turno, sin las redes de la app (gramática,
  reparación de bloques, rutas fijas): mide el efecto del ORDEN del texto,
  no la conducta completa de NIDO.
- Acierto: la herramienta esperada en el bloque, o el dato esperado en el
  texto (Lucía, penicilina, 28 o `device_time` para la fecha).

## Resultado

| | Orden viejo (0.1.121) | Orden nuevo (0.1.122+) |
|---|---|---|
| Aciertos | 11 / 24 | 13 / 24 |
| Misma herramienta que el otro orden | 18 / 24 | |
| Casos que el orden viejo acertaba y el nuevo falla | 0 | |

Las preguntas sobre la memoria (nombre de la hija, alergia) y la fecha se
aciertan igual con los dos órdenes en los tres idiomas: mover la memoria
detrás del catálogo no hizo que el modelo la ignorara. El orden nuevo gana
dos casos en inglés (la nota y el porcentaje) y no pierde ninguno. En el
porcentaje en español y portugués ninguno de los dos llamó a `calculate`
(cuentan como fallo), pero el orden nuevo contestó bien en texto («36») y
el viejo mal («360»).

Hallazgo aparte, igual en los dos órdenes: este modelo de 0,5B elige mal las
herramientas de recordatorio y de memoria en un turno crudo (copia el bloque
de ejemplo `device_time` o elige otra). Es una limitación del modelo pequeño
sin las redes de la app, no del orden.

## Caso a caso

| Idioma | Intención | Petición | Orden viejo | Orden nuevo |
|---|---|---|---|---|
| es | actuar | Recuérdame llamar a mi hija mañana a las 9 de la mañana | ✗ `open_app` | ✗ `device_time` |
| es | actuar | Guarda una nota que diga: comprar cable calibre 12 | ✓ `save_note` | ✓ `save_note` |
| es | actuar | ¿Cuánto es el 15% de 240? | ✗ `texto` | ✗ `texto` |
| es | actuar | ¿Cómo se llama mi hija? Responde solo con el nombre. | ✓ `texto` | ✓ `texto` |
| es | actuar | ¿A qué medicamento soy alérgico? Responde en una frase. | ✓ `texto` | ✓ `texto` |
| es | actuar | ¿Qué fecha es hoy? Responde solo con la fecha. | ✓ `texto` | ✓ `texto` |
| es | recordar | Guarda que mi perro se llama Toby | ✗ `save_person` | ✗ `device_time` |
| es | recordar | Acuérdate de que prefiero que me hables de tú | ✗ `texto` | ✗ `texto` |
| en | actuar | Remind me to call my daughter tomorrow at 9 am | ✗ `device_time` | ✗ `device_time` |
| en | actuar | Save a note that says: buy 12 gauge wire | ✗ `create_reminder` | ✓ `save_note` |
| en | actuar | What is 15% of 240? | ✗ `texto` | ✓ `calculate` |
| en | actuar | What is my daughter's name? Answer with the name only. | ✓ `texto` | ✓ `texto` |
| en | actuar | Which medicine am I allergic to? Answer in one sentence. | ✓ `texto` | ✓ `read_picked_file` |
| en | actuar | What is today's date? Answer with the date only. | ✓ `texto` | ✓ `texto` |
| en | recordar | Remember that my dog is called Toby | ✗ `device_time` | ✗ `device_time` |
| en | recordar | Remember that I prefer short answers | ✗ `device_time` | ✗ `device_time` |
| pt | actuar | Me lembre de ligar para a minha filha amanhã às 9 da manhã | ✗ `list_notes` | ✗ `device_time` |
| pt | actuar | Salve uma nota que diga: comprar fio bitola 12 | ✓ `save_note` | ✓ `save_note` |
| pt | actuar | Quanto é 15% de 240? | ✗ `texto` | ✗ `texto` |
| pt | actuar | Como se chama a minha filha? Responda só com o nome. | ✓ `texto` | ✓ `texto` |
| pt | actuar | A qual remédio eu sou alérgico? Responda em uma frase. | ✓ `texto` | ✓ `texto` |
| pt | actuar | Que data é hoje? Responda só com a data. | ✓ `texto` | ✓ `texto` |
| pt | recordar | Guarde que o meu cachorro se chama Toby | ✗ `device_time` | ✗ `device_time` |
| pt | recordar | Lembre que eu prefiro respostas curtas | ✗ `device_time` | ✗ `device_time` |
