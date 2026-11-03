# Auditoría adversaria de la 0.1.70 (Claude, 2026-11-03)

Encargo: el paquete «Auditoría de la build nueva (NIDO 0.1.70)» del
2026-11-03 (Adenda 6, su suplemento con el §9, la pasada de
completitud y el acto de publicación). Identidad auditada: `main` en
`be4ed9d239d8f3d5d507f4073d4292131f5e1188`, release `v0.1.70-alpha`.
Todo lo de abajo se midió en el repo público, en los bytes servidos
de las releases y en los registros de CI; lo que no tiene sede ahí
se marca **NO ENCONTRADO**. Las sondas de código se corrieron sobre
el árbol de `be4ed9d` (no sobre una copia propia).

## Dictamen

**APTO CON CARGOS.** La identidad publicada es la que el acto
afirma, el ledger del Esencial cuenta exactamente lo que se dice y
la cura PC-§S-1 está. Pero la auditoría encontró tres cargos de
fondo que ningún papel de la cadena traía:

1. **C-1 (grave, salud):** el juez sella como fundada una dosis
   falsa escrita como instrucción con un dígito.
2. **C-2 (media):** la cura de cobertura C-03 nunca llegó a los
   paquetes publicados (v10 ni v11).
3. **C-3 (media):** el texto del Esencial publicado en la v11 no
   estaba en `main`; un build desde `main` habría deshecho sus
   correcciones.

Más dos cargos menores (C-4, C-5) y tres refutaciones de papel
(P-1 a P-3). C-1, C-3, C-4 y C-5 quedan arreglados en el árbol; C-2
queda arreglado en la fuente y su llegada a los teléfonos necesita
la firma del catálogo, que guarda el mantenedor.

## Cargos

### C-1 · Dosis infiel en imperativo con un dígito, sellada fundada

- **Asiento:** `src/rag/grounding.ts`, `hasJudgedDigit` (la vara de
  cifras: 2+ dígitos o decimal) e `isTypedDatumOffender` (la pierna
  tipada de A3-03, que solo mira la frase con categoría y cópula,
  «la dosis es…»).
- **Sondas sobre `be4ed9d`** (`verifyGroundedAnswer`, estado):
  - «Take 5 tablets every eight hours.» contra «Take 2 tablets…» →
    `grounded` con `[1]`.
  - «Give 6 puffs of the reliever inhaler.» contra «Give 2 puffs…» →
    `grounded`.
  - «Give 5 ml of the syrup.» contra «Give 10 ml…» → `grounded`.
  - Con el trozo real de la v11 «Dolor de pecho e infarto — Qué
    hacer»: «Que mastique 8 aspirinas infantiles de 81 mg y las
    trague.» (la guía dice 2 a 4) → `grounded` con `[1]`, y la caja
    (`findNumberConflicts`) tampoco lo marca.
- **Contradice:** el CHANGELOG de la 0.1.70 («a dose is judged
  however the question is phrased — in figures, in words or in
  fractions… puffs, sprays and inhalations included») y las filas
  H-03 y H-15 de la pasada. Lo que se curó fue el número en letra y
  la frase tipada; el dígito único en una instrucción quedó fuera.
- **Cura:** `doseMeasuresOf` y `measuredDoseConflict` en
  `grounding.ts`, al lado de la vara sin tocarla (`MIN_*` e
  `isSupported` intactos): cada cifra se une a su unidad de dosis,
  con rangos y números en letra, y la frase se retira si la
  evidencia dosifica esa unidad con otra cifra. Fixtures en las dos
  direcciones en `grounding.measuredDose.test.ts`. Barrido de
  regresión: las 1.791 frases con cifras de las 174 guías de la v11,
  cada una contra su propio trozo, dan el mismo veredicto antes y
  después (0 diferencias); la batería del juez sigue 152/152.

### C-2 · Las claves de cobertura C-03 no están en los paquetes publicados

