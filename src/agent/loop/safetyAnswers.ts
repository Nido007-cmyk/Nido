/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

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
  /\b(dentro|adentro|en (la |mi )?casa|garaje|garage|cochera|sotano|porche|cuarto|habitacion|dormitorio|recamara|sala|tienda de campana|casa de campana|carpa|caravana|cerrad[oa]|inside|indoors?|in (the|my) (house|home|garage|basement|tent|room|bedroom|camper|rv)|basement|crawl ?space|shed|tent|camper|enclosed|em casa|garagem|porao|barraca|quarto|fechad[oa])\b/;

const CO_WORD_RE = /\b(monoxido|carbon monoxide)\b/;

// 0.1.60: aparatos que se usan DENTRO a propósito (caldera, calentador o
// estufa de gas, chimenea) pero que, si fallan, producen monóxido. Solo
// cuentan junto con síntomas: sin síntomas, «¿puedo usar la caldera en el
// sótano?» no es un peligro y no debe recibir «Nunca lo uses dentro».
// Por eso NO están en CO_DEVICE_RE (que también dispara ese aviso).
const CO_SYMPTOM_ONLY_DEVICE_RE =
  /\b(calentador(es)? (de|a) gas|calentador de agua|estufa(s)? (de|a) gas|calefactor(es)? (de|a) gas|caldera|calefon|chimenea|gas (heater|fire|fireplace|stove|furnace)|space heater|water heater|furnace|boiler|fireplace|aquecedor(es)? (de|a) gas|caldeira|lareira|fogao a gas)\b/;

// Síntomas o alarma: entonces no es una pregunta de planificación.
const CO_SYMPTOM_RE =
  /\b(?:(?:me|nos|le|les|te) duele(?:n)? la cabeza|dolor de cabeza|marea|nausea|vomit|confus|debil|desmay|alarma (?:de co |de monoxido )?(?:sono|suena|esta sonando)|headache|dizz|nause|confused|weak|faint|alarm (?:is )?(?:going off|beeping|sounding)|dor de cabeca|tontura|enjo|alarme (?:esta )?(?:tocando|disparou))/;

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
const EMERGENCY_Q_RE =
  /\b(numero|telefono|tel)s? (de |del |para )?(las? )?(emergencias?|urgencias?|emergency|policia|ambulancia|bomberos)\b|\b(?:a )?(que|cual) numero (llamo|llamar|marco|marcar)\b|\bemergency (number|phone|line)s?\b|\bwhat number (do i|should i|to) (call|dial)\b|\bnumber (for|to call) (the )?(police|ambulance|fire)\b|\bnumeros? de (emergencia|urgencia)\b|\b(qual|que) numero (ligar|ligo|eu ligo|discar)\b|\btelefone (de |da )?(emergencia|emergency)\b/;

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
// 0.1.99 T-01 (M-07): los objetos cotidianos de la familia nueva de
// «cortar» — quien se corta el pelo o las uñas lleva el mismo
// reflexivo que la forma de autolesión, y «cut myself a slice» es
// servirse comida, no hacerse daño.
const SELF_HARM_VETO_RE =
  /\b(?:morir(?:me)? de (?:la )?(?:risa|verguenza|pena|hambre|sueno|calor|frio|amor|ganas|envidia|aburrimiento|cansancio|nervios)|die of (?:embarrassment|laughter|boredom|shame|hunger|thirst)|morrer de (?:rir|vergonha|fome|sono|calor|frio|amor|vontade|tedio|saudade)|(?:cuento|novela|historia|guion|cancion|poema|personaje|pelicula|serie|story|novel|script|song|lyrics|poem|character|movie|conto|romance|roteiro|musica|personagem|filme)\b|cortarme (?:el |la |las |los )?(?:pelo|cabello|flequillo|unas|barba|bigote)|cortar (?:el |la |las |los |o |a |as |os )?(?:pelo|cabello|cabelo|flequillo|unas|unhas|barba|bigote|bigode)|cortar-me (?:o |a |as |os )?(?:cabelo|unhas|barba|bigode)|cut(?:ting)? myself a )/;

const SELF_HARM_VETO_GLUED_RE = new RegExp(SELF_HARM_VETO_RE.source.replace(/\\b/g, "").replace(/\s+/g, ""));

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
export function isSelfHarmMessage(userText: string): boolean {
  const folded = fold(userText).replace(/\s+/g, " ").trim();
  if (folded.length === 0 || folded.length > 4000) return false;
  if (SELF_HARM_RE.test(folded) && !SELF_HARM_VETO_RE.test(folded)) return true;
  // CL-11b: la forma dictada con las palabras pegadas, contra la
  // misma lista sin espacios y con el mismo veto sin espacios.
  const glued = folded.replace(/ /g, "");
  return SELF_HARM_GLUED_RE.test(glued) && !SELF_HARM_VETO_GLUED_RE.test(glued);
}

export function matchSafetyAnswer(userText: string, lang: SafetyLang): SafetyHit | null {
  // Lo primero, y sin el tope de 400 caracteres de las demás reglas:
  // quien se desahoga escribe largo.
  if (isSelfHarmMessage(userText)) {
    return { kind: "self-harm", lang, text: SELF_HARM_TEXT[lang], deterministic: true };
  }
  const folded = fold(userText).replace(/\s+/g, " ").trim();
  if (folded.length === 0 || folded.length > 400) return null;

  const device = CO_DEVICE_RE.test(folded);
  const indoor = CO_INDOOR_RE.test(folded);
  const coWord = CO_WORD_RE.test(folded);
  if ((coWord || device || CO_SYMPTOM_ONLY_DEVICE_RE.test(folded)) && CO_SYMPTOM_RE.test(folded)) {
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

  if (EMERGENCY_Q_RE.test(folded)) return emergencyText(lang, folded);
  return null;
}
