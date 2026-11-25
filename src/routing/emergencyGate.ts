/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * Emergencia primero y puerta léxica de salud (programa «Lo mejor de
 * la bounty», tanda 2; pieza 06 de la colección: Field Atlas,
 * Apache-2.0, y el patrón de puerta léxica de LabRat, MIT, descrito en
 * su README — implementación propia, ver ATTRIBUTION.md).
 *
 * Dos garantías que a NIDO le faltaban, verificadas en su código:
 *
 * 1. LO DE EMERGENCIA NO HACE COLA. Las rutas fijas (monóxido →
 *    números verificados de los packs → tabla de safetyAnswers)
 *    responden sin modelo al principio de send(), pero mientras otra
 *    respuesta se estaba generando el compositor se deshabilitaba y
 *    el botón de enviar era «detener»: una emergencia tecleada a mitad
 *    de generación no podía ni enviarse. `isEmergencyText` reconoce el
 *    texto con los MISMOS detectores puros de las rutas fijas, para
 *    que la pantalla ofrezca el envío de emergencia durante la
 *    generación; al tocarlo se detiene y se espera la generación en
 *    curso (la vía de stopAndAwaitGeneration) y el envío entra por la
 *    ruta fija, que pinta al instante y primero.
 *
 * 2. LA SALUD SIN GUÍA NO CAE A LA MEMORIA DEL MODELO. Si la pregunta
 *    es de salud (puerta léxica, no el juicio del modelo) y ningún
 *    pasaje recuperado es evidencia de salud, las salidas que dejaban
 *    texto del modelo en pie (sin fuentes, o «unverified» por lengua
 *    distinta, o el extracto de una fuente que no es de salud en la
 *    abstención) se sustituyen por el texto seguro fijo. Lo
 *    «grounded»/«partial» NO se toca: no es memoria del modelo, es
 *    texto verificado frase a frase contra sus fuentes.
 *
 * Evidencia de salud = un chunk de los packs cuyas guías son de salud
 * con fuentes verificadas: NIDO Esencial y NIDO Niños (primeros
 * auxilios) y NIDO Crisis (líneas de crisis). El id puede llevar el
 * sufijo de embeddings «-e5» (la convención de guideAnswer.ts).
 *
 * 3. LA EMERGENCIA VIVA CONTADA TAMBIÉN ES PUERTA (cierre de
 *    evaluaciones, 2026-10-31; hallazgo F-B1 de la evaluación ciega
 *    01, docs/BLIND_EVAL.md). La corrida 01 midió que las emergencias
 *    vivas sin pack caían al modelo: la puerta léxica conoce
 *    diagnósticos («ahogamiento») pero la gente cuenta el suceso
 *    («se está ahogando», «no puede respirar», alguien agarrándose
 *    el pecho, humo saliendo de la cocina). `isEmergencySituation`
 *    es esa otra cara de la puerta: signos tal cual se cuentan,
 *    gerundios y tercera persona incluidos, sin exigir señal de
 *    pregunta — quien lo cuenta no pregunta, pide ayuda. Donde la
 *    puerta de salud manda (sin fuentes, o sin evidencia de salud)
 *    manda también esta cara, y sirve el mismo texto seguro: con la
 *    guía instalada responde la guía por recuperación; sin ella,
 *    ninguna emergencia queda a la improvisación del modelo. La
 *    cura se mide contra un conjunto ciego FRESCO (corrida 02), no
 *    contra el conjunto 01 que la destapó (regla del sello).
 *
 * 4. EL PASADO NO ES UNA SITUACIÓN (arreglo F-B3, 2026-10-31;
 *    hallazgo de la corrida ciega 02). Una pregunta de historia
 *    sobre una enfermedad («Qual foi a febre espanhola de 1918 e
 *    quantas pessoas matou?») trae término de salud y señal de
 *    pregunta, y la puerta disparaba: los vetos solo cubrían el
 *    marco explícito «história de…». `hasHistoricalFrame` reconoce
 *    el marco histórico o cultural (siglos, muertes contadas,
 *    pandemias nombradas, novelas y películas, y el patrón año +
 *    verbo en pasado) y veta las DOS caras de la puerta: quien
 *    pregunta por el pasado no está en una situación de salud ni
 *    en una emergencia. La cura se mide contra un conjunto ciego
 *    FRESCO (corrida 03), no contra el conjunto 02 que la destapó.
 *
 * 5. EL TEXTO SEGURO TAMBIÉN ENSEÑA LO ESENCIAL (sustancia del
 *    texto fijo, 2026-10-31; medida de las corridas ciegas 01 y
 *    02). El texto anterior era un suelo honesto pero mínimo —
 *    puntuó 38,9 % (01) y 41,7 %/33,3 % (02) contra la frontera
 *    porque no decía nada de la situación. El texto nuevo mantiene
 *    la honestidad y añade, en orden: los signos que hacen urgente
 *    una situación, los gestos universales paso a paso, lo que no
 *    hay que hacer y la regla de las dosis. LÍMITE DURO: cada
 *    afirmación se traza línea a línea a las guías del propio pack
 *    Esencial (ver el comentario junto a HEALTH_SAFE_TEXT); nada de
 *    contenido clínico nuevo. Sin números de teléfono escritos (la
 *    prueba de la casa lo prohíbe: el número cambia por país) y con
 *    el ritmo de la RCP en palabras, no en dígitos, por la misma
 *    regla. La mejora se mide contra el conjunto FRESCO 03.
 *
 * 6. LA PUERTA MANDA TAMBIÉN SOBRE INVESTIGAR (R-07, ronda física
 *    de la 0.1.68). Con el modo Investigación profunda activo, el
 *    turno entraba en ese pipeline antes de que ninguna puerta
 *    mirara el texto: una emergencia dictada («¿qué hago si alguien
 *    se está atragantando?», con el «alguien» del dictado convertido
 *    en «argument») salió como tema de investigación, en inglés y
 *    sobre un debate. El detector SÍ disparaba con la frase exacta;
 *    lo que faltaba era consultarlo. `gatePreemptsDeepResearch` es
 *    la decisión única que ChatScreen aplica antes de la bifurcación
 *    profunda y que el pipeline reaplica tras descomponer. La misma
 *    ronda midió la fragilidad a nivel de letra: una letra caída
 *    dentro de la palabra-signo rompía las frases exactas en las
 *    tres caras — de ahí la cara por raíz de `isEmergencySituation`
 *    (punto junto a EMERGENCY_STEMS) y las frases de respiración que
 *    faltaban («le cuesta mucho respirar», «se está asfixiando»).
 *
 * 7. LA RAÍZ SOLA NO DECLARA LA SITUACIÓN (H-05, revisión
 *    adversaria de la cadena, 2026-11-01). La cara por raíz cazaba
 *    también la metáfora: «Why do golfers choke under pressure?»
 *    salía situación de emergencia (y cerraba la puerta de salud)
 *    porque «chok» casa por principio de palabra y el sujeto
 *    genérico de la metáfora no se distingue de una víctima por la
 *    raíz sola. Desde este arreglo la raíz exige CONTEXTO DE
 *    CUERPO (ver `stemOccurrenceHasBodyContext`): la construcción del
 *    suceso en curso (auxiliar ante la palabra-signo, enclítico
 *    reflexivo) o una víctima o petición de ayuda cerca de la
 *    palabra-signo. Las formas dictadas medidas en la ronda —
 *    «se esta tragantando», «se esta atragantndo», «my toddler is
 *    chokng», «o bebê está engasgndo» — traen todas ese contexto y
 *    siguen disparando; los sujetos genéricos de la metáfora
 *    (golfers, players, students) no son señal a propósito. Las
 *    frases-signo exactas no cambian: siguen disparando solas.
 *
 * 8. LA FRONTERA NO ES LA LISTA CERRADA DE VÍCTIMAS NI EL ÚNICO
 *    EVENTO (ADV2-07 + ADV-E1, segunda adversaria y corrida de
 *    Grok, 2026-11-01). La cura de H-05 dejó fuera emergencias
 *    reales en dos dimensiones medidas: la víctima nombrada con el
 *    sustantivo corriente de un parte (señor, vecino, cliente,
 *    paciente, patient…) en forma de participio o telegráfica, y
 *    los eventos que no son atragantamiento (desmayo, ahogamiento,
 *    inconsciencia, con sus tallos y frases-signo en las tres
 *    lenguas). La pieza ensancha las LISTAS con el criterio escrito
 *    junto a cada una — no la ventana: la cara permisiva sin
 *    ventana de la corrida externa se midió y se rechazó (reabre
 *    la metáfora entera y ni así ve las formas telegráficas). Y
 *    nace la cara telegráfica: el parte dictado a secas («atragan-
 *    tado», «Choking at table four!») declara por su forma —
 *    mensaje cortísimo, sin pregunta, con la palabra-signo en
 *    participio, gerundio o estado, y sin marcadores de tema.
 *
 * 9. EL PREFIJO SIN RESTO DECLARABA CUERPOS QUE NO HAY (ADV2-08 +
 *    ADV-E2, 2026-11-01). El casado de señales por principio de
 *    palabra cazaba «helpful» por «help», «babysitter» por «baby»
 *    y «personal» por «person»: desde este arreglo la señal casa
 *    solo si la palabra ES la señal o la señal + resto ∈ {s, es}
 *    (el plural; los femeninos van como entradas propias). Y dos
 *    vetos nuevos cierran el tema de seguridad de producto
 *    («choking hazard» y sus formas) y el modismo «choke back»,
 *    que no tiene gemelo físico. Lo demás de la familia queda
 *    como PRECIO DECLARADO y fixturado, sin código: la metáfora
 *    familiar («my son choked at his piano recital») y la
 *    metáfora con auxiliar de ADV-E2 («se atragantó en el
 *    debate») — esta última medida sin cura limpia: la pierna
 *    que la deja pasar (el «se» auxiliar) es la misma que
 *    sostiene la forma real «Se atragantó con una espina», y la
 *    frase metafórica es idéntica, palabra a palabra, a su
 *    gemela verdadera; todo veto de marco vetaría la emergencia
 *    real con esa frase exacta.
 *
 * 10. LA REANIMACIÓN EN CURSO TAMBIÉN SE CUENTA (F-1, auditoría
 *    adversaria de la práctica de RCP de la 0.1.76, 2026-11-06).
 *    La batería de enrutado de esa auditoría midió que contar una
 *    reanimación en curso («está haciendo rcp», «they are doing
 *    cpr on him», «estão fazendo rcp nele») no disparaba ninguna
 *    cara, y que varias formas corrientes de preguntar cómo se
 *    hace («cómo se hace la rcp», «como faço rcp», dictadas sin
 *    signos) tampoco cerraban la puerta de salud: sin el pack,
 *    esas frases caían al modelo sin el suelo del texto seguro.
 *    La cura es la de la casa, editar las listas: los signos de
 *    situación aprenden las formas de reanimación en curso de las
 *    tres lenguas (quien lo cuenta no pregunta: es la cara de
 *    situación, no la de salud), las raíces aprenden «reanim»,
 *    «resuscit» y las siglas «rcp»/«cpr» bajo la misma disciplina
 *    de contexto de cuerpo de H-05, el léxico de salud aprende
 *    «reanimacion»/«reanimacao»/«resuscitation» y la sigla que al
 *    portugués le faltaba («rcp»), y las señales de situación de
 *    la puerta de salud aprenden «como hago», «como hacer»,
 *    «como se hace» y sus gemelas portuguesas. La cura se mide
 *    contra un conjunto ciego FRESCO (conjunto 04,
 *    docs/BLIND_EVAL.md), no contra la batería que la destapó
 *    (regla del sello); las doce frases de la auditoría quedan
 *    fixturadas como regresión en las pruebas de esta puerta.
 *
 * 11. LA PRIMERA PERSONA TAMBIÉN SE CAE (0.1.111, pasada del dueño
 *    sobre la 0.1.110 y auditoría profesional). La pieza §4 fijó la
 *    caída narrada y la inmovilidad solo en tercera persona, y la
 *    frase viva de la pasada («Me caí y no me puedo mover», en la
 *    tableta del dueño) no casó signo, inmovilidad ni contexto: la
 *    puerta devolvió false en todas sus caras y ganó una guía de
 *    niños. La cura es la de la casa, en las listas y en las caras:
 *    las formas de primera persona de la caída y de la inmovilidad
 *    en es/pt (el inglés ya no llevaba sujeto), la familia ancha
 *    («se cayó en el baño», «se cayó» con golpe, la familia
 *    «levantar», la inmovilidad con la parte del cuerpo nombrada),
 *    una cara propia para la caída contada a secas con su contexto,
 *    el veto de marcos de definición y prevención al abrir el texto
 *    (la pregunta de tema no es un parte; el parte con «¿qué hago?»
 *    detrás sigue declarando), la interrogación de la cara
 *    telegráfica leída sobre el texto CRUDO (foldText elimina el
 *    «?» y el veto viejo nunca disparaba) y la ventana de negación
 *    ante el signo y la raíz («no se está ahogando, está actuando»
 *    no declara; la negación DENTRO del signo —«no puedo
 *    respirar», «no se puede mover»— es el signo afirmativo y no
 *    se veta). Las guardas de objeto y de metáfora quedan en pie:
 *    «se cayó el precio», «la puerta no se puede mover» y «se me
 *    cayó el móvil» siguen fuera.
 *
 * Puro, sin dependencias de UI, 100% testeable.
 */

import { buildErrataRepair, crisisQuestionKind, emergencyQuestionKind, foldText, type FactLang } from "../rag/packFacts";
import { parsePackChunkId } from "../rag/packSource";
import type { RetrievedChunk } from "../rag/retrieve";
import { matchSafetyAnswer } from "../agent/loop/safetyAnswers";
import { allFrom, type SentenceProvenance } from "../rag/provenance";
import { splitSentences } from "../rag/grounding";

export type GateLang = FactLang;

// ------------------------------------------------- emergencia primero

/**
 * ¿Es este texto una emergencia para las rutas fijas? Los mismos
 * detectores que send() consulta al abrir: la tabla de seguridad
 * (monóxido y números de emergencia), la clase de pregunta de número
 * de emergencia de los packs y la clase de pregunta de crisis. Desde
 * el cierre de F-B1 también la emergencia viva contada
 * (`isEmergencySituation`): su respuesta es la guía por recuperación
 * o el texto seguro fijo, y tampoco debe hacer cola tras una
 * generación en curso.
 */
export function isEmergencyText(text: string, lang: GateLang): boolean {
  if (!text || text.trim().length === 0) return false;
  return (
    matchSafetyAnswer(text, lang) !== null ||
    emergencyQuestionKind(text) !== null ||
    crisisQuestionKind(text) ||
    isEmergencySituation(text)
  );
}

// ------------------------------------------------------- puerta de salud

/**
 * Términos de salud por lengua, ya plegados (minúsculas, sin acentos).
 * `w` = palabra entera; `p` = principio de palabra (familias: sangr-,
 * vomit-, engasg-). Listas revisables a propósito: la puerta es
 * léxica y sus errores se corrigen editando la lista, no el modelo.
 *
 * Al final de cada lista `w` va el campo de MEDICAMENTOS Y DOSIS
 * (cierre de F-B2, evaluación ciega 01: «¿qué dosis de paracetamol…?»
 * no traía ningún término y caía al modelo). Fuera a propósito, por
 * el casado por prefijo de `isHealthQuestion`: «pill»/«tablet» en
 * inglés atraparían «pillar»/«tabletop», «remedio» en portugués
 * atraparía el verbo «remediar» (arreglar una fuga) y «pastilla» en
 * español la «pastilla de jabón» — homógrafos que no son salud.
 */
