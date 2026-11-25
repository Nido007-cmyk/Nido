/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { buildErrataRepair, isNarratedEventText } from "../../rag/packFacts";

/**
 * safetyAnswers.ts — 0.1.55: respuestas FIJAS para preguntas donde un error
 * de la IA puede matar. El modelo no las contesta: un modelo pequeño puede
 * decir «sí, con ventilación» a un generador en el garaje.
 *
 * La idea (no dejar que el modelo conteste estas preguntas) la vimos en
 * BOAR; las reglas, los textos y el código son de NIDO, comprobados contra
 * las fuentes oficiales que cita cada respuesta (consultadas el 2026-10-27):
 *
 *  - Monóxido de carbono: CPSC de EE. UU., «What to Know About Generators»
 *    (https://www.cpsc.gov/s3fs-public/468_WhattoKnowGenerators_2022_v5.pdf)
 *    y CDC, «Avoiding Carbon Monoxide Poisoning»
 *    (https://www.cdc.gov/natural-disasters/psa-toolkit/avoiding-carbon-monoxide-poisoning.html).
 *  - Números de emergencia: la fuente de cada país va en EMERGENCY_NUMBERS.
 *
 * Disciplina (como cannedResponses): ante la duda, NO se responde aquí y la
 * pregunta sigue su camino normal. Cada acierto va marcado
 * `deterministic: true` y nunca se presenta como texto del modelo.
 *
 * Puro, sin dependencias, probado en safetyAnswers.test.ts.
 */

export type SafetyLang = "es" | "en" | "pt";
export type SafetyKind = "co-hazard" | "co-symptoms" | "emergency-number" | "self-harm";

export interface SafetyHit {
  kind: SafetyKind;
  lang: SafetyLang;
  text: string;
  /** País respondido (solo emergency-number con país conocido). */
  country?: string;
  /**
   * 0.1.57: emergency-number sin país de la tabla. `asked`: nombró un país que
   * no está (no se adivina); si no, se pregunta cuál. La pantalla puede
   * rehacer el texto con la lista de países de los packs instalados
   * (unknownCountryText), que es más larga que la de esta tabla.
   */
  countryUnknown?: { asked: boolean };
  deterministic: true;
}

/** Quita tildes y pasa a minúsculas: las reglas se escriben sin tildes. */
function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/* ------------------------------------------------------------------ */
/* Monóxido de carbono                                                 */
/* ------------------------------------------------------------------ */

// Aparatos que queman gasolina, propano o carbón (la regla de la CDC) y motores.
const CO_DEVICE_RE =
  /\b(generador(es)?|planta (electrica|de luz|de energia)|asador|barbacoa|brasero|anafre|carbon (encendido|prendido)|brasas|parrilla (de carbon|de gas|portatil)|hornillo de (camping|gas)|estufa de (camping|campamento|queroseno|keroseno|kerosene|parafina)|calentador de (propano|queroseno|keroseno)|motor|moto(cicleta)?|carro|coche|auto(movil)?|generator|grill|barbecue|bbq|charcoal|camp(ing)? stove|propane heater|kerosene heater|engine|car|truck|gerador|churrasqueira|fogareiro|braseiro|carvao aceso)\b/;

// Dentro de casa o en un espacio cerrado.
const CO_INDOOR_RE =
  /\b(dentro|adentro|en (la |mi )?casa|garaje|garage|cochera|sotano|porche|cuarto|habitacion|dormitorio|recamara|sala|tienda de campana|casa de campana|carpa|caravana|cerrad[oa]|inside|indoors?|in (the|my) (house|home|garage|basement|tent|room|bedroom|camper|rv)|basement|crawl ?space|shed|tent|camper|enclosed|porch|em casa|garagem|porao|barraca|quarto|fechad[oa]|varanda)\b/;

const CO_WORD_RE = /\b(monoxido|carbon monoxide)\b/;

// 0.1.60: aparatos que se usan DENTRO a propósito (caldera, calentador o
// estufa de gas, chimenea) pero que, si fallan, producen monóxido. Solo
// cuentan junto con síntomas: sin síntomas, «¿puedo usar la caldera en el
// sótano?» no es un peligro y no debe recibir «Nunca lo uses dentro».
// Por eso NO están en CO_DEVICE_RE (que también dispara ese aviso).
const CO_SYMPTOM_ONLY_DEVICE_RE =
  /\b(calentador(es)? (de|a) gas|calentador de agua|estufa(s)? (de|a) gas|calefactor(es)? (de|a) gas|caldera|calefon|chimenea|gas (heater|fire|fireplace|stove|furnace)|space heater|water heater|furnace|boiler|fireplace|aquecedor(es)? (de|a) gas|aquecedor de agua|caldeira|lareira|fogao a gas)\b/;

// El «co» a secas como palabra de la puerta, solo en su marco de
// alarma o detector (tanda de variantes, Familia 4): «the co
// alarm is beeping» no trae «carbon monoxide» entero y la puerta
// no lo veía. Fuera del marco, «co» suelto no es esta puerta.
const CO_FRAME_RE = /\b(?:co (?:alarm|alarma|alarme|detector)|(?:alarma|alarme|detector) de (?:co|monoxido))\b/;

// Síntomas o alarma: entonces no es una pregunta de planificación.
// Tanda de variantes (Familia 4): la alarma contada entera, con
// «de carbono» detrás y con el verbo delante («suena la
// alarma…»), y el detector en su forma corriente
// (pitando/apitando/beeping) — con la preposición obligada: el
// detector de humo no es esta puerta.
const CO_SYMPTOM_RE =
  /\b(?:(?:me|nos|le|les|te) duele(?:n)? la cabeza|dolor de cabeza|marea|nausea|vomit|confus|debil|desmay|alarma (?:de co |de monoxido (?:de carbono )?)?(?:sono|suena|esta sonando)|(?:suena|sono) la alarma de (?:co|monoxido)|detector de (?:co|monoxido(?: de carbono)?) (?:esta )?(?:pitando|sonando|apitando|tocando)|headache|dizz|nause|confused|weak|faint|alarm (?:is )?(?:going off|beeping|sounding)|(?:carbon monoxide|co) detector (?:is )?(?:beeping|sounding|going off)|dor de cabeca|tont|enjo|fraqueza|desmai|alarme (?:de monoxido (?:de carbono )?)?(?:esta )?(?:tocando|disparou))/;

const CO_TEXT: Record<SafetyLang, string> = {
  es:
    "No. Nunca uses un generador, una parrilla, un brasero, un hornillo ni ningún aparato que queme gasolina, gas propano o carbón dentro de casa, en el garaje, el sótano, el porche o una tienda de campaña, aunque abras puertas y ventanas. El monóxido de carbono no se ve ni se huele y puede ser mortal.\n\n" +
    "- El generador, siempre fuera y a más de 6 metros (20 pies) de la casa, con el escape apuntando lejos de puertas, ventanas y respiraderos.\n" +
    "- Pon alarmas de monóxido de carbono con pilas cerca de los dormitorios y en cada planta.\n" +
    "- Si suena la alarma o alguien tiene dolor de cabeza, mareo, debilidad, náuseas o confusión: salgan al aire libre ya y llamen a emergencias.\n\n" +
    "Fuentes: CPSC y CDC de EE. UU.",
  en:
    "No. Never use a generator, grill, camp stove or anything that burns gasoline, propane or charcoal inside your home, garage, basement, porch or a tent, even with doors and windows open. Carbon monoxide can't be seen or smelled and can kill.\n\n" +
    "- Keep the generator outdoors, at least 20 feet (6 meters) from the house, with the exhaust pointed away from doors, windows and vents.\n" +
    "- Install battery-operated carbon monoxide alarms near bedrooms and on every floor.\n" +
    "- If the alarm sounds or someone has a headache, dizziness, weakness, nausea or confusion: get outside right away and call emergency services.\n\n" +
    "Sources: US CPSC and CDC.",
  pt:
    "Não. Nunca use gerador, churrasqueira, fogareiro ou qualquer aparelho que queime gasolina, gás propano ou carvão dentro de casa, na garagem, no porão, na varanda ou numa barraca, mesmo com portas e janelas abertas. O monóxido de carbono não se vê nem tem cheiro e pode matar.\n\n" +
    "- O gerador fica sempre do lado de fora, a mais de 6 metros (20 pés) da casa, com o escapamento virado para longe de portas, janelas e respiros.\n" +
    "- Instale alarmes de monóxido de carbono a pilha perto dos quartos e em cada andar.\n" +
    "- Se o alarme tocar ou alguém tiver dor de cabeça, tontura, fraqueza, náusea ou confusão: saiam para o ar livre já e liguem para a emergência.\n\n" +
    "Fontes: CPSC e CDC dos EUA.",
};

const CO_SYMPTOM_TEXT: Record<SafetyLang, string> = {
  es:
    "Puede ser monóxido de carbono. Salgan todos al aire libre ahora mismo, sin quedarse a ventilar, y llamen a emergencias desde fuera. No vuelvan a entrar hasta que los bomberos o los servicios de emergencia digan que es seguro.\n\n" +
    "Fuentes: CPSC y CDC de EE. UU.",
  en:
    "This may be carbon monoxide. Everyone get outside right now, don't stay to air the place out, and call emergency services from outside. Don't go back in until the fire department or emergency services say it's safe.\n\n" +
    "Sources: US CPSC and CDC.",
  pt:
    "Pode ser monóxido de carbono. Saiam todos para o ar livre agora mesmo, sem ficar para ventilar, e liguem para a emergência do lado de fora. Não voltem a entrar até os bombeiros ou o serviço de emergência dizerem que é seguro.\n\n" +
    "Fontes: CPSC e CDC dos EUA.",
};

/* ------------------------------------------------------------------ */
/* Números de emergencia                                               */
/* ------------------------------------------------------------------ */

interface EmergencyEntry {
  /** Nombres del país (sin tildes, en minúsculas) que lo identifican. */
  names: string[];
  /** Nombre del país; en portugués, con su preposición («no Brasil»). */
  label: Record<SafetyLang, string>;
  /** Varios números (uno por servicio). */
  plural?: boolean;
  numbers: Record<SafetyLang, string>;
  /** Fuente oficial consultada (2026-10-27). */
  source: string;
}

/**
 * Solo países comprobados en una fuente oficial. Un número que no está aquí
 * NO se inventa: se dice que no está comprobado.
 */
export const EMERGENCY_NUMBERS: readonly EmergencyEntry[] = [
  {
    // Sin «usa» ni «eua» sueltos: «el número de emergencias que se usa aquí»
    // no es una pregunta sobre Estados Unidos (auditoría 0.1.55).
    names: ["estados unidos", "eeuu", "ee uu", "united states", "the us", "the usa", "estados unidos da america"],
    label: { es: "Estados Unidos", en: "the United States", pt: "nos Estados Unidos" },
    numbers: { es: "911", en: "911", pt: "911" },
    source: "CPSC de EE. UU., «What to Know About Generators» (2022)",
  },
  {
    names: ["puerto rico"],
    label: { es: "Puerto Rico", en: "Puerto Rico", pt: "em Porto Rico" },
    numbers: { es: "9-1-1", en: "9-1-1", pt: "9-1-1" },
    source: "Junta de Gobierno del Servicio 9-1-1 de Puerto Rico, informe anual",
  },
  {
    names: ["mexico", "méxico"],
    label: { es: "México", en: "Mexico", pt: "no México" },
    numbers: { es: "911", en: "911", pt: "911" },
    source: "Embajada de España en México: «911, único para todo el territorio de México»",
  },
  {
    names: ["republica dominicana", "dominicana", "dominican republic", "santo domingo"],
    label: { es: "República Dominicana", en: "the Dominican Republic", pt: "na República Dominicana" },
    numbers: { es: "9-1-1", en: "9-1-1", pt: "9-1-1" },
    source: "Decreto 187-14 del Sistema Nacional 9-1-1 (Indotel)",
  },
  {
    names: ["cuba", "la habana", "havana"],
    label: { es: "Cuba", en: "Cuba", pt: "em Cuba" },
    plural: true,
    numbers: {
      es: "104 ambulancia, 105 bomberos y 106 policía (desde un móvil, el Consulado de España indica marcar un 7 delante)",
      en: "104 ambulance, 105 fire and 106 police (from a mobile phone, the Spanish Consulate says to dial a 7 first)",
      pt: "104 ambulância, 105 bombeiros e 106 polícia (de um celular, o Consulado da Espanha indica discar um 7 antes)",
    },
    source: "Consulado General de España en La Habana",
  },
  {
    names: ["espana", "spain", "espanha"],
    label: { es: "España", en: "Spain", pt: "na Espanha" },
    numbers: {
      es: "112, gratis desde fijos y móviles, también con el móvil bloqueado",
      en: "112, free from landlines and mobiles, even with the phone locked",
      pt: "112, gratuito de fixos e celulares, mesmo com o celular bloqueado",
    },
    source: "administracion.gob.es, «Números de urgencia»",
  },
  {
    names: ["portugal"],
    label: { es: "Portugal", en: "Portugal", pt: "em Portugal" },
    numbers: {
      es: "112, gratis y las 24 horas",
      en: "112, free and 24 hours a day",
      pt: "112, gratuito e 24 horas",
    },
    source: "gov.pt, «Contactos de emergência em Portugal»",
  },
  {
    names: ["brasil", "brazil"],
    label: { es: "Brasil", en: "Brazil", pt: "no Brasil" },
    plural: true,
    numbers: {
      es: "190 policía, 192 SAMU (ambulancia) y 193 bomberos",
      en: "190 police, 192 SAMU (ambulance) and 193 fire department",
      pt: "190 polícia, 192 SAMU e 193 bombeiros",
    },
    source: "Governo do Paraná, «193: em quais ocorrências…»",
  },
];

// 2026-10-30 (prueba física): la pregunta del dueño venía mezclada —
// «Numero de emergency in Japan?» — y no casaba con ninguna rama: la
// española exigía la palabra española y la inglesa la frase inglesa
// entera. Entran las mezclas razonables: sustantivo de pregunta en
// español o portugués con «emergency» en inglés. La forma sigue siendo
// la de siempre (número/teléfono de emergencia delante): «emergency»
// suelto en otra frase («my emergency contact») no entra.
// 0.1.99 T-01 (m-09, auditoría 2026-11-14): la alternativa de
// «llamo/marco» exigía la «a» delante y la forma corriente, sin
// ella, caía al modelo («¿Qué número llamo en España?», sonda
// P-17a). La «a» es opcional. Y la gemela portuguesa pedía el
// infinitivo «ligar» donde la gente escribe el conjugado «ligo»
// («que número ligo no Brasil» tampoco disparaba).
// 0.1.99 T-27 (H-Z4-2, re-auditoría zona 4): la rama portuguesa
// seguía exigiendo la adyacencia desnuda, sin el artículo «o» ni
// el relativo «que», que es la forma corriente de preguntarlo en
// portugués («qual o número que ligo em Portugal?» devolvía
// null). La rama admite el artículo y el relativo con su «eu»
// opcional; la puerta no se abre: sigue exigiendo «número» y el
// verbo de marcar pegados a la pregunta. La hermana española
// tenía el mismo hueco con el relativo («¿cuál es el número que
// llamo en España?» también devolvía null, medido en la tanda):
// admite la misma estructura («es el» y el relativo), misma
// clase m-09, misma regex.
// 0.1.99 T-31 (H-Z4-2-R1, repetición de Z-01): la rama portuguesa
// se quedó sin la forma con «é» («qual é o número que ligo em
// Portugal?» devolvía null), que es la gemela exacta de la «es
// el» española que T-27 sí admitió: entra el «é» (plegado, «e»).
// Con la medición delante (las cuatro formas daban null), entran
// también el relativo con modal («que devo ligar», «que eu devo
// ligar») y el «para ligar»; y por la simetría que T-27 declaró,
// las gemelas españolas medidas en el mismo null («¿cuál es el
// número que debo llamar…?», «…para llamar…?») admiten la misma
// estructura. La puerta no se mueve: «número de telefone … para
// ligar» sigue fuera, porque la rama sigue exigiendo el verbo
// pegado a «número» (con su relativo, su modal o su «para»).
const EMERGENCY_Q_RE =
  /\b(numero|telefono|tel)s? (de |del |para )?(las? )?(emergencias?|urgencias?|emergency|policia|ambulancia|bomberos)\b|\b(?:a )?(que|cual) (?:es el )?numero (?:(?:que )?(?:debo )?(?:llamo|llamas|llamar|marco|marcar)|para (?:llamar|marcar))\b|\bemergency (number|phone|line)s?\b|\bwhat number (do i|should i|to) (call|dial)\b|\bnumber (for|to call) (the )?(police|ambulance|fire)\b|\bnumeros? de (emergencia|urgencia)\b|\b(?:qual|que) (?:e )?(?:o |a )?numero (?:(?:que )?(?:eu )?(?:devo )?(?:ligar|ligo|discar)|para (?:ligar|discar))\b|\btelefone (de |da )?(emergencia|emergency)\b/;

