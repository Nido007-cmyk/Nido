# Ficha de seguridad · NIDO 0.1.112

> Generada por `scripts/generate-safety-card.mjs` desde
> `eval/gates/baseline.json` y la medida de este árbol.
> No editar a mano: el check de CI la regenera y compara.

## 1 · Tasas de puertas (corpus de la F0, 2.957 variantes)

| Celda | Medida | Baseline | Δ |
|---|---|---|---|
| salud/es | 516/575 · 89,7 % | 89,7 % | 0,0 |
| salud/en | 371/425 · 87,3 % | 86,1 % | +1,2 |
| salud/pt | 365/455 · 80,2 % | 80,2 % | 0,0 |
| emergencia/es | 259/305 · 84,9 % | 75,1 % | +9,8 |
| emergencia/en | 231/270 · 85,6 % | 67,8 % | +17,8 |
| emergencia/pt | 217/270 · 80,4 % | 67,8 % | +12,6 |
| crisis/es | 82/100 · 82,0 % | 58,0 % | +24,0 |
| crisis/en | 69/80 · 86,3 % | 60,0 % | +26,3 |
| crisis/pt | 65/80 · 81,3 % | 40,0 % | +41,3 |
| caida/es | 18/21 · 85,7 % | 85,7 % | 0,0 |
| caida/en | 16/18 · 88,9 % | 88,9 % | 0,0 |
| caida/pt | 11/18 · 61,1 % | 61,1 % | 0,0 |
| caida-narrada/es | 6/6 · 100,0 % | 100,0 % | 0,0 |
| caida-narrada/en | 2/6 · 33,3 % | 33,3 % | 0,0 |
| caida-narrada/pt | 6/6 · 100,0 % | 100,0 % | 0,0 |
| monoxido/es | 15/21 · 71,4 % | 71,4 % | 0,0 |
| monoxido/en | 9/15 · 60,0 % | 60,0 % | 0,0 |
| monoxido/pt | 6/12 · 50,0 % | 50,0 % | 0,0 |
| guia/es | 49/49 · 100,0 % | 100,0 % | 0,0 |
| guia/en | 42/42 · 100,0 % | 100,0 % | 0,0 |
| guia/pt | 42/42 · 100,0 % | 100,0 % | 0,0 |
| negativos/es | 42/45 · 93,3 % | 93,3 % | 0,0 |
| negativos/en | 33/42 · 78,6 % | 78,6 % | 0,0 |
| negativos/pt | 30/36 · 83,3 % | 83,3 % | 0,0 |
| negativos-historicos/es | 6/6 · 100,0 % | 100,0 % | 0,0 |
| negativos-historicos/en | 6/6 · 100,0 % | 100,0 % | 0,0 |
| negativos-historicos/pt | 6/6 · 100,0 % | 100,0 % | 0,0 |
| **Total primaria** | **2520/2957 · 85,2 %** | **78,6 %** | **+6,6** |

Sensibilidad por tipo de variante (puerta primaria):

| Tipo | Medida | Baseline |
|---|---|---|
| base | 618/648 · 95,4 % | 88,3 % |
| sinAcentos | 618/648 · 95,4 % | 88,3 % |
| cortesia | 526/543 · 96,9 % | 91,7 % |
| errata | 171/512 · 33,4 % | 32,0 % |
| pregunta | 449/460 · 97,6 % | 91,1 % |
| marco-temporal | 52/52 · 100,0 % | 63,5 % |
| cierre-desesperado | 52/52 · 100,0 % | 63,5 % |
| ayuda | 27/35 · 77,1 % | 77,1 % |
| voseo | 4/4 · 100,0 % | 100,0 % |
| usted | 3/3 · 100,0 % | 100,0 % |

## 2 · Falsos positivos (guarda)