const HEALTH_TERMS: Record<GateLang, { w: string[]; p: string[] }> = {
  es: {
    w: [
      "fiebre", "tos", "diarrea", "mareo", "mareos", "mareado", "mareada", "nauseas", "hemorragia", "fractura", "asma", "diabetes",
      "alergia", "embarazo", "embarazada", "intoxicacion", "envenenamiento", "mordedura", "picadura", "desmayo",
      "convulsion", "convulsiones", "ahogamiento", "insolacion", "hipotermia", "sobredosis", "erupcion",
      "infeccion", "gripe", "resfriado", "covid", "antibiotico", "antibioticos", "vacuna", "vacunas", "torniquete",
      "esguince", "urticaria", "anemia", "apendicitis", "neumonia", "bronquitis", "otitis", "conjuntivitis",
      "gastroenteritis", "deshidratacion", "parto", "rcp", "reanimacion", "hipertension", "sarpullido", "electrocucion",
      "dolor de cabeza", "dolor de pecho", "dolor de espalda", "dolor abdominal", "dolor de muelas",
      "primeros auxilios", "golpe de calor", "presion arterial",
      "dosis", "dosificacion", "medicamento", "medicamentos", "medicacion", "medicina", "medicinas",
      "paracetamol", "ibuprofeno", "aspirina", "amoxicilina", "omeprazol", "metamizol", "miligramos",
      // Auditoría completa (F-6): infarto, ictus e ingestión, que la
      // puerta no conocía en ninguna lengua.
      "infarto", "ataque al corazon", "ictus", "derrame cerebral",
      // La ingestión, solo con su objeto (no «se tragó el cuento»).
      "se trago una pila", "se trago pastillas", "se trago una moneda", "se trago un iman",
      "bebio lejia", "se bebio la lejia", "trago lejia",
      // Bloque 2 (auditoría 0.1.112): «tomar» es el verbo corriente de la
      // ingestión en español («se tomó lejía»); solo cazaba «bebió».
      "tomo lejia", "se tomo lejia", "se tomo la lejia", "se trago lejia",
      // La quemadura contada en primera persona o con su parte del
      // cuerpo («me quemé la mano»; «se quemó» a secas es la comida).
      "me queme", "me he quemado", "se quemo la mano", "se quemo el brazo", "se quemo la cara", "se quemo con",
      // La hinchazón en curso («se le está hinchando la garganta»).
      "hinchando", "se le hincha", "se me hincha",
      // Auditoría 0.1.93: lo que la gente escribe y la puerta no conocía
      // (batería de 62 preguntas reales: 40 se iban al modelo sin fuentes).
      // El dolor contado, los medicamentos de uso corriente, la presión y
      // el azúcar como se dicen, las picaduras contadas, y el daño a uno
      // mismo, que nunca debe contestarlo un modelo de memoria.
      "me duele", "me duelen", "le duele", "le duelen", "me duela", "le duela", "dolor",
      "pastilla", "jarabe", "inyeccion", "insulina", "tramadol", "warfarina", "naproxeno", "diclofenaco",
      "ketorolaco", "loratadina", "clonazepam", "diazepam", "morfina", "antihistaminico", "anticoagulante",
      "presion alta", "presion baja", "azucar en la sangre", "se me bajo el azucar", "se me subio el azucar",
      "glucosa", "migrana", "jaqueca", "taquicardia", "palpitaciones", "ataque de panico",
      "alacran", "escorpion", "me pico", "le pico", "me mordio", "le mordio", "gripa",
      "remedio casero", "remedio para", "contusion", "hinchazon", "inflamacion",
      "cloro en los ojos", "cloro en el ojo", "se me durmio", "se le durmio", "hormigueo",
      "no quiero vivir", "quiero morir", "quiero morirme", "matarme", "quitarme la vida", "hacerme dano",
      "sintoma", "enfermedad", "enfermo", "enferma", "medico", "doctor", "hospital", "urgencias", "ambulancia",
      "un lunar", "orinar", "orina", "tragar", "hinchado", "se me hincho", "se le hincho", "se toma cloro", "se tomo cloro", "tomo cloro", "bebio cloro",
      "se golpeo la cabeza", "golpe en la cabeza", "se pego en la cabeza", "me pegue en la cabeza",
      "un bulto en", "me salio un bulto", "tengo un bulto", "una bola en", "se le subio la temperatura",
      "tiene temperatura", "tengo temperatura", "calambre", "confunde las palabras", "antigripal", "falta de aire",
      "cancer",
    ],
    p: ["sangr", "vomit", "quemadur", "herid", "alergic", "diabetic", "atragant", "convuls", "desmay", "intoxi", "entumec", "suicid", "inflam"],
  },
  en: {
    w: [
      "fever", "cough", "diarrhea", "dizziness", "nausea", "hemorrhage", "haemorrhage", "fracture", "asthma",
      "diabetes", "diabetic", "allergy", "pregnant", "pregnancy", "poisoning", "poisoned", "bite", "sting",
      "fainted", "fainting", "seizure", "seizures", "drowning", "heatstroke", "hypothermia", "overdose", "rash",
      "infection", "flu", "covid", "antibiotic", "antibiotics", "vaccine", "vaccines", "tourniquet", "sprain",
      // Tanda de variantes (Familia 7): «cold» como sustantivo,
      // solo con su determinante, como las formas de ingestión
      // de esta lista: el frío del tiempo («is it cold
      // outside») no es salud y «cold» a secas no entra.
      "a cold",
      "urticaria", "anemia", "appendicitis", "pneumonia", "bronchitis", "dehydration", "labour", "labor", "cpr",
      "resuscitation", "hypertension", "electrocution", "headache", "toothache",
      "chest pain", "back pain", "abdominal pain", "first aid", "heat stroke", "blood pressure",
      "dose", "dosage", "medication", "medications", "medicine", "milligrams",
      "paracetamol", "acetaminophen", "ibuprofen", "aspirin", "amoxicillin",
      // Auditoría completa (F-6).
      "heart attack", "cardiac arrest", "having a stroke", "had a stroke",
      // Ingestion, only with its object (not «the ATM swallowed my card»).
      "swallowed a battery", "swallowed pills", "swallowed a coin", "swallowed a magnet",
      "drank bleach", "swallowed bleach",
      // Bloque 2 (auditoría 0.1.112): the determiner form, twin of the
      // Spanish «se tomó lejía».
      "drank some bleach", "swallowed some bleach", "drank the bleach", "swallowed the bleach",
      // The plural pain verb, twin of «me duelen» / «doem»: «hurts»
      // only matched a singular subject («my chest and left arm hurt»
      // did not). Bound to a body part or a degree so «I hurt her
      // feelings» stays out.
      "arm hurt", "arms hurt", "legs hurt", "feet hurt", "eyes hurt", "ears hurt", "joints hurt",
      "muscles hurt", "teeth hurt", "ribs hurt", "hurt a lot", "hurt so much", "hurt badly", "really hurt",
      // Audit 0.1.93: everyday words the gate did not know.
      "tylenol", "advil", "benadryl", "melatonin", "insulin", "warfarin", "blood thinner", "naproxen",
      "tramadol", "oxycodone", "xanax", "pill", "painkiller", "lethal dose",
      "hurts", "pain", "numb", "dizzy", "heart is racing", "racing heart", "palpitations",
      "deep cut", "stitches", "swollen", "swelling", "migraine", "panic attack", "scorpion",
      "burn", "burned", "burnt",
      "kill myself", "want to die", "end my life", "hurt myself", "self harm",
      "symptom", "sick", "illness", "doctor", "hospital", "ambulance", "emergency room",
      "hit his head", "hit her head", "hit my head", "hit their head", "head injury", "concussion",
      "throat is closing", "throat closing", "antidepressant", "sleeping pill",
      "earache", "contractions", "blood sugar", "feels hot", "cancer", "cancerous", "hurting myself",
      "has a temperature", "high temperature", "short of breath", "shortness of breath",
    ],
    p: ["bleed", "vomit", "wound", "allerg", "chok", "convuls", "sangr", "suicid", "anaphyla"],
  },
  pt: {
    w: [
      "febre", "tosse", "diarreia", "tontura", "enjoo", "hemorragia", "fratura", "asma", "diabetes",
      "alergia", "gravidez", "gravida", "intoxicacao", "envenenamento", "mordida", "picada", "desmaio",
      "convulsao", "convulsoes", "afogamento", "insolacao", "hipotermia", "overdose", "erupcao", "infeccao",
      "gripe", "resfriado", "covid", "antibiotico", "antibioticos", "vacina", "vacinas", "torniquete",
      "entorse", "urticaria", "anemia", "apendicite", "pneumonia", "bronquite", "desidratacao", "parto",
      "rcp", "reanimacao", "hipertensao", "eletrocucao",
      "dor de cabeca", "dor no peito", "dor nas costas", "dor abdominal", "dor de dente",
      "primeiros socorros", "pressao arterial",
      "dose", "dosagem", "medicamento", "medicamentos",
      "paracetamol", "ibuprofeno", "aspirina", "dipirona", "amoxicilina", "miligramas",
      // Auditoría completa (F-6).
      "infarto", "ataque cardiaco", "avc", "derrame cerebral",
      // A ingestão, só com o objeto.
      "engoliu uma pilha", "engoliu remedios", "engoliu comprimidos", "engoliu uma moeda", "engoliu um ima",
      "bebeu agua sanitaria", "engoliu agua sanitaria",
      // Bloco 2 (auditoria 0.1.112): «tomar» também é ingestão, como no
      // espanhol; o verbo de dor no plural e no gerúndio («doem»,
      // «está doendo»), gêmeo de «me duelen»; a queimadura contada e o
      // inchaço em curso.
      "tomou agua sanitaria", "bebeu cloro", "tomou cloro",
      "doem", "doendo", "doeu",
      "me queimei", "se queimou", "queimei a mao", "queimei o braco", "queimou a mao", "queimou o braco",
      "inchando", "inchou",
      // Auditoria 0.1.93: palavras do dia a dia que a porta não conhecia.
      "dor", "doi", "remedio", "comprimido", "insulina", "tramadol", "varfarina", "naproxeno",
      "pressao alta", "pressao baixa", "pressao esta alta", "pressao esta baixa", "acucar no sangue", "glicose", "enxaqueca", "taquicardia",
      "palpitacoes", "ataque de panico", "escorpiao", "fui picado", "fui picada", "fui mordido", "fui mordida",
      "inchaco", "formigamento",
      "quero morrer", "me matar", "tirar minha vida", "nao quero viver",
      "sintoma", "doente", "doenca", "medico", "hospital", "ambulancia",
      "bateu a cabeca", "bati a cabeca", "falta de ar", "caroco", "cancer",
      // Tanda de variantes (Familia 7): a «coceira», que a porta
      // não conhecia em nenhuma forma, e o adjetivo de tontura
      // («estou tonto»), cuja família só trazia o substantivo.
      "coceira", "tonto", "tonta",
    ],
    p: ["sangr", "vomit", "queimadur", "ferid", "alergic", "diabetic", "engasg", "convuls", "desmai", "intoxi", "suicid"],
  },
};

/** Contextos que vetan la puerta: historia y metáforas conocidas. */
const HEALTH_EXCLUSIONS = [
  "historia de",
  "historia del",
  "history of",
  "historia do",
  "historia da",
  "fiebre del oro",
  "gold fever",
  "febre do ouro",
  // Auditoría 0.1.93: homónimos de uso corriente que no son salud.
  "sangria",
  "pastillas de freno", "pastilla de freno", "pastilhas de freio",
  "burn a cd", "burn a dvd", "burn a disc", "burn calories", "burn fat", "burnout",
  "labor market", "labour market", "labor day", "labor union", "labour party", "labor law",
  "rash guard", "pain point", "horoscopo", "horoscope", "zodiac", "zodiaco",
  // Paso 0-bis (b): la cara emocional de «really hurt» (bloque 2 de la
  // auditoría 0.1.112). La frase atada entró sin el contexto de cuerpo
  // de sus hermanas y declaraba salud en «you really hurt my feelings
  // yesterday»; la exclusión emocional que la prep preveía para esta
  // cara la deja fuera sin tocar el uso corporal («my leg really hurt»
  // sigue declarando).
  "really hurt my feelings",
  // Paso 0-bis (b): la guarda de pasado resuelto para «doeu». Un dolor
  // contado como ya curado («ontem minha cabeça doeu mas já estou
  // bem») no es una situación presente; el marcador de resolución veta
  // la declaración y el plegado cubre la forma sin acentos. El «doeu»
  // sin resolución («minha cabeça doeu muito hoje») sigue declarando.
  "ja estou bem",
  // La ficción que se está escribiendo no es una situación (las señales
  // nuevas, «estoy», «i», la habrían contado como tal).
  "escribiendo un cuento", "escribiendo una novela", "escribiendo una historia", "escribiendo un guion",
  "writing a story", "writing a novel", "writing a script", "writing a short story",
  "escrevendo um conto", "escrevendo um romance", "escrevendo uma historia",
];

/**
 * Marcos históricos o culturales, ya plegados (arreglo F-B3, punto 4
 * de la cabecera): la pregunta es SOBRE el pasado de una enfermedad
 * o de la salud — siglos y épocas, muertes contadas, pandemias y
 * plagas nombradas, guerras mundiales, novelas y películas — y no
 * sobre una situación presente. Frases, como todo el léxico de la
 * casa: un marco nuevo se añade aquí, no al modelo. La comparación
 * se hace sobre el texto con espacios a ambos lados, así que un
 * marco al principio de la frase también veta (los vetos antiguos
 * exigían un espacio delante y dejaban pasar «Historia de…» a secas
 * al abrir la pregunta).
 */
const HISTORY_FRAMES = [
  "historia de", "historia del", "historia sobre", "en la historia", "a lo largo de la historia",
  "siglo", "murieron", "fallecieron", "cuantas personas murieron", "cuantos murieron",
  "gripe espanola", "peste negra", "peste bubonica", "en aquella epoca", "antiguamente",
  "en la antiguedad", "primera guerra mundial", "segunda guerra mundial",
  "en una novela", "en la novela", "en una pelicula",
  "history of", "history about", "in history", "throughout history",
  "century", "how many people died", "how many died", "people died",
  "spanish flu", "black death", "bubonic plague", "in those days", "back then",
  "in ancient times", "first world war", "second world war",
  "in a novel", "in the novel", "in a film", "in the film", "in a movie", "in the movie",
  "historia do", "historia da", "na historia", "ao longo da historia",
  "seculo", "morreram", "quantas pessoas morreram", "quantos morreram", "pessoas morreram",
  "gripe espanhola", "peste bubonica", "naquela epoca", "antigamente",
  "na antiguidade", "primeira guerra mundial", "segunda guerra mundial",
  "num romance", "no romance", "num filme", "no filme",
  // Bloque 2 (auditoría 0.1.112): la ficción contada con relativo («vi
  // una película donde alguien se desmaya») declaraba emergencia en las
  // tres lenguas; solo vetaba «en una película».
  "una pelicula donde", "una pelicula en la que", "una serie donde", "una serie en la que", "sone que",
  "a movie where", "a movie in which", "a film where", "a show where", "a series where", "i dreamt", "i dreamed",
  "um filme em que", "um filme onde", "uma serie em que", "uma serie onde", "sonhei que",
  // Tanda de variantes (Familia 8, los menores de la F9): la
  // muerte familiar contada con su causa, en singular — la
  // lista traía el plural («murieron», «morreram») y no estas
  // formas — y la distancia inglesa y la de «hace años»:
  // «mi abuelo murió de un infarto hace años» declaraba salud.
  "murio de", "morreu de", "died of", "hace anos", "ha anos", "last year",
];

/**
 * Verbos en pasado que, junto a un año, cuentan el suceso como
 * pasado («a pandemia de gripe de 1957 afetou…»): el año solo no
 * veta — una situación presente puede nombrar un año («tengo
 * fiebre desde 2023») — pero año + pasado sí es marco histórico.
 */
const HISTORY_PAST_MARKERS = [
  " fue ", " foi ", " was ", " were ", " died", " happened",
  " murieron", " fallecieron", " morreram",
  " afetou", " afecto", " passou", " paso ", " ocorreu", " ocurrio",
  " causou", " causo ", " deixou", " dejo ", " comecou", " comenzo",
  " terminou", " termino ", " acabou", " acabo ",
];

const PAST_YEAR = /\b(1[0-9]{3}|20[0-2][0-9])\b/;

/** ¿Lleva el texto (ya plegado) un marco histórico o cultural? */
function hasHistoricalFrame(folded: string): boolean {
  const hay = ` ${folded} `;
  if (HISTORY_FRAMES.some((x) => hay.includes(` ${x} `))) return true;
  return PAST_YEAR.test(folded) && HISTORY_PAST_MARKERS.some((m) => hay.includes(m));
}

/**
 * Señales de que el texto PREGUNTA o CUENTA una situación (la puerta
 * no se cierra sobre un tema suelto: «fiebre amarilla» a secas sigue
 * su camino; «mi hijo tiene fiebre» o «¿qué es la fiebre?» no).
 */
const SITUATION_CUES = [
  "?", "¿",
  " mi ", " me ", " tengo ", " sufro ", " duele ", " que hago ", " como trat", " como cur", " ayuda ",
  " my ", " i have ", " i feel ", " hurts ", " what should ", " how do i ", " how to treat ",
  " meu ", " minha ", " estou ", " sinto ", " doi ", " o que fazer ", " como trat",
  // F-1 (auditoría de la RCP, 2026-11-06): «cómo se hace» y sus
  // hermanas, tal como se dictan, sin signos de interrogación.
  // La señal sola no cierra la puerta: hace falta además un
  // término de salud, así que «como hacer una mesa» sigue fuera.
  " como hago ", " como hacer ", " como se hace ",
  " como faco ", " como fazer ", " como se faz ",
  // Auditoría 0.1.93: en el teléfono se pregunta sin «¿?» ni tildes
  // («cuanto ibuprofeno puedo tomar al dia» traía término y ninguna
  // señal, y se iba al modelo). Las señales solas no cierran la
  // puerta: hace falta además un término de salud.
  " cuanto ", " cuanta ", " cuantos ", " cuantas ", " que ", " cual ", " como ", " puedo ", " puede ",
  " debo ", " sirve ", " le ", " tiene ", " tienen ", " estoy ", " esta ", " siento ", " quiero ", " necesito ",
  " how ", " what ", " which ", " can ", " should ", " is ", " are ", " does ", " i ", " he ", " she ", " has ", " need ",
  " quanto ", " quanta ", " quantos ", " quantas ", " qual ", " posso ", " pode ", " devo ", " serve ",
  " tem ", " preciso ", " tomei ", " fui ", " quero ",
  // Bloque 2 (auditoría 0.1.112): los pronombres de persona, como « me »
  // y « le » en español e « i », « he », « she » en inglés; sin ellos
  // «queimei a mão com óleo fervendo» no traía señal en portugués.
  " eu ", " me ", " ele ", " ela ", " queimei ",
];

const ALL_TERMS: Array<{ w: string[]; p: string[] }> = Object.values(HEALTH_TERMS);

/** La ingestión contada, en las tres lenguas (ver isHealthQuestion). */
const INGESTION_TERMS: string[] = Object.values(HEALTH_TERMS)
  .flatMap(({ w }) => w)
  .filter((t) => /^(?:se trago|trago|bebio|se bebio|tomo|se tomo|swallowed|drank|engoliu|bebeu|tomou) /.test(t) &&
    /(?:lejia|pila|pastillas|moneda|iman|bleach|battery|pills|coin|magnet|agua sanitaria|remedios|comprimidos|ima)$/.test(t));

/**
 * ¿Pregunta (o cuenta) el texto algo de salud? Léxico puro: un
 * término de salud en cualquier lengua de la casa (la gente mezcla),
 * una señal de pregunta o situación, y ningún veto de contexto.
 */
/**
 * Auditoría 0.1.93: los términos de la lista `w` son PALABRAS (la lista
 * `p` es la de raíces). El casado anterior aceptaba además el término
 * como prefijo de otra palabra, y «tos» casaba con «tostada», «flu» con
 * «fluent», «labor» con «laboratory», «sting» con «stingy»: preguntas
 * corrientes recibían el texto de salud. Palabra entera, o su plural.
 */
function hasWord(folded: string, t: string): boolean {
  return folded.includes(` ${t} `) || folded.includes(` ${t}s `) || folded.includes(` ${t}es `);
}

/**
 * Cuántos términos de salud DISTINTOS trae el texto (ya plegado). El
 * mismo término en dos lenguas («asma») cuenta una vez, y uno contenido
 * en otro («dolor» dentro de «dolor de cabeza») no suma: un tema suelto
 * sigue siendo un tema suelto.
 */
function healthTermHits(folded: string): number {
  const hits = new Set<string>();
  for (const { w, p } of ALL_TERMS) {
    for (const t of w) if (hasWord(folded, t)) hits.add(t);
    for (const t of p) if (folded.includes(` ${t}`)) hits.add(t);
  }
  const all = [...hits];
  return all.filter((t) => !all.some((o) => o !== t && o.includes(t))).length;
}