function findCountry(folded: string): EmergencyEntry | null {
  for (const e of EMERGENCY_NUMBERS) {
    for (const n of e.names) {
      const re = new RegExp(`(^|[^a-z])${fold(n).replace(/ /g, "\\s+")}([^a-z]|$)`);
      if (re.test(folded)) return e;
    }
  }
  return null;
}

/**
 * ¿Nombra un lugar («… en Alemania», «… in Germany», «… na Argentina»)
 * que no está en la tabla? «en mi país» no cuenta: se pregunta cuál.
 * Auditoría completa 2026-10-31 (F1 B-6): «en casa» y «in home»
 * tampoco nombran país alguno y se respondían como si se hubiera
 * nombrado uno desconocido («No tengo el número de ese país…»);
 * quedan fuera igual que «mi país».
 */
const OTHER_COUNTRY_RE = /\b(emergenci\w*|urgenci\w*|emergency|numero|number|telefono|telefone)\b.*\b(en|in|no|na|em)\s+(?!mi |my |meu |minha |el mio|casa\b|home\b)[a-z]{3,}/;

function emergencyText(lang: SafetyLang, folded: string): SafetyHit {
  const e = findCountry(folded);
  if (e) {
    const pl = e.plural === true;
    const ptLabel = e.label.pt.charAt(0).toUpperCase() + e.label.pt.slice(1);
    const text =
      lang === "en"
        ? `In ${e.label.en}, the emergency ${pl ? "numbers are" : "number is"} ${e.numbers.en}.\n\nSource: ${e.source}.`
        : lang === "pt"
          ? `${ptLabel}, ${pl ? "os números de emergência são" : "o número de emergência é"} ${e.numbers.pt}.\n\nFonte: ${e.source}.`
          : `En ${e.label.es}, ${pl ? "los números de emergencia son" : "el número de emergencias es"} ${e.numbers.es}.\n\nFuente: ${e.source}.`;
    return { kind: "emergency-number", lang, text, country: e.label.en, deterministic: true };
  }
  const known = EMERGENCY_NUMBERS.map((x) => (lang === "pt" ? x.label.pt.replace(/^(nos|no|na|em) /, "") : x.label[lang]));
  const asked = OTHER_COUNTRY_RE.test(folded);
  return { kind: "emergency-number", lang, text: unknownCountryText(lang, asked, known), countryUnknown: { asked }, deterministic: true };
}

/**
 * Texto fijo cuando no hay número comprobado para el país: no se adivina.
 * `known`: los países que sí están comprobados, en el idioma de la respuesta.
 */
export function unknownCountryText(lang: SafetyLang, asked: boolean, knownNames: readonly string[]): string {
  const known = knownNames.join(", ");
  // 2026-10-30 (prueba física): el dueño contó los nombres de la lista en
  // su foto y preguntó cuántos eran — el texto enumeraba sin decir la
  // cifra. La cifra sale de la propia lista que llega (los países de los
  // packs instalados cuando ChatScreen rehace el texto), nunca de una
  // constante: si los packs crecen, el número crece solo.
  const count = knownNames.length;
  return (
    lang === "en"
      ? (asked
          ? "I don't have that country's emergency number checked against an official source, so I won't guess. Look for it on the local government's website or ask someone nearby."
          : "Which country are you in? I'll tell you the number.") +
        `\n\nCountries checked so far (${count}): ${known}.`
      : lang === "pt"
        ? (asked
            ? "Não tenho o número de emergência desse país conferido numa fonte oficial, então não vou chutar. Procure no site do governo local ou pergunte a alguém por perto."
            : "Em que país você está? Eu digo o número.") + `\n\nPaíses conferidos até agora (${count}): ${known}.`
        : (asked
            ? "No tengo el número de emergencias de ese país comprobado en una fuente oficial, así que no lo voy a adivinar. Búscalo en la web del gobierno local o pregunta a alguien cercano."
            : "¿En qué país estás? Te digo el número.") + `\n\nPaíses comprobados por ahora (${count}): ${known}.`
  );
}

/**
 * ¿Es una pregunta de seguridad con respuesta fija? null = no; sigue su camino.
 * `lang` = idioma de la app (las respuestas salen en ese idioma).
 */
/* ------------------------------------------------------------------ */
/* Daño a uno mismo                                                    */
/* ------------------------------------------------------------------ */

/**
 * 0.1.93 (decisión del dueño, 2026-11-10): quien escribe que quiere
 * morir o hacerse daño recibe SIEMPRE este texto fijo, antes que
 * cualquier otra cosa y haya o no fuentes. Hasta ahora ese mensaje podía
 * llegar al modelo («i want to kill myself» pasaba la puerta de salud en
 * la 0.1.92), y un modelo pequeño respondiendo de memoria a eso es lo
 * último que debe pasar.
 *
 * Solo primera persona («quiero morir», «kill myself»): lo que se cuenta
 * de otra persona sigue su camino por la puerta de salud. Las frases
 * hechas («me quiero morir de la risa», «dying to see it») no cuentan.
 *
 * Las líneas de ayuda del texto, comprobadas el 2026-11-10:
 *  - EE. UU.: 988, llamada o mensaje (FCC, «988 Suicide and Crisis
 *    Lifeline»).
 *  - México: Línea de la Vida, 800 911 2000 (Gobierno de México).
 *  - España: 024, gratuita y las 24 horas (Ministerio de Sanidad,
 *    «024. Línea de atención a la conducta suicida»).
 *  - Brasil: CVV, 188, gratuita en todo el país (CONASS).
 */
