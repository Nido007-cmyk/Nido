# Auditoría completa de 0.1.62 a 0.1.72 (2026-11-03)

Auditor: Claude, en el papel de adversario. Base: main `113b313`.
Método: cada afirmación pública del CHANGELOG de 0.1.62 a 0.1.72 se
contrasta con su asiento en el código (fichero y símbolo). En las
superficies de más riesgo se lanzan sondas que ejecutan el código
real con entradas hostiles o raras: OCR e importación, puerta de
emergencia, salud y crisis, juez, memoria, PDF y respaldos. Si una
afirmación no tiene asiento, se marca **NO ENCONTRADO**.

Profundidad de cada fila:

- **Atacada:** se ejecutó con sondas propias.
- **Leída:** se leyó el código y su test.
- **Localizada:** se encontró el símbolo y su test, sin lectura
  completa.

Las auditorías del mismo día sobre la 0.1.70
(`AUDIT_0.1.70_2026-11-03.md`) y la 0.1.72
(`AUDIT_0.1.72_2026-11-03.md`) cubren el juez, la memoria, la
publicación v11/v12 y la identidad de los APK. Aquí no se repiten;
se citan en sus filas.

## Veredicto

**APTO CON CARGOS.** Lo publicado funciona como dice, salvo en
cinco puntos. Uno es un mensaje falso que ve todo usuario que
importa un PDF de texto (F-1). Tres son asimetrías de idioma en la
puerta de seguridad (F-5, F-6 y F-7). El último es una promesa de
la 0.1.68 que el código cumplía solo a medias (F-2). Todos quedan
curados en este PR, con tests en pares. Ninguno toca el juez de
fundamentación.

## Cargos (curados en este PR)

**F-1 (medio, visible para el usuario). Cada PDF de texto recibía
un aviso falso de OCR.**

- Desde la 0.1.68, todo PDF de solo texto se importaba con el aviso
  «el reconocimiento no encontró texto en sus páginas escaneadas»,
  aunque no tuviera ninguna página escaneada.
- Causa: `recognizePdf` (`modules/nido-ocr/.../NidoOcrModule.kt`)
  devuelve «» tanto si no hay páginas escaneadas como si el motor
  no lee nada. `parseFileContent` (`src/services/documentImporter.ts`)
  anotaba los dos casos en `ocrEmptyNames`.
- El propio código y un test lo daban por «asentado», en espera de
  «otro carril».
- Cura:
  - el nativo expone `findScannedPdfPages`;
  - `recognizeScannedPdfText` (`src/services/ocr.ts`) devuelve
    `null` cuando no hay páginas escaneadas, y solo reconoce las que
    lo son;
  - el importador no avisa ante `null`;
  - con un nativo anterior se conserva la vía antigua.
- Bonus: un PDF de texto ya no arranca el motor de OCR.

**F-2 (bajo, promesa pública). El tipo de fichero no lo decidían
los bytes cuando la extensión era conocida.**

- La 0.1.68 dice «el tipo de un fichero lo deciden sus bytes, no su
  nombre». Pero en `parseFileContent` una extensión conocida mandaba
  sin mirar los bytes.
- Un PDF llamado «.txt» se indexaba como texto basura. Una foto
  llamada «.pdf» fallaba como PDF ilegible.
- Cura: la magia fuerte de `attachmentKind` (%PDF-, JPEG, PNG, WEBP,
  GIF, HEIF) manda siempre. Sin ella, decide la extensión, como
  antes.

**F-4 (bajo). Los códigos de error del nativo de OCR se perdían.**

- `src/services/ocr.ts` convertía todo rechazo del nativo en
  `OCR_FAILED`. Eso incluía el fallo de integridad de los datos de
  idioma (`OCR_UNAVAILABLE`) y `PASSWORD_REQUIRED`.
- La Biblioteca enseñaba «(OCR_FAILED)» para un problema que no era
  de reconocimiento.