- **Asiento:** commits `56a3a83` y `2dc69d6` (claves `questions:` y
  comentarios por apartado en las guías es/en de `main`); paquetes
  servidos `knowledge-packs-v10` y `knowledge-packs-v11`.
- **Medida:** en la v11 servida solo 4 trozos es y 4 en llevan
  claves (75 de 568 en total, casi todos pt); en la v10, 2 y 2. La
  fuente con la que se construyeron (rama `build/nido-esencial-v10`
  y commit `e5a55c0`) no trae las claves. Corriendo la puerta real
  (`filterByTermCoverage` de `src/rag/pure.ts`) sobre los trozos de
  la v11 servida con la batería de `retrieve.coverageGate.test.ts`:
  **11 de 22 preguntas siguen muriendo** (fiebre de 39, paracetamol
  de 20 kg, alacrán, serpiente, moneda, desmayo, corte con
  sangre…).
- **Contradice:** el CHANGELOG («Every Esencial guide now carries a
  `questions:` key… all eighteen dead questions revive»): es cierto
  de la fuente de `main`, no de lo que llega al teléfono.
- **Cura en la fuente:** las claves de `main` se conservan encima
  del texto v11 (113 claves de frontmatter y 10 comentarios por
  apartado; los tests que leen la fuente pasan). **Pendiente del
  mantenedor:** construir y publicar el próximo paquete del
  Esencial y re-firmar el catálogo (`scripts/sign-manifest.mjs`
  exige la clave privada, que no está en el repo ni en CI).
  Conviene re-correr antes los checks de sello del repo de
  paquetes, que no están en este repo.

### C-3 · `main` no tenía el texto publicado del Esencial

- **Asiento:** `knowledge-packs/nido-esencial/` en `be4ed9d` frente
  a `e5a55c0` (el commit del que CI construyó la v11, corrida
  41644340311): 180 ficheros distintos; `e5a55c0` no es ancestro
  de `main`; `main` no tiene la carpeta `pt/`, ni
  `verification-ledger.json`, ni `seal-baseline.json`.
- **Sondas:** en `be4ed9d`, `en/57-road-crash.md` dice «Park your
  vehicle off the road and beyond the crash» y `es/26-…` mantiene la
  prueba de «que sepa a lágrima»; en los bytes de la v11 servida
  esas frases tienen 0 apariciones y la forma corregida 1.
- **Cura:** la carpeta del Esencial de `e5a55c0` entra en el árbol
  (más las claves de C-2) y `floor.json` pasa a la v11 con las
  cifras contadas de lo servido (174 guías, 568 trozos
  193/183/192, 1.163.264 bytes).
- **Observación:** las etiquetas `knowledge-packs-v10` y `-v11`
  apuntan a la punta de `main` del momento (`51c4d6c`, `b69de502`),
  no al commit construido; la procedencia real vive en la corrida
  de CI. Mismo patrón que antes; no se cambia aquí.

### C-4 · «Como se chama o meu pai?» responde que no se lo han contado

- **Asiento:** `src/agent/loop/memoryQuery.ts`, `REL_NAME_Q_RES`
  (la forma pt aceptaba «a minha» y «meu», no «o meu»).
- **Sonda:** con la ficha `pai = Carlos` → «Você ainda não me contou
  isso. Quando contar, eu guardo.» Igual con irmão, avô, tio,
  filho, marido. «Qual é o nome do meu pai?» sí servía.
- **Cura:** `(?:[ao] )?`; tests en `memoryQuery.test.ts`.

### C-5 · La detección de fechas al guardar un hecho no conoce el portugués

- **Asiento:** `src/agent/tools/handlers.ts`, `DATE_PATTERNS` /
  `containsDatePattern` (solo es/en, sin «setiembre»). Además
  refuta la precisión P-4 de la pasada («cinco tablas literales»):
  hay al menos una sexta, y otras dos listas en `grounding.ts:778` y
  `sourceCheck.ts:513`.
- **Cura:** meses pt, «setiembre» y el ordinal inglés; test propio.

### Hallado y no curado aquí (bajo)