const SELF_HARM_PATTERNS = [
      // español
      "(?:ya )?no quiero (?:seguir )?vivi(?:r|endo)",
      "(?:me )?quiero morir(?:me)?",
      "quiero matarme",
      "me quiero matar",
      "(?:me )?voy a matar(?:me)?",
      "quitarme la vida",
      "suicidarme",
      "(?:pienso|pensando|he pensado) en (?:el )?suicid\\w*",
      "(?:acabar|terminar) con mi vida",
      "hacerme dano",
      "(?:pienso|pensando|he pensado) en (?:lastimarme|herirme)",
      // C1-H1 (barrido 0.1.96): la forma directa con «lastimar»/«herir»,
      // gemela de la portuguesa «quero me machucar / ferir».
      "(?:quiero|voy a|tengo ganas de) (?:lastimarme|herirme)",
      "lastimarme a mi mism[oa]",
      // 0.1.99 T-01 (M-07, auditoría 2026-11-14): la familia de
      // «cortar», la forma corriente de decirlo que faltaba en los
      // tres idiomas («quiero cortarme», sonda P-17d). Siempre con
      // el reflexivo: «quiero cortar» a secas también es cortar el
      // pan o cortar con alguien. Los objetos cotidianos que sí
      // llevan el reflexivo (el pelo, las uñas) van a los vetos.
      "(?:quiero|voy a|tengo ganas de) cortarme",
      "me (?:quiero|voy a) cortar",
      "(?:pienso|pensando|he pensado) en cortarme",
      // 0.1.99 T-01 (M-07): «estar vivo / estar muerto», la gemela
      // que el acta nombra: estaba «no quiero vivir», no «estar vivo».
      "(?:ya )?no quiero estar viv[oa]",
      "(?:quiero|queria) estar muert[oa]",
      "no vale la pena (?:seguir )?vivi(?:r|endo)",
      "(?:estaria|estarian) mejor (?:muert[oa]|sin mi)",
      "(?:ya )?no (?:le )?encuentro sentido a (?:la vida|nada)",
      // inglés
      "kill(?:ing)? myself",
      "(?:want|wanna) to die",
      "wanna die",
      "end(?:ing)? my (?:own )?life",
      "take my own life",
      "(?:i am|i'm|im|feel(?:ing)?) suicidal",
      "commit suicide",
      "(?:thinking|thought|thoughts) (?:about|of) suicide",
      "(?:hurt|hurting|harm|harming) myself",
      // 0.1.99 T-01 (M-07): the «cutting» family, twin of «hurt
      // myself». Bare «cut myself» stays out: it is also the
      // accidental cut («I cut myself shaving»), which belongs to
      // first aid. What enters is the gerund (the ongoing
      // behaviour), the stated intention and «on purpose».
      "cutting myself",
      "(?:want|wanna) to cut myself",
      "cut myself on purpose",
      "(?:want|wanna) to be dead",
      "(?:don't|dont|do not) want to (?:live|be alive)(?: anymore)?",
      "no (?:point|reason) (?:in|to) (?:living|live)",
      "better off dead",
      "(?:thinking|thought) (?:about|of) ending it",
      // portugués
      "quero morrer",
      "quero me matar",
      "vou me matar",
      "tirar (?:a )?minha (?:propria )?vida",
      "me suicidar",
      "(?:penso|pensando|pensei|pensado) em (?:suicid\\w*|me matar|me machucar|me ferir|me cortar)",
      // C1-H1 (barrido 0.1.96): la forma directa, como «hacerme daño» en
      // español e «I want to hurt myself» en inglés. Siempre con el verbo
      // de intención de quien habla delante: «me machucar» suelto también
      // es «o cachorro pode me machucar».
      "(?:quero|queria|vou|preciso|tenho vontade de) me (?:machucar|ferir)",
      "(?:quero|vou|preciso) (?:machucar|ferir)-me",
      // 0.1.99 T-01 (M-07): a família de «cortar», gêmea direta da
      // de «machucar/ferir» (sonda P-17e: «quero me cortar» não
      // disparava). Os objetos cotidianos (o cabelo, as unhas) vão
      // aos vetos.
      "(?:quero|queria|vou|preciso|tenho vontade de) me cortar",
      "(?:quero|vou|preciso) cortar-me",
      "nao quero (?:mais )?estar viv[oa]",
      "(?:quero|queria) estar mort[oa]",
      "(?:machucar|ferir) a mim mesm[oa]",
      "nao quero (?:mais )?viver",
      "nao aguento mais viver",
      "acabar com (?:a )?minha vida",
      // Auditoría de la 0.1.112, bloque 1: ideación pasiva y sobredosis
      // anunciada. La red era léxica y le faltaban cuatro familias en los
      // tres idiomas (o en alguno): «no tengo razones para vivir», «no
      // quiero despertar mañana», «estarían mejor sin mí» y «voy a
      // tomarme todas las pastillas». Siempre en primera persona, y con
      // las guardas que separan la frase de crisis de la cotidiana: el
      // despertar solo cuenta si la frase termina ahí («no quiero
      // despertarme mañana temprano» es madrugar), y las pastillas solo
      // con «todas» o una cantidad que no es una toma (un bote, una caja),
      // nunca «voy a tomar mis pastillas». El tratamiento completo
      // («todas las pastillas del tratamiento») va a SELF_HARM_VETO_RE.
      // — es
      "(?:ya )?no tengo (?:ninguna |ningun |mas )?(?:razon|razones|motivo|motivos) (?:para|por (?:la )?(?:que|cual)) (?:seguir )?vivi(?:r|endo)",
      "no (?:hay|veo|encuentro) (?:ninguna |ningun )?(?:razon|motivo|sentido) (?:para|en) (?:seguir )?vivi(?:r|endo)",
      "(?:ya )?no quiero (?:volver a )?despertar(?:me)?(?: (?:manana|nunca mas|mas|jamas))?(?=\\s*(?:$|[.,;:!?]|y |porque |pero ))",
      "(?:dormir(?:me)?|quedarme dormid[oa]) y no (?:volver a )?despertar(?:me)?",
      // Corrección del bloque 1 (veredicto de la casa): la desiderativa
      // de la familia 1, «quisiera no despertar», con la misma guarda de
      // final de frase que «no quiero despertar».
      "(?:quisiera|querria|me gustaria) no (?:volver a )?despertar(?:me)?(?: (?:manana|nunca mas|mas|jamas))?(?=\\s*(?:$|[.,;:!?]|y |porque |pero ))",
      "ojala no (?:despertara|despierte|amaneciera)",
      "ojala (?:estuviera muert[oa]|me muriera|no hubiera nacido)",
      "seria mejor (?:si )?(?:no existiera|desapareciera|me muriera|estuviera muert[oa])",
      "(?:todos|todo el mundo|mi familia) (?:estaria|estarian|viviria|vivirian) mejor sin mi",
      "(?:voy a|quiero|pienso|tengo ganas de|(?:estoy )?pensando en|he pensado en) (?:tomarme|tomar|beberme|tragarme|meterme) (?:todas (?:las|mis)|un bote de|un frasco de|una caja de|la caja de|el bote de) (?:pastillas|pildoras|medicinas|medicamentos|tabletas|capsulas|somniferos)",
      "(?:voy a|quiero|pienso) (?:tomarme|tomar|hacerme|provocarme|provocar) una sobredosis",
      // Familia 4, forma telegráfica: la frase ENTERA es «tomarme todas
      // las pastillas», sin verbo de anuncio. Anclada al mensaje completo
      // para no cazar «tengo que tomarme todas las pastillas del…».
      "^(?:tomarme|tragarme|beberme) todas (?:las|mis) (?:pastillas|pildoras|medicinas|tabletas|capsulas|somniferos)(?=[.!]*$)",
      "(?:quiero|me gustaria) desaparecer (?:para siempre|del mundo|de este mundo)",
      // — en
      "(?:have|got) no (?:reason|reasons) (?:left )?(?:to live|for living|to go on)",
      "no reason to (?:keep )?(?:living|going on|go on)",
      "nothing (?:left )?to live for",
      "(?:don't|dont|do not) want to wake up(?: (?:tomorrow|again|ever again|anymore))?(?=\\s*(?:$|[.,;:!?]|and |because |but ))",
      "(?:go to sleep|fall asleep|sleep) and (?:never|not) wake up",
      "hope i (?:don't|dont|never) wake up",
      "wish i (?:wouldn['’]?t|would not|won['’]?t|would never|could just not) wake up(?: (?:tomorrow|again|ever again|anymore))?(?=\\s*(?:$|[.,;:!?]|and |because |but ))",
      // Familia 3 firmada en condicional, igual en las tres lenguas: el
      // presente («they are better off without me») no declara.
      "(?:would be|'d be|d be) better off without me",
      "better off if i (?:was|were) (?:dead|gone)",
      "wish i (?:was|were) (?:dead|never born)",
      "(?:i'm going to|i'm gonna|im gonna|i am going to|i will|i'll|i want to|i wanna|thinking (?:about|of)) (?:take|taking|swallow|swallowing) (?:all (?:of )?(?:my|the)|a (?:whole )?bottle of|the whole bottle of) (?:pills|meds|medication|medications|tablets|sleeping pills)",
      "(?:i'm going to|i'm gonna|im gonna|i am going to|i want to|i wanna|thinking (?:about|of)) (?:overdose|overdosing|od)\\b",
      "^(?:take|swallow) all (?:of )?my (?:pills|meds|medication|tablets|sleeping pills)(?=[.!]*$)",
      "(?:want|wanna) to disappear (?:forever|from (?:this|the) world)",
      // — pt
      "nao tenho (?:mais )?(?:nenhum |nenhuma )?(?:motivo|motivos|razao|razoes) (?:para|pra) (?:continuar )?viver",
      "nao (?:ha|vejo|encontro) (?:nenhum |nenhuma )?(?:motivo|razao|sentido) (?:para|pra|em) (?:continuar )?viver",
      "nao quero (?:mais )?acordar(?: (?:amanha|nunca mais|mais))?(?=\\s*(?:$|[.,;:!?]|e |porque |mas ))",
      "dormir e nao (?:mais )?acordar",
      // Familia 1 portuguesa en imperfecto: «queria não acordar», «não
      // queria acordar nunca mais».
      "(?:queria|gostaria de) nao (?:mais )?acordar(?: (?:amanha|nunca mais|mais))?(?=\\s*(?:$|[.,;:!?]|e |porque |mas ))",
      "nao queria (?:mais )?acordar(?: (?:amanha|nunca mais|mais))?(?=\\s*(?:$|[.,;:!?]|e |porque |mas ))",
      "(?:espero|tomara que eu) nao (?:acordar|acorde)",
      "(?:estariam|estaria|ficariam|ficaria|viveriam) melhor sem mim",
      "seria melhor se eu (?:morresse|nao existisse|sumisse|estivesse mort[oa])",
      "queria (?:estar mort[oa]|nunca ter nascido|nao ter nascido)",
      "(?:vou|quero|penso em|pensando em|pensei em|tenho vontade de) (?:tomar|engolir) (?:todos os (?:meus )?|todas as (?:minhas )?|um vidro de |uma caixa de |a caixa de )(?:comprimidos|remedios|pilulas|capsulas|calmantes)",
      "(?:vou|quero) (?:tomar|ter|me provocar|provocar) uma overdose",
      "^(?:tomar|engolir) todos os (?:meus )?(?:comprimidos|remedios|calmantes)(?=[.!]*$)",
      "^(?:tomar|engolir) todas as (?:minhas )?(?:pilulas|capsulas)(?=[.!]*$)",
      "quero (?:sumir|desaparecer) (?:para sempre|do mundo|deste mundo)",
      // Tanda de variantes de la casa, Familia 1: las formas que la
      // ciega gastada midió en falso negativo, por grupos, en el
      // orden del censo (METODO, LIMITE, CARGA, SUENO, DESAPAR,
      // SINSENTIDO). Batería: safetyAnswers.variantesF1.test.ts.
      // — METODO: el medio entra en la ideación y en el anuncio.
      "me dan ganas de cortarme",
      "(?:pienso|pensando|he pensado) en (?:ahorcarme|envenenarme)",
      "(?:quiero|voy a) (?:ahorcarme|envenenarme)",
      "(?:pienso|pensando|he pensado) en tirarme de (?:un|el) puente",
      "(?:escribi|he escrito) (?:mi |la )?carta de despedida",
      "(?:he guardado|guarde|guardo|guardando) (?:las |mis )?(?:pastillas|pildoras|medicinas|medicamentos|tabletas|capsulas|comprimidos|somniferos)[^.]{0,30}no aguant",
      "(?:voy a|quiero|pienso|pensando en|he pensado en) mezclar (?:las |mis |los )?(?:pastillas|pildoras|medicinas|medicamentos|tabletas|capsulas|comprimidos|remedios)[^.]{0,20}con alcohol",
      "(?:thinking|thought|thoughts) (?:about|of) (?:hanging|poisoning) myself",
      "(?:keep|kept|keeping|saving|saved) (?:some |all )?(?:my )?(?:pills|meds|medication|tablets) aside[^.]{0,30}(?:cannot hold on|can t hold on|can t take it)",
      "(?:have|ve) (?:already )?written (?:my |a )?goodbye letter",
      "wrote (?:my |a )?goodbye letter",
      "hope i (?:get in|have) an accident and (?:do not|don t|dont) survive",
      "(?:penso|pensando|pensei|pensado) em (?:me enforcar|me envenenar)",
      "(?:quero|vou) me (?:enforcar|envenenar)",
      "(?:penso|pensando|pensei|pensado) em me jogar de (?:uma|a) ponte",
      "fico me imaginando (?:nos|nas) (?:trilhos|vias)",
      "(?:escrevi|ja escrevi) (?:minha |a )?carta de despedida",
      "(?:guardo|guardei|guardando|guardado) (?:comprimidos|remedios|pilulas|capsulas)[^.]{0,30}nao aguent",
      "(?:vou|quero|penso em) misturar (?:meus |os |as |minhas )?(?:remedios|comprimidos|medicamentos|pilulas|capsulas)[^.]{0,20}com alcool",
      "ja (?:me feri|me machuquei)",
      "(?:fico planejando|planeando|planejando|pensando en|pensando em) (?:como |como eu )?(?:acabar (?:con todo|com tudo)|quitarme de en medio)",
      // — LIMITE: la firma es el complemento (duración, salida
      // única, comparación), nunca el verbo suelto.
      "(?:no soporto|nao suporto) (?:nem )?(?:mais )?(?:un|um) dia(?: mas| mais)?",
      "(?:can't stand|can t stand|cannot stand|can not stand) one more day",
      "(?:hart[oa]|fart[oa]|cansad[oa]) de fingir que (?:quiero seguir|quero continuar)",
      "(?:tired|sick) of pretending (?:that )?(?:i want to (?:keep going|go on))",
      "(?:atrapad[oa])[^.]{0,40}(?:la )?unica salida es (?:morirme|morir)",
      "(?:preso|presa)[^.]{0,30}morrer e a unica saida",
      "trapped[^.]{0,40}(?:dying is the only way out|only way out is (?:dying|death|to die))",
      "(?:prefiero|preferiria|prefiro) estar (?:muert[oa]|mort[oa]) (?:que seguir|que continuar|a continuar)",
      "(?:would rather|i d rather) be dead (?:than|then) (?:keep|continue|go on)",
      "(?:quiero|quero|voy a|vou) (?:dejar|parar) de respirar (?:para siempre|para sempre|forever)",
      "(?:seria|ficaria) mais facil se eu (?:nao existisse|morresse|sumisse)",
      "(?:al limite|en mi limite)[^.]{0,40}hacerme algo(?=\\s*(?:$|[.,;:!?]))",
      "(?:no meu limite|no limite)[^.]{0,40}fazer algo contra mim",
      "(?:acabar|terminar) con (?:mi )?sufrimiento (?:de una vez|de uma vez)",
      "(?:acabar|terminar) com (?:o )?(?:meu )?sofrimento (?:de uma vez|de una vez)",
      "(?:end|ending) (?:my )?suffering once and for all",
      "(?:ya )?no aguanto mas (?:esta vida|vivi(?:r|endo))",
      "(?:quiero|vou|voy a) acabar (?:con todo|com tudo)",
      // — CARGA: la ausencia firmada (nadie + falta/cuidado + la
      // cláusula de muerte o desaparición) y el estorbo sentido.
      "(?:nadie|ninguno)[^.]{0,30}(?:echaria de menos|haria falta|se importaria|notaria)[^.]{0,30}(?:si (?:me muero|me muriera|me fuera|desapareciera|no estuviera)|esta noche)",
      "ninguem[^.]{0,30}(?:sentiria (?:minha|sua) falta|se importaria|notaria|perceberia)[^.]{0,30}(?:se eu (?:morresse|sumisse|fosse embora|desaparecesse)|esta noite)",
      "(?:se eu (?:morresse|sumisse|desaparecesse))[^.]{0,30}ninguem[^.]{0,20}(?:se importaria|notaria|sentiria)",
      "(?:nobody|no one)[^.]{0,30}(?:would (?:notice|care|miss me)|wouldn t (?:notice|care))[^.]{0,30}(?:if i (?:died|die|disappeared|was gone)|tonight)",
      "(?:if i (?:died|die|was gone|disappeared))[^.]{0,30}(?:nobody|no one)[^.]{0,20}(?:would (?:care|notice|miss)|wouldn t care)",
      "(?:siento que|me siento)[^.]{0,25}(?:estorbo|soy un peso|mi vida es una carga)",
      "(?:sinto que|me sinto)[^.]{0,25}(?:atrapalho|sou um peso|sou um fardo|minha vida e (?:uma carga|um peso))",
      "(?:mi presencia|minha presenca|my presence) (?:solo |so |only )?(?:estorba|atrapalha|gets in)",
      "(?:ficariam|estariam) melhor se eu (?:simplesmente )?(?:desaparecesse|sumisse|morresse|nao existisse)",
      // — SUENO: la mañana dentro de la optativa, la forma de los
      // ojos y el dormir para siempre.
      "ojala (?:manana )?no (?:despertara|despierte|amaneciera)",
      "(?:ojala|quisiera|queria|deseo|desearia|espero)[^.]{0,50}(?:no (?:volver a )?abrir|nunca (?:mas )?abrir|no abriera|nunca abriera) (?:los |mis )?ojos",
      "(?:queria|quero|desejo|torco|espero)[^.]{0,50}(?:nunca mais abrir|nao (?:mais )?abrir) (?:os |meus )?olhos",
      "(?:torco|queria|desejo|espero)[^.]{0,50}(?:meus )?olhos nunca mais (?:abrirem|abrir)",
      "(?:wish|hope)[^.]{0,50}(?:never open (?:my )?eyes|eyes never open)",
      "(?:quedarme dormid[oa]|dormir(?:me)?|ficar dormindo|ficar dormid[oa]|stay asleep|remain asleep) (?:para siempre|para sempre|forever)",
      // — DESAPAR: el complemento nuevo es «sin dejar rastro».
      "(?:quiero|quisiera|querria|me gustaria) desaparecer sin dejar rastro",
      "nao encontro (?:mais )?sentido na vida",
      // — SINSENTIDO: solo marcos ENTEROS anclados al mensaje, con
      // la cortesía delante y la pregunta detrás opcionales; la
      // misma forma suelta en una frase más larga no declara (el
      // residuo de FP queda declarado en el censo).
      "^(?:por favor,? )?(?:estoy )?cansad[oa] de existir(?:\\s*,?\\s*¿?(?:que hago|que puedo hacer))?(?=[.!?]*$)",
      "^(?:por favor,? )?(?:estou )?cansad[oa] de existir(?:\\s*,?\\s*¿?(?:o que (?:eu )?faco|que faco))?(?=[.!?]*$)",
      "^(?:please,? )?(?:i am |i m )?(?:tired|sick) of (?:being alive|existing)(?:\\s*,?\\s*(?:what (?:should|do) i do))?(?=[.!?]*$)",
      "^(?:por favor,? )?siento un vacio que no se llena con nada(?=[.!?]*$)",
      "^(?:por favor,? )?sinto um vazio que (?:nada preenche|nao se preenche com nada)(?=[.!?]*$)",
      "^(?:please,? )?i feel (?:an? )?emptiness (?:that )?nothing fills(?=[.!?]*$)",
      "^(?:por favor,? )?la idea de (?:morirme|morir) me (?:tranquiliza|calma)(?=[.!?]*$)",
      "^(?:por favor,? )?a ideia de morrer me (?:tranquiliza|acalma)(?=[.!?]*$)",
      "^(?:please,? )?the (?:idea|thought) of (?:dying|being dead) (?:calms|soothes) me(?=[.!?]*$)",
      "^(?:please,? )?being dead sounds peaceful(?: to me)?(?=[.!?]*$)",
      "^(?:por favor,? )?(?:ya )?no (?:veo|encuentro) (?:ningun )?futuro(?: para mi)?(?:\\s*,?\\s*¿?(?:que hago|que puedo hacer))?(?=[.!?]*$)",
      "^(?:por favor,? )?nao vejo (?:nenhum )?futuro(?: para mim)?(?=[.!?]*$)",
      "^(?:please,? )?i (?:cannot|can t|can not|don t) see (?:any )?future(?: for me)?(?=[.!?]*$)",
      "^(?:por favor,? )?acordar todos os dias (?:parece|e) um castigo(?=[.!?]*$)",
      "^(?:por favor,? )?(?:ya )?no deseo seguir en este mundo(?=[.!?]*$)",
      "(?:desearia|quisiera|queria) no haber nacido",
      "wish i had never been born",
      "(?:cannot|can t|couldn t) find (?:a single |any )?reason to (?:go on|keep living|live)",
      "life has no meaning(?: left)? for me",
];

const SELF_HARM_RE = new RegExp("\\b(?:" + SELF_HARM_PATTERNS.join("|") + ")\\b");

/**
 * La misma lista sin espacios ni límites de palabra (CL-11b de la
 * caza 0.1.97): el dictado por voz pega las palabras («quieroaserme
 * daño», «queromemachucar», «iwanttohurtmyself») y la puerta no
 * disparaba en ningún idioma, porque cada expresión exige palabras
 * separadas. Contra el texto también sin espacios, la frase entera
 * tiene que aparecer como una sola corrida de letras: una colisión
 * benigna necesitaría la frase completa cruzando palabras ajenas.
 */
/**
 * Variantes solo para la vía pegada: la fusión dictada también se
 * come la h muda y sesea («quiero hacerme daño» llega como
 * «quieroaserme dano»: ni «hacerme» ni «quiero hacerme» sobreviven
 * como corrida de letras). Como patrones con espacios nunca casan
 * texto real; solo alimentan la regex sin espacios.
 */
const SELF_HARM_GLUED_EXTRA = ["aserme dano", "(?:quiero|voy a|tengo ganas de) (?:lastimarme|erirme)"];

const SELF_HARM_GLUED_RE = new RegExp(
  [...SELF_HARM_PATTERNS, ...SELF_HARM_GLUED_EXTRA].map((p) => p.replace(/\s+/g, "")).join("|"),
);

// Frases hechas y ficción: no son una persona contando que quiere morir.
// (El veto de la familia de «cortar» vive aparte, en cutObjectVeto:
// es por clase de objeto, no una lista dentro de esta regex.)
// El veto vive por partes con nombre porque la vía pegada las
// trata distinto (ver SELF_HARM_VETO_GLUED_* más abajo): la letra
// de modismo, ficción y marco médico es la que ya gobernaba; la
// tanda de variantes (Familia 1) añade solo la parte de contexto
// laboral que separa la carga de crisis de la carta y la ausencia
// del trabajo.
const SELF_HARM_VETO_IDIOM_SRC =
  "morir(?:me)? de (?:la )?(?:risa|verguenza|pena|hambre|sueno|calor|frio|amor|ganas|envidia|aburrimiento|cansancio|nervios)|die of (?:embarrassment|laughter|boredom|shame|hunger|thirst)|morrer de (?:rir|vergonha|fome|sono|calor|frio|amor|vontade|tedio|saudade)";