| Subcorpus | Con alguna puerta | health | emergency | crisis | co |
|---|---|---|---|---|---|
| guía (suelo cero) | 0/133 | 0 | 0 | 0 | 0 |
| negativos | 46/123 | 42 | 6 | 18 | 0 |
| históricos | 8/18 | 8 | 0 | 0 | 0 |
| ciega-guia (suelo cero) | 0/48 | 0 | 0 | 0 | 0 |
| ciega-ficcion | 27/102 | 0 | 21 | 6 | 0 |
| ciega-modismos | 3/99 | 3 | 0 | 0 | 0 |
| ciega-prevencion | 66/99 | 66 | 6 | 0 | 0 |
| ciega-historicos | 54/99 | 54 | 9 | 0 | 0 |
| ciega-medico | 84/99 | 84 | 0 | 0 | 0 |

La lectura de las familias conocidas: los falsos positivos de crisis son la familia F6 del censo (frases de ficción, modismos y marcos que lo léxico lee como crisis: en negativos y en el cubo ciega-ficcion); los históricos que declaran salud son la familia F9 (tema histórico que declara salud sin urgencia); el veto de prevención lo rompe la cortesía en los tres idiomas (los falsos positivos de emergencia de negativos, ciega-prevencion y ciega-historicos); y en los cubos de tema de la ciega (prevención, históricos y médico) salud declara como tema, que es conducta asentada: su foto por cubo es el techo, no un cero exigido.

## 3 · Matriz de confusión y confusión nombrada

| Esperada \ Respondida | salud | emergencia | crisis | monoxido | ninguna |
|---|---|---|---|---|---|
| salud | 1248 | 4 | 0 | 0 | 203 |
| emergencia | 0 | 707 | 0 | 0 | 138 |
| crisis | 3 | 0 | 216 | 0 | 41 |
| caida | 0 | 45 | 0 | 0 | 12 |
| ninguna | 30 | 10 | 18 | 0 | 234 |
| monoxido | 0 | 3 | 0 | 30 | 15 |

- Crisis esperada respondida como salud: 3
- Crisis esperada sin ninguna puerta: 41

## 4 · Suelos vigentes

| Celda | Suelo | Última subida |
|---|---|---|
| crisis/es | 58,0 | F0 (2026-11-24) |
| crisis/en | 60,0 | F0 (2026-11-24) |
| crisis/pt | 40,0 | F0 (2026-11-24) |

## 5 · Riesgos conocidos

1. **Exynos sin aparato.** Los fallos de llama.rn en Exynos (#336 y #350 aguas arriba) no están validados ni refutados: la casa no tiene un aparato Exynos (la Tab A9+ es Snapdragon). Sin medir en aparato.

2. **La heurística de voces de red del bloque 3.** Android no expone por API si una voz TTS es de red (VoiceRecord trae solo identificador, nombre, calidad e idioma); el descarte de voces de red del #356 es una heurística por la convención de nombres de Google en tts.ts, verificada con arnés, no con motores reales. La conducta con un Google TTS o un Samsung concretos solo se cobra en un aparato.

3. **Cobertura Kotlin con el ram-monitor pendiente.** De los cuatro módulos de la breve S-3, keyvault, p2p y ocr traen suite ejecutada; modules/ram-monitor sigue sin suite (veredicto de la verificación del bloque 6) y vuelve a la breve S-3 reducida.

4. **Crisis solo léxica, por decisión sellada.** La puerta de crisis no tiene pierna semántica: el modelo de búsqueda no viene en la primera instalación. El experimento de un clasificador (fase 3 del plan de ingeniería) se cerró sin adopción el 2026-11-24 y la decisión «solo léxica» sigue sellada; las familias que lo léxico no alcanza (la errata leve hunde el acierto a un tercio de las variantes) quedan medidas en esta ficha.

5. **Caída narrada en inglés al 33,3 %.** La cláusula de resolución temporal inglesa declara emergencia en 4 de 6 variantes ya resueltas; familia F8 del censo, con cura nombrada en el paquete de variantes.

## 6 · Lo que no se ha medido

- Rendimiento, memoria y batería en aparatos reales (TTFT, tokens/s, RSS, cierres): no hay banco de aparatos; la fase 2 del plan lo monta cuando haya aparatos.
- La pasada del dueño en su Tab A9+ sobre la versión vigente.
- Motores TTS reales (ver riesgo 2) y aparatos Exynos (riesgo 1).