export function isHealthQuestion(text: string): boolean {
  if (!text) return false;
  const folded = foldText(gateErrataRepair(text));
  if (folded.trim().length === 0) return false;
  if (HEALTH_EXCLUSIONS.some((x) => folded.includes(` ${x} `) || folded.includes(` ${x}`))) return false;
  // Auditoría 2026-11-25 (H-4): el suceso negado o el
  // casi-suceso resuelto no es una consulta en curso.
  if (NEGATED_EVENT_FRAMES.some((x) => folded.includes(x))) return false;
  // Auditoría 2026-11-25 (H-5): el enunciado hipotético
  // tampoco es una consulta en curso.
  if (isHypotheticalStatement(text, folded)) return false;
  if (isHabitualFireStatement(text, folded)) return false;
  // Auditoría 2026-11-25 (H-8): la tarea de guía sin suceso
  // no es una consulta en curso.
  if (GUIDE_TASK_FRAMES.some((x) => folded.includes(x))) return false;
  // Fase B ronda 3 (2026-11-25): la metáfora «drowning in
  // work» sobre-disparaba ESTA cara; la de situación tiene
  // su forma fixturada como precio aceptado (X-09) y no se
  // toca — el veto es solo de salud, donde se midió.
  if (folded.includes("drowning in work")) return false;
  // Fase B ronda 5 (2026-11-25): la comida quemada en
  // inglés («i burned the rice») sobre-disparaba esta cara
  // por el tallo «burn»; en español y portugués la forma ya
  // es de contexto (la comida no es la persona) y no
  // disparaba. Veto solo de salud, como el de arriba.
  if (["burned the rice", "burnt the rice", "burned the toast", "burnt the toast"].some((x) => folded.includes(x))) return false;
  if (hasHistoricalFrame(folded)) return false;
  // Tanda de narración (2026-11-25): el suceso contado con su
  // distancia no es una consulta en curso («ayer mi abuelo llamó
  // una ambulancia» declaraba salud por «ambulancia»). El veto
  // es solo para el enunciado: con forma de pregunta o petición
  // de consejo, la consulta es viva y la puerta sigue cerrando.
  if (isNarratedGateEvent(folded) && !/[¿?]/.test(text) && !HEALTH_QUESTION_FORM_RE.test(` ${folded} `)) return false;
  // H-05: la familia inglesa «chok» comparte raíz con la metáfora
  // deportiva («choke under pressure» = fallar bajo presión), así
  // que cuando es el ÚNICO término que casa, no basta: la puerta
  // exige el contexto de cuerpo de la cara de situación o una
  // señal de primera persona («how do I stop choking?» sigue
  // dentro; «why do golfers choke…?» queda fuera). Las demás
  // familias — «atragant» y «engasg» incluidas — no comparten esa
  // homografía en su uso asentado y su casado no se toca: la
  // pregunta instructiva genérica sobre atragantamiento sigue
  // cerrando esta puerta como hasta ahora.
  const chokOnlyHit =
    folded.includes(" chok") &&
    !ALL_TERMS.some(
      ({ w, p }) =>
        w.some((t) => hasWord(folded, t)) ||
        p.some((t) => t !== "chok" && folded.includes(` ${t}`)),
    );
  const hasTerm = chokOnlyHit
    ? anyStemHasBodyContext(folded) || CHOKE_FIRST_PERSON_CUES.some((c) => folded.includes(c))
    : ALL_TERMS.some(
        ({ w, p }) => w.some((t) => hasWord(folded, t)) || p.some((t) => folded.includes(` ${t}`)),
      );
  if (!hasTerm) return false;
  // Bloque 2 (auditoría 0.1.112): la ingestión contada (lejía, pilas,
  // pastillas, imanes) ya es una situación por sí sola, sin señal de
  // pregunta ni sujeto: «se tomó lejía» no traía ninguna señal en
  // español (el sujeto se omite) y su gemela inglesa con «he» sí.
  if (INGESTION_TERMS.some((t) => hasWord(folded, t))) return true;
  // Auditoría 0.1.93: dos términos de salud juntos ya cuentan una
  // situación («vomite sangre» no trae ninguna señal de pregunta).
  if (!chokOnlyHit && healthTermHits(folded) >= 2) return true;
  return SITUATION_CUES.some((c) => folded.includes(c) || text.includes(c));
}

// ------------------------- narración por distancia (tanda 2026-11-25)
// El suceso contado con su marcador de distancia no es una
// situación viva ni una consulta de salud en curso: ya pasó. La
// puerta solo vetaba los marcos históricos (guerras, novelas,
// «hace años») y, en la cara de caída, un juego corto de
// marcadores por ocurrencia; el signo contado («ayer mi abuelo
// se desmayó») y la caída contada en portugués («ontem meu avô
// caiu», sin «ontem» en el juego) declaraban como si estuvieran
// ocurriendo. La medición del acto 0 de la tanda: F-CAIDA
// 47–58 %, F-SIGNOS 16–32 % según idioma. El veto pide tres
// cosas a la vez: marcador de tiempo ∧ el verbo del suceso en
// pasado ∧ ninguna ancla viva. Las anclas vivas son las
// exenciones de la doctrina de la caída llevadas a todo el
// suceso: progresivo en curso, inmovilidad en presente, «acaba
// de», respiración o pulso ausentes ahora, síntoma en presente.
// Sin forma de pregunta: la interrogación y la petición de
// consejo se tratan en la cara de salud, no aquí.
const GATE_TIME_MARKER_RE = / (ayer|anoche|anteayer|esta manana|la semana pasada|semana pasada|el mes pasado|mes pasado|el ano pasado|ano pasado|hace un rato|hace rato|hace unas horas|hace dos dias|hace tres dias|hace una semana|hace dos semanas|hace un mes|hace dos meses|hace un ano|hace dos anos|hace anos|el otro dia|otro dia|el lunes pasado|el martes pasado|la noche pasada|el fin de semana pasado|despues del accidente|tras el accidente|yesterday|last night|the day before yesterday|this morning|last week|last month|last year|two days ago|three days ago|a few days ago|a while ago|the other day|on monday|last monday|last tuesday|last wednesday|last thursday|last friday|last weekend|after the accident|ontem|ontem a noite|anteontem|esta manha|na semana passada|no mes passado|no ano passado|faz dois dias|ha dois dias|faz tres dias|faz um tempo|ha um tempo|no outro dia|outro dia|na segunda passada|na terca passada|no fim de semana passado|depois do acidente|apos o acidente) /;
const GATE_EVENT_PAST_RE = / (cayo|cayeron|cai|desmayo|desmayaron|quemo|quemaron|corto|sangro|sangraron|tuvo|tuvieron|sufrio|sufrieron|convulsiono|convulsionaron|golpeo|atraganto|atragantaron|dolia|dio|dieron|estuvo|estuvieron|llamo|llame|llamaron|marco|marque|marcaron|sono|encendio|habia|era|salimos|fell|fainted|collapsed|burned|burnt|bled|bleed|cut|hit|choked|seized|suffered|had|called|dialed|dialled|went|was|sounded|caiu|cairam|desmaiou|desmaiaram|queimou|queimaram|cortou|sangrou|sangraram|teve|tiveram|sofreu|sofreram|engasgou|engasgaram|convulsionou|bateu|bateram|estava|ligou|liguei|ligaram|discou|disquei|tocou|disparou|tinha|tivemos|saimos) /;
// (Las formas del suceso de monóxido —«sonó», «había», «went»,
// «tocou», «tinha»— entran con la familia F-CO de la tanda: las
// frases de CO que no casa la tabla fija caen a esta puerta por
// el olor o la alarma, y su narración se veta aquí.)
// («bleed» y «cut» van en la lista inglesa a sabiendas: la
// reparación de erratas de la puerta canoniza «bled» a «bleed»
// antes de plegar, y «cut» tiene la misma forma en pasado; con
// marcador y sin ancla viva, en un texto de esta puerta son el
// suceso contado. El progresivo vivo es «cutting», otra forma.)
const GATE_LIVE_ANCHOR_RE = / (se esta cayendo|se esta caindo|esta cayendo|esta caindo|esta sangrando|esta desmayando|esta convulsionando|esta atragantando|esta engasgando|esta quemando|esta queimando|esta teniendo|is falling|is fainting|is bleeding|is choking|is seizing|is having|is burning|acaba de|acabou de|just fell|just fainted|just collapsed|no respira|nao respira|not breathing|is not breathing|sin pulso|sem pulso|no pulse|nao tem pulso|le duele|duele|doi|hurts|esta mareado|esta mareada|esta tonto|esta tonta|is dizzy|feels dizzy|feels sick|se siente mal|sente se mal|sigue inconsciente|continua inconsciente|still unconscious|esta inconsciente|no se puede mover|no puede moverse|no se puede levantar|no puede levantarse|no se levanta|nao consegue se mexer|nao consegue se mover|nao consegue se levantar|nao se pode mover|nao levanta|nao se levanta|cannot move|can t move|can t get up|can not move|cannot get up|no se mueve|nao se mexe) /;

/**
 * El marco de RELATO (auditoría 2026-11-25, H-6): el suceso
 * llega contado por otra voz («contó que», «me contaram
 * que», «diz que»…). Con el verbo del suceso en pasado y sin
 * ancla viva es la misma narración que la rama de distancia
 * veta; con el suceso en presente o un ancla viva («diz que
 * está se engasgando agora») el marco no veta nada, como la
 * dimensión de habla indirecta viva mide al 100 %.
 */
const GATE_REPORTED_FRAME_RE = / (conto que|contou que|contaram que|me contaron que|me contaram que|me conto que|me contou que|dice que|diz que|conta que|me dijo que|me disse que) /;

/** ¿El texto cuenta un suceso ya pasado, sin ninguna parte viva? */
function isNarratedGateEvent(folded: string): boolean {
  // El plegado de la puerta no acolcha los extremos (el de
  // packFacts sí): el marcador que ABRE el relato («Last night
  // my neighbor…») necesita el espacio inicial para casar.
  const hay = ` ${folded} `;
  return (
    (GATE_TIME_MARKER_RE.test(hay) || GATE_REPORTED_FRAME_RE.test(hay)) &&
    GATE_EVENT_PAST_RE.test(hay) &&
    !GATE_LIVE_ANCHOR_RE.test(hay)
  );
}

/**
 * La forma de pregunta o de petición de consejo sobre salud:
 * con ella, la cara de salud no veta aunque el texto cuente el
 * pasado («ayer se desmayó, ¿qué hago si pasa otra vez?» es una
 * consulta viva; el modelo no debe responder dosis, pero la
 * puerta de salud sí debe cerrar).
 */
const HEALTH_QUESTION_FORM_RE = / (cuanto|cuanta|cuantos|cuantas|puedo|debo|debe|que hago|que debo|que tomo|como se|como puedo|what should|how much|how do|can i|should i|posso|devo|quanto|quanta|quantos|quantas|como devo|o que faco|o que devo|que faco) /;

// -------------------------------------------- situación de emergencia

/**
 * Signos de una emergencia VIVA, contados tal cual se ven, ya
 * plegados. Frases, no temas: cada entrada describe el suceso en
 * curso (respiración que falta, atragantamiento o ahogamiento en
 * gerundio, inconsciencia, el pecho agarrado, humo o fuego en un
 * lugar, un sangrado que no para). Las formas con contracción
 * inglesa van en su forma plegada («can t breathe» es lo que queda
 * de "can't breathe" tras plegar). Listas revisables, como las de
 * salud: un signo nuevo se añade aquí, no al modelo.
 */