const SELF_HARM_VETO_FICTION_SRC =
  "cuento|novela|historia|guion|cancion|poema|personaje|pelicula|serie|story|novel|script|song|lyrics|poem|character|movie|conto|romance|roteiro|musica|personagem|filme";
const SELF_HARM_VETO_MEDICAL_SRC =
  "(?:pastillas|pildoras|medicinas|medicamentos|tabletas|capsulas|pills|meds|medication|tablets|comprimidos|remedios|pilulas) (?:del tratamiento|de la receta|que me (?:receto|mando|indico)|hasta (?:el )?final|of (?:the|my) (?:course|treatment|prescription)|(?:as|like) (?:prescribed|the doctor said)|until (?:the )?end|do tratamento|da receita|que o medico (?:receitou|passou|mandou)|ate o fim)";
const SELF_HARM_VETO_CONTEXT_SRC =
  "(?:si me fuera|se eu fosse embora|if i left) (?:de la empresa|do trabalho|da empresa|do emprego|my job|the company|o trabalho)|(?:carta de despedida|goodbye letter) (?:del trabajo|de mi trabajo|de la empresa|to (?:my )?(?:coworkers|colleagues|boss|job)|aos (?:meus )?colegas|para (?:mis|os) (?:companeros|colegas))";
const SELF_HARM_VETO_RE = new RegExp(
  "\\b(?:" +
    SELF_HARM_VETO_IDIOM_SRC +
    "|(?:" +
    SELF_HARM_VETO_FICTION_SRC +
    ")\\b|" +
    SELF_HARM_VETO_MEDICAL_SRC +
    "\\b|" +
    SELF_HARM_VETO_CONTEXT_SRC +
    ")",
);

/**
 * 0.1.99 T-27 (H-Z4-1, re-auditoría zona 4): el veto de la familia
 * de «cortar» ya no es una lista cerrada de objetos. La de T-01
 * (pelo, cabello, flequillo, uñas, barba, bigote…) vetaba solo lo
 * enumerado, y el conjunto cotidiano es abierto: la re-auditoría
 * disparó el texto fijo con «las cutículas», «las puntas del
 * pelo», «las patillas», «la perilla», «el vello de las piernas»,
 * «un trozo de pastel», PT «as pontas» y EN «some slack». Ahora el
 * veto lee el sintagma que sigue a la forma reflexiva y decide
 * por CLASE:
 *  - si la cabeza del sintagma es un lugar de daño (las venas,
 *    las muñecas, la garganta, os pulsos…), NUNCA veta: la frase
 *    dispara, como disparaba «quiero cortarme las venas»;
 *  - si alguna palabra del sintagma es de una clase cotidiana
 *    (raíces de aseo y pelo, porciones y comida, modismos en
 *    inglés), veta: «las puntas DEL PELO» y «um pedaço DE BOLO»
 *    entran por su palabra cotidiana, no por enumerar la frase;
 *  - si no hay objeto reconocido («quiero cortarme», «cortarme
 *    un poco», «cortarme otra vez», «cortarme a mí mismo»), no
 *    veta: el disparo queda exactamente como estaba.
 * Las raíces son de clase (cabel- vale cabello y cabelo, punt-
 * vale puntas y pontas), no la frase entera; el freno es el de
 * siempre en las dos direcciones y lo fijan las sondas de T-01 y
 * de esta tanda.
 *
 * 0.1.99 T-31 (residuos de la repetición de Z-01, ACTA-z01-r2
 * §5): la forma de T-27 decidía con medio sintagma y con tokens
 * ambiguos, y la repetición lo midió en las dos direcciones:
 *  - R1: «unas» es a la vez el artículo y «uñas» plegado, y
 *    vetaba como objeto aunque fuera el artículo de un
 *    instrumento («quiero cortarme con unas tijeras» no
 *    disparaba). El sintagma de instrumento («con…», «usando…»,
 *    «com…», «with…») es un ADJUNTO, no el objeto: ya no decide
 *    el veto. Si tras el adjunto viene otro objeto con su
 *    determinante («con unas tijeras las venas»), ese objeto se
 *    lee como objeto.
 *  - R2: la lectura se cortaba en la conjunción y el segundo
 *    objeto coordinado no se leía («las uñas y las venas» no
 *    disparaba). Ahora se leen TODOS los objetos coordinados:
 *    una cabeza de daño en cualquiera de ellos manda.
 *  - R3: el pelado de determinantes se comía «uñas» como si
 *    fuera el artículo cuando llevaba complemento detrás
 *    («las uñas de los pies» disparaba otra vez: regresión
 *    contra la ronda 1). «Unas»/«umas» son ambiguos y no se
 *    pelan como determinantes: como cabeza leída son el objeto
 *    (las uñas); solo ceden cuando lo que sigue es ya una
 *    cabeza reconocida («unas venas», «unas pestañas»).
 * La cabeza de cada objeto se lee pelando determinantes,
 * cuantificadores («las dos muñecas») y la preposición del
 * frente; el daño manda solo como CABEZA de un objeto, y el
 * «de» interno sigue siendo complemento («el vello de las
 * piernas» veta por «vello», «las uñas de los pies» por «uñas»,
 * «la piel de la muñeca» dispara por «piel»).
 * Dos decisiones que el acta asentó sin enumerar y esta tanda
 * toma con conocimiento: la ropa (mangas, pantalón, camisa y
 * familia) es tan cotidiana como el pelo —cortarse la ropa
 * puesta es sastrería, no un lugar del cuerpo— y entra en las
 * clases cotidianas; y «barbilla» es el mentón, un lugar del
 * cuerpo como su gemelo «mentón» (que sí dispara), así que
 * entra en las cabezas de daño y deja de vetarse por la raíz
 * «barb-» de la barba.
 *
 * 0.1.99 T-32 (residuos de la ronda 3 de Z-01, ACTA-z01-r3
 * §6): la forma por segmentos aguantó su centro y la ronda 3
 * midió tres fronteras, que se curan aquí:
 *  - R3a: la ropa era clase declarada pero cubierta solo por
 *    la familia que T-31 enumeró, y el inocente canónico de
 *    la clase seguía disparando («la chaqueta», «los
 *    zapatos», «as meias», «o casaco»…). La clase se cubre
 *    como clase: el vocabulario corriente de prendas de
 *    vestir de los tres idiomas, por familias de raíces
 *    (chaquet-/jaquet-/chamarr-, zapat-/sapat-, guant-/luv-,
 *    bufand-/cachecol, sombrer-/chapeu, abrig-/casac-,
 *    corbat-/gravat-, gorr-, meia-, sandali-, sueter-,
 *    sudader-/moletom, player-/remer-/poler-, camper-,
 *    chalec-, bota-/boot, pijam-, uniform-, panuel- y las
 *    inglesas jacket/shoe/glove/scarv-/sweater/hoodie/shirt/
 *    jeans/sock/dress/coat) más las palabras que no pueden
 *    ir por raíz (tenis, medias, cinturón/cinto, traje, bata,
 *    delantal/avental, tie, hat, cap, pants, skirt, blouse,
 *    underwear…). Ese es el alcance escrito de la clase: las
 *    prendas corrientes; una prenda fuera de ese vocabulario
 *    sigue fuera, como cualquier clase por raíces.
 *  - R3b: la rama pegada del adjunto no reconocía los
 *    artículos portugueses «o»/«a» ante el objeto que sigue
 *    al instrumento, aunque `gluedHarmHeads` sí los trae:
 *    las dos listas de determinantes de la vía pegada quedan
 *    en paridad.
 *  - R3c: la coordinación escondía la cabeza de daño tras
 *    dos mediadores. La puntuación de lista (coma, punto y
 *    coma, dos puntos) ya no corta la lectura con espacios:
 *    cierra el objeto en curso y la lista sigue, como la
 *    conjunción; la de fin de frase (punto, !, ?) sigue
 *    cerrando. Y la cabeza de cada objeto se lee también
 *    tras un adverbio de coordinación («también», «solo»,
 *    «hasta», «também», «só», «até»…), que se pela del
 *    frente como los determinantes: «el vello y también las
 *    venas» lee «venas» como cabeza y manda. La vía pegada
 *    rescata la cabeza tras los mismos mediadores.
 *
 * 0.1.99 T-34 (residuos de la ronda 4 de Z-01, ACTA-z01-r4
 * §7): la forma de T-32 aguantó su centro y todo el freno
 * histórico, y la repetición midió la clase viva un anillo
 * más afuera, en cuatro fronteras:
 *  - R4a: el vocabulario de la ropa dejaba fuera prendas
 *    canónicas de los tres idiomas (vaqueros, cazadora,
 *    chanclas, calzoncillos, bañador, mallas, leggins,
 *    sujetador, mocasines, chándal, alpargatas, pantuflas;
 *    boné, terno, chinelo, cueca, sutiã, pantufa; sneakers,
 *    sandals, pajamas, leggings, swimsuit). Entran sus
 *    familias y palabras, en las dos vías. El alcance
 *    escrito sigue siendo «las prendas corrientes» y su
 *    frontera queda escrita con verdad: fuera del
 *    vocabulario quedan las prendas arcaicas, de oficio o
 *    regionales que la ronda 4 midió sin expectativa
 *    (jubón, casulla, kimono, gabardina, rebeca, anorak,
 *    parka, tirantes, babuchas); una prenda corriente que
 *    no esté en el vocabulario es un hueco de la clase, no
 *    parte de su alcance.
 *  - R4b: los secuenciadores corrientes de enumeración
 *    (luego, después, encima, aún; depois, ainda, logo) se
 *    leían como cabeza y escondían el daño, como los
 *    adverbios de R3c antes de pelarse. Se pelan del
 *    frente igual que ellos, en las dos vías.
 *  - R4c: el pelado del frente tenía un presupuesto de 3
 *    palabras y la pila corriente de mediadores lo agotaba
 *    («y hasta incluso también las venas» no disparaba);
 *    y «até mesmo» no se pelaba en ninguna vía («mesmo»
 *    no estaba en la lista ni en la regex pegada). El
 *    pelado ya no tiene presupuesto: recorre todo el
 *    frente funcional (determinantes, preposiciones,
 *    cuantificadores, adverbios y secuenciadores) y la
 *    cabeza es la primera palabra de contenido, sin pelar
 *    nunca la última. En la vía pegada, «mesmo» entra en
 *    la regex y el pelado encadena los mediadores.
 *  - R4d: las cotas de lectura perdían la cabeza en la
 *    enumeración corriente larga (con espacios, la cabeza
 *    como 15ª palabra ya no se leía; pegada, la misma
 *    enumeración caía fuera de la ventana de 30). El tope
 *    con espacios sube de 14 a 20 palabras y la ventana
 *    pegada de 30 a 40 caracteres, con la acotación medida
 *    delante (la enumeración medida pone la cabeza en la
 *    palabra 16ª y en el carácter 32º de la corrida) y el
 *    freno entero re-medido. La frontera queda escrita:
 *    una cabeza de daño más allá de la 20ª palabra leída
 *    o del 40º carácter pegado sigue sin leerse, como en
 *    toda lectura acotada.
 *
 * 0.1.99 T-35 (residuos de la ronda 5 de Z-01, ACTA-z01-r5
 * §8): la forma de T-34 aguantó su centro entero y todo el
 * freno histórico, y la repetición midió la clase viva un
 * anillo más afuera en las mismas formas enumerativas. Las
 * cinco fronteras se curan aquí, y la primera con una
 * decisión de coordinación tomada con tres rondas de la
 * misma forma delante (R3a, R4a, R5a):
 *  - R5a: se hacen las dos salidas del acta a la vez. El
 *    vocabulario cubre el anillo medido entero: la palabra
 *    con guion «t-shirt» como token, raincoat, sweatshirt,
 *    cardigan, el «tank» de «tank top», brag- (bragas),
 *    macac- (macacão), el singular corriente «short» con
 *    su paridad pegada, y los corrientes de la frontera
 *    medida (overall- de overalls, jumpsuit). Y cerrado
 *    ese anillo, el alcance escrito de la clase se
 *    redefine A LA VERDAD MEDIDA: la ropa de esta clase
 *    es una LISTA ENUMERADA de prendas corrientes (las
 *    raíces y palabras de CUT_EVERYDAY_STEMS,
 *    CUT_EVERYDAY_WORDS y su gemela pegada), no «las
 *    prendas corrientes» en general, que es lo que las
 *    rondas 3, 4 y 5 desmintieron. La frontera medida
 *    que queda fuera de la lista queda nombrada:
 *    chubasquero, sostén, tacones, leotardos, mono,
 *    regata, touca, boina, bathrobe, gafas y glasses,
 *    medidos sin expectativa en la ronda 5. El residuo
 *    posible queda declarado con su dirección probada:
 *    una prenda no listada puede disparar el texto fijo
 *    sobre una petición benigna (falso positivo), pero
 *    nunca esconder una cabeza de daño, porque la
 *    lectura de las cabezas no depende de la clase de
 *    ropa: una coordinación con prenda no listada y
 *    cabeza de daño sigue disparando por la cabeza
 *    (probado en la regresión de esta tanda). Esa
 *    asimetría es la que hace cerrable la clase.
 *  - R5b: las locuciones corrientes de enumeración (de
 *    dos o tres palabras: «a continuación», «en
 *    seguida»/«em seguida», «sobre todo», «después de
 *    todo», «acto seguido», «en primer lugar»/«em
 *    primeiro lugar», «mais tarde»/«mais cedo») escondían
 *    la cabeza igual que las palabras sueltas de R4b. Se
 *    tratan como CLASE de locuciones (CUT_FRONT_LOCUTIONS)
 *    y se pelan como unidad del frente del objeto. Y los
 *    mediadores de una palabra que la ronda 5 midió
 *    verdes solo por el accidente de letra de la vía
 *    pegada («finalmente», «finally», «also», «even»)
 *    entran en el pelado con espacios: la lectura ya no
 *    se apoya en ese accidente, y el test de frontera
 *    pegado no se toca.
 *  - R5c: la palabra de cierre «mas» se comía la fórmula
 *    española «más tarde»: el texto va plegado y «más»
 *    y el «mas» portugués son el mismo token, así que la
 *    lectura se cerraba antes de la cabeza. Se dirime
 *    por la fórmula, como el acta manda: «mas» seguido
 *    de «tarde» o «temprano» es el secuenciador español
 *    y abre el objeto siguiente; «mas» seguido de
 *    cualquier otra cosa sigue cerrando, y el cierre
 *    portugués de contraste queda intacto.
 *  - R5d: la cadena de pelado pegado enlazaba por letra,
 *    no por mediador: tras un mediador acabado en «m»
 *    («também só», «também até») el siguiente no se
 *    reconocía. La cadena enlaza ahora por mediador:
 *    uno se pela cuando va precedido de la conjunción,
 *    la puntuación de lista, el inicio, otro mediador o
 *    un determinante; y las fórmulas «mas tarde»/«mais
 *    tarde»/«mais cedo» se pelan como unidad en la
 *    cadena, antes de que el «de» final de «tarde» las
 *    haga pasar por complemento. La frontera pegada
 *    queda re-escrita a lo que la cadena cubre: un
 *    mediador fundido como cola de una palabra de
 *    contenido («consolo», el «logo» de «catálogo»)
 *    sigue sin pelarse, y el test final de frontera de
 *    la vía (inicio, «y», «e» o puntuación de lista) no
 *    cambia.
 *  - R5e: la paridad de determinantes pegados que R3b
 *    cerró para el adjunto no había llegado a la lista
 *    que pela el determinante ante la cabeza de daño:
 *    ante «…unasvenas» pelaba «as», dejaba «un» y la
 *    cabeza no se reconocía. «Unas»/«umas» se pelan
 *    enteros ante la cabeza cuando van pegados a una
 *    frontera (inicio, conjunción, puntuación, mediador
 *    o determinante), como con espacios (R3); como cola
 *    de otra palabra («algunas») no se pelan.
 *
 * 0.1.99 T-37 (residuos de la ronda 6 de Z-01, ACTA-z01-r6
 * §7, y la paridad pegada de locuciones de su §6): la forma
 * de T-35 aguantó su centro entero, todo el freno
 * histórico y la clase de ropa contra su alcance
 * reescrito, y la repetición midió cuatro fronteras nuevas
 * en la dirección grave sobre la forma concreta de la
 * cura, más una frontera pegada asentada sin veredicto:
 *  - R6a: la unidad pegada de la fórmula española «más
 *    temprano» estaba escrita «maistemprano» — el «mais»
 *    portugués pegado al «temprano» español, una forma
 *    que no ocurre en ninguna lengua — y la forma real,
 *    «mastemprano», perdía el verdadero pegado. La unidad
 *    se escribe «mastemprano»; la forma mixta sale de la
 *    cadena (no es forma de ninguna lengua y ninguna
 *    batería la espera: era la sonda discriminadora del
 *    acta). Las demás unidades de la familia se revisaron
 *    una a una contra su forma real: «mastarde» (más +
 *    tarde), «maistarde» (mais + tarde) y «maiscedo»
 *    (mais + cedo) están bien escritas.
 *  - R6b: el cuantificador fundido perdía el verdadero
 *    pegado («quierocortarmealgunasvenas»): la corrida
 *    vetaba por la subcadena cotidiana «unas» dentro del
 *    cuantificador y la cabeza tras él no se reconocía,
 *    porque el «unas» de «algunas» es cola de otra
 *    palabra y la frontera de R5e no lo pelaba. La
 *    cabeza tras un cuantificador fundido se reconoce
 *    ahora: el cuantificador entero («algunas» y su
 *    familia es/pt) se pela como unidad cuando va
 *    pegado a una frontera, en peelGluedDeterminer, y
 *    gluedHarmHeads manda antes que el veto por
 *    subcadena. La frontera de R5e se re-escribe a lo
 *    que la cura cubre de verdad: «unas»/«umas» como
 *    cola de una palabra que no es el cuantificador
 *    sigue sin pelarse como determinante; el
 *    cuantificador como palabra sí se pela. La gemela
 *    portuguesa («algumas») dispara ahora por lectura,
 *    no por la doble ausencia de la ronda 6. El freno
 *    de R5e no se mueve: «…unasvenas» sigue disparando
 *    y «…lasunas» sigue vetando por su objeto.
 *  - R6c: la familia «más/mais + adverbio de tiempo» se
 *    decide COMO FAMILIA, no por dos segundas palabras:
 *    la fórmula del segmentador y las locuciones cubren
 *    «tarde», «temprano», «luego» y «adelante» en
 *    español y «tarde», «cedo», «logo» y «adiante» en
 *    portugués, y la cadena pegada trae las ocho como
 *    unidades. «Más luego» perdía el verdadero y «más
 *    adelante»/«mais adiante» daban el resultado
 *    correcto solo por el accidente de letra pegado (el
 *    prefijo acabado en «e»); ahora la cabeza se lee
 *    por la fórmula en las dos vías, sin apoyarse en
 *    ese accidente. La familia queda escrita donde
 *    está: «mas» seguido de cualquier otra palabra
 *    sigue cerrando la lectura (es el cierre portugués
 *    de contraste, diseño declarado, y su control
 *    «mas agora» sigue verde), y el cierre ante «pero»
 *    no se toca.
 *  - R6d: los secuenciadores ingleses «then»/«next» no
 *    se leían en ninguna vía: no estaban en el pelado
 *    con espacios ni en la cadena pegada, y su verde
 *    con «the»/«my» era el accidente de letra («and
 *    then her veins», «and then his veins» y «and next
 *    her veins» perdían el verdadero). Entran en
 *    CUT_FRONT_ADVERBS y en la cadena pegada, y la vía
 *    pegada aprende la frontera inglesa que le faltaba:
 *    los determinantes «the»/«her»/«his»/«my» se pelan
 *    ante la cabeza y la conjunción «and» vale como
 *    frontera de la cadena y del test final, como la
 *    «y»/«e» de una letra en es/pt. La cobertura de
 *    «and then the veins» pasa a ser lectura en las dos
 *    vías, no rescate por la «e» de «the».
 *  - Paridad pegada de locuciones (la frontera de R6
 *    §6, medida sin expectativa): las locuciones
 *    enteras de CUT_FRONT_LOCUTIONS entran como
 *    unidades en la cadena pegada, como ya entraban las
 *    fórmulas de «tarde». Donde la locución abre un
 *    objeto (tras conjunción o puntuación de lista), la
 *    cabeza se lee ahora también pegada; donde va
 *    fundida sobre el primer objeto sin separador
 *    («…peloacontinuacionlas…»), las dos vías dejan
 *    mandar al primer objeto igual que con espacios,
 *    que es la paridad medida: la locución sin
 *    separador no abre objeto en ninguna de las dos
 *    vías.
 *
 * 0.1.99 T-39 (residuos de la ronda 7 de Z-01, ACTA-z01-r7
 * §5): la forma de T-37 aguantó su centro entero y todo el
 * freno histórico, y la repetición midió la misma forma
 * enumerativa un anillo más afuera en las dos listas que
 * la cura tocó. Las dos se curan dejando de enumerar dos
 * veces la misma clase: cada conjunto pegado se deriva de
 * la constante que nombra su clase.
 *  - R7a: la familia de cuantificadores pegados traía
 *    solo la de «alguna-» y el cuantificador negativo
 *    perdía el verdadero («quierocortarmeningunasvenas»):
 *    su cola es el mismo «unas» cotidiano que veta la
 *    corrida y la familia escrita no lo pelaba como
 *    unidad. La clase vive ahora en una constante única,
 *    CUT_QUANTIFIERS (los indefinidos y los negativos de
 *    es/pt: alguna-, ninguna-, nenhuma-), y la regex
 *    pegada se deriva de ella. La vía con espacios no
 *    tiene conjunto de cuantificadores del que derivar:
 *    los lee por transparencia (el cuantificador no es
 *    palabra cotidiana ni cabeza, y el objeto decide),
 *    así que la clase se nombra una sola vez en esa
 *    constante y la regex no puede quedarse más estrecha
 *    que ella. El freno de R5e y de R6b no se mueve:
 *    «…unasvenas» dispara, «…lasunas» veta por su objeto
 *    y «lagunas» sigue sin pelarse (no es el
 *    cuantificador, y su cola conserva el pelado con
 *    frontera).
 *  - R7b: la lista de determinantes pegados traía los
 *    artículos y los cuatro ingleses de R6d donde el
 *    conjunto con espacios (CUT_DETERMINERS) lee
 *    posesivos y determinantes en las tres lenguas:
 *    «and then your veins», «y mis venas», «e minhas
 *    veias» perdían el verdadero pegado, y el posesivo
 *    portugués se pelaba por su cola de artículo dejando
 *    una letra muerta («minh», «tu»). La regex pegada se
 *    DERIVA de CUT_DETERMINERS, ordenada por longitud:
 *    las dos vías leen el mismo conjunto por construcción
 *    y no pueden volver a separarse por enumeración. Del
 *    conjunto derivado solo sale el par ambiguo
 *    «unas»/«umas», que conserva su pelado propio con
 *    frontera (R5e). La rama del adjunto pegado usa la
 *    misma derivación con el conjunto completo, como su
 *    lista de R3b (ahí no se pela: se mira la palabra
 *    anterior a la raíz cotidiana), y con eso el medido
 *    de la ronda entra en paridad: «with a knife the
 *    hair» veta pegado como su gemela portuguesa, porque
 *    «the» ya se lee también en esa rama.
 *  - El discriminador «whose», declarado: «whose» no
 *    está en ningún conjunto y su frase pegada sigue
 *    disparando por el test de frontera de letra (la
 *    conjunción «y»/«e» de una letra fusionada a la
 *    palabra anterior, el mecanismo de frontera de esta
 *    vía desde R1). Queda escrito como lo que es: un
 *    sobre-disparo sobre una cabeza de daño, la dirección
 *    segura, medido por la ronda 7. Ningún determinante
 *    del conjunto compartido depende ya de esa letra,
 *    porque todos se pelan por lectura; de «some», que
 *    acaba en «e» y cuyo resultado en gluedHarmHeads no
 *    distingue letra de lectura, la lectura se prueba en
 *    la rama del adjunto, donde la letra no opera
 *    («withaknifesomehair» veta tras esta cura).
 */
