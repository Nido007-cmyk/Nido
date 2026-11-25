# Ficha de seguridad · NIDO 0.1.112

> Generada por `scripts/generate-safety-card.mjs` desde
> `eval/gates/baseline.json` y la medida de este árbol.
> No editar a mano: el check de CI la regenera y compara.

## 1 · Tasas de puertas (corpus de la F0, 2.957 variantes)

| Celda | Medida | Baseline | Δ |
|---|---|---|---|
| salud/es | 561/575 · 97,6 % | 89,7 % | +7,9 |
| salud/en | 420/425 · 98,8 % | 86,1 % | +12,7 |
| salud/pt | 410/455 · 90,1 % | 80,2 % | +9,9 |
| emergencia/es | 305/305 · 100,0 % | 75,1 % | +24,9 |
| emergencia/en | 270/270 · 100,0 % | 67,8 % | +32,2 |
| emergencia/pt | 270/270 · 100,0 % | 67,8 % | +32,2 |
| crisis/es | 99/100 · 99,0 % | 58,0 % | +41,0 |
| crisis/en | 80/80 · 100,0 % | 60,0 % | +40,0 |
| crisis/pt | 79/80 · 98,8 % | 40,0 % | +58,8 |
| caida/es | 21/21 · 100,0 % | 85,7 % | +14,3 |
| caida/en | 18/18 · 100,0 % | 88,9 % | +11,1 |
| caida/pt | 18/18 · 100,0 % | 61,1 % | +38,9 |
| caida-narrada/es | 6/6 · 100,0 % | 100,0 % | 0,0 |
| caida-narrada/en | 6/6 · 100,0 % | 33,3 % | +66,7 |
| caida-narrada/pt | 6/6 · 100,0 % | 100,0 % | 0,0 |
| monoxido/es | 21/21 · 100,0 % | 71,4 % | +28,6 |
| monoxido/en | 15/15 · 100,0 % | 60,0 % | +40,0 |
| monoxido/pt | 12/12 · 100,0 % | 50,0 % | +50,0 |
| guia/es | 49/49 · 100,0 % | 100,0 % | 0,0 |
| guia/en | 42/42 · 100,0 % | 100,0 % | 0,0 |
| guia/pt | 42/42 · 100,0 % | 100,0 % | 0,0 |
| negativos/es | 42/45 · 93,3 % | 93,3 % | 0,0 |
| negativos/en | 33/42 · 78,6 % | 78,6 % | 0,0 |
| negativos/pt | 30/36 · 83,3 % | 83,3 % | 0,0 |
| negativos-historicos/es | 6/6 · 100,0 % | 100,0 % | 0,0 |
| negativos-historicos/en | 6/6 · 100,0 % | 100,0 % | 0,0 |
| negativos-historicos/pt | 6/6 · 100,0 % | 100,0 % | 0,0 |
| **Total primaria** | **2873/2957 · 97,2 %** | **78,6 %** | **+18,6** |

Sensibilidad por tipo de variante (puerta primaria):

| Tipo | Medida | Baseline |
|---|---|---|
| base | 631/648 · 97,4 % | 88,3 % |
| sinAcentos | 631/648 · 97,4 % | 88,3 % |
| cortesia | 526/543 · 96,9 % | 91,7 % |
| errata | 490/512 · 95,7 % | 32,0 % |
| pregunta | 449/460 · 97,6 % | 91,1 % |
| marco-temporal | 52/52 · 100,0 % | 63,5 % |
| cierre-desesperado | 52/52 · 100,0 % | 63,5 % |
| ayuda | 35/35 · 100,0 % | 77,1 % |
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
| salud | 1386 | 5 | 0 | 0 | 64 |
| emergencia | 0 | 845 | 0 | 0 | 0 |
| crisis | 0 | 0 | 258 | 0 | 2 |
| caida | 0 | 57 | 0 | 0 | 0 |
| ninguna | 30 | 6 | 18 | 0 | 238 |
| monoxido | 0 | 0 | 0 | 48 | 0 |

- Crisis esperada respondida como salud: 0
- Crisis esperada sin ninguna puerta: 2

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