const EMERGENCY_SIGNS: Record<GateLang, string[]> = {
  es: [
    "no puede respirar", "no pueden respirar", "no respira", "no respiran", "sin respirar",
    // Auditoría 2026-11-25 (H-7): la falta de aire ANTEPUESTA
    // («sin poder respirar está un hombre en la calle»), la
    // forma natural de alarma que caía al modelo porque la
    // lista solo traía el predicado tras el sujeto.
    "sin poder respirar",
    "dejo de respirar", "paro de respirar",
    "se esta ahogando", "esta ahogandose", "ahogandose", "se ahoga",
    // Fase B ronda 4 (2026-11-25): la espina atorada y el
    // corte con el hueso visible («se le atoró una espina de
    // pescado en la garganta», «se cortó y se le ve el
    // hueso»).
    "se le atoro", "se le ve el hueso",
    // Fase B ronda 1 (2026-11-25): el ahogamiento contado como
    // hundimiento y el desplome, las paráfrasis que la ronda
    // cazó al modelo («un niño se está hundiendo en la
    // alberca», «mi esposo se desplomó en la cocina»).
    "se esta hundiendo", "se desplomo",
    "se esta atragantando", "atragantandose",
    // ADV-E1: los eventos nuevos también se cuentan con frase-signo
    // (el suceso ya ocurrió y se nombra en pasado, sin víctima cerca
    // que la cara por raíz pueda leer).
    "se desmayo", "se ahogo", "se desvanecio",
    // Causa E de DIAG-A (paquete de arreglos 2026-11-20): el
    // desvanecimiento en su participio, con los vetos de
    // resolución y de marco que la cara ya aplica.
    "desvanecido", "desvanecida",
    // Tanda del residuo vivo (2026-11-25): el desvanecimiento en
    // curso, en su perífrasis y con el enclítico, como
    // «ahogandose»: «se está desvaneciendo» no casaba ninguna
    // forma (la del desmayo en curso, «se está desmayando»,
    // entra por su raíz con contexto; esta no trae raíz).
    "se esta desvaneciendo", "desvaneciendose",
    "cuesta respirar", "cuesta mucho respirar",
    // 0.1.99 T-01 (m-10, auditoría 2026-11-14): la respiración
    // contada con su marca de gravedad dentro de la frase («mi
    // padre respira muy mal», sonda P-18a), la forma corriente que
    // ninguna cara veía. La raíz suelta no entra como raíz en
    // EMERGENCY_STEMS a propósito: «respir-» comparte principio
    // con temas cotidianos (ejercicios de respiración, «un
    // respiro» como descanso), y las raíces de ahí no comparten
    // principio con temas cotidianos.
    "respira muy mal", "respira mal", "respirando muy mal", "respirando mal",
    "respiro muy mal", "respiro mal",
    "respira con dificultad", "respirando con dificultad",
    "esta inconsciente", "quedo inconsciente", "no responde",
    "se agarra el pecho", "agarrandose el pecho", "se aprieta el pecho",
    // Tanda del residuo vivo: el gerundio suelto del pecho, la
    // forma que la perífrasis con «está» necesita («se está
    // agarrando el pecho») y que la lista portuguesa ya traía
    // («segurando o peito»): sin él, el signo en progresivo
    // español iba al modelo y sus gemelas en/pt declaraban.
    "agarrando el pecho", "apretando el pecho",
    "humo saliendo", "saliendo humo", "sale humo", "hay humo", "hay fuego",
    "salen llamas", "saliendo llamas", "esta ardiendo",
    "sangrando mucho", "no para de sangrar", "esta convulsionando",
    // Auditoría completa (F-5): la primera persona de la respiración
    // («no puedo respirar»; el inglés ya traía «can t breathe») y los
    // eventos que el inglés o el portugués nombraban y el español no.
    "no puedo respirar", "no podemos respirar",
    "esta teniendo una convulsion", "le esta dando una convulsion",
    // Tanda de variantes (Familia 2a): el presente simple con su
    // paradigma de sujeto («mi hijo tiene convulsiones»), la forma
    // corriente de contarlo que el progresivo no cubría.
    "tiene convulsiones", "tienen convulsiones",
    "esta teniendo un infarto", "le esta dando un infarto",
    "esta teniendo un ictus", "le esta dando un ictus", "le esta dando un derrame",
    // Causa E de DIAG-A: «un ataque» a secas, solo en su marco
    // estrecho (el veto «ataque de risa» de abajo fija el límite:
    // con complemento no corporal nombrado, no cuenta).
    "le esta dando un ataque",
    // F-1 (auditoría de la RCP, 2026-11-06): la reanimación en
    // curso, contada por quien la ve o la hace. El suceso ES la
    // situación: no se exige señal de pregunta.
    "esta haciendo rcp", "estan haciendo rcp", "le esta haciendo rcp", "le estan haciendo rcp",
    "haciendo rcp", "haciendole rcp",
    "esta haciendo reanimacion", "estan haciendo reanimacion",
    "le esta haciendo reanimacion", "le estan haciendo reanimacion",
    "haciendo reanimacion", "haciendole reanimacion",
    // 0.1.87 (giro del gas): la FUGA DE GAS contada. El signo es el
    // olor o la fuga misma, el suceso en curso: el giro de la 0.1.86
    // no disparaba ninguna cara de la puerta. El tema suelto (el
    // precio de reparar, cómo funciona un detector) no trae signo y
    // no declara; las metáforas asentadas del gas van a los vetos.
    "huele a gas", "huele mucho a gas", "olor a gas", "fuga de gas", "hay una fuga de gas",
    "esta saliendo gas", "saliendo gas",
    // Auditoría 0.1.93: sucesos en curso que no son del cuerpo y la
    // puerta no conocía (13 de 21 de la batería se iban al modelo).
    "se esta incendiando", "se incendia", "se esta quemando", "hay un incendio", "incendio forestal",
    // Tanda del residuo vivo: la quemadura de persona en primera
    // persona, que el signo de fuego (de tercera) no casaba:
    // «me estoy quemando», «quemándome».
    "me estoy quemando", "quemandome",
    // Fase B ronda 2 (2026-11-25): el progresivo reflexivo con
    // su agente, en el orden alterado de la ronda («en la
    // cocina, quemándose con la estufa, está mi abuela»).
    "quemandose con",
    "se esta inundando", "se inunda", "hay una inundacion",
    "hubo un temblor", "esta temblando", "hubo un terremoto", "hubo un sismo",
    "se cayo un cable", "cable caido", "cable de luz caido",
    // Espejo §4 (H-LOOP-4): la CAÍDA NARRADA — el suceso contado
    // en pasado («se cayó de una escalera»), que ninguna cara
    // veía: el único «cayó» de la lista era el del cable. El
    // sustantivo suelto («caída») no entra, en la forma de la
    // lista, que caza sucesos y no temas; y la metáfora del
    // precio no trae estas formas («se cayó el precio» no es
    // «se cayo de»), como la batería de la pieza cobra en su
    // guarda.
    "se cayo de", "se callo de", "cayo de una",
    // 0.1.111 (punto 11 de la cabecera): la caída y la inmovilidad
    // en PRIMERA persona. «me cai de» es la gemela de «se cayo de»
    // y declara sola, como ella; las formas de inmovilidad con
    // «me» solo las dice un cuerpo de sí mismo, así que también
    // son signos y no contexto: la guarda de objeto vive en la
    // tercera persona («la puerta no se puede mover»), que sigue
    // en su cara con contexto.
    "me cai de",
    "no me puedo mover", "no puedo moverme",
    "no me puedo levantar", "no puedo levantarme",
    "tratando de entrar a mi casa", "intentan entrar a mi casa", "entraron a mi casa",
    "hay un choque", "hubo un choque", "hay heridos", "se volco",
    "atrapado en el elevador", "atrapada en el elevador", "atrapado en el ascensor", "atrapada en el ascensor",
    "estoy atrapado", "estoy atrapada",
    "atropello a", "lo atropello", "la atropello", "atropellaron a", "lo atropellaron", "la atropellaron",
    "se desbordo", "esta entrando agua", "el agua esta entrando", "deja de respirar",
    "tirado en la calle", "tirada en la calle", "tirado en el piso", "tirada en el piso", "no se mueve",
    "exploto", "hubo una explosion", "encerrado en un carro", "encerrado en el coche", "encerrada en un carro",
    "sobre los cables",
  ],
  en: [
    "not breathing", "is not breathing", "stopped breathing", "no longer breathing",
    "can t breathe", "cant breathe", "cannot breathe",
    // Auditoría 2026-11-25 (H-7): la falta de aire antepuesta
    // («unable to breathe is a man on the street»).
    "unable to breathe",
    "is choking", "choking on", "started choking", "is drowning",
    // Fase B ronda 4 (2026-11-25): el corte con el hueso
    // visible y el incendio forestal («you can see the
    // bone», «there's a wildfire nearby»).
    "can see the bone", "wildfire",
    // Fase B ronda 1 (2026-11-25): «going under» en el agua.
    "going under in the pool", "going under in the water",
    "struggling to breathe", "hard to breathe", "difficulty breathing",
    // 0.1.99 T-01 (m-10): the same family as the Spanish signs —
    // the breathing told with its severity inside the phrase.
    "breathing very badly", "breathing badly", "breathing poorly", "breathing with difficulty",
    "clutching his chest", "clutching her chest", "clutching my chest", "clutching their chest",
    // Tanda del residuo vivo: el mismo pecho con «grabbing», la
    // forma corriente que faltaba junto a «clutching».
    "grabbing his chest", "grabbing her chest", "grabbing my chest", "grabbing their chest",
    "is unconscious", "was unconscious", "found unconscious", "not responding", "lost consciousness",
    // Bloque 2 (auditoría 0.1.112): the contracted and adjectival forms,
    // twins of «no responde» / «não responde».
    "isn t responding", "is not responding", "not responsive", "unresponsive",
    "won t respond", "doesn t respond", "isn t responsive",
    // ADV-E1: «passed out», la frase-signo corriente del desmayo.
    "passed out",
    // Tanda del residuo vivo: la gemela en curso de «passed
    // out» («my mother is passing out»). El precio de la forma
    // (el reparto: «she passed out the invitations» ya declara
    // en la base) es el ya pagado por la lista, no uno nuevo.
    "passing out",
    // Tanda del residuo vivo: la quemadura de persona en
    // presente, el reflexivo y la parte del cuerpo en
    // progresivo — en pasado sí son formas conocidas («burned
    // his hand» declara por su cara) y en presente ninguna
    // cara las traía: «my neighbor is burning himself with
    // boiling water right now» iba al modelo.
    "burning himself", "burning herself", "burning myself",
    "burning his hand", "burning her hand", "burning his arm", "burning her arm",
    "burning my hand",
    "smoke coming", "smoke pouring", "full of smoke", "there is a fire", "there s a fire",
    "house on fire", "kitchen on fire", "building on fire", "car on fire", "room on fire",
    "bleeding a lot", "bleeding heavily", "won t stop bleeding",
    // Auditoría 2026-11-25 (H-2): «perder sangre» con su
    // cuantificador, la forma que faltaba junto a «bleeding a
    // lot» («my father is losing a lot of blood» iba al modelo).
    // Sin cantidad no entra: perder sangre a secas también se
    // dice de una analítica.
    "losing a lot of blood", "losing lots of blood", "losing so much blood", "losing too much blood",
    // Causa E de DIAG-A: el chorro con su verbo, con la sangre
    // nombrada en la frase (la vara de la cura: sin sangre
    // nombrada, el aspersor y la manguera no entran).
    "blood is pouring", "pouring blood", "blood is spraying", "spraying blood",
    "blood is spurting", "spurting blood",
    // Auditoría completa (F-5): la contracción corriente («isn't
    // breathing» se pliega a «isn t breathing», que no contiene «not
    // breathing») y las convulsiones, que es y pt ya traían.
    "isn t breathing", "wasn t breathing", "aren t breathing",
    "having a seizure", "is seizing", "is convulsing",
    // Tanda de variantes (Familia 2a): el plural corriente
    // («my son is having seizures»), gemelo del singular.
    "having seizures",
    "having a heart attack", "having a stroke",
    // F-1 (CPR practice audit, 2026-11-06): resuscitation already
    // in progress, as a bystander tells it.
    "doing cpr", "doing chest compressions", "performing cpr",
    // 0.1.87 (giro del gas): THE GAS LEAK, as told — the smell or
    // the leak itself is the running event. The bare topic (repair
    // prices, how a detector works) carries no sign and stays out;
    // the settled gas metaphors are in the vetoes.
    "smells like gas", "smell of gas", "smell gas", "gas leak", "gas is leaking", "leaking gas",
    // Fase B ronda 3 (2026-11-25): la forma corrida del olor
    // («it smells strongly of gas») y la descarga eléctrica
    // contada («got an electric shock»).
    "smells of gas", "smells strongly of gas", "electric shock", "got shocked", "electrocuted",
    // Audit 0.1.93: running events the gate did not know.
    "house is on fire", "kitchen is on fire", "building is on fire", "car is on fire", "room is on fire",
    "apartment is on fire", "stove is on fire", "oven is on fire", "caught fire", "is flooding", "flood coming", "flooding my",
    "breaking into my", "broke into my", "someone is in my house",
    "carbon monoxide alarm", "carbon monoxide detector",
    "there was an earthquake", "earthquake just", "car crash", "car accident",
    // H-LOOP-4: the fall, as told («fell off a ladder»).
    "fell off a", "fell down the stairs", "fell from a",
    // 0.1.111 (header point 11): the first person of the fall and
    // of immobility. «can t move» in IMMOBILITY_SIGNS carries no
    // subject and stays context-bound; with the «i» it is a body
    // speaking of itself and is a sign, like the Spanish forms.
    "fell off the", "i fell down", "i can t move", "i can t get up",
    "i m trapped", "i am trapped", "is trapped",
    "smoke alarm", "i see smoke", "collapsed", "is sinking",
    // Tanda de variantes (Familia 2b): la inmovilidad con su
    // pronombre («she is not moving»), la base que el censo dejó
    // restante. Sin pronombre no entra: «the car is not moving»
    // es tráfico, no un cuerpo.
    "she is not moving", "he is not moving", "they are not moving",
  ],
  pt: [
    "nao esta respirando", "nao respira", "nao respiram", "parou de respirar", "sem respirar",
    // Auditoria 2026-11-25 (H-7): a falta de ar anteposta
    // («sem conseguir respirar está um homem na rua»).
    "sem conseguir respirar",
    "deixou de respirar",
    "esta engasgando", "engasgando", "engasgou",
    // Fase B ronda 4 (2026-11-25): o corte com o osso à
    // vista e o incêndio florestal («dá para ver o osso»,
    // «tem um incêndio florestal perto»).
    "da para ver o osso", "incendio florestal",
    // ADV-E1: os eventos novos em português («desmaiou», «se afogou»).
    "desmaiou", "se afogou",
    // Fase B ronda 1 (2026-11-25): o afogamento como
    // afundamento e a queda como desabamento («está afundando
    // na piscina», «meu marido desabou na cozinha»).
    "esta afundando", "desabou",
    "dificuldade para respirar", "dificuldade em respirar",
    // 0.1.99 T-01 (m-10): a mesma família dos signos em espanhol
    // («respira muito mal»); «respira mal» já entra pela lista
    // espanhola, porque ALL_SIGNS junta as três línguas.
    "respira muito mal", "respirando muito mal",
    "respira com dificuldade", "respirando com dificuldade",
    "esta inconsciente", "ficou inconsciente", "nao responde",
    "segurando o peito", "apertando o peito", "mao no peito",
    // Tanda del residuo vivo: o peito com «agarrando», nas duas
    // ordens («agarrando o peito», «se agarrando no peito»).
    "agarrando o peito", "agarrando no peito",
    // Tanda del residuo vivo: a queimadura de pessoa no
    // presente, o reflexivo e a parte do corpo em progressivo
    // — como no inglês, em passado são formas conhecidas e no
    // presente nenhuma cara as trazia («meu vizinho está se
    // queimando com água fervendo agora» ia ao modelo).
    "se queimando", "me queimando",
    "queimando a mao", "queimando o braco",
    "fumaca saindo", "saindo fumaca", "tem fogo", "pegando fogo", "em chamas", "saindo chamas",
    "sangrando muito", "nao para de sangrar", "esta convulsionando",
    // Auditoria 2026-11-25 (H-2): «perder sangue» com o seu
    // quantificador, a forma que faltava junto a «sangrando
    // muito» («meu pai está perdendo muito sangue» ia ao
    // modelo); inclui a perífrase europeia «a perder».
    "perdendo muito sangue", "perdendo tanto sangue", "a perder muito sangue",
    // Causa E de DIAG-A: o jorro com o seu verbo, com o sangue
    // nomeado na frase.
    "sangue espirrando", "espirrando sangue", "sangue a espirrar", "sangue esta espirrando",
    // Auditoría completa (F-5): «não consigo respirar», la forma
    // corriente que el portugués no traía, y los eventos de las otras
    // dos lenguas.
    "nao consigo respirar", "nao consegue respirar", "nao conseguem respirar",
    "esta tendo uma convulsao", "esta tendo um infarto", "esta tendo um avc",
    // Tanda de variantes (Familia 2a): el plural sin artículo
    // («meu filho está tendo convulsões»).
    "tendo convulsoes",
    // Tanda de variantes (Familia 2c): la inmovilidad portuguesa,
    // espejo del «no se mueve» español que ya era signo.
    "nao se mexe", "nao se move",
    // F-1 (auditoria da RCP, 2026-11-06): a reanimação em curso,
    // contada por quem a vê ou a faz, nas duas variantes do
    // português (a fazer / fazendo).
    "esta fazendo rcp", "estao fazendo rcp", "fazendo rcp",
    "esta a fazer rcp", "estao a fazer rcp",
    "esta fazendo reanimacao", "estao fazendo reanimacao", "fazendo reanimacao",
    "fazendo massagem cardiaca",
    // 0.1.87 (giro do gás): O VAZAMENTO DE GÁS contado — o cheiro
    // ou o vazamento é o evento em curso («cheiro de gás» se dobra
    // a «cheiro de gas»). O tema solto (preço do reparo, como
    // funciona um detector) não traz sinal e não declara.
    "cheiro de gas", "vazando gas", "vazamento de gas", "esta vazando gas", "sai gas", "saindo gas",
    // Fase B ronda 3 (2026-11-25): o cheiro em curso
    // («está cheirando muito gás na cozinha»).
    "cheirando gas", "cheirando muito gas",
    // Auditoria 0.1.93: eventos em curso que a porta não conhecia.
    "esta inundando", "esta alagando", "houve um terremoto",
    "tentando entrar na minha casa", "arrombando a porta", "houve um acidente",
    // H-LOOP-4: a queda contada («caiu de uma escada»).
    "caiu de", "caiu da escada",
    // 0.1.111 (ponto 11 do cabeçalho): a primeira pessoa da queda
    // e da imobilidade. «eu cai de/da» com o seu complemento: o
    // «caí» português solto é fortemente metafórico («caí na
    // tentação») e fica na cara da queda com contexto. As formas
    // de imobilidade com «me» só as diz um corpo de si mesmo.
    "eu cai de", "eu cai da",
    "nao consigo me mover", "nao consigo me levantar",
    "estou preso", "estou presa",
  ],
};

/**
 * Contextos que vetan la cara de emergencia: marcos de ficción o
 * ensayo y metáforas asentadas. La emergencia real no se presenta
 * como «historia sobre…» ni se ahoga «en un vaso de agua».
 */
const EMERGENCY_VETOES = [
  ...HEALTH_EXCLUSIONS,
  "historia sobre", "cuento sobre", "cuento de", "novela sobre", "poema sobre",
  "story about", "essay about", "poem about", "novel about",
  "conto sobre", "poema sobre",
  "en un vaso de agua", "en deudas", "in debt", "em dividas",
  // ADV2-08: el TEMA de seguridad de producto no es un suceso —
  // una consulta de prevención con la víctima nombrada («choking
  // hazard for toddlers») declaraba situación viva y adelantaba
  // la ruta protegida. (Su cara de salud, sellada por la familia
  // de H-04, no se toca: estos vetos solo mandan sobre la cara de
  // situación, como todos los de esta lista.)
  "choking hazard",
  "peligro de atragantamiento", "riesgo de atragantamiento",
  "peligro de asfixia", "riesgo de asfixia",
  "risco de engasgo", "perigo de asfixia",
  // ADV2-08: el modismo «choke back» (contener las lágrimas o la
  // risa) no tiene gemelo físico — nadie «choke back» un objeto —
  // y el auxiliar que trae («was choking back…») le daba contexto
  // de cuerpo a una frase sin cuerpo.
  "choke back", "choking back", "choked back",
  // 0.1.87 (giro del gas): las metáforas asentadas del gas («a todo
  // gas», «dar gas», «full gas» como elogio deportivo) no son una
  // fuga; sin ellas, el signo «saliendo gas» no las caza, pero
  // quedan vetadas por nombre como las demás metáforas de la lista.
  "a todo gas", "full gas", "dar gas",
  // Causa E de DIAG-A: el límite del signo «le esta dando un
  // ataque» — el ataque que no es del cuerpo no es situación.
  "ataque de risa",
  // Fase B ronda 3 (2026-11-25): la alarma de humo con la
  // batería agotándose pita a intervalos («chirping»); la
  // alarma de un fuego suena continua y trae el humo, y esa
  // sigue declarando por sus signos.
  "is chirping", "battery is dying", "battery is dead",
];

const ALL_SIGNS: string[] = Object.values(EMERGENCY_SIGNS).flat();

/**
 * Cláusulas de resolución tras conector adversativo: el suceso
 * se cuenta ya cerrado («pero ya está bien»). Sin el conector,
 * la misma frase no veta (puede ser el estado previo a otro
 * suceso vivo del mismo texto).
 */
const RESOLVED_CLAUSES = [
  "pero ya esta bien", "pero ya esta mejor", "pero ya paso",
  "mas ja esta bem", "mas ja passou",
  "but is fine now", "but he is fine now", "but she is fine now", "but is already fine",
];

/**
 * El suceso NEGADO o el casi-suceso resuelto (auditoría
 * 2026-11-25, H-4): la frase nombra el signo solo para decir
 * que no está pasando («no está sangrando, es solo un
 * rasguño», «the carbon monoxide alarm didn't go off; it was
 * a detector test», «ela quase se queimou, mas tirou a mão a
 * tempo»). La negación que acota las rutas de seguridad no
 * acotaba la puerta de salud, que se disparaba por la mera
 * mención del signo negado. Marcos con la negación (o el
 * «casi») pegados al suceso mismo, en las tres lenguas, y el
 * marco de cita («estoy citando una frase de una novela»):
 * las dos caras de la puerta los consultan, como comparten
 * los vetos de contexto. El suceso vivo gemelo no trae
 * ninguno de estos marcos y sigue declarando.
 */
const NEGATED_EVENT_FRAMES = [
  "no se esta atragantando", "no esta atragantando", "no esta sangrando",
  "no se desmayo", "no quiero hacerme dano", "estoy citando una frase",
  "casi se quemo", "no hay fuego", "alarma no sono",
  "isn t bleeding", "is not bleeding", "isn t choking", "is not choking",
  "there is no fire", "don t want to hurt myself", "do not want to hurt myself",
  "quoting a line", "almost burned herself", "almost burned himself",
  "alarm didn t go off", "alarm did not go off", "was a detector test",
  "nao esta se engasgando", "nao esta sangrando", "nao desmaiou",
  "quase se queimou", "citando uma frase", "nao quero me machucar",
  // Fase B ronda 1 (2026-11-25): la negación con resolución
  // («no hay ninguna hemorragia, solo fue un susto»).
  "no hay ninguna hemorragia", "no hay hemorragia", "there is no bleeding",
  "nao ha nenhuma hemorragia", "nao ha hemorragia",
  // Fase B ronda 3 (2026-11-25): la metáfora en curso no es
  // un suceso que no ocurre: es un suceso que no existe
  // («estoy sangrando de amor»). La familia la consultan
  // las dos caras, como la negación. La gemela inglesa
  // («drowning in work») NO entra aquí: su familia tiene un
  // precio fixturado en la suite gobernada (X-09, «He is
  // drowning in work emails» es disparo aceptado de la cara
  // de situación) y su veto vive solo en la cara de salud,
  // donde la ronda midió su sobre-disparo.
  "sangrando de amor",
  // Fase B ronda 5 (2026-11-25): la hipérbole del calor con
  // el «tú» genérico («hace un calor que te desmayas»,
  // «dá para desmaiar») no cuenta ningún desmayo.
  "que te desmayas", "da para desmaiar",
];

/**
 * El enunciado HIPOTÉTICO (auditoría 2026-11-25, H-5): abre
 * con la condición (if / si / se), trae el modo condicional
 * en la cláusula principal (would / tendría / teria) y no
 * tiene forma interrogativa. Es el dirimen sellado de «cuando
 * haya un incendio llamo a los bomberos» llevado a las formas
 * que la auditoría midió: el inglés de caída y de CO, y el
 * atragantamiento en subjuntivo en español y portugués. La
 * consulta condicional genuina no abre con la condición
 * («¿qué hago si mi hijo se atraganta?») y sigue cerrando su
 * puerta; el suceso vivo no trae el modo condicional.
 */
function isHypotheticalStatement(text: string, folded: string): boolean {
  if (/[¿?]/.test(text)) return false;
  const t = folded.trim().replace(/^(por favor|please)\s+/, "");
  if (!/^(if|si|se) /.test(t)) return false;
  return / (would|tendria|teria) /.test(` ${t} `);
}