const CUT_ANCHOR_RE =
  /\b(?:cortarme|cortar-me|me\s+(?:quiero\s+|voy\s+a\s+)?cortar|(?:cut|cutting)\s+myself)\b/g;

const CUT_DETERMINERS = new Set([
  "el", "la", "los", "las", "un", "una", "unos", "unas",
  "o", "a", "os", "as", "um", "uma", "uns", "umas",
  "mi", "mis", "meu", "minha", "meus", "minhas", "tu", "tus", "teu", "tua", "su", "sus", "seu", "sua",
  "este", "esta", "estos", "estas", "esse", "essa", "estes", "estas",
  "the", "an", "some", "my", "your", "his", "her", "their", "our",
]);

const CUT_PREPOSITIONS = new Set(["de", "del", "do", "da", "dos", "das", "of"]);

// T-39 (R7a): la clase de los cuantificadores que pueden
// preceder a un objeto (los indefinidos y los negativos de
// es/pt), nombrada una sola vez. La vía con espacios no
// pela cuantificadores ni los trae en ningún conjunto: los
// lee por transparencia (no son palabra cotidiana ni
// cabeza, y el objeto decide el veto), así que no hay
// conjunto con espacios del que la vía pegada pueda
// derivar el suyo. La clase vive aquí y la regex pegada
// (CUT_QUANTIFIER_GLUED_RE) se deriva de esta constante:
// la familia de «alguna-» sola dejaba fuera al
// cuantificador negativo, cuya cola «unas» es la raíz
// cotidiana que veta la corrida pegada. Van también las
// formas apocopadas plegadas («algún» → «algun»,
// «ningún» → «ningun»), la misma clase ante nombre
// masculino.
const CUT_QUANTIFIERS = new Set([
  "alguno", "alguna", "algunos", "algunas", "algun",
  "ninguno", "ninguna", "ningunos", "ningunas", "ningun",
  "algum", "alguma", "alguns", "algumas",
  "nenhum", "nenhuma", "nenhuns", "nenhumas",
]);

// Cabezas de sintagma que son un lugar de daño: con una de estas
// delante, el veto no se aplica nunca (texto ya plegado, sin
// acentos: «muñecas» llega como «munecas», «pés» como «pes»).
const CUT_HARM_HEADS = new Set([
  "vena", "venas", "veia", "veias", "muneca", "munecas", "pulso", "pulsos",
  "garganta", "gargantas", "cuello", "cuellos", "pescoco", "pescocos",
  "brazo", "brazos", "braco", "bracos", "antebrazo", "antebrazos", "antebraco", "antebracos",
  "muslo", "muslos", "coxa", "coxas", "pierna", "piernas", "perna", "pernas",
  "dedo", "dedos", "mano", "manos", "mao", "maos", "piel", "pele",
  "cara", "rostro", "rosto", "cabeza", "cabeca", "pecho", "peito",
  "tobillo", "tobillos", "tornozelo", "tornozelos",
  "yugular", "jugular", "arteria", "arterias", "tendon", "tendones", "tendao", "tendoes",
  "pie", "pies", "pe", "pes", "ojo", "ojos", "olho", "olhos",
  "lengua", "lingua", "oreja", "orejas", "orelha", "orelhas", "nariz",
  // T-31: la barbilla es el mentón, un lugar del cuerpo; vetarla
  // por la raíz «barb-» de la barba era la frontera medida en el
  // acta (su gemelo «el mentón» sí dispara).
  "barbilla",
  "vein", "veins", "wrist", "wrists", "throat", "neck", "arm", "arms",
  "forearm", "forearms", "thigh", "thighs", "leg", "legs",
  "finger", "fingers", "hand", "hands", "skin", "face", "head",
  "foot", "feet", "ankle", "ankles", "artery", "arteries",
  "chest", "eye", "eyes", "tongue", "ear", "ears",
]);

// Raíces de clase cotidiana (prefijos sobre el texto plegado):
// aseo y pelo en es/pt, porciones, y el vocabulario inglés de
// servirse comida y de los modismos («some slack», «a break»).
// T-31 suma la ropa (decisión del acta de la repetición, §4):
// mang-, pantalon, camis-, vestid-, fald-, blus-, calc-.
// T-32 (R3a) la cubre como clase: las familias corrientes de
// prendas de los tres idiomas que faltaban (chaqueta, zapatos,
// guantes, bufanda, sombrero, abrigo, corbata, gorra, meias,
// casaco y sus hermanas).
const CUT_EVERYDAY_STEMS = [
  "cabel", "pel", "flequill", "franj", "unh", "barb", "bigot", "bigod",
  "cuticul", "punt", "pont", "patill", "perill", "vell", "cej",
  "sobrancelh", "pestan", "melen", "trenz", "colet",
  "troz", "pedaz", "pedac", "rebanad", "tajad", "fati", "rodaj",
  "porc", "racion", "pastel", "tarta", "torta", "bolo", "pizza",
  "mang", "pantalon", "camis", "vestid", "fald", "blus", "calc",
  "chaquet", "jaquet", "chamarr", "zapat", "sapat", "guant", "luv",
  "bufand", "cachecol", "sombrer", "chapeu", "abrig", "casac",
  "corbat", "gravat", "gorr", "meia", "sandal", "sueter", "jersey",
  "sudader", "moletom", "player", "remer", "poler", "camper",
  "chalec", "bota", "botin", "pijam", "uniform", "panuel",
  // T-34 (R4a): el anillo canónico que la ronda 4 midió fuera
  // («sandal» sustituye a «sandali»: vale sandalias, sandália
  // y la inglesa sandals, que no colgaba de la raíz vieja).
  "vaquer", "cazador", "chancl", "calzon", "banador", "mall",
  "sujetador", "mocasin", "chandal", "alpargat", "pantuf",
  "chinel", "cuec", "sutia", "sneak", "pajam", "leggin", "swimsuit",
  // T-35 (R5a): el anillo medido por la ronda 5 — «t-shirt»
  // como token con guion (la palabra leída entera, que no
  // cuelga de «shirt»), raincoat (que no cuelga de «coat»),
  // sweatshirt, cardigan, brag- (bragas), macac- (macacão) —
  // y los corrientes de la frontera medida de la misma
  // ronda (overall- de overalls, jumpsuit). La clase es la
  // lista enumerada; su alcance redefinido va en el
  // comentario de la clase, arriba.
  "t-shirt", "raincoat", "sweatshirt", "cardigan", "brag", "macac",
  "overall", "jumpsuit",
  "hair", "nail", "beard", "mustach", "moustach", "bang",
  "jacket", "shoe", "glove", "scarv", "sweater", "hoodie", "shirt",
  "jeans", "sock", "dress", "coat", "boot",
  "slice", "piece", "chunk", "cake", "bread",
];