- Cura: `fromNative` conserva el código.

**F-5 (alto, seguridad). La emergencia viva contada no se reconocía
en sus formas corrientes.**

`isEmergencySituation` (`src/routing/emergencyGate.ts`,
`EMERGENCY_SIGNS`) dejaba fuera:

- «my dad isn't breathing»: la contracción se pliega a «isn t
  breathing», que no contiene «not breathing». «is not breathing» sí
  disparaba.
- la primera persona de la respiración en español y portugués: «no
  puedo respirar» y «não consigo respirar». El inglés sí traía «can't
  breathe».
- la convulsión en inglés: «having a seizure». El español y el
  portugués sí traían «está convulsionando».
- el infarto y el ictus en curso, en las tres lenguas.

Cura: se añaden esas frases-signo en las tres lenguas. Sus metáforas
no disparan («backstroke», «brush stroke», «what is a heart attack»).

**F-6 (medio, seguridad). La puerta de salud no conocía el infarto,
el ictus ni la ingestión.**

- `HEALTH_TERMS` no traía «infarto», «heart attack», «AVC», «ictus»
  ni la ingestión («swallowed a battery», «se tragó pastillas»,
  «engoliu água sanitária»).
- Consecuencia: sin guía recuperada, la salida del modelo quedaba en
  pie, y eso es justo lo que la puerta existe para impedir.
- Cura: términos simétricos en las tres lenguas. La ingestión solo
  cuenta con su objeto, para que no salten «the ATM swallowed my
  card» ni «se tragó el cuento».

**F-7 (alto, seguridad). La intención de crisis no reconocía la
forma corriente en español y portugués.**

- `CRISIS_INTENT_CUES` (`src/rag/packFacts.ts`) traía «kill myself»
  en inglés, pero no «quiero matarme», «me voy a matar», «quero me
  matar» ni «vou me matar».
- «quiero matarme» no abría la ruta de líneas de crisis.
- Cura: `CRISIS_SELF_KILL_CUES`, más «acabar con mi vida», «acabar
  com a minha vida» y «take my own life». El modismo de esfuerzo
  queda fuera («me voy a matar estudiando», «vou me matar de rir»).

**Documentación.** `AGENTS.md` y `AGENTS.es.md` decían «siete módulos
nativos». Hay doce: faltaban nido-keyvault, nido-launch, nido-ocr,
nido-pdf-text y nido-vectors. Corregido.

## Observaciones sin cura aquí

- **Idioma del OCR.** El OCR usa solo el idioma de la app
  (`TESSDATA_LANG`). Un documento en inglés importado con la app en
  español se reconoce con el modelo «spa». Funciona con el alfabeto
  latino, pero peor. Dar los tres a la vez («spa+eng+por») exige
  cambiar la verificación de integridad del nativo. Es una decisión
  de diseño.
- **Datos de idioma tras el borrado total.** Los datos de idioma del
  OCR (`noBackupFilesDir/ocr/tessdata`) sobreviven al borrado total.
  No son datos del usuario: vienen dentro de la app. Pero la frase
  «censo de todo fichero que la app produce» los deja fuera.
  `wipeCensus.test.ts` escanea TS y un fichero Kotlin, no el OCR.
- **Cifra caducada.** `docs/CRYPTO_ARCHITECTURE.md` dice «1985
  tests», una cifra antigua.
- **Prueba física.** Desde la 0.1.69, ninguna versión se ha probado
  en un teléfono físico. La última ronda del dueño fue la de la
  0.1.68: OCR de un documento de prueba, Local en portugués e
  interrupción.

## Tabla de cobertura

