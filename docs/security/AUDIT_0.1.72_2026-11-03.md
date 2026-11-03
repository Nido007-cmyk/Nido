# Auditoría de la 0.1.72-alpha contra lo publicado (2026-11-03)

Auditor: Claude, en el papel de adversario. Base: punta de main
`b19f4ec1c5b19b3c832c0c33f22c57a4fcd6fcbc`, release `v0.1.72-alpha`
(id 433142046) y release `knowledge-packs-v12` (id 433018692).
Los ficheros se descargaron de las URLs servidas y se midieron;
nada sale del paquete del dueño sin su medida.

## Veredicto

**APTO.** Lo publicado de la 0.1.72 es lo que dice ser en los
seis puntos. Hay **un cargo de papel** (K-1): el paquete del acto
explica mal la cifra de recuperación del CI. No afecta a ningún
byte publicado ni a ningún texto público del repo. Hay una
observación de proceso (O-1).

## Los seis puntos

| # | Punto | Medida | Estado |
|---|---|---|---|
| 1 | Batería C-03 por la puerta real | `filterByTermCoverage` y `buildLexicalQuery` (`src/rag/pure.ts`) sobre los trozos servidos de la v12: **22/22** en `nido-esencial.sqlite` y **22/22** en `nido-esencial-e5.sqlite`. En la v11 eran 11/22. Trozos con claves: **es 66 · en 64 · pt 67 = 197** de 568. Guías con claves: 58/58 por lengua (v11: 4 es y 4 en). | Comprobada |
| 2 | Texto corregido en los bytes | «antes del accidente» 1 trozo; «lejos de puertas y ventanas» 1 trozo; «beyond the crash» 0. «lágrima» aparece 6 veces, pero todas son el signo de deshidratación «llora sin lágrimas» / «chora sem lágrimas». La prueba del sabor no está («sepa a», «tastes like», «saiba a»: 0). Título, cuerpo y fuente de los 568 trozos, y las 174 filas de guías, son idénticos a los de la v11 en los dos ficheros. | Comprobada |
| 3 | Catálogo y firma | `src/models/manifest.ts` (`MODEL_CATALOG`, `nido-esencial` y `nido-esencial-e5`): sha256 `f1324cf5…0cab0e` y `5c0f7ebe…81fa4f`, 1.228.800 B cada uno. Igual al hash de los bytes descargados y al digest de la API. `floor.json`: v12, 568 trozos (en 183 · es 193 · pt 192), 174 guías, igual a los bytes. `manifestSignature.ts`: diff de una línea (`MANIFEST_SIGNATURE_BASE64`). Log de la corrida 41700361629: «PASS: 32 pins verified» y «OK: manifest signature valid (32 catalog entries)». El bundle del APK lleva los dos sha de la v12 y `knowledge-packs-v12`, y ninguna cadena de la v11. | Comprobada |
| 4 | Base | `git log 6a8b8df..b19f4ec`: seis commits. Tres son de catálogo (`2f0a0e7`, `6e9678b`, `ac0ff47`) y tres de versión y notas (`5434134`, `0632127`, `b19f4ec`). Cero ficheros de código fuera del catálogo. El build de la v12 (corrida knowledge-pack 41685204901) salió de `6a8b8df`, que está en main. La fuente `.md` de `6a8b8df`, sin las líneas de claves, es byte a byte la de la v11 (`e5a55c0`): 175 ficheros, 0 diferencias. | Comprobada |
| 5 | Identidad del APK | El asset servido tiene sha256 `c3a142fb…183e2f20` y 133.316.155 B. Coincide con el `sha256sum` del log, el `.sha256` adjunto y el digest de la API. Firma v2 con certificado `4bd73b2f…50160cf`. `team.nido.app`, versionName 0.1.72, versionCode 73. | Comprobada |
| 6 | Recuperación del CI | El log de la corrida 41685204901 da e5 **201/202**, bge 64/64, FA e5 38/38 y FA bge 6/6. La pregunta que falla **ya no es la del accidente**: ver K-1. | Comprobada la cifra; la explicación del paquete es falsa |

Condición del dueño, la del hash clínico: los checks (a)(b)(c)
están en `docs/comprobable` y se fusionan a main en el PR #183. Sobre
el árbol fusionado salen 0: 174 sellos, 174 entradas del ledger y
2.283 filas. El test de la biblioteca pasa 13/13. Las posiciones
**#32 y #14** del portugués quedan **NO ENCONTRADO**, porque no hay
instrumento que las reproduzca.

## Cargo