/**
 * La afirmación HABITUAL de incendio (auditoría 2026-11-25,
 * H-5): «when there is a fire, I call the fire department»
 * trae el signo «there is a fire», pero es un enunciado de
 * costumbre, no un parte — la misma forma sellada del
 * dirimen en español («cuando haya un incendio llamo a los
 * bomberos») y en portugués. Sin forma interrogativa y con
 * el verbo de llamada en primera persona de presente, las
 * dos caras la dejan fuera, como la ruta del número.
 */
/**
 * Los marcos de TAREA DE GUÍA (auditoría 2026-11-25, H-8):
 * la frase pide aprender una técnica, preparar, escribir o
 * traducir una guía o un folleto, consejos de prevención, el
 * contenido de un botiquín, o cuenta el uso o la instalación
 * de un detector como tema. No hay suceso en curso: es la
 * clase «guia» del corpus gobernado medida sobre primeros
 * auxilios, que disparaba la puerta de salud por la mención
 * del signo dentro de la tarea, y en inglés hasta la de
 * situación. Las dos caras consultan la familia, como los
 * vetos de suceso negado. El suceso vivo no trae ninguno de
 * estos marcos.
 */
const GUIDE_TASK_FRAMES = [
  "quiero aprender", "quero aprender", "i want to learn", "want to learn",
  "preparando una guia", "preparando um guia", "preparing a guide",
  "escribiendo un folleto", "escrevendo um folheto", "writing a leaflet",
  // Fase B ronda 6 (2026-11-25): el cruce que faltaba —
  // preparar un folleto («estoy preparando un folleto…»,
  // «i'm preparing a leaflet…», «estou preparando um
  // folheto…»).
  "preparando un folleto", "preparing a leaflet", "preparando um folheto",
  "traduciendo una guia", "traduzindo um guia", "translating a first aid guide", "translating a guide",
  "first aid kit contain", "kit de primeiros socorros deve conter",
  "botiquin debe contener", "kit de primeros auxilios debe contener",
  "quiero consejos para que", "i want tips so", "quero dicas para",
  "health workshop", "taller de salud", "detector is used", "alarm installed",
  "alarma instalada", "alarme instalado",
  // Fase B ronda 1 (2026-11-25): el taller como tarea, en su
  // nombre propio («estoy montando un taller de primeros
  // auxilios para la escuela»).
  "taller de primeros auxilios", "first aid workshop", "oficina de primeiros socorros",
  // Fase B ronda 2 (2026-11-25): la tarea meta sobre la guía
  // —descargarla, imprimirla, pasarla— tampoco trae suceso
  // («quiero descargar la guía de primeros auxilios para
  // imprimirla», «send me the leaflet…», «quero baixar o
  // guia de primeiros socorros para imprimir»).
  "descargar la guia", "pasame el folleto", "download the first aid guide",
  "download the guide", "send me the leaflet", "baixar o guia", "me passa o folheto",
];

function isHabitualFireStatement(text: string, folded: string): boolean {
  if (/[¿?]/.test(text)) return false;
  const hay = ` ${folded} `;
  if (!/ (when there is a fire|when there s a fire|cuando haya un incendio|quando houver um incendio) /.test(hay)) return false;
  return / (i call|llamo|ligo) /.test(hay);
}

/**
 * Raíces de situación (R-07, ronda física de la 0.1.68): la cara de
 * frases exactas de arriba no tolera el ruido del dictado por voz —
 * una sola letra caída dentro de la palabra-signo («tragantando»,
 * «atragantndo») la dejaba invisible en las tres caras. Esta segunda
 * cara casa por principio de palabra, el mismo patrón de prefijos de
 * `HEALTH_TERMS.*.p`: «atragant» cubre la familia entera y sus
 * pretéritos, «tragant» la misma palabra sin la primera letra (el
 * error de dictado medido) y «asfixi» el sinónimo que las frases no
 * traían («se está asfixiando»). Inglés y portugués llevan sus
 * equivalentes («chok»/«asphyxi»/«suffocat», «engasg»/«asfixi»).
 * Las raíces son específicas del atragantamiento y la asfixia: no
 * comparten principio con temas cotidianos, y los vetos de contexto
 * y el marco histórico se aplican ANTES, igual que con las frases —
 * el pasado y la ficción siguen sin disparar. Desde H-05 la raíz
 * tampoco dispara sola: exige el contexto de cuerpo de
 * `stemOccurrenceHasBodyContext` (punto 7 de la cabecera), porque «chok»
 * sí comparte principio con una metáfora cotidiana. ADV-E1 añade
 * los tallos de los otros eventos del parte (desmayo, ahogamiento,
 * inconsciencia — es/en/pt), que heredan la misma disciplina: sin
 * contexto de cuerpo o forma telegráfica no declaran, y los vetos
 * cerrados ya cubren sus metáforas asentadas («en deudas», «em
 * dividas», «en un vaso de agua»). F-1 añade los tallos de la
 * reanimación («reanim», «resuscit» y las siglas «rcp»/«cpr» como
 * raíz acotada a la palabra que empieza por ellas) bajo la misma
 * disciplina: la sigla como tema suelto («un curso de rcp») no
 * declara nada sin cuerpo cerca, y la cara telegráfica exige
 * además una forma de participio, gerundio o estado que la sigla
 * desnuda no tiene.
 */
const EMERGENCY_STEMS: Record<GateLang, string[]> = {
  es: ["atragant", "tragant", "asfixi", "desmay", "ahog", "inconscient", "reanim", "rcp"],
  en: ["chok", "asphyxi", "suffocat", "faint", "drown", "unconsc", "resuscit", "cpr"],
  pt: ["engasg", "asfixi", "desmai", "afog", "inconscient", "reanim", "rcp"],
};

const ALL_STEMS: string[] = Object.values(EMERGENCY_STEMS).flat();

/**
 * Auxiliares que, justo antes de la palabra-signo, forman la
 * construcción del suceso en curso que el dictado produce: «se
 * esta tragantando», «is chokng», «estou engasgando». Los plurales
 * genéricos («are»/«were») quedan fuera a propósito: son los
 * auxiliares de los sujetos de clase de la metáfora («golfers are
 * choking under pressure» no gana contexto por ellos).
 */
const STEM_AUX_WORDS = new Set(["is", "was", "am", "esta", "estoy", "estou", "se"]);

/**
 * Víctimas y peticiones de ayuda que, CERCA de la palabra-signo
 * (tres palabras a cada lado), la atan a un cuerpo: quien dicta
 * una emergencia nombra a quién le pasa («mi hijo», «o bebê»,
 * «someone», «ayuda»). Fuera a propósito: pronombres y posesivos
 * sueltos («he choked on stage» también los trae, y es la
 * metáfora del escenario) y los sustantivos de clase genérica
 * (golfers, players, students), que son el sujeto natural de la
 * metáfora deportiva. El casado (ADV2-08) es por palabra exacta
 * —sin la puntuación pegada— o por la señal + resto ∈ {s, es}
 * (el plural): «son» no caza «song», y desde el arreglo «help»
 * tampoco caza «helpful», ni «baby» a «babysitter», ni «person»
 * a «personal» — el prefijo sin resto declaraba cuerpos que no
 * hay. Los femeninos van como entradas propias de la lista.
 */
const STEM_BODY_SIGNALS = [
  "alguien", "alguem", "someone", "somebody",
  "bebe", "nino", "nina", "crianca", "baby", "toddler", "child",
  "hijo", "hija", "filho", "filha", "son", "daughter",
  "padre", "madre", "pai", "mae", "mother", "father",
  "abuelo", "abuela", "grandfather", "grandmother",
  "hombre", "mujer", "homem", "mulher", "persona", "pessoa", "person",
  "ayuda", "ajuda", "help", "socorro", "auxilio",
  // ADV2-07: a quién le pasa, nombrado por relación o por papel en
  // un parte — el criterio de inclusión de la lista. Los sustantivos
  // corrientes del parte dictado (señor/a, vecino/a, cliente,
  // paciente, encargado/a, conductor/a, pasajero/a, huésped,
  // compañero/a) y la familia que el dictado dice sin pasar por la
  // lista vieja (papá, mamá, hermano/a, esposo/a…). Las formas
  // irregulares entran como entradas propias: children, kid, kids.
  // Fuera, como desde H-05: los sustantivos de clase que son el
  // sujeto natural de la metáfora de rendimiento (golfers, players,
  // students) y los pronombres sueltos.
  // 0.1.111: las formas corrientes inglesas de la familia cercana
  // («my dad can't get up»): el mismo criterio que papa/mama.
  "dad", "mom", "grandpa", "grandma",
  "senor", "senora", "vecino", "vecina", "cliente", "paciente", "patient", "customer",
  "encargado", "encargada", "conductor", "conductora", "pasajero", "pasajera",
  "huesped", "companero", "companera",
  "papa", "mama", "hermano", "hermana", "irmao", "irma",
  "esposo", "esposa", "marido", "husband", "wife", "brother", "sister",
  "amigo", "amiga",
  "children", "kid", "kids",
  // Bloque 2 (auditoría 0.1.112): «hombre»/«homem» estaban y «man» no,
  // así que «there is a man unconscious on the street» no declaraba en
  // inglés y su gemela española sí. Las personas corrientes de las tres
  // lenguas, en paridad.
  "man", "woman", "men", "women", "guy", "lady", "boy", "girl", "neighbor", "neighbour", "friend",
  "chico", "chica", "muchacho", "muchacha",
  "menino", "menina", "rapaz", "moca", "senhor", "senhora", "vizinho", "vizinha",
  // Tanda de variantes (Familia 3): la persona mayor nombrada por
  // su edad en las formas que el censo midió («una anciana
  // caída», «uma idosa caída»). Solo esas dos: el plural
  // masculino portugués («idosos») medido contra la guarda
  // ampliada daba contexto de cuerpo a un tema de prevención
  // («como evitar que idosos desmaiem») y la empeoraba; las
  // formas masculinas del baño las carga el lugar (IMMOBILITY_
  // PLACES), y las de parentesco ya viven en la lista («padre»).
  "anciana", "idosa",
  // Tanda del residuo vivo (2026-11-25): el parentesco corriente
  // que faltaba en las tres lenguas, con el mismo criterio de la
  // lista (relación o papel en un parte): «mi tío se está
  // cayendo» no traía cuerpo leíble, ni «meu avô» el suyo (el
  // portugués no tenía su «abuelo»: «avo» es el plegado de avô y
  // de avó).
  "tio", "tia", "uncle", "aunt", "avo",
];

/**
 * ¿Trae alguna palabra-signo (principio de palabra de ALL_STEMS)
 * contexto de cuerpo en el texto ya plegado? (H-05, punto 7 de la
 * cabecera.) Tres formas, todas leídas sobre la palabra-signo
 * misma o su vecindad inmediata:
 *
 * - la construcción progresiva o reflexiva: auxiliar justo antes
 *   («se esta tragantando», «my toddler is chokng» — ahí manda
 *   también la víctima), el enclítico pegado al gerundio
 *   («atragantandose», «ahogandome») o el «se» suelto tras él
 *   («engasgando se»);
 * - una señal de víctima o ayuda a tres palabras o menos.
 *
 * La metáfora sin víctima («why do golfers choke under pressure»,
 * «she choked on stage», «se me atragantan las matemáticas») no
 * trae ninguna de las tres y la raíz, sola, ya no basta.
 */
function stemOccurrenceHasBodyContext(words: string[], i: number): boolean {
  if (i > 0 && STEM_AUX_WORDS.has(words[i - 1])) return true;
  if (words[i].endsWith("ndose") || words[i].endsWith("ndome") || words[i].endsWith("ndonos")) return true;
  if (words[i + 1] === "se") return true;
  const from = Math.max(0, i - 3);
  const to = Math.min(words.length - 1, i + 3);
  for (let j = from; j <= to; j++) {
    // La palabra sin su puntuación pegada («hijo.» cuenta como
    // «hijo», como contaba con el casado por principio) y la
    // regla del resto de ADV2-08: la señal, o la señal + s/es.
    const w = words[j].replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");
    if (STEM_BODY_SIGNALS.some((s) => w === s || w === `${s}s` || w === `${s}es`)) return true;
  }
  return false;
}

/**
 * La pregunta «¿alguna palabra-signo trae contexto de cuerpo?»
 * sobre el texto ya plegado: la forma que la puerta de salud
 * (isHealthQuestion, vía del «chok») viene usando desde H-05.
 * Sin ventana de negación: esa vía pregunta por el tema, no por
 * la declaración, y su disciplina es la de siempre.
 */
function anyStemHasBodyContext(folded: string): boolean {
  const words = folded.trim().split(/\s+/).filter((w) => w.length > 0);
  for (let i = 0; i < words.length; i++) {
    if (!ALL_STEMS.some((s) => words[i].startsWith(s))) continue;
    if (stemOccurrenceHasBodyContext(words, i)) return true;
  }
  return false;
}

/**
 * Palabras que niegan la forma que las sigue (0.1.111, punto 11
 * de la cabecera): «no se está ahogando, está actuando», «nadie
 * se está ahogando», «nobody is choking», «ya no se está
 * ahogando». La ventana es la palabra pegada a la forma, saltando
 * los auxiliares de la construcción en curso (en «no se está
 * ahogando» el «no» queda dos palabras antes de «ahogando»
 * porque «se está» es la construcción). La negación DENTRO de la
 * forma no se mira nunca: «no puedo respirar» y «no se puede
 * mover» son signos afirmativos de esta puerta, y su «no» va
 * dentro, no delante.
 */
const NEGATION_WORDS = new Set([
  "no", "nao", "not", "never", "nobody", "nadie", "ningun", "ninguna",
  "ninguem", "nunca", "jamais", "tampoco", "nem",
]);

/** ¿La ocurrencia de la palabra-signo en el índice i viene
 *  negada? (la negación pegada, saltando auxiliares). */
function occurrenceNegated(words: string[], i: number): boolean {
  let j = i - 1;
  while (j >= 0 && STEM_AUX_WORDS.has(words[j])) j--;
  return j >= 0 && NEGATION_WORDS.has(words[j]);
}

const SIGNS_BY_FIRST_WORD = new Map<string, string[][]>();
for (const sign of ALL_SIGNS) {
  const pw = sign.split(" ");
  const arr = SIGNS_BY_FIRST_WORD.get(pw[0]) ?? [];
  arr.push(pw);
  SIGNS_BY_FIRST_WORD.set(pw[0], arr);
}

/**
 * La cara de signos, por ocurrencia (0.1.111): el mismo casado
 * por palabras de siempre, pero una ocurrencia negada no declara
 * («no se está ahogando» trae el signo «se esta ahogando» con el
 * «no» delante). Otra ocurrencia del mismo u otro signo sin
 * negar sigue declarando: «no respira, se está ahogando» declara
 * dos veces.
 */
function signDeclares(words: string[]): boolean {
  for (let i = 0; i < words.length; i++) {
    const candidates = SIGNS_BY_FIRST_WORD.get(words[i]);
    if (!candidates) continue;
    for (const pw of candidates) {
      if (i + pw.length > words.length) continue;
      if (!pw.every((w, k) => words[i + k] === w)) continue;
      if (occurrenceNegated(words, i)) continue;
      return true;
    }
  }
  return false;
}

/**
 * La cara por raíz, por ocurrencia (H-05 con la ventana de
 * negación de la 0.1.111): una palabra-signo con contexto de
 * cuerpo y sin negación pegada declara; la negada («no está
 * inconsciente, está dormido», vía su raíz) no.
 */
function stemDeclares(words: string[]): boolean {
  for (let i = 0; i < words.length; i++) {
    if (!ALL_STEMS.some((s) => words[i].startsWith(s))) continue;
    if (occurrenceNegated(words, i)) continue;
    if (stemOccurrenceHasBodyContext(words, i)) return true;
  }
  return false;
}

/**
 * La caída contada a secas (0.1.111, punto 11): «se cayó» sin
 * complemento no es un signo de la lista — la misma forma la
 * dice el precio o el sistema, y su guarda («se cayó el precio
 * de la casa») es batería viva. Su cara es la de las raíces: la
 * forma declara con su contexto. El contexto es la víctima o la
 * ayuda a tres palabras, la lesión contada a cuatro (golpe,
 * sangre, fractura: «se cayó y se golpeó la cabeza»), una frase
 * de inmovilidad en el mismo texto, o el parte a secas abriendo
 * el mensaje («Se cayó.», tres palabras o menos en total). La
 * primera persona española con «me» es contexto bastante por sí
 * misma: «me caí» solo lo dice un cuerpo de sí mismo, y la
 * metáfora corriente del caer («caer en la tentación») no lleva
 * el «me». La portuguesa con «eu» no hereda ese atajo: «eu caí
 * na tentação» es metáfora y su «caí» exige el contexto común.
 * La negación pegada veta la ocurrencia («mi hijo no se cayó»).
 */
const FALL_PHRASES = [
  "se cayo", "se callo", "se me cayo", "se me callo", "me cai",
  "caiu", "eu cai", "fell",
  // Tanda del residuo vivo (2026-11-25): la caída EN CURSO y la
  // recién ocurrida, que ninguna cara conocía (las 12 frases del
  // residuo de la tanda de narración eran esta clase). El
  // progresivo solo vivía como ancla del veto de narración, que
  // exime pero no declara: «me estoy cayendo» iba al modelo. Y
  // «acaba de caer» no era forma de caída: la inmovilidad que lo
  // acompañaba no declaraba sin su contexto. Sus reglas propias
  // van en fallDeclares (primera persona directa, apertura y
  // pronombre, recencia a secas); el contexto común (cuerpo,
  // lesión, lugar, inmovilidad) las cobra como a las demás.
  "me estoy cayendo", "se esta cayendo", "esta cayendo",
  "i am falling", "i m falling", "is falling",
  "estou caindo", "esta caindo",
  "se acaba de caer", "acaba de caer", "acaba de caerse", "acabou de cair",
];

/** Los progresivos de primera persona: solo los dice un cuerpo
 * de sí mismo, como «me cai» — declaran directos. («i m falling»
 * es lo que queda de «I'm falling» tras plegar, como «can t».) */
const FALL_PROGRESSIVE_FIRST = new Set([
  "me estoy cayendo", "i am falling", "i m falling", "estou caindo",
]);
const FALL_PROGRESSIVE = new Set([
  ...FALL_PROGRESSIVE_FIRST,
  "se esta cayendo", "esta cayendo", "is falling", "esta caindo",
]);
/** Las formas de recencia: el suceso que acaba de pasar. */
const FALL_RECENT = new Set([
  "se acaba de caer", "acaba de caer", "acaba de caerse", "acabou de cair",
]);
/** El pronombre sujeto pegado delante del progresivo o del
 * «just fell»: «He is falling», «Ele está caindo». */
