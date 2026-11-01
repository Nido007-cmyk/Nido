/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * factAttribute.ts — N-02: clave de entidad por patrones de atributo.
 *
 * El dedup por Jaccard sobre el texto entero no ve los duplicados
 * entre idiomas («vivo en Madrid» contra «I live in Berlin now» mide
 * 0,00–0,25: conviven todos, incluido el contradictorio). Sin modelo,
 * la única vía determinista honesta es esta: si dos textos instancian
 * el MISMO marco de atributo cerrado (residencia, cumpleaños, nombre,
 * favorito…) con valores comparables, hablan de lo mismo. Fuera de
 * los marcos, la vía no opina (null) y los hechos conviven como hoy:
 * la vía es monótona — resuelve un conjunto cerrado medido y no puede
 * perder ningún hecho que hoy se guarde.
 *
 * Marcos cerrados, trilingües, espejo de los que extractImplicitFact
 * ya probó en rememberRouter.ts. La clave de los multivaluados lleva
 * el discriminante DENTRO (allergy:nueces ≠ allergy:polen;
 * diet:vegetariano ≠ diet:vegano): nunca se pisan entre sí. En los de
 * valor único (singleValued), misma clave con valor distinto es una
 * corrección y gana lo nuevo — la doctrina de mergeFactContent.
 *
 * Firma del valor: si el valor es una fecha, su ISO vía extractDateISO
 * (la fecha es la misma en los tres idiomas sin diccionario). Si no,
 * tokens plegados sin artículos ni rellenos temporales, con el
 * mini-léxico de colores donde el idioma cambia la palabra. Dos
 * firmas son el mismo valor si son iguales o una contiene a la otra
 * por tokens («Rocky» y «Rocky y es café» son el mismo hecho
 * extendido, no una contradicción).
 *
 * Límites declarados (conviven, como hoy): frases compuestas con dos
 * atributos, residencia de terceros sin marco posesivo, sustantivos
 * de favorito fuera de la clave plegada («plato» contra «dish» no se
 * resuelve: la clave lleva el sustantivo plegado, sin léxico), y
 * sustancias de alergia entre idiomas (la clave lleva la sustancia
 * plegada, sin diccionario: nueces ≠ nuts).
 */

import { extractDateISO } from "../loop/rememberRouter";

export interface FactAttribute {
  /** Clave de atributo: «residence», «birthday:rel:mama», «allergy:nueces»… */
  key: string;
  /** Firma del valor: «date:2027-03-15» o tokens plegados unidos por espacios. */
  value: string;
  /** true si el atributo admite un solo valor vigente (corrección = gana lo nuevo). */
  singleValued: boolean;
}

const fold = (s: string): string =>
  (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

/** Muletillas de arranque, espejo de IMPLICIT_LEAD_RE (rememberRouter)
 *  más las temporales que la preparación nombra («agora moro em…»). */
const LEAD_FILLER_RE =
  /^(?:(?:por\s+cierto|a\s+prop[oó]sito|oye|ah|bueno|tambi[eé]n|btw|by\s+the\s+way|also|oh|ali[aá]s|por\s+falar\s+nisso|ah[,!]?\s+e|tamb[eé]m|agora|ahora|now)[,.!:]?\s*)+/i;

/** Palabras que no firman un valor: artículos, copulas y rellenos temporales. */
const SIG_STOP = new Set([
  "el", "la", "los", "las", "un", "una", "unos", "unas", "the", "a", "an",
  "o", "os", "as", "um", "uma", "de", "del", "do", "da", "es", "is", "e",
  "ahora", "now", "agora", "desde", "since", "hoje", "today",
  "actualmente", "currently",
]);

/** Mini-léxico de colores (el idioma cambia la palabra; la firma es el es). */
const COLOR_CANON: Record<string, string> = {
  azul: "azul", blue: "azul",
  rojo: "rojo", red: "rojo", vermelho: "rojo",
  verde: "verde", green: "verde",
  amarillo: "amarillo", yellow: "amarillo", amarelo: "amarillo",
  negro: "negro", black: "negro", preto: "negro",
  blanco: "blanco", white: "blanco", branco: "blanco",
  rosa: "rosa", pink: "rosa",
  morado: "morado", purple: "morado", roxo: "morado",
  naranja: "naranja", orange: "naranja", laranja: "naranja",
  gris: "gris", gray: "gris", grey: "gris", cinza: "gris",
  marron: "marron", brown: "marron", marrom: "marron",
};

function valueTokens(raw: string): string[] {
  return fold(raw)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 0 && !SIG_STOP.has(w))
    .map((w) => COLOR_CANON[w] ?? w);
}