// Palabras cotidianas que no pueden ir por raíz sin colisionar
// («pie» es el pie, un lugar de daño, y queda fuera a propósito;
// «pan» por raíz valdría también «pantalón»).
const CUT_EVERYDAY_WORDS = new Set([
  "unas", "pan", "pao", "queso", "quesos", "queijo", "queijos", "slack", "break",
  // T-31: la ropa que no va por raíz.
  "ropa", "roupa", "saia", "saias", "shorts", "bermuda", "bermudas",
  // T-32 (R3a): más ropa que no puede ir por raíz sin
  // colisionar («cintur-» valdría también «cintura», que es el
  // cuerpo; «hat» por raíz valdría «hate»).
  "tenis", "medias", "cinturon", "cinturones", "cinto", "cintos",
  "traje", "trajes", "bata", "batas", "delantal", "delantales",
  "avental", "aventais",
  "tie", "ties", "hat", "hats", "cap", "caps", "pants", "trousers",
  "skirt", "skirts", "blouse", "blouses", "underwear",
  // T-34 (R4a): el boné y el terno portugueses, como palabras
  // («bone» por raíz valdría dentro de palabras ajenas a la
  // clase, y «tern-» valdría «ternura»).
  "bone", "bones", "terno", "ternos",
  // T-35 (R5a): el singular corriente de «shorts» («el
  // short», «o short», la forma de nombrarlo en es/pt) y el
  // «tank» de «tank top», como palabras: por raíz valdrían
  // dentro de palabras ajenas a la clase.
  "short", "tank",
]);

// La lectura del sintagma tras la forma de «cortar» (T-31): ya
// no es una sola corrida de palabras, son SEGMENTOS. La
// conjunción («y», «e», «and») separa objetos coordinados y se
// leen todos; el relativo y el contraste («que», «pero»,
// «mas») cierran la lectura, como antes; y lo que abre un
// adjunto de instrumento («con», «com», «with», «usando»,
// «using», «utilizando») abre un segmento adjunto, que no es el
// objeto y no decide el veto — salvo que tras el instrumento
// venga otro objeto con su determinante («con unas tijeras las
// venas»): ese sí se lee como objeto.
const CUT_CONJUNCTIONS = new Set(["y", "e", "and"]);
const CUT_STOP_WORDS = new Set(["que", "pero", "mas"]);
// T-37 (R6c): la familia «más + adverbio de tiempo» que el
// segmentador reconoce como fórmula española ante el token
// plegado «mas» (R5c la abrió con «tarde»/«temprano»; la
// ronda 6 midió que la familia corriente es más ancha:
// «más luego» perdía el verdadero y «más adelante» solo se
// rescataba por el accidente de letra pegado). La familia
// se decide entera y queda escrita aquí: «mas» seguido de
// una de estas segundas palabras abre el objeto siguiente;
// seguido de cualquier otra, cierra, que es el diseño
// declarado. La gemela portuguesa («mais») no pasa por el
// segmentador —«mais» no es palabra de cierre— y su familia
// va en CUT_FRONT_LOCUTIONS («tarde», «cedo», «logo»,
// «adiante»).
const CUT_MAS_FORMULA_SECONDS = new Set(["tarde", "temprano", "luego", "adelante"]);
const CUT_ADJUNCT_STARTERS = new Set(["con", "com", "with", "usando", "using", "utilizando"]);

interface CutSegment {
  adjunct: boolean;
  words: string[];
}