- «¿Cuándo es mi cumpleaños?» con el hecho «El cumpleaños de mi
  abuela es el 15 de marzo y el mío es el 3 de mayo» → «Todavía no me
  has contado eso». El pronombre «el mío» no está entre las formas
  propias (`SELF_BDAY_PHRASE_RE`). La respuesta no sirve la fecha
  ajena (lo que la cadena prometió), pero niega un dato guardado.
- La frase corta sin negación copiada de una frase larga de la
  fuente («El paciente está sangrando.» contra «El paciente no está
  sangrando y respira con normalidad tras la caída.») sale tal cual,
  sin cita, con estado `grounded`. Con la frase de la fuente corta,
  la cura T-J7 sí la sustituye.

## Refutaciones de papel (sin efecto en código)

- **P-1:** la pasada (§1 y §11.5) dice que `QUERY_PATTERNS` lo
  consume solo `isRememberQuery` y que el clasificador de intención
  no lo consume. La función es `isMemoryQuery`
  (`rememberRouter.ts:163`) y **sí** la consume `intent.ts:319`
  (ruta «recordar»). La superficie no censada tiene más alcance del
  declarado.
- **P-2:** el commit `5298075` que el acto describe como «la cura
  del cargo PC-§S-1» tiene por asunto D-7/D-10; la cura está en su
  diff (`docs/es/KNOWLEDGE_PACKS.md`, +5 líneas), no en su mensaje.
- **P-3:** «punta firmada» designa la firma del catálogo
  (`manifestSignature.ts`), no una firma git: `be4ed9d` no lleva
  firma GPG/SSH y su autor es `NIDO <nido@localhost>`.

## Tabla de cobertura