function signature(raw: string): string {
  return valueTokens(raw).join(" ");
}

/** ¿Dos firmas hablan del mismo valor? Igualdad, o contención por tokens. */
export function attributeValuesMatch(a: FactAttribute, b: FactAttribute): boolean {
  if (a.value.startsWith("date:") || b.value.startsWith("date:")) return a.value === b.value;
  const ta = new Set(a.value.split(" ").filter(Boolean));
  const tb = new Set(b.value.split(" ").filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return a.value === b.value;
  const [small, big] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  for (const t of small) if (!big.has(t)) return false;
  return true;
}

/** Parentescos canonizados (formas plegadas), espejo reducido de REL_GROUPS. */
const REL_CANON: Record<string, string> = {
  mama: "mama", madre: "mama", mom: "mama", mother: "mama", mae: "mama",
  papa: "papa", padre: "papa", dad: "papa", father: "papa", pai: "papa",
  hermano: "hermano", brother: "hermano", irmao: "hermano",
  hermana: "hermana", sister: "hermana", irma: "hermana",
  hijo: "hijo", son: "hijo", filho: "hijo",
  hija: "hija", daughter: "hija", filha: "hija",
  esposo: "esposo", marido: "esposo", husband: "esposo",
  esposa: "esposa", wife: "esposa",
  abuelo: "abuelo", grandfather: "abuelo",
  abuela: "abuela", grandmother: "abuela",
  tio: "tio", uncle: "tio", tia: "tia", aunt: "tia",
  nieto: "nieto", grandson: "nieto", neto: "nieto",
  nieta: "nieta", granddaughter: "nieta", neta: "nieta",
  sobrino: "sobrino", nephew: "sobrino", sobrinho: "sobrino",
  sobrina: "sobrina", niece: "sobrina", sobrinha: "sobrina",
  primo: "primo", cousin: "primo", prima: "prima",
  amigo: "amigo", friend: "amigo", amiga: "amiga",
};

function canonRelToken(raw: string): string {
  const t = fold(raw).split(/[^a-z0-9]+/).filter(Boolean)[0] ?? "";
  return REL_CANON[t] ?? t;
}

/** Sustantivos curados → sustantivo canónico de la clave (espejo de extractImplicitFact). */
const NOUN_CANON: Record<string, string> = {
  coche: "car", carro: "car", auto: "car", car: "car",
  telefono: "phone", celular: "phone", phone: "phone", telefone: "phone",
  banco: "bank", bank: "bank",
  correo: "email", email: "email", correio: "email",
  direccion: "address",
  equipo: "team", team: "team", time: "team",
  perro: "dog", dog: "dog", cachorro: "dog",
  gato: "cat", cat: "cat",
  mascota: "pet", pet: "pet",
  ciudad: "city", city: "city", cidade: "city",
  pueblo: "town",
  trabajo: "job", job: "job", trabalho: "job",
};

const DIET_CANON: Record<string, string> = {
  vegetariano: "vegetariano", vegetariana: "vegetariano", vegetarian: "vegetariano",
  vegano: "vegano", vegana: "vegano", vegan: "vegano",
  pescetariano: "pescetariano", pescetariana: "pescetariano", pescatarian: "pescetariano",
  celiaco: "celiaco", celiaca: "celiaco", celiac: "celiaco",
};

/** Conjunciones y verbos que delatan una frase compuesta (fallo seguro: sin clave). */
const COMPOUND_TOKENS = new Set([
  "y", "e", "and", "mas", "pero", "but",
  "trabajo", "trabaja", "work", "works", "vive", "lives", "estudia",
]);

const ALLERGY_RES: RegExp[] = [
  /^soy alergic[oa] a(?:l| la| los| las)?\s+(.+)$/,
  /^tengo alergia a(?:l| la| los| las)?\s+(.+)$/,
  /^i(?:'m| am) allergic to\s+(.+)$/,
  /^sou alergic[oa] (?:a|ao|aos|as)\s+(.+)$/,
  /^tenho alergia (?:a|ao|aos|as)\s+(.+)$/,
];

/** La firma de un cumpleaños: la fecha ISO si el texto la trae; si no, tokens. */
function birthdayValue(original: string, folded: string, lang: "es" | "en", frameWords: string[]): string {
  const iso = extractDateISO(original, lang);
  if (iso) return `date:${iso.slice(0, 10)}`;
  const skip = new Set([...SIG_STOP, ...frameWords]);
  const tokens = folded
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 0 && !skip.has(w));
  return tokens.join(" ");
}

/**
 * Extrae la clave de atributo de un hecho, o null si el texto no
 * instancia ningún marco cerrado. Pura y determinista.
 */
export function factAttribute(text: string): FactAttribute | null {
  const original = (text ?? "").trim().replace(/[.!]+$/, "");
  const f = fold(original.replace(LEAD_FILLER_RE, "")).trim();
  if (!f) return null;

  // — Alergias: la sustancia va EN la clave; cada sustancia es su hecho.
  for (const re of ALLERGY_RES) {
    const m = re.exec(f);
    if (m) {
      const substance = m[1]
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length > 0 && !SIG_STOP.has(w))
        .join(" ");
      if (!substance || substance === "nada" || substance === "nothing") return null;
      return { key: `allergy:${substance}`, value: substance, singleValued: false };
    }
  }

  // — Dietas con identidad propia: cada dieta es su clave.
  const diet =
    /^soy (vegetarian[oa]|vegan[oa]|pescetarian[oa]|celiac[oa])\b/.exec(f) ??
    /^i(?:'m| am) (?:a )?(vegetarian|vegan|pescatarian|celiac)\b/.exec(f) ??
    /^sou (vegetarian[oa]|vegan[oa]|pescetarian[oa]|celiac[oa])\b/.exec(f);
  if (diet) {
    const canon = DIET_CANON[diet[1]];
    if (canon) return { key: `diet:${canon}`, value: canon, singleValued: false };
  }

  // — Cumpleaños de una relación: «el cumpleaños de mi mamá…»,
  //   «o aniversário da minha mãe…» (el pt real dice da|do, no solo de),
  //   «my mom's birthday…», «the birthday of my…».
  const bdayRelEsPt = /^(?:el|la|o|a) (?:cumpleanos|aniversario) (?:de|da|do)\s+(.+)$/.exec(f);
  const bdayRelEn = /^my\s+(.+?)'s (?:birthday|anniversary)\b/.exec(f) ?? /^the (?:birthday|anniversary) of my\s+(\w+)/.exec(f);
  if (bdayRelEsPt || bdayRelEn) {
    const rest = (bdayRelEsPt ? bdayRelEsPt[1] : bdayRelEn![1])
      .replace(/^(?:mi|my|meu|minha|el|la|o|a)\s+/, "");
    const rel = canonRelToken(rest);
    if (!rel) return null;
    return {
      key: `birthday:rel:${rel}`,
      value: birthdayValue(original, f, bdayRelEn ? "en" : "es", ["cumpleanos", "aniversario", "birthday", "anniversary", rel]),
      singleValued: true,
    };
  }

  // — Cumpleaños propio.
  if (/^(?:mi|my|meu|minha) (?:cumpleanos|aniversario|birthday)\b/.test(f)) {
    return {
      key: "birthday:self",
      value: birthdayValue(original, f, /^my/.test(f) ? "en" : "es", ["cumpleanos", "aniversario", "birthday"]),
      singleValued: true,
    };
  }

  // — Nombre de mascota por especie.
  const pet =
    /^mi (perro|perra|gato|gata) se llama\s+(.+)$/.exec(f) ??
    /^my (dog|cat) (?:is called|is named|'s name is)\s+(.+)$/.exec(f) ??
    /^(?:meu|minha) (cachorro|cachorra|gato|gata) se chama\s+(.+)$/.exec(f);
  if (pet) {
    const species = pet[1].startsWith("per") || pet[1] === "dog" || pet[1].startsWith("cachorr") ? "perro" : "gato";
    const name = valueTokens(pet[2]).slice(0, 3).join(" ");
    if (!name) return null;
    return { key: `name:pet:${species}`, value: name, singleValued: true };
  }

  // — Nombre propio.
  const selfName =
    /^me llamo\s+(.+)$/.exec(f) ??
    /^mi nombre es\s+(.+)$/.exec(f) ??
    /^my name is\s+(.+)$/.exec(f) ??
    /^me chamo\s+(.+)$/.exec(f) ??
    /^meu nome e\s+(.+)$/.exec(f);
  if (selfName) {
    const name = valueTokens(selfName[1]).slice(0, 3).join(" ");
    if (!name) return null;
    return { key: "name:self", value: name, singleValued: true };
  }

  // — Residencia (solo primera persona). El valor con conjunción o
  //   verbo, o de más de 5 tokens, es frase compuesta: sin clave.
  const home =
    /^(?:yo )?vivo en\s+(.+)$/.exec(f) ??
    /^i live in\s+(.+)$/.exec(f) ??
    /^(?:eu )?moro em\s+(.+)$/.exec(f);
  if (home) {
    const rawTokens = home[1].split(/[^a-z0-9]+/).filter(Boolean);
    if (rawTokens.length > 5 || rawTokens.some((w) => COMPOUND_TOKENS.has(w))) return null;
    const value = signature(home[1]);
    if (!value) return null;
    return { key: "residence", value, singleValued: true };
  }

  // — Lugar de trabajo (valor corto, como el extractor implícito).
  const job =
    /^trabajo en\s+(.+)$/.exec(f) ??
    /^i work at\s+(.+)$/.exec(f) ??
    /^trabalho em\s+(.+)$/.exec(f);
  if (job) {
    if (valueTokens(job[1]).length > 4) return null;
    const value = signature(job[1]);
    if (!value) return null;
    return { key: "work", value, singleValued: true };
  }

  // — Sustantivo curado: «mi coche es un…», «my car is a…», «meu carro é um…».
  const noun =
    /^mi (coche|carro|auto|telefono|celular|banco|correo|direccion|equipo|perro|gato|mascota|ciudad|pueblo|trabajo) (?:es|se llama)\s+(.+)$/.exec(f) ??
    /^my (car|phone|bank|email|dog|cat|team|city|job) is\s+(.+)$/.exec(f) ??
    /^(?:meu|minha) (carro|telefone|celular|banco|correio|time|cachorro|gato|cidade|trabalho) (?:e|se chama)\s+(.+)$/.exec(f);
  if (noun) {
    const canon = NOUN_CANON[noun[1]];
    const value = signature(noun[2]);
    if (!canon || !value) return null;
    return { key: `noun:${canon}`, value, singleValued: true };
  }

  // — Favorito por sustantivo: la clave lleva el sustantivo plegado
  //   (sin léxico entre idiomas: «plato» y «dish» no se resuelven);
  //   el valor sí usa el mini-léxico de colores.
  const fav =
    /^mi (\w+) favorit[oa] es\s+(.+)$/.exec(f) ??
    /^my favorite (\w+) is\s+(.+)$/.exec(f) ??
    /^(?:meu|minha) (\w+) favorit[oa] e\s+(.+)$/.exec(f);
  if (fav) {
    const value = signature(fav[2]);
    if (!value) return null;
    return { key: `favorite:${fav[1]}`, value, singleValued: true };
  }

  return null;
}