| Versión | Afirmación | Asiento | Profundidad | Estado |
|---|---|---|---|---|
| 0.1.62 | Registro de red persistente (500) | `src/privacy/networkAudit.ts`, `networkAudit.limits.test.ts` | Localizada | Comprobada |
| 0.1.62 | PDF que se descomprime en texto enorme, rechazado | `parseFileContent` (`estimateChunkCount` antes de trocear) | Leída | Comprobada |
| 0.1.62 | Piezas de pack no aceptado no se guardan | `src/p2p/packShareService.ts` | Localizada | Comprobada |
| 0.1.62 | Restaurar dice fecha y efecto; formato más nuevo rechazado | `validateBackup` (`tooNew`) en `src/security/backup.ts` | Leída | Comprobada |
| 0.1.62 | Checksum = SHA-256 real; los viejos se aceptan | `sha256File` / `legacySha256File` | Leída | Comprobada |
| 0.1.62 | Tope de 100 MB al desempaquetar | `MAX_BUNDLE_BYTES` | Localizada | Comprobada |
| 0.1.62 | Permisos de insignia retirados | Manifiesto del APK 0.1.72 (auditoría 0.1.72) | Leída | Comprobada |
| 0.1.63 | Contacto «no verificado» hasta pulsar Verificar | Mensajería P2P | Localizada | Parcial (símbolo no leído entero) |
| 0.1.63 | Dictado solo con reconocedor del teléfono | `VoiceInputModule.kt` (`startListening(onDeviceOnly)`, `E_ON_DEVICE_UNAVAILABLE`) | Leída | Comprobada |
| 0.1.63 | Fichero de rotación cifrado | `src/security/keyRotation.ts` (staging cifrado con llave del Keystore) | Localizada | Comprobada |
| 0.1.63 | Cuota de ofertas 3/10, caducan a los 30 min | `MAX_PENDING_OFFERS_PER_PEER` / `_TOTAL` / `OFFER_TTL_MS`, `expireUnacceptedOffers` | Leída | Comprobada |
| 0.1.64 | Lector PDF propio: >3.000 páginas rechazado; corta a mitad de página | `NidoPdfTextModule.kt` (`CappedStripper`, `CappedWriter`), `MAX_IMPORT_PDF_PAGES` | Leída | Comprobada |
| 0.1.64 | La bóveda exige respaldo de ≤30 días | `src/security/vaultBackupGate.ts` (`VAULT_BACKUP_MAX_AGE_MS`) | Localizada | Comprobada (y probada en la tablet) |
| 0.1.65 | Respuesta sigue en segundo plano; nota si el sistema la corta | — | No auditada | NO ENCONTRADO en esta pasada |
| 0.1.65 | «Cuéntame un cuento» es creación | `src/routing/classify.creative.test.ts` | Localizada | Comprobada |
| 0.1.65 | Números de emergencia en lenguas mezcladas | `emergencyQuestionKind` (`src/rag/packFacts.ts`) | Localizada | Comprobada |
| 0.1.65 | La guía abre en la sección preguntada | Anclaje de guías | No auditada | NO ENCONTRADO en esta pasada |
| 0.1.65 | Siete packs nuevos; Esencial pt; Local 69 países | Releases de packs | Leída (Esencial v12) | Comprobada para Esencial; el resto, no medido aquí |
| 0.1.66–0.1.67 | Ediciones corregidas de packs (v7, v8) | Releases | No medida aquí | NO ENCONTRADO en esta pasada |
| 0.1.66 | Sin permiso de insignia | Manifiesto del APK | Leída | Comprobada |
| 0.1.67 | 124 hallazgos, 88 curados | Informe de la 0.1.67 | No re-auditado | Fuera de alcance |
| 0.1.67 | Firma del catálogo sobre 14 campos | `manifestSignature.ts` / `verify:manifest-sig` | Leída | Comprobada (OK en CI) |
| 0.1.67 | Respaldos que fallan en voz alta, copia previa al restaurar | `restoreBackup` / `restoreExtracted` | Leída | Comprobada |
| 0.1.67 | El borrado total se verifica | `resetAllAppData`, `checkGone`, `WipeVerificationError` | Leída | Comprobada (ver observación del OCR) |
| 0.1.67 | Generaciones serializadas | `LlamaEngine.generate` (M-6) | Localizada | Comprobada |
| 0.1.67 | Conversor: «1,000» no es 1 | `src/agent/tools/convert.ts` | Localizada | Parcial |
| 0.1.68 | Lee fotos y escaneos en el teléfono, datos verificados por hash | `NidoOcrModule.kt` (`TRAINEDDATA_SHA256`, `tessRoot`) | Atacada | Comprobada, **con F-1, F-2 y F-4** |
| 0.1.68 | Sin módulo, el escaneado nombra su causa | `emptyImportErrorCode` (`scannedNoOcr`) | Leída | Comprobada |
| 0.1.68 | El tipo lo deciden los bytes | `attachmentKind` | Atacada | **F-2**, curada |
| 0.1.68 | Importaciones concurrentes no se pisan | `inFlightCollectionIds` | Leída | Comprobada |
| 0.1.68 | La evidencia primero; cifra contradicha marcada | `findNumberConflicts` (auditoría 0.1.70) | Atacada | Comprobada |
| 0.1.68 | Emergencia a mitad de generación; la contada es puerta; la historia no | `isEmergencyText`, `isEmergencySituation`, `hasHistoricalFrame` | Atacada | **F-5 y F-6**; la historia no dispara (comprobado) |
| 0.1.68 | Texto seguro con la sustancia de las guías | `HEALTH_SAFE_TEXT` | Leída | Comprobada |
| 0.1.68 | Carga del modelo según el teléfono | `ModelManager` | Localizada | Parcial |
| 0.1.68 | Local trilingüe, 164/165 | knowledge-packs-v9 | No medida aquí | NO ENCONTRADO en esta pasada |
| 0.1.68 | Tarjeta de edición; publicación atómica | `buildEditionCard` (`scripts/build-knowledge-pack.mjs`) | Localizada | Comprobada |
| 0.1.68 | Borrado total: censo | `DOC_LEFTOVER_FILES`, `wipeCensus.test.ts` | Leída | Comprobada (salvo los datos de OCR, ver arriba) |
| 0.1.69 | Juez por tipo, unidades, fechas, puerta de cobertura | Auditoría 0.1.70 | Atacada | Comprobada (C-1 curado en 0.1.71) |
| 0.1.69 | Memoria: nombres, olvido, recordatorios | Auditoría 0.1.70 | Atacada | Comprobada (C-4, C-5 y «el mío» curados) |
| 0.1.69 | Enciclopedia de 858; −20,8 MB; SQLCipher real | CI y APK (auditorías 0.1.70 y 0.1.72) | Leída | Comprobada |
| 0.1.70 | Todo lo de la 0.1.70 | `AUDIT_0.1.70_2026-11-03.md` | Atacada | Comprobada con cargos curados |
| 0.1.71 | Dosis medida, «o meu», fechas pt | Curas propias, con tests | Atacada | Comprobada |
| 0.1.72 | Catálogo v12 con claves | `AUDIT_0.1.72_2026-11-03.md` | Atacada | Comprobada (K-1 de papel) |
| — | Intención de crisis trilingüe | `crisisQuestionKind` | Atacada | **F-7**, curada |
| — | AGENTS: módulos nativos | `AGENTS.md` / `AGENTS.es.md` | Leída | Corregida |

## Lo que esta pasada no cubre

- Las filas marcadas «NO ENCONTRADO en esta pasada» o «No medida
  aquí»: no se abrieron sus asientos. No se afirman ni se niegan.
- Nada de esto sustituye la prueba física. Lo que más importa probar
  en la tablet:
  - una emergencia contada en las tres lenguas («my dad isn't
    breathing», «no puedo respirar»);
  - un PDF de texto, que ya no debe dar aviso de OCR;
  - una foto de una caja de medicina.