const FALL_SUBJECT_PRONOUNS = new Set(["el", "ella", "he", "she", "ele", "ela"]);
/** La meteorología tras el verbo del progresivo: «está cayendo
 * granizo» es el tiempo, no un parte — la ocurrencia con una de
 * estas palabras detrás no declara por la cara de caída. */
const FALL_WEATHER_AFTER = new Set([
  "granizo", "nieve", "neve", "chuva", "lluvia", "hail", "snow", "rain",
]);
const FALL_INJURY_PREFIXES = [
  "golpe", "cabez", "sangr", "herid", "fractur", "romp", "quebr",
  "machuc", "ferid", "fratur", "hurt", "injur", "bleed",
];

/**
 * El lugar de la caída como contexto (0.1.112, resto de la
 * verificación de la 0.1.111): «se cayó en el baño» escrito tal
 * cual, sin sujeto en la frase, es un parte — la forma
 * impersonal con «se» y un lugar de la casa no la dice un objeto
 * (el objeto que cae trae su nombre pegado: «se cayó el precio»,
 * «se me cayó el móvil»). La guarda es la construcción entera:
 * solo las formas impersonales («se cayo»/«se callo», el «caiu»
 * portugués, el «fell» inglés) seguidas de la preposición de
 * lugar y un lugar de esta lista. Las formas con «se me» quedan
 * fuera (son la caída DE un objeto) y la narración y la negación
 * vetan la ocurrencia antes, como en el resto de la cara.
 */
const FALL_PLACES_ES = new Set([
  "bano", "cocina", "ducha", "regadera", "tina", "cuarto", "habitacion",
  "dormitorio", "recamara", "sala", "comedor", "pasillo", "patio",
  "jardin", "terraza", "balcon", "azotea", "sotano", "garaje", "cochera",
  "entrada", "escalera", "escaleras", "calle", "acera", "banqueta",
  "vereda", "piscina", "alberca", "suelo", "piso",
]);
const FALL_PLACES_PT = new Set([
  "banheiro", "cozinha", "chuveiro", "banho", "quarto", "sala",
  "corredor", "patio", "terraco", "varanda", "sotao", "garagem",
  "entrada", "escada", "escadas", "rua", "calcada", "piscina", "chao",
]);
const FALL_PLACES_EN = new Set([
  "bathroom", "kitchen", "shower", "bedroom", "hallway", "patio",
  "garden", "terrace", "balcony", "basement", "garage", "stairs",
  "street", "sidewalk", "pool", "floor",
]);
const FALL_PLACE_ARTICLES = new Set([
  "el", "la", "los", "las", "un", "una", "o", "a", "os", "as", "um", "uma", "the",
]);

/** ¿Sigue a la caída (que acaba en `end`) su lugar? Preposición
 * en la posición `end + 1`, artículo opcional y el lugar.
 * Ampliación del lote (§1): la contracción fusionada («al»,
 * «del») trae la preposición y el artículo en un solo token, así
 * que el lugar se cobra en el token siguiente; y «del» vale
 * además como artículo tras una preposición («dentro del
 * baño»). */
function fallPlaceFollows(
  words: string[],
  end: number,
  preps: string[],
  places: Set<string>,
): boolean {
  const next = words[end + 1] ?? "";
  if (next === "al" || next === "del") return places.has(words[end + 2] ?? "");
  if (!preps.includes(next)) return false;
  let j = end + 2;
  if (FALL_PLACE_ARTICLES.has(words[j] ?? "") || words[j] === "del") j++;
  return places.has(words[j] ?? "");
}

/**
 * El marco de NARRACIÓN de la caída (guardas de bateriaA2Movil,
 * doctrina desde la 0.1.109: una historia de una emergencia pasada
 * no dispara la respuesta de emergencia). La caída con víctima
 * declara («mi vecino se cayó» es un parte), pero la misma frase
 * contada a distancia no es un parte: trae su marcador de tiempo
 * pegado a la caída («ayer», «hace años», «la semana pasada»,
 * «desde entonces») o su desenlace resuelto («fue solo un susto,
 * ya está bien»). La exención manda sobre el veto: si el texto
 * trae un signo de inmovilidad EN PRESENTE, el caído sigue en el
 * suelo aunque la caída fuera ayer, y la cara declara igual.
 */
const FALL_DISTANCE_TOKENS = new Set(["ayer", "anoche", "anteayer", "yesterday",
  // Tanda de narración (2026-11-25): el portugués de la doctrina
  // no traía su «ayer»: «ontem meu avô caiu» declaraba.
  "ontem", "anteontem"]);
const FALL_TIME_UNITS = new Set([
  "anos", "ano", "meses", "mes", "semanas", "semana", "dias", "dia", "mucho",
  // Tanda de narración: «hace un rato» no era distancia («rato»
  // no era unidad).
  "rato",
]);
const FALL_COUNT_WORDS = new Set([
  "un", "una", "uno", "um", "uma", "dos", "dois", "duas", "tres", "cuatro",
  "cinco", "seis", "siete", "ocho", "nueve", "diez", "dez",
]);
const FALL_DISTANCE_BIGRAMS = new Set([
  "semana pasada", "semana passada", "mes pasado", "mes passado",
  "ano pasado", "anos atras", "years ago", "months ago", "weeks ago",
  "days ago", "desde entonces", "desde entao", "otro dia",
  // Tanda de variantes (Familia 3): la distancia inglesa corriente
  // («fell last week», «fell last year»), que declaraba situación
  // viva por no estar en la lista.
  "last week", "last year",
  // Tanda de narración (2026-11-25): el resto de marcadores
  // corrientes de las tres lenguas en su forma de bigrama.
  "last month", "last night", "outro dia", "esta manana", "esta manha",
  "this morning", "on monday", "last monday", "lunes pasado", "segunda passada",
]);
const FALL_RESOLUTION_PHRASES = new Set([
  "ya esta bien", "ya esta mejor", "esta bien ahora",
  "fue solo un susto", "solo fue un susto", "foi so um susto",
  "ya se recupero", "ya se recuperou", "he is fine", "she is fine",
]);

function fallOccurrenceNarrated(words: string[], i: number, end: number): boolean {
  const lo = Math.max(0, i - 4);
  const hi = Math.min(words.length - 1, end + 4);
  for (let j = lo; j <= hi; j++) {
    if (FALL_DISTANCE_TOKENS.has(words[j])) return true;
    // Tanda de variantes (Familia 3): el bigrama que ABRE en el
    // borde de la ventana también cuenta («fell in the kitchen
    // last week»: «last» cae en hi y su segunda palabra queda
    // una fuera; sin esto la distancia inglesa no vetaba).
    if (j <= hi && j + 1 < words.length && FALL_DISTANCE_BIGRAMS.has(`${words[j]} ${words[j + 1]}`)) return true;
    if (words[j] === "hace" || words[j] === "faz" || words[j] === "ha") {
      if (FALL_TIME_UNITS.has(words[j + 1] ?? "")) return true;
      if (FALL_COUNT_WORDS.has(words[j + 1] ?? "") && FALL_TIME_UNITS.has(words[j + 2] ?? "")) return true;
    }
  }
  // El desenlace resuelto se busca desde la caída hasta el final:
  // es el cierre del relato («…, pero fue solo un susto»).
  for (let j = i; j < words.length; j++) {
    for (const n of [4, 3, 2]) {
      if (j + n <= words.length && FALL_RESOLUTION_PHRASES.has(words.slice(j, j + n).join(" "))) return true;
    }
  }
  return false;
}

function fallDeclares(words: string[], folded: string): boolean {
  const immobilityPresent = IMMOBILITY_SIGNS.some((t) => folded.includes(` ${t}`));
  for (const phrase of FALL_PHRASES) {
    const pw = phrase.split(" ");
    for (let i = 0; i + pw.length <= words.length; i++) {
      if (!pw.every((w, k) => words[i + k] === w)) continue;
      if (occurrenceNegated(words, i)) continue;
      if (!immobilityPresent && fallOccurrenceNarrated(words, i, i + pw.length - 1)) continue;
      const end = i + pw.length - 1;
      // Tanda del residuo vivo: las reglas de las formas nuevas.
      if (FALL_PROGRESSIVE.has(phrase)) {
        // La meteorología tras el verbo no es un parte: esta
        // ocurrencia no declara por ninguna vía de la cara.
        if (FALL_WEATHER_AFTER.has(words[end + 1] ?? "")) continue;
        if (FALL_PROGRESSIVE_FIRST.has(phrase)) return true;
        // Abriendo el mensaje o con el pronombre sujeto pegado,
        // el progresivo ES el parte («Se está cayendo», «He is
        // falling»): está pasando ahora y no pide contexto. Con
        // sujeto nombrado manda el contexto común de abajo («el
        // precio está cayendo» no lo trae y no entra).
        if (i === 0) return true;
        if (FALL_SUBJECT_PRONOUNS.has(words[i - 1] ?? "")) return true;
      }
      if (FALL_RECENT.has(phrase) && i <= 1) {
        // La recencia a secas, con nadie o solo el «se»/el
        // pronombre delante: «Se acaba de caer», «Ele acabou de
        // cair». Con un sujeto extraño delante («el precio se
        // acaba de caer») manda el contexto común.
        return true;
      }
      if (
        phrase === "fell" &&
        words[i - 1] === "just" &&
        (i <= 1 || FALL_SUBJECT_PRONOUNS.has(words[i - 2] ?? ""))
      ) {
        // «He just fell», «She just fell»: el parte desnudo de
        // la recencia inglesa. «The price just fell» no trae el
        // pronombre y sigue pidiendo el contexto común.
        return true;
      }
      if (phrase === "me cai") return true;
      if (i === 0 && words.length <= 3) return true;
      if (immobilityPresent) return true;
      for (let j = Math.max(0, i - 3); j <= Math.min(words.length - 1, end + 3); j++) {
        const w = words[j];
        if (STEM_BODY_SIGNALS.some((s) => w === s || w === `${s}s` || w === `${s}es`)) return true;
      }
      for (let j = i; j <= Math.min(words.length - 1, end + 4); j++) {
        if (FALL_INJURY_PREFIXES.some((p) => words[j].startsWith(p))) return true;
      }
      // 0.1.112: la caída impersonal con su lugar («se cayó en el
      // baño» sin sujeto) es contexto bastante: ver FALL_PLACES_*.
      if (
        (phrase === "se cayo" || phrase === "se callo") &&
        fallPlaceFollows(words, end, ["en", "a", "dentro"], FALL_PLACES_ES)
      ) return true;
      if (phrase === "caiu" && fallPlaceFollows(words, end, ["no", "na", "em"], FALL_PLACES_PT)) return true;
      // Ampliación del lote (§1): tras «fell», un «down» opcional e
      // inmediato; con él vale también «the» + lugar («fell down
      // the stairs»), y sin él la forma de siempre («in the»).
      if (phrase === "fell") {
        const down = words[end + 1] === "down";
        const k = down ? end + 2 : end + 1;
        if (
          words[k] === "in" &&
          words[k + 1] === "the" &&
          FALL_PLACES_EN.has(words[k + 2] ?? "")
        ) return true;
        if (
          down &&
          words[k] === "the" &&
          FALL_PLACES_EN.has(words[k + 1] ?? "")
        ) return true;
      }
      // Tanda del residuo vivo: el lugar tras el progresivo y
      // tras la recencia, con las preposiciones de su orden
      // («cayendo por las escaleras», «cayendo de la silla»,
      // «caindo da escada», «acabou de cair no banheiro»,
      // «falling off the ladder», «falling in the bathroom»).
      if (
        (phrase === "se esta cayendo" || phrase === "esta cayendo" ||
          phrase === "se acaba de caer" || phrase === "acaba de caer" || phrase === "acaba de caerse") &&
        fallPlaceFollows(words, end, ["en", "a", "dentro", "por", "de"], FALL_PLACES_ES)
      ) return true;
      if (
        (phrase === "esta caindo" || phrase === "acabou de cair") &&
        fallPlaceFollows(words, end, ["no", "na", "em", "da", "de"], FALL_PLACES_PT)
      ) return true;
      if (phrase === "is falling") {
        const step = words[end + 1] === "down" || words[end + 1] === "off";
        const k = step ? end + 2 : end + 1;
        if (
          words[k] === "in" &&
          words[k + 1] === "the" &&
          FALL_PLACES_EN.has(words[k + 2] ?? "")
        ) return true;
        if (
          step &&
          words[k] === "the" &&
          FALL_PLACES_EN.has(words[k + 1] ?? "")
        ) return true;
      }
    }
  }
  return false;
}

/**
 * Marcadores de TEMA para la cara telegráfica: un fragmento que los
 * trae es un título, un pie o una pregunta de prevención, no un
 * parte — por mucho que su palabra-signo venga en participio.
 */
const TELEGRAPHIC_TOPIC_MARKERS = [
  "hazard", "peligro", "riesgo", "risco", "perigo",
  "video", "foto", "photo", "pregunta", "question",
  "historia", "titulo", "title", "libro", "book",
];

/** Formas de la palabra-signo que un parte telegráfico usa:
 *  participio, gerundio o estado (las terminaciones de las tres
 *  lenguas y las dos palabras de estado, que no terminan así). */
const TELEGRAPHIC_FORM_ENDINGS = ["ando", "endo", "indo", "ado", "ada", "ados", "adas", "ing", "ed"];
const TELEGRAPHIC_STATE_WORDS = new Set(["inconsciente", "inconscientes", "unconscious"]);

/**
 * La cara telegráfica (ADV2-07 + ADV-E1, punto 8 de la cabecera):
 * el parte dictado a secas — «atragantado», «Choking at table
 * four!» — no trae auxiliar, ni enclítico, ni víctima nombrada que
 * la ventana pueda leer, y sin embargo ES el suceso. Declara por
 * su forma, toda a la vez: mensaje sin signos de pregunta, de
 * cinco palabras o menos, con una palabra-signo en forma de
 * participio, gerundio o estado, y sin marcadores de tema. El
 * sustantivo abstracto («atragantamiento») no es forma válida: un
 * título de guía de una palabra sigue fuera. Precio nombrado: un
 * fragmento telegráfico que sea título o pie («Choking.»,
 * «Drowning.») cae hacia la emergencia, en la dirección aceptada.
 */
// Las colas de pregunta que cierran un parte («…, ¿qué hago?»):
// no son el tema del mensaje, son la petición pegada al parte, y
// la tanda de variantes midió que rompían la forma telegráfica
// entera (Familia 2d). Solo se recortan AL FINAL y solo si queda
// parte delante.
const TELEGRAPHIC_QUESTION_TAILS = [
  "que hago", "que debo hacer", "que hacemos",
  "what should i do", "what do i do", "what should we do",
  "o que eu faco", "o que faco", "que faco",
];

function stemHitIsTelegraphic(folded: string, rawHasQuestion = false): boolean {
  // 0.1.111: la interrogación se lee sobre el texto CRUDO, no
  // sobre el plegado — foldText convierte «?» y «¿» en espacios
  // y el veto, buscándolos en el plegado, nunca disparaba (la
  // auditoría lo probó: foldText("¿Qué?") no contiene «?»). El
  // casado sobre el plegado se queda como red por si un llamante
  // futuro pliega distinto.
  if (folded.includes("?") || folded.includes("¿")) return false;
  let words = folded
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, ""))
    .filter((w) => w.length > 0);
  // Tanda de variantes (Familia 2d): la cortesía que abre y la
  // pregunta que cierra no son el parte; se recortan antes de
  // contar, y la interrogación del texto crudo solo veta si no
  // era esa cola («inconsciente en la calle, ¿qué hago?» es un
  // parte con petición, no una pregunta de tema).
  if (words[0] === "por" && words[1] === "favor") words = words.slice(2);
  else if (words[0] === "please") words = words.slice(1);
  let tailStripped = false;
  for (const tail of TELEGRAPHIC_QUESTION_TAILS) {
    const tw = tail.split(" ");
    if (words.length <= tw.length) continue;
    if (tw.every((w, k) => words[words.length - tw.length + k] === w)) {
      words = words.slice(0, words.length - tw.length);
      tailStripped = true;
      break;
    }
  }
  if (rawHasQuestion && !tailStripped) return false;
  if (words.length === 0 || words.length > 5) return false;
  if (words.some((w) => TELEGRAPHIC_TOPIC_MARKERS.includes(w))) return false;
  // 0.1.111: la ventana de negación también manda aquí — el
  // estado negado («no está inconsciente, está dormido») no es
  // un parte telegráfico, como no lo es ante el signo ni la raíz.
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (!ALL_STEMS.some((s) => w.startsWith(s))) continue;
    if (!(TELEGRAPHIC_FORM_ENDINGS.some((e) => w.endsWith(e)) || TELEGRAPHIC_STATE_WORDS.has(w))) continue;
    if (occurrenceNegated(words, i)) continue;
    return true;
  }
  return false;
}

/**
 * La inmovilidad contada (espejo §4, H-LOOP-4): «no se puede
 * mover» y sus formas en las tres lenguas. NO es un signo
 * suelto de la lista de frases: la misma forma la dice una
 * puerta atrancada o un objeto que no enciende por analogía
 * de redacción, y la lista de signos declara sin contexto. Su
 * cara es la de las raíces (H-05): declara cuando el texto la
 * ata a un cuerpo — una caída narrada en el mismo texto (las
 * formas de caída de `EMERGENCY_SIGNS`, que ya declaran por sí
 * solas: esta cara es su cinturón, no su único camino) o una
 * señal de víctima o ayuda de `STEM_BODY_SIGNALS` a tres
 * palabras o menos de la frase, con la misma regla del resto
 * de ADV2-08. «Mi vecino no se puede mover» declara por
 * «vecino»; «la puerta no se puede mover», sin caída ni cuerpo
 * cerca, no — el borde honesto que la batería de la pieza fijó
 * con sus dos guardas de objeto.
 */