| Afirmación | Sede | Veredicto |
| --- | --- | --- |
| `main` = `be4ed9d`, cadena `80851c9`→`2ba714a`→`5298075`→`c52b76a`→`be2b255`→`be4ed9d` | `git log` | Comprobada |
| Release `v0.1.70-alpha` id 432795278, 2026-11-03T14:21:01Z, `target_commitish` `be4ed9d` | API de releases | Comprobada |
| APK 133.310.979 B, sha256 `9ae3024a…`, igual al `sha256sum` del log | asset servido + log del job 125955857836 | Comprobada |
| `team.nido.app` 0.1.70 / 71, certificado `4bd73b2f…` | binario + `app.json` | Comprobada |
| Corrida 41647290881: 0 `##[error]`, vitest 340/5.857, jest 13/52, `emergencyGate` 39, SQLCipher real, pins 32, manifest-sig | log del job | Comprobada |
| v11 id 432734387, sha bge `3024a7b1…` y e5 `81cf08ea…`, 1.163.264 B | bytes servidos | Comprobada |
| v11: 174 guías 58/58/58, 568 trozos 193/183/192, edición 2026-11 | tablas `guides`/`chunks` + `.json` servidos | Comprobada |
| v11: FA bge 6/6, FA e5 38/38, recuperación e5 201/202, bge 64/64 | anotaciones de la corrida 41644340311 | Comprobada |
| Suelo `be2b255`: dos entradas del Esencial a la v11, «~4.31MB», ledger de releases solo añade | diff | Comprobada (la línea vieja cambia solo por la coma) |
| Firma `be4ed9d`: una línea en `manifestSignature.ts`; `verify:manifest-sig` OK | diff + log | Comprobada |
| Cura PC-§S-1: párrafo v10 ES en `docs/es/KNOWLEDGE_PACKS.md:115` espejo del EN :111 | fichero | Comprobada |
| Ledger: 174 entradas / 2.283 filas; 1.329 · 930 · 21 · 3 · NO ENCONTRADO 0 | `verification-ledger.json` de `e5a55c0` | Comprobada (en `be4ed9d` no existía: C-3) |
| Ledger: 174 auditores firmados, 0 preparador = auditor | mismo fichero | Comprobada |
| Ledger: D-A3 no usada | mismo fichero (3 menciones, todas «jamás forma D-A3») | Comprobada |
| Hashes clínicos y checks (a)(b)(c) en exit 0 | algoritmo y scripts no están en el repo | NO ENCONTRADO |
| Frontera pt: variantes 12/14, VAR-pt-2 #32, VAR-pt-3 #14 (o #13) | ni las variantes ni el instrumento están en el repo; CHANGELOG solo dice «12/14» | NO ENCONTRADO |
| «Toda dosis sobre el trozo #381 rompe la puerta FA» | sin sede | NO ENCONTRADO |
| Recuperación 202/202 local frente a 201/202 en CI | la de CI está; la local no tiene sede | Parcial (manda la de CI; las posiciones locales de la frontera pt heredan esa incertidumbre) |
| Commits del repo de paquetes (`9066190`, `d80eb0a`, `0a8e6a9`, `372f511`, `550dd04`, `64ac4dc`, `b3feb55`, `099fac1`, `df84583`, `f5e5e7a`, `60b89ef`, `413e2fd`, `d62344d`, `2033ffa`, `a4b0f52`, `b049600`, `64c2297`, `14ae2de`) y `087ed20` | no existen en el repo público | NO ENCONTRADO |
| Commits de la app de la cadena (`eee2684`, `dbf808d`, `3977857`, `a55da85`, `9f8ebbc`, `aa3b1b8`, `4b1ccce`, `103f365`, `dff1895`, `82a121c`, `c6904c2`, `9a91057`, `5282066`, `882bc53`) | en `main` | Comprobada |
| Vara del juez intacta (constantes en `grounding.ts:306-309`, `isSupported` idéntico a `b69de502`) | diff de texto; prefijo de hash de `isSupported` `92149ef8` coincide | Comprobada |
| `hasJudgedDigit` ×2, `scoreMemoryFacts` ×1, `rotateDatabaseKey` 0 en `src/` | grep | Comprobada |
| `TOOL_KINDS` = 23 | `toolRouter.ts:53` | Comprobada |
| Símbolos de segmentación (`clauseBounds`, `commaSubRange`, `commaSubSlice`, `pickAnchorSpan`, `birthdayServingSlice`, `clauseSlice`), `DATUM_TYPE_BY_WORD`, `NUMBER_WORDS`, `TIMER_NUMBER_WORDS`, familias `*_Q_RES`, regla R7 «anio» | `memoryQuery.ts`, `grounding.ts`, `actionRouter.ts`, `dates.ts` | Comprobada |
| Fixture H-04 en `emergencyGate.test.ts` | línea 258 | Comprobada |
| «Sua pai» → «Seu pai» | sonda | Comprobada |
| Cumpleaños cruzado curado (PC-1) | sonda | Comprobada; frontera O-1 reproducida tal como se declara |
| Juez: dosis pt con cópula, «¿cómo se toma?», números en letra | sondas | Comprobada |
| Juez: dosis con un dígito y puffs (H-03/H-15 «en toda forma») | sondas | **Refutada → C-1** |
| C-03 «toda guía lleva `questions:`» en lo publicado | bytes servidos v10/v11 | **Refutada → C-2** |
| `QUERY_PATTERNS` no lo consume el clasificador de intención | `intent.ts:319` | **Refutada → P-1** |
| Cinco tablas de meses literales | `handlers.ts:337` y otras | **Refutada → C-5** |
| Órdenes del dueño, papeles de adversarias, informes de tandas | fuera del repo | NO ENCONTRADO (no se juzgan) |

Cuenta: 33 filas de la tabla; 24 comprobadas o parciales, 4
refutadas, 5 sin sede.

## Lo que esta auditoría no firma

- Nada de lo arreglado se ha probado aún en un teléfono físico.
- No re-ejecuté la recuperación ni las posiciones de la frontera
  portuguesa: las variantes y el instrumento no están en el repo.
- El dictamen sobre la calidad clínica del texto de las guías no
  entra: se comprobó la cuenta del ledger, no las citas una a una.
