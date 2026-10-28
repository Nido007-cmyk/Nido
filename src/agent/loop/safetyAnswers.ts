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
export type SafetyKind = "co-hazard" | "co-symptoms" | "emergency-number";

export interface SafetyHit {
  kind: SafetyKind;
  lang: SafetyLang;
  text: string;
  /** País respondido (solo emergency-number con país conocido). */
  country?: string;
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

// Síntomas o alarma: entonces no es una pregunta de planificación.
const CO_SYMPTOM_RE =
  /\b(?:me duele la cabeza|dolor de cabeza|marea|nausea|vomit|confus|debil|desmay|alarma (?:de co |de monoxido )?(?:sono|suena|esta sonando)|headache|dizz|nause|confused|weak|faint|alarm (?:is )?(?:going off|beeping|sounding)|dor de cabeca|tontura|enjo|alarme (?:esta )?(?:tocando|disparou))/;

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
    names: ["estados unidos", "eeuu", "ee uu", "usa", "united states", "the us", "the usa", "estados unidos da america", "eua"],
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
    source: "ePortugal (gov.pt), «Contactos de emergência em Portugal»",
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

const EMERGENCY_Q_RE =
  /\b(numero|telefono|tel)s? (de |del |para )?(las? )?(emergencias?|urgencias?|policia|ambulancia|bomberos)\b|\ba (que|cual) numero (llamo|llamar|marco|marcar)\b|\bemergency (number|phone|line)s?\b|\bwhat number (do i|should i|to) (call|dial)\b|\bnumber (for|to call) (the )?(police|ambulance|fire)\b|\bnumeros? de (emergencia|urgencia)\b|\b(qual|que) numero (ligar|eu ligo|discar)\b|\btelefone de emergencia\b/;

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
 */
const OTHER_COUNTRY_RE = /\b(emergenci\w*|urgenci\w*|emergency|numero|number|telefono|telefone)\b.*\b(en|in|no|na|em)\s+(?!mi |my |meu |minha |el mio)[a-z]{3,}/;

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
  const known = EMERGENCY_NUMBERS.map((x) => (lang === "pt" ? x.label.pt.replace(/^(nos|no|na|em) /, "") : x.label[lang])).join(", ");
  const asked = OTHER_COUNTRY_RE.test(folded);
  const text =
    lang === "en"
      ? (asked
          ? "I don't have that country's emergency number checked against an official source, so I won't guess. Look for it on the local government's website or ask someone nearby."
          : "Which country are you in? I'll tell you the number.") +
        `\n\nCountries checked so far: ${known}.`
      : lang === "pt"
        ? (asked
            ? "Não tenho o número de emergência desse país conferido numa fonte oficial, então não vou chutar. Procure no site do governo local ou pergunte a alguém por perto."
            : "Em que país você está? Eu digo o número.") + `\n\nPaíses conferidos até agora: ${known}.`
        : (asked
            ? "No tengo el número de emergencias de ese país comprobado en una fuente oficial, así que no lo voy a adivinar. Búscalo en la web del gobierno local o pregunta a alguien cercano."
            : "¿En qué país estás? Te digo el número.") + `\n\nPaíses comprobados por ahora: ${known}.`;
  return { kind: "emergency-number", lang, text, deterministic: true };
}

/**
 * ¿Es una pregunta de seguridad con respuesta fija? null = no; sigue su camino.
 * `lang` = idioma de la app (las respuestas salen en ese idioma).
 */
export function matchSafetyAnswer(userText: string, lang: SafetyLang): SafetyHit | null {
  const folded = fold(userText).replace(/\s+/g, " ").trim();
  if (folded.length === 0 || folded.length > 400) return null;

  const device = CO_DEVICE_RE.test(folded);
  const indoor = CO_INDOOR_RE.test(folded);
  const coWord = CO_WORD_RE.test(folded);
  if ((coWord || device) && CO_SYMPTOM_RE.test(folded)) {
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