const IMMOBILITY_SIGNS = [
  "no se puede mover", "no puede moverse", "no se pueden mover",
  "can t move", "cannot move", "cant move",
  "nao se pode mover", "nao consegue se mover",
  // 0.1.111 (punto 11): la familia «levantar» — el caído que no se
  // levanta es la misma inmovilidad con otro verbo — y el «mover»
  // con la parte del cuerpo como objeto («no puedo mover las
  // piernas»: el contexto lo da la parte nombrada, ver
  // immobilityHasContext). Las formas de primera persona con «me»
  // no viven aquí: son signos (EMERGENCY_SIGNS), porque solo las
  // dice un cuerpo de sí mismo.
  "no se puede levantar", "no puede levantarse", "no puedo mover",
  "can t get up",
  "nao consegue se levantar", "nao se pode levantar", "nao consigo mover",
  // Tanda de variantes (Familia 3): la familia sin el «se» que el
  // dictado se come («ela caiu e não consegue levantar», «she
  // fell and cannot get up», «minha avó caiu e não levanta»): la
  // misma disciplina de contexto las ata a un cuerpo.
  "nao consegue levantar", "nao levanta", "cannot get up",
  // Tanda del residuo vivo (2026-11-25): el «levantar» con su
  // «se» en español y en portugués, que la familia traía solo en
  // las formas de poder («no se puede levantar») y en la
  // portuguesa sin «se». Sin esta forma, «ayer se cayó y no se
  // levanta» no traía inmovilidad leíble y la distancia vetaba
  // el parte contra la doctrina de la cara (la inmovilidad en
  // presente manda sobre el marcador).
  "no se levanta", "no levanta", "nao se levanta",
  // Auditoría 2026-11-25 (H-1): las colas de inmovilidad de las
  // paráfrasis de caída, en las tres lenguas. Como el resto de
  // la familia, solo declaran con su contexto (cuerpo, lugar o
  // la caída contada en el mismo texto, que FALL_TOLD_SIGNS
  // aprende en esta misma tanda): «no se puede parar» a secas
  // también lo dice un coche, y sin contexto no entra.
  "no se puede parar", "sin poder levantarse", "sin poder levantar",
  "no hay manera de que se levante", "no hay forma de que se levante",
  "can t get back up", "can t get himself up", "can t get herself up",
  "can t get myself up", "unable to get up",
  // Fase B ronda 2 (2026-11-25): «cant» sin apóstrofo, la
  // forma que el dictado deja («cant get himself up»).
  "cant get up", "cant get back up", "cant get himself up",
  "cant get herself up", "cant get myself up",
  "no way she can get up", "no way he can get up", "no way they can get up",
  "nao consegue ficar de pe", "nao consegue se erguer",
  "sem conseguir se levantar", "sem conseguir levantar",
  "nao ha jeito de ela se levantar", "nao ha jeito de ele se levantar",
];

/** Las formas de caída narrada de `EMERGENCY_SIGNS`, en las
 * tres lenguas (la lista de signos las mezcla, como ALL_SIGNS):
 * la caída contada en el mismo texto es contexto de cuerpo
 * para la inmovilidad. */
const FALL_TOLD_SIGNS = [
  "se cayo de", "se callo de", "cayo de una",
  "fell off a", "fell down the stairs", "fell from a",
  "caiu de", "caiu da escada",
  // 0.1.111: las formas a secas como CONTEXTO de la inmovilidad
  // (nunca declaran solas desde esta lista: «se cayó el precio y
  // no se puede mover» no es una frase que nadie escriba, y la
  // caída a secas tiene su propia cara con su contexto, abajo).
  "se cayo", "se callo", "me cai", "caiu", "fell",
  // Auditoría 2026-11-25 (H-1): las paráfrasis de la caída
  // contada, SOLO como contexto de la inmovilidad (desde esta
  // lista nunca declaran solas: «el precio tuvo una caída» no
  // es un parte, y su guarda vive en la batería de la tanda).
  "se fue al suelo", "tuvo una caida", "se resbalo",
  "took a tumble", "had a fall", "lying on the floor", "slipped",
  "foi ao chao", "caido no chao", "sofreu uma queda", "escorregou",
];

/**
 * Partes del cuerpo y lugares del cuerpo en el suelo que, CERCA
 * de la frase de inmovilidad, la atan a un cuerpo (0.1.111):
 * «no puedo mover las piernas» trae su contexto en el objeto, y
 * «no se puede levantar del suelo» en el lugar. Fuera los objetos
 * que se mueven o se levantan sin cuerpo («no puedo mover el
 * coche» sigue sin declarar: ni parte ni lugar en su ventana).
 */
const IMMOBILITY_BODY_PARTS = [
  "pierna", "piernas", "brazo", "brazos", "mano", "manos", "pie", "pies",
  "cuello", "espalda", "cabeza",
  "perna", "pernas", "braco", "bracos", "mao", "maos", "pes", "pescoco", "costas",
  "leg", "legs", "arm", "arms", "hand", "hands", "foot", "feet", "neck", "back",
];
// Tanda de variantes (Familia 3): el baño entra como lugar — es
// donde el parte corriente encuentra al caído que no se levanta
// («anciana caída en el baño que no se puede levantar»).
// Fase B ronda 2 (2026-11-25): «flor», la errata de dictado
// de «floor», entra como lugar de contexto —solo habilita un
// signo de inmovilidad, nunca declara por sí sola.
const IMMOBILITY_PLACES = ["suelo", "piso", "chao", "floor", "flor", "bano", "banheiro", "bathroom"];

/**
 * La familia «levantar» de `IMMOBILITY_SIGNS` (0.1.112, resto de
 * la verificación de la 0.1.111): su guarda de contexto dejaba
 * fuera el parte más desnudo de la familia, «No se puede
 * levantar» como mensaje entero, que el CHANGELOG de la 0.1.111
 * prometía sin matiz. A secas sí declara, con un borde estrecho
 * y medido: el signo ABRE el mensaje (sin sujeto delante: «El
 * embargo no se puede levantar» no entra) y detrás no trae un
 * objeto (ni artículo que lo abra — «No se puede levantar el
 * embargo» — ni un sustantivo suelto — «No se puede levantar
 * pesas»): lo que puede seguir es el fin del mensaje o una
 * continuación que no nombra cosa alguna (preposición,
 * conjunción, adverbio: «todavía», «del suelo», «sin ayuda»).
 * Con cuerpo o lugar cerca manda la cara de contexto de siempre;
 * esta es solo la red del mensaje desnudo.
 */
const LEVANTAR_SIGNS = [
  "no se puede levantar", "no puede levantarse", "can t get up",
  "nao consegue se levantar", "nao se pode levantar",
  // Tanda de variantes (Familia 3): las formas sin «se», en la
  // misma red del mensaje desnudo.
  "nao consegue levantar", "cannot get up",
];
const LEVANTAR_OBJECT_INTRODUCERS = new Set([
  "el", "la", "los", "las", "un", "una", "unos", "unas",
  "o", "a", "os", "as", "um", "uma", "the", "an", "su", "sus",
]);
const LEVANTAR_BARE_CONTINUATIONS = new Set([
  "de", "del", "en", "desde", "do", "da", "dos", "das", "from",
  "y", "e", "ni", "o", "pero", "mas", "and", "but", "or",
  "aun", "todavia", "ya", "solo", "so", "apenas", "sin", "con",
  "still", "yet", "without", "with",
]);

function immobilityBareLevantarDeclares(folded: string): boolean {
  const words = folded
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, ""))
    .filter((w) => w.length > 0);
  for (const phrase of LEVANTAR_SIGNS) {
    const pw = phrase.split(" ");
    if (words.length < pw.length) continue;
    if (!pw.every((w, k) => words[k] === w)) continue;
    const next = words[pw.length];
    if (next === undefined) return true;
    if (LEVANTAR_OBJECT_INTRODUCERS.has(next)) return false;
    if (LEVANTAR_BARE_CONTINUATIONS.has(next)) return true;
    return false;
  }
  return false;
}

function immobilityHasContext(folded: string): boolean {
  if (FALL_TOLD_SIGNS.some((t) => folded.includes(` ${t}`))) return true;
  const words = folded
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, ""))
    .filter((w) => w.length > 0);
  for (const phrase of IMMOBILITY_SIGNS) {
    const pw = phrase.split(" ");
    for (let i = 0; i + pw.length <= words.length; i++) {
      if (!pw.every((w, k) => words[i + k] === w)) continue;
      const from = Math.max(0, i - 3);
      const to = Math.min(words.length - 1, i + pw.length - 1 + 3);
      for (let j = from; j <= to; j++) {
        const w = words[j];
        if (STEM_BODY_SIGNALS.some((s) => w === s || w === `${s}s` || w === `${s}es`)) return true;
        if (IMMOBILITY_BODY_PARTS.includes(w) || IMMOBILITY_PLACES.includes(w)) return true;
      }
    }
  }
  return false;
}

/**
 * Señales de primera persona o de petición de instrucción que
 * corroboran la familia «chok» cuando es el único término que
 * casa en la puerta de salud (ver el uso en `isHealthQuestion`):
 * «how do I stop choking?» es primeros auxilios en primera
 * persona, no metáfora. Los posesivos quedan fuera (no prueban
 * cuerpo: «my teacher asked why golfers choke»).
 */
const CHOKE_FIRST_PERSON_CUES = [
  " i ", " estoy ", " estou ", " que hago ", " o que fazer ",
  " what should ", " how do i ", " how can i ",
];

/**
 * Marcos de TEMA que, abriendo el texto, lo sacan de la cara de
 * situación (0.1.111): la definición y la prevención se preguntan
 * («what is…», «¿cómo evitar…?») o se titulan («significado
 * de…»); el parte se cuenta. Solo mandan en posición de apertura:
 * el mismo marco a mitad de un parte contado no veta nada.
 */
const SITUATION_TOPIC_FRAMES = [
  "what is", "what are", "what does", "que es", "que significa",
  "o que e", "o que significa", "como evitar", "como prevenir",
  "how to prevent", "significado de", "meaning of",
  // Tanda de variantes (Familia 8): la prevención preguntada
  // con su verbo («how can I prevent…», «¿cómo puedo
  // prevenir…?»), que el censo de la ciega midió declarando
  // situación: la lista solo traía la forma de infinitivo.
  "how can i prevent", "how can we prevent", "how do i prevent",
  "como puedo prevenir", "como puedo evitar",
  "como faco para prevenir", "como faco para evitar",
  "como posso prevenir", "como posso evitar",
];

/**
 * ¿Cuenta el texto una emergencia viva en curso? Léxico puro de
 * signos: basta UN signo (el suceso ES la situación; no se exige
 * señal de pregunta) y ningún veto de contexto. La cara por raíz,
 * en cambio, exige además el contexto de cuerpo de
 * `stemOccurrenceHasBodyContext` (H-05, punto 7 de la cabecera):
 * la raíz nació para el ruido de dictado DENTRO de un suceso
 * contado, no como detector de tema. La cara de la inmovilidad
 * (espejo §4, H-LOOP-4) hereda esa misma disciplina: su frase
 * solo declara con una caída narrada o un cuerpo cerca
 * (`immobilityHasContext`). Desde la 0.1.111 (punto 11) las
 * caras de signos y de raíz miran además la negación pegada a
 * cada ocurrencia, la caída a secas tiene su cara con contexto
 * (`fallDeclares`) y los marcos de tema de
 * `SITUATION_TOPIC_FRAMES` vetan la cara entera al abrir el
 * texto. Ver la cabecera, punto 3: donde manda la puerta de
 * salud manda también esta cara, con el mismo texto seguro.
 */
// La reparación de errata leve de estas dos puertas (tanda de
// variantes, Familia 5; la ayuda vive en packFacts): el
// vocabulario sale de las listas propias de la puerta —
// términos de salud, signos, inmovilidad, caída, señales de
// cuerpo y exclusiones — para que la palabra repuesta sea
// siempre una palabra que la puerta ya conoce. Vive aquí
// abajo porque sus listas se definen a lo largo del fichero;
// las dos funciones la llaman al entrar, ya con el módulo
// entero cargado.
const GATE_ERRATA_REPAIR = buildErrataRepair([
  ...Object.values(HEALTH_TERMS).flatMap((fam) => [...fam.w, ...fam.p]),
  ...ALL_SIGNS,
  ...IMMOBILITY_SIGNS,
  ...FALL_TOLD_SIGNS,
  ...STEM_BODY_SIGNALS,
  ...IMMOBILITY_BODY_PARTS,
  ...IMMOBILITY_PLACES,
  ...HEALTH_EXCLUSIONS,
  // Compleción (F5-bis): las formas enteras que la puerta solo
  // conoce por prefijo («vomit») y el re-cobro midió rotas:
  // sin ellas, «vmitos» no tenía canónica que reponer. No son
  // términos nuevos: no casan nada por sí mismas, solo
  // alimentan la reparación.
  "vomitos", "vomite",
]);

/**
 * Auditoría 2026-11-25 (H-6): el posesivo portugués «dele»
 * es, letra a letra, la errata española de «duele» (el
 * borrado de la primera vocal), y la reparación lo
 * reescribía como dolor: «o filho dele desmaiou na semana
 * passada» ganaba el ancla viva «duele» y el veto de
 * narración se desarmaba. Las dos lecturas son reales y el
 * corpus gobernado cobra la española («me dele el pecho» es
 * «me duele» dictado), así que la protección es por
 * contexto: el posesivo portugués (dele/dela/nele…) se
 * restaura tras la reparación salvo que vaya tras un
 * pronombre de la construcción de dolor (me/le/se/te/nos),
 * donde la lectura española es la que manda.
 */
const GATE_REPAIR_POSSESSIVES = new Set(["dele", "dela", "deles", "delas", "nele", "nela", "neles", "nelas"]);
const GATE_REPAIR_PAIN_PRONOUNS = new Set(["me", "le", "se", "te", "nos"]);
function gateErrataRepair(text: string): string {
  const repaired = GATE_ERRATA_REPAIR(text);
  const orig = text.split(/(\s+)/);
  const rep = repaired.split(/(\s+)/);
  if (orig.length !== rep.length) return repaired;
  let prev = "";
  for (let i = 0; i < orig.length; i++) {
    const m = orig[i].match(/^(\P{L}*)([\p{L}]+)(\P{L}*)$/u);
    if (!m) continue;
    const core = m[2].normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    if (GATE_REPAIR_POSSESSIVES.has(core) && !GATE_REPAIR_PAIN_PRONOUNS.has(prev)) rep[i] = orig[i];
    prev = core;
  }
  return rep.join("");
}

export function isEmergencySituation(text: string): boolean {
  if (!text) return false;
  const folded = foldText(gateErrataRepair(text));
  if (folded.trim().length === 0) return false;
  // El pajar va acolchado: un veto que ABRE el mensaje («Choking
  // hazard for toddlers…», ADV2-08) también veta — sin el acolchado
  // el casado exigía un espacio delante y el tema en posición cero
  // se colaba. Es el mismo patrón de hasHistoricalFrame.
  const vetoHay = ` ${folded} `;
  if (EMERGENCY_VETOES.some((x) => vetoHay.includes(` ${x} `) || vetoHay.includes(` ${x}`))) return false;
  // Auditoría 2026-11-25 (H-4): la misma familia de suceso
  // negado veta la cara de situación («the carbon monoxide
  // alarm didn't go off; it was a detector test»).
  if (NEGATED_EVENT_FRAMES.some((x) => vetoHay.includes(` ${x}`))) return false;
  // Auditoría 2026-11-25 (H-5): el enunciado hipotético no
  // es una situación («if my grandfather fell tomorrow, I
  // would help him get up»).
  if (isHypotheticalStatement(text, folded)) return false;
  if (isHabitualFireStatement(text, folded)) return false;
  // Auditoría 2026-11-25 (H-8): la tarea de guía sin suceso
  // tampoco es una situación (el taller de salud y la
  // instalación de la alarma de CO declaraban en inglés).
  if (GUIDE_TASK_FRAMES.some((x) => vetoHay.includes(` ${x}`))) return false;
  if (hasHistoricalFrame(folded)) return false;
  // Causa E de DIAG-A (paquete de arreglos del móvil, §4.3): el
  // suceso ya resuelto, contado con su cláusula de resolución
  // («…ayer en el mercado, pero ya está bien»), no es una
  // situación viva. La cláusula ha de venir tras el conector
  // adversativo: un «ya está bien» suelto no veta nada.
  if (RESOLVED_CLAUSES.some((x) => vetoHay.includes(` ${x}`))) return false;
  // Tanda de narración (2026-11-25): el suceso contado con su
  // marcador de distancia y sin ancla viva no es una situación:
  // «ayer mi abuelo se desmayó», «ontem meu avô caiu», «last
  // week my father fainted». Las anclas vivas (progresivo,
  // inmovilidad en presente, «acaba de», síntoma en presente)
  // mandan sobre el marcador: «ayer se cayó y ahora no se puede
  // mover» sigue declarando. Ver isNarratedGateEvent.
  if (isNarratedGateEvent(folded)) return false;
  const trimmed = folded.trim();
  // 0.1.111 (punto 11): el marco de definición o de prevención
  // ABRIENDO el texto es un tema, no un parte («What is
  // choking?», «¿Cómo evitar que un niño se ahogue en la
  // piscina?», «Significado de atragantamiento»): esta cara no
  // declara y responde la puerta de salud. El parte con la
  // petición detrás («Sale humo por la ventana, ¿qué hago?») no
  // abre con estos marcos y sigue declarando.
  // Tanda de variantes (Familia 8): el arranque se lee tras la
  // cortesía — «por favor, ¿cómo evitar…?» y «please, how can
  // I prevent…?» rompían el marco por su primera palabra, en
  // los tres idiomas, y el tema declaraba por otra cara.
  const topicText = trimmed.replace(/^(por favor|please)\s+/, "");
  if (SITUATION_TOPIC_FRAMES.some((f) => topicText.startsWith(f))) return false;
  const words = trimmed.split(/\s+/).filter((w) => w.length > 0);
  return (
    signDeclares(words) ||
    stemDeclares(words) ||
    (IMMOBILITY_SIGNS.some((t) => folded.includes(` ${t}`)) && immobilityHasContext(folded)) ||
    immobilityBareLevantarDeclares(folded) ||
    fallDeclares(words, folded) ||
    stemHitIsTelegraphic(folded, /[?¿]/.test(text))
  );
}

// -------------------------------------- la puerta manda sobre Investigar

/**
 * ¿Debe este turno ir por la ruta protegida aunque el modo
 * Investigación profunda esté activo? (R-07, ronda física de la
 * 0.1.68: con Investigar activo, send() entraba en el pipeline de
 * investigación ANTES de que ninguna puerta mirara el texto, y una
 * emergencia dictada — que `isEmergencyText` sí reconocía — salía
 * como tema de investigación, en inglés y sobre otro tema.) La
 * decisión nació como la unión de las dos caras que la ruta normal
 * ya consulta: la de emergencia (`isEmergencyText`, que incluye la
 * situación viva contada) y la de salud (`isHealthQuestion`). Es la
 * función que ChatScreen consulta antes de la bifurcación profunda
 * y la que el propio pipeline vuelve a consultar tras descomponer:
 * una sola definición para que las dos redes no diverjan. Desde
 * Núcleo 3 la unión excluye la clase de pregunta de número de
 * emergencias (ver el cuerpo): preguntar POR el número no es un
 * suceso y no abandona la investigación.
 */