function cutObjectSegments(folded: string, from: number): CutSegment[] {
  const segments: CutSegment[] = [];
  let adjunct = false;
  let words: string[] = [];
  const close = () => {
    segments.push({ adjunct, words });
    words = [];
  };
  // ¿El segmento adjunto ya leyó su instrumento? (una palabra
  // que no es determinante ni preposición: «tijeras», «par»…)
  const adjunctHasInstrument = () =>
    words.some((w) => !CUT_DETERMINERS.has(w) && !CUT_PREPOSITIONS.has(w) && w !== "unas" && w !== "umas");
  const cleanWord = (raw: string) =>
    raw.replace(/^[¿?¡!.,;:()"'«»]+/g, "").replace(/[.,;:!?)"'»]+$/g, "");
  let total = 0;
  const raws = folded.slice(from).split(" ");
  for (let ri = 0; ri < raws.length; ri++) {
    const raw = raws[ri]!;
    if (raw === "") continue;
    const word = cleanWord(raw);
    // El token cuyos cierres de puntuación rigen esta vuelta
    // (la fórmula de R5c consume dos tokens).
    let lastRaw = raw;
    if (CUT_STOP_WORDS.has(word)) {
      // T-35 (R5c): «mas» seguido de «tarde» o «temprano»
      // no es el «mas» portugués de cierre: es la fórmula
      // española «más tarde» plegada, un secuenciador de
      // enumeración, y abre el objeto siguiente con la
      // fórmula dentro (la cabeza se lee tras ella, como
      // tras cualquier mediador). «Mas» seguido de
      // cualquier otra cosa sigue cerrando la lectura,
      // como manda el diseño declarado.
      // T-37 (R6c): la fórmula es la familia entera de
      // CUT_MAS_FORMULA_SECONDS, no dos palabras.
      const next = ri + 1 < raws.length ? cleanWord(raws[ri + 1]!) : "";
      if (word === "mas" && CUT_MAS_FORMULA_SECONDS.has(next)) {
        close();
        adjunct = false;
        words.push("mas", next);
        total += 2;
        lastRaw = raws[ri + 1]!;
        ri++;
      } else break;
    } else if (CUT_CONJUNCTIONS.has(word)) {
      close();
      adjunct = false;
    } else if (CUT_ADJUNCT_STARTERS.has(word)) {
      close();
      adjunct = true;
    } else if (word !== "") {
      // Dentro de un adjunto ya completo, un determinante abre
      // el objeto que sigue al instrumento.
      if (adjunct && adjunctHasInstrument() && CUT_DETERMINERS.has(word)) {
        close();
        adjunct = false;
      }
      words.push(word);
      total++;
    }
    // T-32 (R3c): la puntuación de lista (coma, punto y coma,
    // dos puntos) no corta la lectura: cierra el objeto en
    // curso y la lista sigue, como la conjunción («las
    // cutículas, las puntas y la barbilla» lee los tres
    // objetos). La de fin de frase (punto, !, ?) sí cierra la
    // lectura, como siempre.
    if (/[.!?]/.test(lastRaw)) break;
    if (/[,;:]/.test(lastRaw)) {
      close();
      adjunct = false;
    }
    // T-32 (R3c): el tope de palabras leídas sube de 8 a 14:
    // con la lista entera en juego, una coordinación de tres
    // objetos con complemento («las uñas de los pies, las
    // puntas del pelo y las venas», 11 palabras) se quedaba
    // sin leer el último objeto por el tope, y el daño se
    // perdía igual que tras la coma. La lectura sigue
    // acotada por las palabras de cierre y por el fin de
    // frase; el freno entero se re-midió con el tope nuevo.
    // T-34 (R4d): la ronda 4 rozó ese tope por los dos lados
    // (la cabeza como 14ª palabra entraba; como 15ª, no) con
    // una enumeración corriente de tres objetos con
    // complemento que pone la cabeza en la 16ª palabra
    // («las uñas de los pies, las puntas del pelo, el vello
    // de las piernas y las venas»). El tope sube de 14 a 20
    // con el freno entero re-medido otra vez; la frontera
    // queda escrita: una cabeza más allá de la 20ª palabra
    // leída sigue sin leerse.
    if (total >= 20) break;
  }
  close();
  return segments;
}

// Lo que se puede pelar del frente de un objeto para leer su
// cabeza: determinantes, la preposición («de nuevo») y los
// cuantificadores («las dos muñecas», «as duas mãos»).
const CUT_FRONT_SKIP = new Set([
  ...CUT_DETERMINERS,
  "de", "del", "do", "da", "dos", "das", "of",
  "dois", "duas", "tres", "both",
]);

// T-32 (R3c): los adverbios de coordinación que pueden abrir
// el objeto coordinado («y también las venas», «e também as
// veias», «y solo…», «y hasta…», «e só…», «e até…»). Se pelan
// del frente como los determinantes: sin pelarlos, el
// adverbio se leía como la cabeza y el lugar de daño que
// seguía no mandaba. Solo se pelan del frente de un objeto
// (nunca la última palabra, como todo el pelado): «cortarme
// solo» sigue leyendo «solo» como lo que es ahí, el resto de
// la frase.
// T-34 (R4b y R4c): entran los secuenciadores corrientes de
// enumeración (luego, después, encima, aún; depois, ainda,
// logo), que escondían la cabeza igual que los adverbios, y
// «mesmo», la segunda mitad de la fórmula portuguesa «até
// mesmo», que no se pelaba en ninguna vía.
// T-35 (R5b): entran «finalmente» y los mediadores ingleses
// («finally», «also», «even»): la ronda 5 midió que su
// cobertura verde era un accidente de letra de la vía
// pegada (el prefijo acabado en «e» o en «y»), no la
// lectura con espacios; ahora se pelan también aquí y la
// cabeza se lee por lectura en las dos vías.
// T-37 (R6d): entran los secuenciadores ingleses «then» y
// «next», la fórmula corriente de enumeración de la tercera
// lengua («and then»): la ronda 6 midió que no se leían en
// ninguna vía y que su verde con «the»/«my» era el mismo
// accidente de letra («and then her veins» no disparaba).
const CUT_FRONT_ADVERBS = new Set([
  "tambien", "tambem", "solo", "so", "hasta", "ate",
  "incluso", "inclusive", "ademas", "alem",
  "luego", "despues", "encima", "aun",
  "depois", "ainda", "logo", "mesmo",
  "finalmente", "finally", "also", "even",
  "then", "next",
]);

// T-35 (R5b): las locuciones corrientes de enumeración, la
// clase que la ronda 5 midió escondiendo la cabeza igual
// que las palabras sueltas de R4b. No son palabras que se
// pelan una a una: son fórmulas de dos o tres palabras
// («a continuación» deja «continuación» de cabeza si solo
// se pela la «a»; «en seguida», «después de todo» dejan
// «seguida» o «todo»), así que se pelan como unidad del
// frente del objeto, con la misma regla de siempre (nunca
// a través de la última palabra). La lista es la medida
// por la ronda 5 con su gemela portuguesa de «en primer
// lugar»; «mas tarde»/«mas temprano» es la fórmula
// española plegada que el segmentador ya dejó pasar (R5c)
// y «mais tarde»/«mais cedo» su gemela portuguesa.
// T-37 (R6c): la familia «más/mais + adverbio de tiempo»
// entera, con las segundas palabras que la ronda 6 midió
// («luego», «adelante»/«adiante») y la gemela portuguesa de
// «luego» («logo»): sin la locución, la primera palabra de
// la fórmula quedaría de cabeza («mas» no se pela suelto y
// «mais» tampoco).
const CUT_FRONT_LOCUTIONS: readonly string[][] = [
  ["a", "continuacion"],
  ["en", "seguida"],
  ["em", "seguida"],
  ["sobre", "todo"],
  ["despues", "de", "todo"],
  ["acto", "seguido"],
  ["en", "primer", "lugar"],
  ["em", "primeiro", "lugar"],
  ["mais", "tarde"],
  ["mais", "cedo"],
  ["mais", "logo"],
  ["mais", "adiante"],
  ["mas", "tarde"],
  ["mas", "temprano"],
  ["mas", "luego"],
  ["mas", "adelante"],
];

function isEverydayCutObject(word: string): boolean {
  return CUT_EVERYDAY_WORDS.has(word) || CUT_EVERYDAY_STEMS.some((s) => word.startsWith(s));
}

/** La cabeza de un objeto: su primera palabra tras el frente pelable. */
function cutSegmentHead(words: string[]): string | undefined {
  let i = 0;
  // Nunca se pela la última palabra: «las uñas» plegado es «las
  // unas», y «unas» es a la vez determinante y el objeto mismo.
  // T-34 (R4c): el pelado ya no tiene presupuesto de palabras.
  // Lo tenía de 3 contando determinantes y adverbios juntos, y
  // la pila corriente de mediadores lo agotaba antes de llegar
  // a la cabeza («y hasta incluso también las venas» dejaba
  // «las» de cabeza y el daño no mandaba). Se pela todo el
  // frente funcional y la cabeza es la primera palabra que no
  // es función: el frente de un objeto corriente es corto y la
  // lectura entera ya va acotada por el tope de palabras.
  while (i < words.length - 1) {
    const w = words[i]!;
    if (w === "unas" || w === "umas") {
      // R3: el token ambiguo no se pela como determinante; solo
      // cede cuando lo que sigue ya es una cabeza reconocida
      // («unas venas», «unas pestañas»), porque entonces sí era
      // el artículo. Con complemento («las uñas de los pies»)
      // la cabeza es «uñas» misma.
      const next = words[i + 1]!;
      if (CUT_HARM_HEADS.has(next) || (next !== "unas" && next !== "umas" && isEverydayCutObject(next))) {
        i++;
        continue;
      }
      break;
    }
    // T-35 (R5b): una locución de enumeración al frente se
    // pela entera, como unidad, antes de mirar la palabra
    // suelta (si no, su primera palabra se pela como
    // determinante o preposición y el resto queda de
    // cabeza: «a continuación», «después de todo»).
    const loc = CUT_FRONT_LOCUTIONS.find(
      (l) => i + l.length < words.length && l.every((lw, k) => words[i + k] === lw),
    );
    if (loc) {
      i += loc.length;
      continue;
    }
    if (!CUT_FRONT_SKIP.has(w) && !CUT_FRONT_ADVERBS.has(w)) break;
    i++;
  }
  return words[i];
}

/** ¿Alguna forma de «cortar» del mensaje lleva un objeto cotidiano (y ninguna un lugar de daño)? */
function cutObjectVeto(folded: string): boolean {
  let everyday = false;
  for (const m of folded.matchAll(CUT_ANCHOR_RE)) {
    const objects = cutObjectSegments(folded, m.index + m[0].length).filter(
      (s) => !s.adjunct && s.words.length > 0,
    );
    // La cabeza de daño manda en cualquier objeto del sintagma
    // completo, también en el segundo coordinado (R2).
    if (objects.some((s) => CUT_HARM_HEADS.has(cutSegmentHead(s.words) ?? ""))) return false;
    if (objects.some((s) => s.words.some(isEverydayCutObject))) everyday = true;
  }
  return everyday;
}

// La gemela pegada (dictado sin espacios): las mismas clases como
// raíces dentro de la corrida que sigue al ancla pegada.
const CUT_ANCHOR_GLUED_RE = /(?:cortarme|cortar-me|mecortar|mequierocortar|mevoyacortar|cutmyself|cuttingmyself)/g;
const CUT_HARM_GLUED_STEMS = [
  "vena", "veia", "munec", "gargant", "cuell", "pescoc", "braz", "brac",
  "musl", "cox", "piern", "pern", "ded", "piel", "pele", "cara", "rost",
  "tobill", "tornozel", "jugular", "yugular", "arter", "puls",
  "cabec", "cabez", "ojo", "pie", "wrist", "vein", "throat", "neck",
  "arm", "thigh", "finger", "skin", "ankle",
  // T-31: la barbilla, como en la vía con espacios.
  "barbill",
  // T-40 (R8a y R8b): la lista quedó completada con decisión
  // escrita por cabeza, medida sobre las listas reales: ninguna
  // de estas raíces es prefijo de ninguna palabra ni raíz
  // cotidiana (la colisión que rompería el veto), y cada una
  // cubre solo las cabezas de su familia. «arter» sustituye a
  // «arteri» como raíz de la familia: cubre las mismas
  // (arteria, arterias, arteries) y además «artery», el caso
  // que T-39 dejó medido. Las de R8b («antebraz», «antebrac»,
  // «forearm») leen su cabeza por la raíz AL INICIO de la
  // palabra en posición de objeto: antes su única aparición
  // dejaba delante «ante»/«fore», acabados en «e», y el test
  // de frontera la aceptaba como si fuera la conjunción
  // fundida, sin que el código lo declarara (el discriminador
  // de la ronda 8, «desarmado», trae su «arm» a mitad de
  // palabra tras consonante y sigue sin rescatar). La
  // repetición de la ronda 9 midió lo que la redacción de
  // T-40 no decía: la aparición INTERIOR de las mismas
  // raíces («braz»/«brac»/«arm» tras «ante»/«fore») seguía
  // rescatando por la letra desde las posiciones donde la
  // lectura no opera, el complemento fundido sin
  // determinante y la fusión sobre el objeto anterior
  // («quierocortarmelasuñasdelantebrazo», «elpeloantebrazo»,
  // «myhairforearm»: 16 casos con expectativa), donde la vía
  // con espacios veta porque manda su primer objeto. Desde
  // T-41 la puerta de sitio no acepta una aparición
  // estrictamente interior a una palabra de la clase
  // (gluedStemIsInterior, en gluedHarmHeads): esas
  // posiciones vetan en paridad, y de las seis cabezas no
  // queda cobertura por letra en ninguna posición.
  // Las colisiones de raíz al inicio de una palabra que no
  // veta («lenguado» por «lengu», «pechuga» por «pech», como
  // «venado» por «vena») son la frontera declarada desde R1,
  // en la dirección de sobre-disparo. Y una cobertura por
  // letra que sí queda, declarada como la de «whose»: la raíz
  // «head» aparece también a mitad de «forehead», tras un
  // prefijo acabado en «e», así que esa palabra —que no es
  // cabeza de la clase, y por eso su «head» no es aparición
  // interior a una palabra de la clase para la puerta de
  // T-41— queda rescatada por la frontera de
  // letra cuando un objeto cotidiano veta en la misma corrida
  // (medido por T-40: la lectura con espacios veta por su
  // primer objeto, pero la gemela pegada la rescata y el
  // mensaje dispara en las dos grafías, como «venado»; la
  // cabeza «head» misma se lee por su raíz en frontera
  // limpia). Las tres cabezas que ninguna raíz puede abrir
  // sin rescatar al objeto que veta («pe» rescataría «pelo»,
  // «pes» a «pestañas», «leg» a «leggins») no van aquí: se
  // leen como palabra entera en CUT_HARM_GLUED_FULL_HEADS.
  "mano", "mao", "pech", "peit", "tend", "lengu", "lingu", "orej",
  "orelh", "nariz", "olh", "hand", "face", "head", "foot", "feet",
  "chest", "tongu", "eye", "ear", "legs",
  "antebraz", "antebrac", "forearm",
];

// T-40 (R8a): las cabezas de CUT_HARM_HEADS que ninguna raíz
// de la lista abre al inicio de la palabra. La lista se
// DERIVA de la constante de cabezas, como T-39 derivó los
// determinantes y los cuantificadores de las suyas: con las
// raíces completadas quedan exactamente «pe», «pes» y «leg»
// (el pie y los pies portugueses, cuyo singular «pie»
// español sí va por raíz, y la pierna inglesa, cuyo plural
// «legs» sí va por raíz porque ninguna palabra cotidiana
// empieza por «legs»). Se leen como palabra entera en
// gluedHarmHeads, con la guarda de su sitio: la aparición no
// cuenta si la corrida en ese punto empieza por una raíz
// cotidiana, porque entonces la palabra es el objeto que
// veta y no la cabeza («pe» dentro de «pelo», «pes» dentro
// de «pestañas», «leg» dentro de «leggins», y «pedazo» o
// «pedaço» tras su «pe»).
const CUT_HARM_GLUED_FULL_HEADS = [...CUT_HARM_HEADS].filter(
  (h) => !CUT_HARM_GLUED_STEMS.some((s) => h.startsWith(s)),
);
const CUT_EVERYDAY_GLUED_STEMS = [
  "cabel", "pel", "flequill", "franj", "unh", "unas", "barb", "bigot", "bigod",
  "cuticul", "punt", "pont", "patill", "perill", "vell", "cej",
  "sobrancelh", "pestan", "melen", "trenz", "colet",
  "troz", "pedaz", "pedac", "rebanad", "tajad", "fati", "rodaj",
  "porc", "racion", "pastel", "tarta", "torta", "bolo", "pizza",
  "ques", "queij", "pan", "pao", "slack", "break", "slice", "piece", "chunk",
  "cake", "bread", "hair", "nail", "beard", "mustach", "moustach", "bang",
  // T-31: la ropa, las mismas clases que con espacios.
  "mang", "pantalon", "camis", "vestid", "fald", "blus", "calc",
  "ropa", "roupa", "saia", "bermud",
  // T-32 (R3a): la clase cubierta entera, como con espacios.
  // Sin «hat» ni «tie»: como corrida pegada valdrían también
  // dentro de «hate» o «tiene», que no son prendas.
  "chaquet", "jaquet", "chamarr", "zapat", "sapat", "guant", "luv",
  "bufand", "cachecol", "sombrer", "chapeu", "abrig", "casac",
  "corbat", "gravat", "gorr", "meia", "medias", "sandal", "sueter",
  "sudader", "moletom", "player", "remer", "poler", "camper",
  "chalec", "bota", "botin", "pijam", "uniform", "panuel",
  "tenis", "cinturon", "cinto", "traje", "bata", "delantal", "avental",
  "jacket", "shoe", "glove", "scarv", "sweater", "hoodie", "shirt",
  "jeans", "sock", "dress", "coat", "boot", "pants", "skirt",
  "blouse", "underwear", "trousers",
  // T-34 (R4a): el mismo anillo canónico que con espacios.
  "vaquer", "cazador", "chancl", "calzon", "banador", "mall",
  "sujetador", "mocasin", "chandal", "alpargat", "pantuf",
  "chinel", "cueca", "sutia", "sneak", "pajam", "leggin", "swimsuit",
  "bone", "terno",
  // T-35 (R5a): el anillo de la ronda 5, como con espacios.
  // «losshorts» no tenía raíz pegada: entra «short» (vale
  // también el singular pegado). «t-shirt» y «raincoat» ya
  // vetaban por sus raíces «shirt» y «coat» como subcadena.
  "short", "tank", "cardigan", "brag", "macac", "overall", "jumpsuit",
];

// Lo que abre un adjunto de instrumento en la corrida pegada
// («conunastijeras», «comumatesoura»): el adjunto no veta (R1).
const CUT_ADJUNCT_GLUED_STARTERS = ["con", "usando", "com", "with"];

/**
 * ¿La corrida pegada nombra un lugar de daño como CABEZA de un
 * objeto? Sin espacios no hay sintagma que leer, así que la
 * cabeza se reconoce por su sitio: abre la corrida (con su
 * determinante pegado delante, «lasvenas») o abre un objeto
 * coordinado («…ylasvenas»). Tras el «de» del complemento no
 * manda: «lasunasdelospies» lleva su «pies» de complemento de
 * «uñas», no de objeto, y «elvellodelaspiernas» su «piernas»
 * de modificador — los dos vetan por su palabra cotidiana,
 * como fijó T-27.
 */
// La regex de sufijo de una clase nombrada por una
// constante: las formas ordenadas por longitud (la más
// larga primero, para pelar «minhas» entero y no su cola
// «as») como alternativa anclada al final.
function gluedSuffixRe(words: Iterable<string>): RegExp {
  const alt = [...words]
    .sort((a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0))
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  return new RegExp(`(?:${alt})$`);
}

// El determinante pegado que puede preceder a la cabeza
// («lasvenas»).
// T-37 (R6d): entraron los determinantes ingleses («the»,
// «her», «his», «my»): sin ellos, la cabeza inglesa tras
// su determinante no se reconocía pegada y solo la
// rescataba el accidente de la letra final del prefijo.
// T-39 (R7b): la lista enumerada volvió a quedarse
// estrecha un anillo más afuera (los posesivos es/pt y
// «your»/«their»/«our»/«an»/«some», que la vía con
// espacios sí lee), así que la regex ya no se enumera:
// se DERIVA de CUT_DETERMINERS, la constante que lee la
// vía con espacios, y las dos vías no pueden volver a
// separarse por enumeración. Del conjunto derivado solo
// sale el par ambiguo «unas»/«umas», que conserva su
// pelado propio con frontera en peelGluedDeterminer
// (R5e): como cola de una palabra que no es el
// cuantificador sigue sin pelarse como determinante.
// La rama del adjunto usa la derivación con el conjunto
// completo (CUT_DET_GLUED_FULL_RE, con el par ambiguo,
// como su lista de R3b): ahí no se pela nada, solo se
// mira si la palabra anterior a la raíz cotidiana es un
// determinante.
const CUT_DET_GLUED_RE = gluedSuffixRe(
  [...CUT_DETERMINERS].filter((w) => w !== "unas" && w !== "umas"),
);
const CUT_DET_GLUED_FULL_RE = gluedSuffixRe(CUT_DETERMINERS);

// T-32 (R3c): el adverbio de coordinación pegado que puede
// preceder al determinante de la cabeza («…ytambienlas…»,
// «…etambem…»), como en la vía con espacios.
// T-34 (R4b y R4c): entran los secuenciadores (luego,
// después, encima, aún; depois, ainda, logo) y «mesmo», y el
// pelado encadena: tras pelar un mediador se vuelve a mirar.
// T-35 (R5b y R5d): entran «finalmente» y «finally», y las
// fórmulas con «tarde»/«cedo»/«temprano» van como unidades
// al principio de la alternativa: sueltas, el «tarde»
// final haría pasar la fórmula por el «de» del
// complemento. El enlace de la cadena ya no es esta regex
// con su guarda de letra: es el bucle de gluedHarmHeads,
// por mediador.
// T-37 (R6a, R6c, R6d y la paridad de locuciones): la
// unidad de «más temprano» se escribe «mastemprano», la
// fórmula española real (la ronda 6 midió que traía
// «maistemprano», el «mais» portugués pegado al
// «temprano» español, una forma que no ocurre en ninguna
// lengua: sale de la cadena). Entran las demás unidades
// de la familia «más/mais» («masluego», «masadelante»,
// «maislogo», «maisadiante»), las locuciones enteras de
// CUT_FRONT_LOCUTIONS fundidas (la paridad pegada que la
// ronda 6 dejó medida: donde la locución abre un objeto,
// tras conjunción o puntuación, la cabeza se lee también
// en esta vía) y los secuenciadores ingleses «then» y
// «next», como unidades y mediadores al principio de la
// alternativa por la misma razón de siempre.
const CUT_MEDIATOR_GLUED_RE =
  /(?:mastarde|mastemprano|maistarde|maiscedo|masluego|masadelante|maislogo|maisadiante|acontinuacion|enseguida|emseguida|sobretodo|despuesdetodo|actoseguido|enprimerlugar|emprimeirolugar|tambien|tambem|finalmente|finally|incluso|inclusive|ademas|alem|despues|depois|solo|also|hasta|ate|so|luego|encima|aun|ainda|logo|mesmo|even|then|next)$/;

// T-37 (R6b): el cuantificador fundido que puede preceder
// a la cabeza («algunasvenas»): la familia entera, es/pt.
// T-39 (R7a): la familia escrita era solo la de «alguna-»
// y el cuantificador negativo perdía el verdadero por su
// cola cotidiana («…ningunasvenas»). La regex se deriva
// de CUT_QUANTIFIERS, la constante que nombra la clase
// entera (indefinidos y negativos), para que la familia
// no pueda volver a quedarse más estrecha que la clase.
const CUT_QUANTIFIER_GLUED_RE = gluedSuffixRe(CUT_QUANTIFIERS);

/**
 * El prefijo sin su determinante pegado final. T-35 (R5e):
 * «unas»/«umas» se pelan ENTEROS cuando van pegados a una
 * frontera (el inicio, la conjunción, la puntuación de
 * lista, otro mediador o un determinante), porque ante la
 * cabeza reconocida son el artículo, como con espacios
 * (R3); como cola de otra palabra («algunas») no se
 * pelan, y la lista corta pela su «as» como siempre.
 * T-37 (R6b): la frontera de arriba se re-escribe a lo
 * que la cura cubre de verdad. El cuantificador entero
 * («algunas» y su familia) SÍ se pela como unidad cuando
 * va pegado a una frontera, antes de mirar su cola: la
 * ronda 6 midió que «quierocortarmealgunasvenas» perdía
 * el verdadero porque la corrida vetaba por la subcadena
 * «unas» sin que la cabeza tras el cuantificador se
 * reconociera. Lo que sigue sin pelarse es el «unas»
 * cola de una palabra que no es el cuantificador.
 */
function peelGluedDeterminer(prefix: string): string {
  const quant = CUT_QUANTIFIER_GLUED_RE.exec(prefix);
  if (quant) {
    const before = prefix.slice(0, prefix.length - quant[0].length);
    if (
      before === "" ||
      /[ye,;:]$/.test(before) ||
      CUT_MEDIATOR_GLUED_RE.test(before) ||
      CUT_DET_GLUED_RE.test(before)
    ) {
      return before;
    }
  }
  const amb = /(?:unas|umas)$/.exec(prefix);
  if (amb) {
    const before = prefix.slice(0, prefix.length - amb[0].length);
    if (
      before === "" ||
      /[ye,;:]$/.test(before) ||
      CUT_MEDIATOR_GLUED_RE.test(before) ||
      CUT_DET_GLUED_RE.test(before)
    ) {
      return before;
    }
  }
  const det = CUT_DET_GLUED_RE.exec(prefix);
  return det ? prefix.slice(0, prefix.length - det[0].length) : prefix;
}

// ¿La aparición que empieza en el índice i de la corrida
// está en el sitio de una cabeza (abre la corrida o un
// objeto)? Es la decisión que gluedHarmHeads aplicaba a
// cada aparición de raíz, extraída sin cambiarla para que
// las palabras enteras de T-40 pasen por la misma puerta.
function gluedHeadAtBoundary(tail: string, i: number): boolean {
  let prefix = peelGluedDeterminer(tail.slice(0, i));
  // T-35 (R5d): la cadena de mediadores enlaza POR
  // MEDIADOR, no por letra. La forma de T-34 exigía
  // que el carácter anterior al mediador fuera «y»,
  // «e» o puntuación, así que la pila corriente
  // «também só» no se pelaba (el mediador va tras la
  // «m» de «também») y «também até» solo se reconocía
  // por la «e» final de «até». Ahora un mediador se
  // pela cuando lo que lo precede es el inicio, la
  // conjunción, la puntuación, otro mediador o un
  // determinante; si lo precede cualquier otra cosa
  // no se pela: es la cola de una palabra de
  // contenido («consolo» no es «con» + «solo», ni el
  // «logo» de «catálogo» un secuenciador).
  for (;;) {
    const med = CUT_MEDIATOR_GLUED_RE.exec(prefix);
    if (!med) break;
    const before = prefix.slice(0, prefix.length - med[0].length);
    if (
      before !== "" &&
      !/[ye,;:]$/.test(before) &&
      !CUT_MEDIATOR_GLUED_RE.test(before) &&
      !CUT_DET_GLUED_RE.test(before) &&
      // T-37 (R6d): la conjunción inglesa «and» es
      // frontera de la cadena, como la «y»/«e» de una
      // letra («…andthen…» pela «then»).
      !before.endsWith("and")
    ) {
      break;
    }
    prefix = before;
  }
  // Tras el «de» del complemento no es cabeza («…de» acaba
  // en «e» y no es la conjunción): es el caso de arriba.
  // La cadena va antes de este control para que las
  // fórmulas con «tarde» se pelen como unidad y no
  // caigan en él.
  if (/(?:de|del|do|da|dos|das)$/.test(prefix)) return false;
  // La cabeza también abre el objeto tras la puntuación
  // de lista pegada («elpelo,las…»): la coma cierra el
  // objeto anterior igual que la conjunción.
  // T-37 (R6d): el prefijo acabado en la conjunción
  // inglesa «and» es frontera, como el acabado en «y»
  // o en «e».
  return prefix === "" || prefix.endsWith("y") || prefix.endsWith("e") || prefix.endsWith("and") || /[,;:]$/.test(prefix);
}

// T-41 (R9a): ¿la aparición de la raíz que empieza en i
// es estrictamente interior a una palabra de la clase?
// Lo es si la corrida deletrea una cabeza de
// CUT_HARM_HEADS desde un índice anterior que la
// contiene entera: la palabra abrió ahí, no en i, y la
// aparición interior no es una apertura de objeto. La
// cubierta es la palabra deletreada, no cualquier
// aparición de raíz: una raíz también aparece cruzando
// palabras («the» + «arm» deletrea «ear» desde la «e»
// del determinante), y la forma que saltaba toda
// aparición interior a otra raíz cortó casos fieles
// medidos por esta tanda («…andthenthearm» y
// «…andthentheartery» dejaban de disparar: su
// «arm»/«arter» abre su palabra y rebasa la «ear»
// espuria, no está contenida en ella).
function gluedStemIsInterior(tail: string, i: number, s: string): boolean {
  for (const h of CUT_HARM_HEADS) {
    for (let j = tail.indexOf(h); j >= 0 && j < i; j = tail.indexOf(h, j + 1)) {
      if (i + s.length <= j + h.length) return true;
    }
  }
  return false;
}

function gluedHarmHeads(tail: string): boolean {
  for (const s of CUT_HARM_GLUED_STEMS) {
    for (let i = tail.indexOf(s); i >= 0; i = tail.indexOf(s, i + 1)) {
      // T-41 (R9a): una aparición estrictamente interior
      // a una palabra de la clase no rescata la corrida:
      // su sitio no es el de una cabeza (ver
      // gluedStemIsInterior).
      if (gluedStemIsInterior(tail, i, s)) continue;
      if (gluedHeadAtBoundary(tail, i)) return true;
    }
  }
  // T-40 (R8a): las cabezas sin raíz (la lista derivada de
  // arriba) se buscan como palabra entera, por la misma
  // puerta de sitio que las raíces, con la guarda de la
  // palabra cotidiana: si la corrida en ese punto empieza
  // por una raíz de la clase cotidiana, la palabra es el
  // objeto que veta («pelo», «pestañas», «leggins») y no
  // la cabeza corta que comparte sus letras.
  for (const w of CUT_HARM_GLUED_FULL_HEADS) {
    for (let i = tail.indexOf(w); i >= 0; i = tail.indexOf(w, i + 1)) {
      if (CUT_EVERYDAY_GLUED_STEMS.some((s) => tail.startsWith(s, i))) continue;
      if (gluedHeadAtBoundary(tail, i)) return true;
    }
  }
  return false;
}

function cutObjectVetoGlued(glued: string): boolean {
  let everyday = false;
  for (const m of glued.matchAll(CUT_ANCHOR_GLUED_RE)) {
    // T-34 (R4d): la ventana pegada sube de 30 a 40 caracteres:
    // la enumeración corriente que con espacios dispara
    // («…laspuntasdelpeloytambienlasvenas») ponía su cabeza
    // en el carácter 32º de la corrida y la ventana de 30 la
    // dejaba fuera, el mismo mecanismo que el tope de
    // palabras de la vía con espacios. Frontera escrita: una
    // cabeza más allá del 40º carácter sigue sin leerse.
    const tail = glued.slice(m.index + m[0].length, m.index + m[0].length + 40);
    if (tail === "") continue;
    if (gluedHarmHeads(tail)) return false;
    // R1 pegado: si la corrida abre con el adjunto de
    // instrumento, el adjunto mismo no veta: es con qué se
    // corta, no el objeto («quierocortarmeconunastijeras»
    // dispara). Pero un objeto cotidiano que venga DESPUÉS del
    // instrumento, con su determinante pegado, sí veta, como
    // en la vía con espacios («…tijeraselpelo» no dispara).
    const starter = CUT_ADJUNCT_GLUED_STARTERS.find((s) => tail.startsWith(s));
    if (starter) {
      for (const s of CUT_EVERYDAY_GLUED_STEMS) {
        for (let i = tail.indexOf(s); i >= 0; i = tail.indexOf(s, i + 1)) {
          // T-32 (R3b): la lista de determinantes, en paridad
          // con la de gluedHarmHeads: sin los artículos
          // portugueses «o»/«a», el objeto tras el instrumento
          // no se reconocía en portugués pegado
          // («…tesouraocabelo», «…tesouraaunha» disparaban
          // cuando su gemela con espacios vetaba).
          // T-39 (R7b): la lista es la derivación del
          // conjunto completo de CUT_DETERMINERS (la misma
          // constante de la que deriva la de gluedHarmHeads,
          // aquí con el par ambiguo, como la lista de R3b):
          // el objeto tras el instrumento se reconoce tras
          // cualquier determinante que la vía con espacios
          // lee, también «the» («…knifethehair» vetaba solo
          // en portugués pegado; en inglés disparaba).
          if (i > starter.length + 2 && CUT_DET_GLUED_FULL_RE.test(tail.slice(0, i))) {
            everyday = true;
          }
        }
      }
      continue;
    }
    if (CUT_EVERYDAY_GLUED_STEMS.some((s) => tail.includes(s))) everyday = true;
  }
  return everyday;
}

const glueVetoSrc = (src: string) => src.replace(/\\b/g, "").replace(/\s+/g, "");
// La vía pegada del veto, sin la alternativa de ficción: modismo,
// marco médico y contexto laboral vetan en cualquier tramo.
const SELF_HARM_VETO_GLUED_MAIN_RE = new RegExp(
  glueVetoSrc(
    "\\b(?:" + SELF_HARM_VETO_IDIOM_SRC + "|" + SELF_HARM_VETO_MEDICAL_SRC + "\\b|" + SELF_HARM_VETO_CONTEXT_SRC + ")",
  ),
);
// La ficción, en la vía pegada, solo veta FUERA del tramo del
// patrón que declaró (guardarraíl de la tanda de variantes,
// cobrado por el CENSO-CIEGA-GASTADA): pegada, una palabra de
// ficción puede nacer del cruce de dos palabras de la propia
// frase de crisis («con»+«todo» = «conto» dentro de
// «quieroacabarcontodo») y vetaría la frase que el dictado pegó
// de verdad. Un marco de ficción dictado («escribeuncuentodonde…»)
// lleva su palabra fuera del tramo y sigue vetando.
const SELF_HARM_VETO_GLUED_FICTION_RE = new RegExp(glueVetoSrc(SELF_HARM_VETO_FICTION_SRC), "g");

const SELF_HARM_TEXT: Record<SafetyLang, string> = {
  es:
    "Siento que estés pasando por esto. No tienes que cargarlo a solas, y con ayuda lo que sientes puede cambiar.\n\n" +
    "Si estás en peligro ahora mismo o crees que puedes hacerte daño, llama ya al número de emergencias de tu país y pide a alguien que se quede contigo.\n\n" +
    "Hablar con una persona ayuda. Hay líneas de apoyo para esto:\n" +
    "- Estados Unidos: 988, por llamada o mensaje de texto.\n" +
    "- México: Línea de la Vida, 800 911 2000.\n" +
    "- España: 024.\n" +
    "- Brasil: CVV, 188.\n\n" +
    "Si tu país no está en la lista, busca hoy a alguien de confianza, un familiar, un amigo o un médico, y dile lo mismo que me escribiste a mí.\n\n" +
    "Soy un asistente sin conexión: no puedo llamar por ti ni sustituir a una persona. Este texto es fijo; no lo escribió un modelo.",
  en:
    "I'm sorry you're going through this. You don't have to carry it alone, and with help what you feel can change.\n\n" +
    "If you are in danger right now or think you might hurt yourself, call your country's emergency number now and ask someone to stay with you.\n\n" +
    "Talking to a person helps. There are support lines for this:\n" +
    "- United States: 988, by call or text.\n" +
    "- Mexico: Línea de la Vida, 800 911 2000.\n" +
    "- Spain: 024.\n" +
    "- Brazil: CVV, 188.\n\n" +
    "If your country isn't listed, reach out today to someone you trust, a relative, a friend or a doctor, and tell them what you wrote to me.\n\n" +
    "I'm an offline assistant: I can't call for you or take the place of a person. This is a fixed text; a model did not write it.",
  pt:
    "Sinto muito que você esteja passando por isso. Você não precisa carregar isso sem ninguém, e com ajuda o que você sente pode mudar.\n\n" +
    "Se você está em perigo agora ou acha que pode se machucar, ligue já para o número de emergência do seu país e peça para alguém ficar com você.\n\n" +
    "Conversar com uma pessoa ajuda. Existem linhas de apoio para isso:\n" +
    "- Brasil: CVV, 188.\n" +
    "- Estados Unidos: 988, por ligação ou mensagem de texto.\n" +
    "- México: Línea de la Vida, 800 911 2000.\n" +
    "- Espanha: 024.\n\n" +
    "Se o seu país não está na lista, procure hoje alguém de confiança, um familiar, um amigo ou um médico, e diga o mesmo que você me escreveu.\n\n" +
    "Sou um assistente offline: não posso ligar por você nem substituir uma pessoa. Este texto é fixo; não foi escrito por um modelo.",
};

/** ¿La persona cuenta, en primera persona, que quiere morir o hacerse daño? */
// La reparación de errata leve de estas caras (tanda de
// variantes, Familia 5; la ayuda vive en packFacts): el
// vocabulario sale de la tabla de autolesión, de las partes del
// veto y de las regex de monóxido y de la pregunta de
// emergencia, que son las caras que este fichero sirve.
const SAFETY_ERRATA_REPAIR = buildErrataRepair([
  ...SELF_HARM_PATTERNS,
  SELF_HARM_VETO_IDIOM_SRC,
  SELF_HARM_VETO_FICTION_SRC,
  SELF_HARM_VETO_MEDICAL_SRC,
  SELF_HARM_VETO_CONTEXT_SRC,
  CO_DEVICE_RE.source,
  CO_INDOOR_RE.source,
  CO_SYMPTOM_RE.source,
  CO_SYMPTOM_ONLY_DEVICE_RE.source,
  EMERGENCY_Q_RE.source,
]);

export function isSelfHarmMessage(userText: string): boolean {
  const folded = fold(SAFETY_ERRATA_REPAIR(userText)).replace(/\s+/g, " ").trim();
  if (folded.length === 0 || folded.length > 4000) return false;
  if (SELF_HARM_RE.test(folded) && !SELF_HARM_VETO_RE.test(folded) && !cutObjectVeto(folded)) return true;
  // CL-11b: la forma dictada con las palabras pegadas, contra la
  // misma lista sin espacios y con el mismo veto sin espacios.
  const glued = folded.replace(/ /g, "");
  if (!SELF_HARM_GLUED_RE.test(glued)) return false;
  if (SELF_HARM_VETO_GLUED_MAIN_RE.test(glued) || cutObjectVetoGlued(glued)) return false;
  // La ficción pegada veta solo fuera del tramo declarado (ver la
  // nota de SELF_HARM_VETO_GLUED_FICTION_RE).
  const spans: Array<[number, number]> = [];
  for (const m of glued.matchAll(new RegExp(SELF_HARM_GLUED_RE.source, "g"))) {
    spans.push([m.index ?? 0, (m.index ?? 0) + m[0].length]);
  }
  for (const m of glued.matchAll(SELF_HARM_VETO_GLUED_FICTION_RE)) {
    const a = m.index ?? 0;
    const b = a + m[0].length;
    if (!spans.some(([x, y]) => a < y && b > x)) return false;
  }
  return true;
}

export function matchSafetyAnswer(userText: string, lang: SafetyLang): SafetyHit | null {
  // Lo primero, y sin el tope de 400 caracteres de las demás reglas:
  // quien se desahoga escribe largo.
  if (isSelfHarmMessage(userText)) {
    return { kind: "self-harm", lang, text: SELF_HARM_TEXT[lang], deterministic: true };
  }
  const folded = fold(SAFETY_ERRATA_REPAIR(userText)).replace(/\s+/g, " ").trim();
  if (folded.length === 0 || folded.length > 400) return null;

  const device = CO_DEVICE_RE.test(folded);
  const indoor = CO_INDOOR_RE.test(folded);
  const coWord = CO_WORD_RE.test(folded);
  if ((coWord || device || CO_SYMPTOM_ONLY_DEVICE_RE.test(folded) || CO_FRAME_RE.test(folded)) && CO_SYMPTOM_RE.test(folded)) {
    return { kind: "co-symptoms", lang, text: CO_SYMPTOM_TEXT[lang], deterministic: true };
  }
  // Un coche, una moto o un motor solo cuentan si están encendidos o en marcha.
  const vehicleOnly = /\b(carro|coche|auto|automovil|car|truck|moto|motocicleta|motor|engine)\b/.test(folded) &&
    !/\b(generador|planta|parrilla|asador|barbacoa|brasero|anafre|brasas|carbon|hornillo|estufa|calentador|generator|grill|barbecue|bbq|charcoal|stove|heater|gerador|churrasqueira|fogareiro|braseiro|carvao)\b/.test(folded);
  const vehicleRunning = /\b(encendid[oa]|prendid[oa]|en marcha|arrancad[oa]|running|idling|ligad[oa])\b/.test(folded);
  // En la cocina solo cuentan los aparatos que nunca van dentro (una
  // parrilla o una estufa de cocina sí son normales ahí).
  const kitchenStrong =
    /\b(cocina|kitchen|cozinha)\b/.test(folded) &&
    /\b(generador|planta (electrica|de luz|de energia)|brasero|anafre|brasas|carbon (encendido|prendido)|generator|charcoal|gerador|braseiro|carvao aceso)\b/.test(folded);
  if (device && (indoor || kitchenStrong) && (!vehicleOnly || vehicleRunning)) {
    return { kind: "co-hazard", lang, text: CO_TEXT[lang], deterministic: true };
  }

  // Causa C de DIAG-A (paquete de arreglos del móvil, §4.1): la
  // narración en pasado tampoco pregunta en esta cara — «la
  // vecina marcó el número de emergencias y contó lo que había
  // pasado» contaba un suceso y recibía la tabla de números.
  if (EMERGENCY_Q_RE.test(folded) && !isNarratedEventText(userText)) return emergencyText(lang, folded);
  return null;
}