**K-1 (papel, medio).** El paquete del acto dice: «la recuperación e5
en el CI quedó en 201/202 […] la misma foto que la v11 en el CI,
ajena a las claves». Las dos afirmaciones son falsas.

- La v11 (corrida 41644340311) fallaba «qué hago primero si veo un
  accidente», que esperaba «Cómo actuar en una emergencia».
- La v12 (corrida 41685204901) falla
  «tiene mucho frío y no deja de temblar», que espera «Hipotermia y
  congelación». Su top 3 es: Olas de calor y frío extremo · Terremoto
  · Refugio y mantener el calor corporal. La del accidente ya pasa.
- El texto de los 568 trozos es idéntico entre la v11 y la v12. Las
  claves sí entran en el vector:
  `scripts/build-knowledge-pack.mjs`, línea 181, embebe
  `` `${title}\n${body}${keys}` ``. El cambio de pregunta fallida se
  debe a las claves.
- La cifra sigue por encima del umbral del 90 %. Ningún texto público
  del repo repite la afirmación falsa (`CHANGELOG.md`,
  `docs/KNOWLEDGE_PACKS.md` y `ALPHA_RELEASE_NOTES.md` no dan la
  cifra de recuperación de la v12).
- El «202/202 en local» no tiene sede reproducible: **NO ENCONTRADO**.
- Sin curar aquí: curarla exige un pack nuevo y una firma de catálogo,
  que es el carril del dueño. No se curará añadiendo la pregunta de
  la prueba como clave, porque eso enseñaría al examen.

Nota menor: la anotación del CI escribe «201/202 (100%)». Es un
redondeo de 99,5 %.

## Observación de proceso

**O-1.** Los seis commits entraron en main por empuje directo, sin
PR. El workflow «CI» de main quedó rojo en los seis: falló
`verify:pins` porque la v12 aún era borrador, y por eso se saltaron
`check-constitution`, `verify:manifest-sig` y los avisos de terceros.
Nadie lo re-corrió. La corrida verde «gobernante» es la del workflow
del APK. Esa sí pasa tests (vitest 5.871, jest 52), pines 32/32, firma
y avisos, pero no corre `check-constitution`. Lo corrí a mano sobre
`b19f4ec`: «8 firm rules, all checks in place». Re-lancé el job rojo
del CI sobre `b19f4ec` para que main deje de mostrarse rojo.

Además: el tag `knowledge-packs-v12` apunta a `b19f4ec`, pero el build
salió de `6a8b8df`. `floor.json` lo dice bien. Es la misma observación
que en la v11.

## Tareas B y C del paquete (este PR)

- **B, «el mío»:** `src/agent/loop/memoryQuery.ts`, `SELF_BDAY_PRONOUN_RE`
  y `selfBirthdaySpans`, usados por `findBirthdayFact` y
  `birthdaySelfSlice`.
  - El pronombre posesivo («el mío», «mine», «o meu» sin sustantivo
    detrás) vale como frase propia solo si su cláusula trae fecha.
  - La frase explícita manda como hasta hoy.
  - La fecha ajena nunca se sirve como propia: hay pares en es/en/pt
    en `memoryQuery.test.ts`.
  - El juez de fundamentación no se toca: ninguna línea de
    `src/rag/grounding.ts` cambia por esta cura.
- **C, la negación en la frase corta:** `src/rag/grounding.ts`,
  `negatedClauseSource`, en la capa de corrección de negación de
  0.1.59/T-J7. La llama `verifyGroundedAnswer` solo cuando
  `closestSourceSentence` y `closestShortCopySentence` no encontraron
  copia, y solo para frases de 2 raíces.
  - El diff de `grounding.ts` es solo de altas: 0 líneas borradas.
  - `MIN_JUDGED_TERMS`, `MIN_SUPPORT`, `STRICT_SUPPORT`,
    `MAX_NOVEL_LOOSE` e `isSupported` quedan byte a byte.
  - Barrido de regresión: cada frase y cada cláusula de los 568
    trozos de la v12, juzgada contra su trozo, son 14.583 casos con
    **0** cambios de veredicto o de texto.
  - Pares en es/en/pt en `grounding.negatedClause.test.ts`.
  - Hallazgo previo, sin tocar: la vía larga ya sustituía una
    cláusula fiel de 3 raíces («El paciente respira con normalidad.»)
    por su frase fuente entera, marcada `negationFixed`. El texto que
    sale es verdadero, pero la marca es inexacta. Queda anotado para
    otra tanda, porque el paquete manda no cambiar la vía larga.