export function gatePreemptsDeepResearch(text: string, lang: GateLang): boolean {
  if (!text || text.trim().length === 0) return false;
  // Núcleo 3 (hallazgo vecino de la preparación S-02): la pregunta
  // SOBRE el número de emergencias no es una emergencia. Hasta hoy
  // la unión heredaba de isEmergencyText la clase de pregunta de
  // número de los packs y la tabla fija de números, así que
  // «¿cuál es el número de emergencias en México?» abandonaba la
  // investigación profunda como si fuera un suceso vivo y perdía
  // la respuesta de conocimiento. La preempción queda en lo que sí
  // es suceso o riesgo: la situación viva contada, la pregunta de
  // crisis, la de salud (la fixture congelada de H-04 entra por
  // esta cara y no se mueve) y la tabla de seguridad en sus clases
  // de monóxido — la clase «emergency-number» ya no preempta por
  // sí sola. isEmergencyText NO cambia: su papel en la pantalla
  // (ofrecer enviar ya el mensaje de emergencia mientras se genera)
  // es otro y sigue igual.
  const safety = matchSafetyAnswer(text, lang);
  return (
    isHealthQuestion(text) ||
    crisisQuestionKind(text) ||
    isEmergencySituation(text) ||
    (safety !== null && safety.kind !== "emergency-number")
  );
}

// ------------------------------------------------------- texto seguro

/**
 * El texto seguro fijo, en las tres lenguas con la MISMA estructura
 * (la paridad se cuenta en las pruebas): honestidad, signos de
 * urgencia, seis pasos en orden, lo que no hay que hacer, la regla
 * de las dosis y el cierre del pack. Cada afirmación se traza a las
 * guías del pack Esencial (knowledge-packs/nido-esencial), cuyo
 * contenido está verificado contra sus fuentes oficiales:
 *
 * - Llamar, nombrar a una persona concreta, decir dónde y qué pasa,
 *   no colgar hasta que lo digan; de lado si no responde pero
 *   respira, vigilando: guías 01 y 11.
 * - RCP en el centro del pecho, fuerte y rápido (el ritmo, en
 *   palabras por la regla de no escribir números largos): guía 02.
 * - Sangrado: presión directa y no retirar el paño empapado: guía 06.
 * - Atragantamiento: tose fuerte → animar, sin golpes ni agua;
 *   grave → 5 golpes en la espalda y 5 abdominales; bebé → 5 y 5
 *   en el pecho, nunca abdominales: guía 05.
 * - Quemadura: agua corriente fresca al menos 10 minutos: guía 08.
 * - Signos de urgencia (cuándo llamar): guía 29.
 * - No dar comida ni bebida a quien no traga bien (01), no provocar
 *   el vómito ni dar leche o aceite a quien tragó un tóxico (21),
 *   no mover a quien cayó de altura o puede tener el cuello o la
 *   espalda lesionados salvo peligro (01 y 10), no sacar objetos
 *   clavados (06).
 * - Dosis: la del prospecto según edad y peso; aspirina no antes
 *   de los 16 años: guía 25.
 *
 * Fuera a propósito, y consta aquí: la aspirina en el dolor de
 * pecho (guía 14) lleva cuatro condiciones que un texto genérico
 * no puede comprobar, y el torniquete (guía 06) cede su sitio a la
 * presión, que es el gesto universal. Son contenido de la guía con
 * el pack instalado, no de este suelo sin pack.
 */
const HEALTH_SAFE_TEXT: Record<GateLang, string> = {
  es:
    "Esto es una pregunta de salud y en este teléfono no hay ninguna guía verificada de NIDO que la responda, " +
    "así que no voy a contestar de memoria: un consejo de salud inventado puede hacer daño.\n\n" +
    "Es urgencia si la persona no responde o está muy confusa o somnolienta, le cuesta mucho respirar, tiene " +
    "dolor o presión fuerte en el pecho, la cara torcida, un brazo débil o el habla rara, un sangrado que no " +
    "para, convulsiones, o un dolor de cabeza repentino y fortísimo.\n\n" +
    "Si es una urgencia, actúa en este orden:\n" +
    "1. Si puedes, llama ahora mismo al número de emergencias de donde estás; si no puedes, grita a una " +
    "persona concreta que llame. Di dónde estás y qué pasa, y no cuelgues hasta que te lo digan.\n" +
    "2. Si la persona no responde pero respira con normalidad, ponla de lado y comprueba sin parar que sigue " +
    "respirando.\n" +
    "3. Si no responde y no respira con normalidad, túmbala boca arriba en el suelo y empuja fuerte y rápido " +
    "en el centro del pecho, de cien a ciento veinte veces por minuto, dejando que el pecho suba del todo, " +
    "sin parar hasta que respire o llegue la ayuda.\n" +
    "4. Si sangra mucho, aprieta la herida con un paño limpio y no lo retires aunque se empape: pon otro " +
    "encima y sigue apretando.\n" +
    "5. Si se está atragantando y tose con fuerza, anímala a seguir tosiendo, sin golpes ni agua. Si no puede " +
    "hablar ni toser con fuerza, inclínala hacia delante: 5 golpes secos entre los omóplatos y 5 compresiones " +
    "en el abdomen, alternando. En un bebé: 5 golpes en la espalda y 5 compresiones en el pecho, nunca en el " +
    "abdomen.\n" +
    "6. Si hay una quemadura, enfríala con agua corriente fresca durante al menos 10 minutos.\n\n" +
    "No hagas esto: no des comida ni bebida a una persona inconsciente, mareada o que traga mal; no provoques " +
    "el vómito a quien haya tragado algo tóxico, ni le des leche o aceite; no muevas a quien haya caído de " +
    "una altura o pueda tener lesionados el cuello o la espalda, salvo que donde está corra peligro; no " +
    "saques un objeto clavado en una herida.\n\n" +
    "Si tu pregunta es por una dosis: la dosis depende de la edad y del peso, y está en el prospecto del " +
    "medicamento; síguelo tal cual, no improvises otra, y no des aspirina a menores de 16 años.\n\n" +
    "Las guías oficiales de primeros auxilios de NIDO Esencial se guardan en el teléfono al descargar el pack " +
    "en Biblioteca › Packs: con él, estas preguntas se responden con la guía delante, sin conexión.",
  en:
    "This is a health question and this phone holds no verified NIDO guide that answers it, so I will not " +
    "answer from memory: made-up health advice can do harm.\n\n" +
    "It is an emergency if the person does not respond or is very confused or drowsy, is struggling to " +
    "breathe, has strong chest pain or pressure, a drooping face, a weak arm or slurred speech, bleeding " +
    "that will not stop, seizures, or a sudden, worst-ever headache.\n\n" +
    "If it is an emergency, act in this order:\n" +
    "1. If you can, call your emergency number right now for wherever you are; if you cannot, shout at one " +
    "specific person to call. Say where you are and what is happening, and do not hang up until they tell " +
    "you to.\n" +
    "2. If the person does not respond but is breathing normally, roll them onto their side and keep " +
    "checking that they are still breathing.\n" +
    "3. If they do not respond and are not breathing normally, lay them on their back on the floor and push " +
    "hard and fast in the center of the chest, one hundred to one hundred and twenty times a minute, letting " +
    "the chest come fully back up, without stopping until they breathe or help arrives.\n" +
    "4. If they are bleeding heavily, press on the wound with a clean cloth and do not lift it off even if " +
    "it soaks through: put another cloth on top and keep pressing.\n" +
    "5. If they are choking and coughing hard, encourage them to keep coughing, with no blows and no water. " +
    "If they cannot speak or cough with force, lean them forward: 5 sharp blows between the shoulder blades " +
    "and 5 thrusts on the abdomen, alternating. For a baby: 5 blows on the back and 5 thrusts on the chest, " +
    "never on the abdomen.\n" +
    "6. If there is a burn, cool it under cool running water for at least 10 minutes.\n\n" +
    "Do not do these things: do not give food or drink to someone unconscious, dizzy or swallowing badly; " +
    "do not make someone who swallowed something toxic vomit, and do not give them milk or oil; do not move " +
    "someone who has fallen from a height or may have injured their neck or back, unless where they are is " +
    "dangerous; do not pull out an object stuck in a wound.\n\n" +
    "If your question is about a dose: the dose depends on age and weight, and it is printed in the " +
    "medicine's leaflet; follow it exactly, do not improvise another, and do not give aspirin to anyone " +
    "under 16.\n\n" +
    "The official first-aid guides of NIDO Essentials live on the phone once you download the pack in " +
    "Library › Packs: with it, these questions are answered with the guide in front, no connection needed.",
  pt:
    "Isto é uma pergunta de saúde e neste telefone não há nenhum guia verificado do NIDO que a responda, " +
    "por isso não vou responder de memória: um conselho de saúde inventado pode fazer mal.\n\n" +
    "É urgência se a pessoa não responde ou está muito confusa ou sonolenta, tem muita dificuldade para " +
    "respirar, tem dor ou pressão forte no peito, a cara torta, um braço fraco ou a fala estranha, um " +
    "sangramento que não para, convulsões, ou uma dor de cabeça súbita e fortíssima.\n\n" +
    "Se for uma urgência, aja nesta ordem:\n" +
    "1. Se puder, ligue agora mesmo para o número de emergência de onde está; se não puder, grite a uma " +
    "pessoa concreta que ligue. Diga onde está e o que se passa, e não desligue até lhe dizerem.\n" +
    "2. Se a pessoa não responde mas respira normalmente, vire-a de lado e verifique sem parar se continua " +
    "a respirar.\n" +
    "3. Se não responde e não respira normalmente, deite-a de costas no chão e empurre com força e depressa " +
    "no centro do peito, de cem a cento e vinte vezes por minuto, deixando o peito voltar a subir por " +
    "completo, sem parar até ela respirar ou a ajuda chegar.\n" +
    "4. Se sangra muito, aperte a ferida com um pano limpo e não o retire mesmo que encharque: ponha outro " +
    "por cima e continue a apertar.\n" +
    "5. Se está a engasgar e tosse com força, incentive-a a continuar a tossir, sem pancadas nem água. Se " +
    "não consegue falar nem tossir com força, incline-a para a frente: 5 pancadas secas entre as omoplatas " +
    "e 5 compressões no abdómen, alternando. Num bebé: 5 pancadas nas costas e 5 compressões no peito, " +
    "nunca no abdómen.\n" +
    "6. Se houver uma queimadura, arrefeça-a com água corrente fresca durante pelo menos 10 minutos.\n\n" +
    "Não faça isto: não dê comida nem bebida a uma pessoa inconsciente, tonta ou que engole mal; não " +
    "provoque o vómito a quem engoliu algo tóxico, nem lhe dê leite ou óleo; não mova quem caiu de uma " +
    "altura ou pode ter lesionado o pescoço ou as costas, salvo se onde está corre perigo; não retire um " +
    "objeto espetado numa ferida.\n\n" +
    "Se a sua pergunta é por uma dose: a dose depende da idade e do peso, e está na bula do medicamento; " +
    "siga-a tal qual, não improvise outra, e não dê aspirina a menores de 16 anos.\n\n" +
    "Os guias oficiais de primeiros socorros do NIDO Essencial ficam guardados no telefone ao baixar o " +
    "pacote em Biblioteca › Pacotes: com ele, estas perguntas são respondidas com o guia à frente, sem conexão.",
};

/** El texto seguro fijo al que cae la pregunta de salud sin guía. */
export function healthSafeText(lang: GateLang): string {
  return HEALTH_SAFE_TEXT[lang];
}

/** La procedencia del texto seguro: texto fijo de NIDO, frase a frase. */
export function healthSafeProvenance(text: string): SentenceProvenance[] {
  return allFrom(text, { kind: "fixed" }, splitSentences);
}

// ------------------------------------------------- evidencia de salud

/** Los packs cuyas guías son de salud con fuentes verificadas (ver cabecera). */
const HEALTH_PACK_IDS = new Set(["nido-esencial", "nido-ninos", "nido-crisis"]);

/**
 * ¿Trae la recuperación algún pasaje de un pack de salud? Hasta la
 * 0.1.86 solo contaban los integrados de la lista cerrada de arriba:
 * un fragmento de un pack IMPORTADO por la puerta firmada — cuya
 * firma se verificó al entrar, la misma vara de confianza que la de
 * los integrados — nunca era evidencia, y la sustitución por el
 * texto seguro quedaba desarmada justo en el turno que el pack
 * importado debía responder (el giro del gas, dirimen 2026-11-09).
 *
 * 0.1.87: el llamador puede pasar los ids que el registro de la
 * puerta verificó (verifiedImportedPacks en services/packImporter,
 * leído fresco en cada turno — un pack retirado deja de contar al
 * momento). Esta capa sigue pura: el registro vive tras
 * expo-file-system y no entra aquí; sin el conjunto, el
 * comportamiento es exactamente el de siempre.
 */
/**
 * ¿Cuenta este fragmento como evidencia de salud de la puerta? La
 * misma vara que hasHealthEvidence aplica fragmento a fragmento:
 * un pack integrado de la lista, o un pack que el registro de la
 * puerta firmada verificó (el llamador pasa el conjunto).
 */
function isHealthEvidenceChunk(c: RetrievedChunk, verifiedImportedPackIds?: ReadonlySet<string>): boolean {
  const ref = parsePackChunkId(c.chunkId);
  if (!ref) return false;
  if (HEALTH_PACK_IDS.has(ref.packId.replace(/-e5$/, ""))) return true;
  return !!verifiedImportedPackIds && verifiedImportedPackIds.has(ref.packId);
}

export interface SafeTextSubstitutionInput {
  /** El turno es de investigación profunda: la puerta no actúa. */
  deepTurn: boolean;
  /** Las fuentes del turno, en su orden (la procedencia cita por índice). */
  sources: readonly RetrievedChunk[];
  /** El veredicto del juez de fundamentación sobre la respuesta. */
  grounding: string | undefined;
  /** La pregunta es de salud (isHealthQuestion). */
  isHealth: boolean;
  /** La pregunta cuenta una emergencia viva (isEmergencySituation). */
  isEmergency: boolean;
  /** La procedencia por frase de la respuesta juzgada. */
  provenance: readonly SentenceProvenance[] | undefined;
  /** Ids de packs importados que el registro verificó en este turno. */
  verifiedImportedPackIds?: ReadonlySet<string>;
}

/**
 * 0.1.88 (dirimen del gas en la 0.1.87): la decisión de sustituir la
 * respuesta del modelo por el texto seguro, extraída de ChatScreen
 * a función pura para poder probarla con los valores del campo.
 *
 * Hasta la 0.1.87 la condición (en ChatScreen) sustituía cuando el
 * veredicto era «unverified» o «abstained» y NINGUNA fuente era
 * evidencia de salud. El hueco medido: la condición miraba las
 * fuentes, no el apoyo de la respuesta. Con la guía del pack
 * verificado entre las fuentes (hasHealthEvidence verdadero), un
 * texto del modelo que el juez NO pudo verificar quedaba en
 * pantalla en plena emergencia viva, apoyado en nada: justo el
 * turno de la foto, donde la guía estaba en el aparato y entre las
 * fuentes pero no se había servido. La vara pasa a ser el apoyo
 * real: se sustituye cuando ninguna frase con procedencia de fuente
 * se apoya en un fragmento que es evidencia de salud.
 *
 * Lo que NO cambia, por doctrina: los veredictos «grounded» y
 * «partial» nunca se sustituyen por esta puerta. Sus frases
 * quedaron verificadas una a una contra sus fuentes por el juez, y
 * si la fuente es una guía de salud verificada, el apoyo es real
 * aunque sea otra guía de la misma familia; el fallo de la foto se
 * cura donde nació, en la elección de la guía, no reescribiendo lo
 * que el juez ya verificó.
 */
/**
 * 0.1.90 (familia 4): qué pasa con un turno SIN fuentes, extraído de
 * ChatScreen a función pura con el patrón de shouldSubstituteSafeText.
 *
 * La ley del dueño (2026-11-09): una pregunta que una guía del
 * dispositivo responde no llega al modelo; una pregunta que NINGUNA
 * guía cubre la genera el modelo activo; la abstención determinista
 * queda SOLO donde inventar sería peligroso — salud y emergencia sin
 * evidencia. Hasta la 0.1.89 la puerta previa de la ruta fija y el
 * post-chequeo sustituían también toda «pregunta de hechos» sin
 * fuentes por el «no lo sé» determinista (RAG-GROUNDING 2026-10-11,
 * Fase 3): con el Qwen3 activo, «Explícame cómo cambiar una llanta en
 * 5 pasos numerados» recibió la abstención sin generar (foto del dueño
 * 15:43 MST). Esa rama muere: sin fuentes y sin peligro, el turno
 * genera y el texto del modelo queda en pie; la banda «No se
 * encontraron fuentes offline relevantes» sigue pintándose como
 * metadato honesto, y la instrucción de sistema sin fuentes (decir
 * que no se sabe cuando no se puede responder con fiabilidad) sigue
 * en el prompt, como estaba.
 */
export type NoSourcesOutcome = "safe-text" | "generate";

export function noSourcesOutcome(input: {
  isHealth: boolean;
  isEmergency: boolean;
}): NoSourcesOutcome {
  return input.isHealth || input.isEmergency ? "safe-text" : "generate";
}

export function shouldSubstituteSafeText(input: SafeTextSubstitutionInput): boolean {
  if (input.deepTurn || input.sources.length === 0) return false;
  if (!input.isHealth && !input.isEmergency) return false;
  if (input.grounding !== "unverified" && input.grounding !== "abstained") return false;
  const restsOnEvidence = (input.provenance ?? []).some((s) => {
    if (s.origin.kind !== "source") return false;
    const src = input.sources[s.origin.n - 1];
    return !!src && isHealthEvidenceChunk(src, input.verifiedImportedPackIds);
  });
  return !restsOnEvidence;
}

export function hasHealthEvidence(
  chunks: readonly RetrievedChunk[],
  verifiedImportedPackIds?: ReadonlySet<string>,
): boolean {
  return chunks.some((c) => isHealthEvidenceChunk(c, verifiedImportedPackIds));
}
