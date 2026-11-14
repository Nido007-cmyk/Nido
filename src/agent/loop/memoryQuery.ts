/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * 0.1.20 (M1): respondedor determinista de CONSULTAS de memoria.
 *
 * Investigación 2026-10-12: preguntar de vuelta («¿cómo se llama mi
 * mamá?», «¿cómo me llamo?», «¿cuál es mi color favorito?») no tenía
 * ninguna ruta determinista — 10/10 consultas de la sonda caían al
 * modelo, que acertaba solo si el 0.5B leía bien el contexto, y si no,
 * inventaba o citaba la «fuente» que fuera (evidencia física: la
 * estación Lista del Metro de Madrid como respuesta a «mi mamá se
 * llama Marta»). Aquí la respuesta sale de lo guardado, y cuando el
 * dato no está, la respuesta honesta también es determinista:
 * «todavía no me has contado eso». Nunca una invención con cita falsa.
 *
 * Solo reclama preguntas SOBRE la memoria del usuario (su gente, sus
 * datos). Cualquier otra pregunta devuelve null y sigue el flujo normal.
 */

import { extractDateISO } from "./rememberRouter";
import { formatDay } from "./toolRouter";
import { mentionsTerm } from "./memoryEquiv";

export type MemoryQueryLang = "es" | "en" | "pt";

export interface MemoryQueryData {
  facts: { content: string; category: string }[];
  people: { name: string; relationship?: string; notes?: string }[];
}

const fold = (s: string): string =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

/** Grupos de sinónimos de parentesco entre idiomas y registros. */
const REL_GROUPS: string[][] = [
  ["mama", "madre", "mom", "mother", "mae"],
  ["papa", "padre", "dad", "father", "pai"],
  ["hermano", "brother", "irmao"],
  ["hermana", "sister", "irma"],
  ["esposa", "wife"],
  ["esposo", "marido", "husband"],
  ["hijo", "son", "filho"],
  ["hija", "daughter", "filha"],
  ["abuelo", "grandfather", "avo", "avô"],
  ["abuela", "grandmother", "avo", "avó"],
  ["tio", "uncle"],
  ["tia", "aunt"],
  ["primo", "cousin"],
  ["prima", "cousin"],
  ["amigo", "friend"],
  ["amiga", "friend"],
  ["novio", "boyfriend", "namorado"],
  ["novia", "girlfriend", "namorada"],
  ["cunado", "brother-in-law", "cunhado"],
  ["cunada", "sister-in-law", "cunhada"],
  ["suegro", "father-in-law", "sogro"],
  ["suegra", "mother-in-law", "sogra"],
  ["nieto", "grandson", "neto"],
  ["nieta", "granddaughter", "neta"],
  ["sobrino", "nephew", "sobrinho"],
  ["sobrina", "niece", "sobrinha"],
  ["pareja", "partner"],
];

function sameRel(a: string, b: string): boolean {
  const fa = fold(a);
  const fb = fold(b);
  if (fa === fb) return true;
  return REL_GROUPS.some((g) => g.includes(fa) && g.includes(fb));
}

/** Coincidencia de parentesco SIN plegar acentos (solo minúsculas):
 *  «avô» y «avó» se distinguen solo por el acento y el pliegue los
 *  funde en «avo»; los grupos llevan las dos formas acentuadas para
 *  que esta pasada las mantenga separadas. */
function exactSameRel(a: string, b: string): boolean {
  const la = a.trim().toLowerCase();
  const lb = b.trim().toLowerCase();
  if (la === lb) return true;
  return REL_GROUPS.some((g) => g.includes(la) && g.includes(lb));
}

function findPersonByRel(mem: MemoryQueryData, rel: string) {
  // B9 (barrido «revisa todo», clase 1): con el abuelo (avô) guardado
  // antes que la abuela (avó), «minha avó» servía el nombre del abuelo
  // como si fuera la abuela — los dos grupos contienen «avo» plegado
  // y find devolvía el primer match. Primera pasada EXACTA, sin
  // plegar: si la forma dictada distingue (avô ≠ avó, sinónimos con
  // su grafía), manda ella. La pasada plegada queda para lo demás
  // (sinónimos entre idiomas, dictado sin acentos) con un solo
  // guardia: si pregunta y ficha traen las dos formas acentuadas del
  // par avô/avó y no son la misma, no hay match — sin abuela
  // guardada, la respuesta es la honesta, no el abuelo.
  const exact = mem.people.find((p) => p.relationship && exactSameRel(p.relationship, rel));
  if (exact) return exact;
  const relLow = rel.trim().toLowerCase();
  return (
    mem.people.find((p) => {
      if (!p.relationship) return false;
      const pLow = p.relationship.trim().toLowerCase();
      if ((relLow === "avô" || relLow === "avó") && (pLow === "avô" || pLow === "avó") && pLow !== relLow) {
        return false;
      }
      return sameRel(p.relationship, rel);
    }) ?? null
  );
}

const STR: Record<string, Record<MemoryQueryLang, string>> = {
  personName: {
    es: "Tu {{rel}} se llama {{name}}.",
    en: "Your {{rel}}'s name is {{name}}.",
    pt: "{{poss}} {{rel}} se chama {{name}}.",
  },
  selfName: { es: "Te llamas {{name}}.", en: "Your name is {{name}}.", pt: "Você se chama {{name}}." },
  birthday: {
    es: "El cumpleaños de {{who}} es el {{day}}.",
    en: "{{who}}'s birthday is on {{day}}.",
    pt: "O aniversário de {{who}} é em {{day}}.",
  },
  yourBirthday: {
    es: "Tu cumpleaños es el {{day}}.",
    en: "Your birthday is on {{day}}.",
    pt: "Seu aniversário é em {{day}}.",
  },
  factQuote: {
    es: "Según lo que me contaste: «{{fact}}».",
    en: "From what you told me: “{{fact}}”.",
    pt: "Pelo que você me contou: “{{fact}}”.",
  },
  notKnown: {
    // Pruebas adversarias del 2026-11-03: la búsqueda es por palabras, así
    // que un dato guardado en otra lengua («vivo en Tucson» ante «where
    // do I live?») no aparece, y «todavía no me has contado eso» afirmaba
    // algo falso. El texto dice lo que la app sabe: que no lo encuentra.
    es: "No lo encuentro en lo que me has contado. Si me lo dices, lo guardo.",
    en: "I can't find that in what you've told me. If you tell me, I'll save it.",
    pt: "Não encontro isso no que você me contou. Se você me contar, eu guardo.",
  },
  aboutYou: {
    es: "Esto es lo que me has contado:",
    en: "Here's what you've told me:",
    pt: "Isto é o que você me contou:",
  },
};

function msg(key: string, lang: MemoryQueryLang, vars: Record<string, string> = {}): string {
  let s = STR[key][lang];
  for (const [k, v] of Object.entries(vars)) s = s.split(`{{${k}}}`).join(v);
  return s;
}

/** Posesivo pt según el género del parentesco (B10 = ADV-GM1-C1):
 *  la plantilla usaba «Sua» invariante y, abierto «meu» por B3,
 *  servía «Sua pai». La forma acentuada manda en el par avô/avó; el
 *  resto va por la lista masculina; lo no listado conserva «Sua»,
 *  que es el suelo de hoy. es «Tu» y en «Your» son neutros. */
const PT_MASC_REL = new Set([
  "pai", "irmao", "tio", "filho", "esposo", "marido", "sogro",
  "neto", "sobrinho", "primo", "cunhado", "namorado", "amigo",
]);
function ptPossessive(rel: string): "Seu" | "Sua" {
  const low = rel.trim().toLowerCase();
  if (low === "avô") return "Seu";
  if (low === "avó") return "Sua";
  return PT_MASC_REL.has(fold(rel)) ? "Seu" : "Sua";
}

/** Forma pt canónica de cada grupo de REL_GROUPS, en su mismo orden:
 *  el parentesco de un registro servido (ficha o hecho), dicho en la
 *  lengua de la plantilla. «pareja» no trae forma pt en su grupo. */
const REL_PT_CANON: (string | null)[] = [
  "mãe", "pai", "irmão", "irmã", "esposa", "marido", "filho", "filha",
  "avô", "avó", "tio", "tia", "primo", "prima", "amigo", "amiga",
  "namorado", "namorada", "cunhado", "cunhada", "sogro", "sogra",
  "neto", "neta", "sobrinho", "sobrinha", null,
];

/** ADV-F-C2 (adversaria de formas): el posesivo pt se calculaba del
 *  token de la PREGUNTA, y con el dictado sin acento («minha avo») la
 *  respuesta servía «Sua avo se chama José.» — posesivo femenino para
 *  el abuelo, contra la propia ficha («avô»), que la app sí conoce.
 *  El género sale ahora del registro SERVIDO: si su parentesco, en su
 *  grafía exacta, pertenece a un solo grupo, manda la forma canónica
 *  pt de ese grupo. Si la grafía es ambigua entre grupos («avo»
 *  plegado, «cousin», «friend») o no hay registro, manda el token
 *  preguntado: ese es el suelo declarado por la tanda B9. */
function ptServingRel(servedRel: string | undefined, askedRel: string): string {
  if (servedRel) {
    const low = servedRel.trim().toLowerCase();
    let hit = -1;
    let hits = 0;
    REL_GROUPS.forEach((g, i) => {
      if (g.includes(low)) {
        hit = i;
        hits += 1;
      }
    });
    if (hits === 1 && REL_PT_CANON[hit]) return REL_PT_CANON[hit]!;
  }
  return askedRel;
}

const BIRTHDAY_RE = /cumplea[ñn]os|aniversario|birthday|aniversário/i;

/** La cláusula que trae un nombre dentro de un hecho, por lengua del
 *  hecho (B8): «se llama» (es), «se chama» (pt), «name is» /
 *  «is called» (en). ADV-F-C1 (adversaria de formas): dos redacciones
 *  pt comunes quedaban fuera — el reflexivo «chama-se» («a minha mãe
 *  chama-se Maria») y el marco «o nome d… é» («o nome do meu pai é
 *  João») — y la app decía «no me lo has contado» teniéndolo. La
 *  alternativa del marco exige la cópula «é» como palabra suelta
 *  (miradas con \p{L}: \b no ve las letras acentuadas).
 *  ADV-F2-C1 (adversaria de formas II): el marco solo existía en pt —
 *  «el nombre de mi padre es Juan» y «the name of my dad is John»
 *  daban notKnown con el dato presente, el desenlace exacto de B8 en
 *  las otras dos lenguas. Las alternativas es/en espejan la pt: el
 *  marco al inicio del hecho y su cópula («es» / «is») como palabra
 *  suelta, para que ni «esposa» ni «sister» la falsifiquen. */
const NAME_CLAUSE_RE = /se llama|se chama|chama-se|name is|is called|^o nome\b[^.!?]*?(?<![\p{L}])é(?![\p{L}])|^el nombre\b[^.!?]*?(?<![\p{L}])es(?![\p{L}])|^the name\b[^.!?]*?(?<![\p{L}])is(?![\p{L}])/iu;

/** Hecho de cumpleaños de una persona (por nombre o parentesco) o propio. */
function findBirthdayFact(
  mem: MemoryQueryData,
  opts: { personName?: string; rel?: string; self?: boolean }
): string | null {
  const candidates = mem.facts.filter((f) => BIRTHDAY_RE.test(f.content));
  if (opts.self) {
    // Auditoría de la 0.1.70 (punto 5a): la frase propia explícita
    // manda; si ningún hecho la trae, vale el pronombre posesivo
    // («…y el mío es el 3 de mayo», «…and mine is May 3», «…e o meu
    // é dia 3 de maio») solo cuando su propia cláusula trae fecha
    // (selfBirthdaySpans).
    return (
      candidates.find((f) => SELF_BDAY_PHRASE_RE.test(f.content))?.content ??
      candidates.find((f) => selfBirthdaySpans(f.content).length > 0)?.content ??
      null
    );
  }
  if (opts.personName) {
    const hit = candidates.find((f) => fold(f.content).includes(fold(opts.personName!)));
    if (hit) return hit.content;
  }
  if (opts.rel) {
    const rel = opts.rel;
    // ADV-F2-C3 (adversaria de formas II): este buscador carecía de la
    // disciplina de findPersonByRel — buscaba solo por coincidencia
    // PLEGADA y, con solo el abuelo guardado, servía su fecha como
    // cumpleaños de la abuela (la colisión de B9 viva aquí). La misma
    // cura en dos pasadas: EXACTA primero (la grafía acentuada manda:
    // avô ≠ avó) y plegada después con la guardia del par — si
    // pregunta y hecho traen las dos formas acentuadas y no son la
    // misma, no hay match y el desenlace es el honesto.
    const rawWords = (c: string) => c.toLowerCase().split(/[^a-záéíóúàâêôãõçñü0-9-]+/);
    const exact = candidates.find((f) => rawWords(f.content).some((w) => w && exactSameRel(w, rel)));
    if (exact) return exact.content;
    const relLow = rel.trim().toLowerCase();
    const hit = candidates.find((f) =>
      rawWords(f.content).some((w) => {
        if (!w) return false;
        const wLow = w.trim().toLowerCase();
        if ((relLow === "avô" || relLow === "avó") && (wLow === "avô" || wLow === "avó") && wLow !== relLow) {
          return false;
        }
        return sameRel(w, rel);
      })
    );
    if (hit) return hit.content;
  }
  // Las notas de la ficha de la persona también pueden traer la frase.
  if (opts.personName) {
    const p = mem.people.find((x) => x.name === opts.personName);
    if (p?.notes && BIRTHDAY_RE.test(p.notes)) return p.notes;
  }
  return null;
}

/** Conjunciones que parten un hecho en cláusulas: la de cada lengua,
 *  como token suelto. La coma NO parte: «el cumpleaños de mi abuela,
 *  que vive en Tucson, es el 15 de marzo» es una sola cláusula con
 *  incisos, y partirla dejaría el ancla sin su fecha. */
const CLAUSE_CONJUNCTIONS = new Set(["e", "y", "and"]);

interface FactToken {
  text: string;
  start: number;
  end: number;
}

/** Tokens de un hecho con su posición: palabras (letras/dígitos, con
 *  el guion interno de «brother-in-law»), como los corta la pasada de
 *  findBirthdayFact. */
function factTokens(text: string): FactToken[] {
  const out: FactToken[] = [];
  const re = /[\p{L}0-9]+(?:-[\p{L}0-9]+)*/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push({ text: m[0], start: m.index, end: m.index + m[0].length });
  }
  return out;
}

/** ADV-F3-C1 (adversaria de formas III): el hecho ÚNICO que guarda
 *  DOS cumpleaños («o aniversário do meu avô é 20 de junho e o da
 *  minha avó é 15 de março») servía la fecha de la PRIMERA cláusula
 *  a la segunda persona, con la etiqueta mezclada — la selección del
 *  hecho es correcta (trae los dos datos), pero la extracción se
 *  ataba al hecho entero: extractDateISO sacaba su primera fecha y
 *  el «who» pt su primera palabra que casaba en plegado. La cura
 *  ata la extracción al SEGMENTO servido: la cláusula —entre
 *  conjunciones o frases (ADV-F4-C1)— que contiene la palabra que casó (el nombre de la
 *  ficha o el parentesco, localizado con la misma disciplina de dos
 *  pasadas de findBirthdayFact: exacta, luego plegada con la guardia
 *  avô/avó). Devuelve también esa palabra tal como está escrita,
 *  para que el posesivo pt salga del segmento servido. Sin ancla
 *  localizada (el hecho vino de las notas, sin nombre ni parentesco
 *  escritos), null: manda el hecho entero, como hasta hoy. Si el
 *  segmento no trae fecha, birthdayAnswer cita ESE segmento — nunca
 *  afirma la fecha de la otra cláusula.
 *
 *  ADV-PC1-C1 (adversaria de PC-1): el ancla puede ocurrir más
 *  de una vez — la persona preguntada mencionada antes, sin
 *  fecha, en un inciso o apositivo dentro de la cláusula de
 *  otro («…, el esposo de mi abuela, …») o en una cláusula
 *  previa por comas — y la primera mención capturaba el asiento:
 *  commaSubSlice recibía un tramo sin fecha y el cruce de PC-1
 *  sobrevivía entero. Se recogen TODAS las ocurrencias con la
 *  misma disciplina de dos pasadas y manda la primera cuyo
 *  subtramo de comas trae su fecha (pickAnchorSpan); si ninguna
 *  la trae, la primera, como hasta hoy. */
function birthdayServingSlice(
  fact: string,
  opts: { personName?: string; rel?: string }
): { slice: string; word: string | null } | null {
  const tokens = factTokens(fact);
  let spans: { from: number; to: number }[] = [];
  let relIdxs: number[] = [];
  if (opts.personName) {
    const nameWords = factTokens(opts.personName).map((t) => fold(t.text));
    if (nameWords.length) {
      for (let i = 0; i + nameWords.length <= tokens.length; i++) {
        let matches = true;
        for (let j = 0; j < nameWords.length; j++) {
          if (fold(tokens[i + j]!.text) !== nameWords[j]) {
            matches = false;
            break;
          }
        }
        if (matches) {
          spans.push({ from: tokens[i]!.start, to: tokens[i + nameWords.length - 1]!.end });
        }
      }
    }
  }
  if (!spans.length && opts.rel) {
    const rel = opts.rel;
    relIdxs = tokens.flatMap((tk, i) => (exactSameRel(tk.text, rel) ? [i] : []));
    if (!relIdxs.length) {
      const relLow = rel.trim().toLowerCase();
      relIdxs = tokens.flatMap((tk, i) => {
        const wLow = tk.text.trim().toLowerCase();
        if ((relLow === "avô" || relLow === "avó") && (wLow === "avô" || wLow === "avó") && wLow !== relLow) {
          return [];
        }
        return sameRel(tk.text, rel) ? [i] : [];
      });
    }
    spans = relIdxs.map((i) => ({ from: tokens[i]!.start, to: tokens[i]!.end }));
  }
  if (!spans.length) return null;
  // ADV-PC1-C1: con más de una ocurrencia, manda la primera cuyo
  // subtramo de comas trae su fecha; si ninguna, la primera.
  const chosen = pickAnchorSpan(fact, tokens, spans);
  const word = relIdxs.length ? tokens[relIdxs[chosen]!]!.text : null;
  const slice = clauseSlice(fact, tokens, spans[chosen]!.from, spans[chosen]!.to);
  return slice ? { slice, word } : null;
}

/** Títulos y abreviaturas cuya punto NO cierra frase dentro de un
 *  hecho («el Dr. Pérez», «p. ej.»): si cortaran, el segmento del
 *  ancla perdería su fecha y la respuesta degradaría a cita. */
const SENTENCE_ABBREVS = new Set(["dr", "dra", "sr", "sra", "srta", "mr", "mrs", "ms", "st", "ej"]);

/** ADV-F4-C1 (adversaria de formas IV · MEDIA-BAJA): cortes de
 *  FRASE en el texto crudo — punto y punto y coma — como posiciones
 *  {start, after} (el segmento anterior acaba en start, sin la
 *  puntuación; el siguiente empieza en after). La segmentación de
 *  ADV-F3-C1 solo cortaba en conjunciones y el hecho combinado
 *  partido por punto reproducía el defecto entero: dos frases en
 *  un solo hecho («…es el 20 de junio. El de mi abuela es el 15 de
 *  marzo.») es una forma tan real de guardar los dos datos como
 *  la de la conjunción. Guardas del punto, medidas una a una:
 *  decimal («3.5»: dígito a ambos lados) no corta; la palabra
 *  previa de una sola letra (iniciales, «p.») no corta; la palabra
 *  previa en SENTENCE_ABBREVS («Dr.», «ej.») no corta. Una corrida
 *  de puntos (elipsis) cuenta como un solo corte tras la corrida.
 *  Un corte falso solo puede ENCOGER el segmento del ancla — el
 *  desenlace peor es la cita honesta, nunca la fecha ajena.
 *
 *  Cobertura medida de la adversaria de formas V (ataque 4): «!»
 *  y «?» cierran frase con el mismo daño tras ellos — el hecho
 *  partido por «!» («…es el 20 de junio! El de mi abuela…»)
 *  reproducía el cruce entero, en el asiento propio con la fecha
 *  ajena afirmada como cumpleaños del usuario. «!» es forma real
 *  de dictado con énfasis; «?» dentro de un hecho guardado es
 *  forma rara (una pregunta guardada como hecho). Una corrida de
 *  signos («?!», «!!») es un solo corte tras la corrida. Guarda
 *  del inciso, de la misma familia que las del punto: el signo
 *  seguido de coma es inciso entre signos («¿sabes?», «¡claro!»)
 *  dentro de la cláusula — la coma-inciso de siempre — y no
 *  corta, así el hecho con pregunta legítima entre paréntesis
 *  sigue sirviendo la fecha de su cláusula por plantilla; sin la
 *  coma, un corte de más solo encoge el segmento (cita honesta),
 *  nunca afirma la fecha ajena.
 *
 *  ADV-F6-C1 (adversaria de formas VI · MEDIA-BAJA): la guarda
 *  del inciso apagaba también el separador de frase real con la
 *  coma PEGADA al signo y sin conjunción tras ella («…es el 20
 *  de junio!, el de mi abuela es el 15 de marzo»): dictado que
 *  dicta la coma tras exclamar, o escritura en lista — y tras
 *  esa forma el cruce entero volvía, en los dos asientos y las
 *  tres lenguas. La guarda exige ahora la FORMA del inciso: el
 *  tramo de cláusula que el signo cerraría (desde el último
 *  corte de frase o la última conjunción) NO trae fecha ya
 *  servida — en el inciso la fecha de la cláusula va siempre
 *  DESPUÉS del signo («¿sabes?, es el 15 de marzo», «you know?,
 *  is March 15»), y en el separador la cláusula ya está completa
 *  con su fecha. La alternativa del signo de apertura en la
 *  cláusula se midió y se descartó como discriminador: la «¡»
 *  que abre la frase exclamativa misma («¡El cumpleaños de mi
 *  abuelo es el 20 de junio!, el de mi abuela…») la cumple sin
 *  ser inciso, y todo inciso medido queda cubierto por la
 *  ausencia de fecha. La propiedad de seguridad manda igual: un
 *  corte de más solo encoge el segmento (cita honesta). */
/** ADV-F6-C1: ¿el tramo de cláusula que un signo en `pos`
 *  cerraría ya trae fecha servida? El tramo va desde la última
 *  frontera aceptada (corte de frase ya asentado o conjunción
 *  suelta) hasta el signo. Con fecha, la cláusula está completa
 *  y el signo es separador aunque lleve la coma pegada; sin
 *  fecha, es la forma del inciso (su fecha va después del signo)
 *  y la guarda lo protege. La presencia se mide con el mismo
 *  extractor que sirve la fecha (extractDateISO cubre las tres
 *  lenguas y la forma numérica sin depender del idioma). */
function clauseServesDateBefore(
  fact: string,
  pos: number,
  breaks: { after: number }[]
): boolean {
  let start = 0;
  for (const b of breaks) if (b.after <= pos) start = Math.max(start, b.after);
  for (const tk of factTokens(fact)) {
    if (tk.end <= pos && CLAUSE_CONJUNCTIONS.has(tk.text.toLowerCase())) {
      start = Math.max(start, tk.end);
    }
  }
  return extractDateISO(fact.slice(start, pos)) !== null;
}

function sentenceBreaks(fact: string): { start: number; after: number }[] {
  const out: { start: number; after: number }[] = [];
  for (let i = 0; i < fact.length; i++) {
    const ch = fact[i]!;
    if (ch === ";") {
      out.push({ start: i, after: i + 1 });
      continue;
    }
    if (ch === "!" || ch === "?") {
      let j = i;
      while (fact[j + 1] === "!" || fact[j + 1] === "?") j++;
      // La coma tras el signo solo apaga el corte si el tramo que
      // el signo cerraría tiene la forma del inciso: sin fecha ya
      // servida (ADV-F6-C1). Con la cláusula completa, corta.
      if (fact[j + 1] !== "," || clauseServesDateBefore(fact, i, out)) {
        out.push({ start: i, after: j + 1 });
      }
      i = j;
      continue;
    }
    if (ch !== ".") continue;
    let j = i;
    while (fact[j + 1] === ".") j++;
    const after = j + 1;
    let k = i;
    while (k > 0 && /[\p{L}]/u.test(fact[k - 1]!)) k--;
    const prevWord = fact.slice(k, i).toLowerCase();
    const prevChar = fact[i - 1];
    const nextChar = fact[after];
    const decimal =
      j === i && prevChar !== undefined && /\d/.test(prevChar) && nextChar !== undefined && /\d/.test(nextChar);
    if (!decimal && prevWord.length !== 1 && !SENTENCE_ABBREVS.has(prevWord)) {
      out.push({ start: i, after });
    }
    i = j;
  }
  return out;
}

/** PC-1 (pre-censo de la puerta de barrido, 2026-11-02): dentro
 *  del segmento que clauseSlice ya delimitó (conjunciones y
 *  cortes de frase), la COMA sigue sin partir cláusulas — el
 *  inciso es su oficio asentado (suelo de ADV-F3-C1: «…, que
 *  vive en Tucson, …» no deja el ancla sin fecha) — pero el
 *  hecho combinado unido SOLO por comas («El cumpleaños de mi
 *  abuelo es el 20 de junio, el de mi abuela es el 15 de
 *  marzo») dejaba el segmento en el tramo entero y la
 *  extracción servía la fecha de la PRIMERA cláusula con fecha
 *  a cualquier asiento, afirmada por plantilla. La cura no
 *  parte nada: si el subtramo de comas que contiene el ancla
 *  trae SU fecha, se sirve ese subtramo — la fecha dentro del
 *  tramo de comas de la persona es la suya, esté donde esté la
 *  cláusula —; si no la trae (inciso, título, paréntesis), null
 *  y manda el segmento entero como hasta hoy, y con él sus
 *  desenlaces asentados: el inciso sirve la fecha tras sus
 *  comas y la frontera F-1 (primera cláusula SIN fecha cerrada
 *  por signo con coma pegada) sigue sirviendo la fecha de la
 *  segunda, porque su subtramo tampoco trae fecha y distinguir
 *  ese caso es el aparato diferido que su tanda nombró. La
 *  presencia se mide con el mismo extractor que sirve la
 *  fecha, como en clauseServesDateBefore. La coma entre
 *  dígitos («3,5») no es frontera ni aquí: es la guarda
 *  decimal de la familia del punto. Un subtramo de más solo
 *  puede ENCOGER lo servido hacia la cláusula del ancla —
 *  nunca trae la fecha de otra cláusula. */
/** Los subtramos de comas dentro del segmento [start, end) y el
 *  que contiene el tramo [from, to): la troceada cruda de
 *  commaSubSlice, sin su juicio de fecha. Sin comas en el
 *  segmento (la de entre dígitos no cuenta), null: hay un solo
 *  tramo posible y es el segmento entero. */
function commaSubRange(
  fact: string,
  start: number,
  end: number,
  from: number,
  to: number
): { s: number; e: number } | null {
  const ranges: { s: number; e: number }[] = [];
  let prev = start;
  for (let i = start + 1; i < end; i++) {
    if (fact[i] !== ",") continue;
    const before = fact[i - 1];
    const afterCh = fact[i + 1];
    if (before !== undefined && afterCh !== undefined && /\d/.test(before) && /\d/.test(afterCh)) {
      continue;
    }
    ranges.push({ s: prev, e: i });
    prev = i + 1;
  }
  if (!ranges.length) return null;
  ranges.push({ s: prev, e: end });
  return ranges.find((r) => from >= r.s && to <= r.e) ?? null;
}

function commaSubSlice(
  fact: string,
  start: number,
  end: number,
  from: number,
  to: number
): string | null {
  const mine = commaSubRange(fact, start, end, from, to);
  if (!mine) return null;
  const text = fact.slice(mine.s, mine.e);
  if (extractDateISO(text) === null) return null;
  return text.replace(/^[\s,;]+|[\s,;]+$/g, "");
}

/** La cláusula de un hecho que contiene el tramo [from, to): desde
 *  la frontera anterior hasta la siguiente, donde frontera es la
 *  conjunción suelta de tokens o el corte de frase del texto crudo
 *  (ADV-F4-C1). Un corte de frase solo cuenta si separa dos tramos
 *  con contenido: el punto final del hecho no es frontera y el
 *  segmento servido queda byte a byte como antes de esta tanda. */
/** Las fronteras del segmento de un tramo [from, to): la
 *  delimitación asentada de clauseSlice (conjunciones sueltas y
 *  cortes de frase con contenido a ambos lados), sin el juicio
 *  de comas. */
function clauseBounds(
  fact: string,
  tokens: FactToken[],
  from: number,
  to: number
): { start: number; end: number } {
  let start = 0;
  let end = fact.length;
  for (const tk of tokens) {
    if (tk.end <= from && CLAUSE_CONJUNCTIONS.has(tk.text.toLowerCase())) start = Math.max(start, tk.end);
    if (tk.start >= to && CLAUSE_CONJUNCTIONS.has(tk.text.toLowerCase())) end = Math.min(end, tk.start);
  }
  for (const b of sentenceBreaks(fact)) {
    const hasBefore = tokens.some((tk) => tk.start < b.start);
    const hasAfter = tokens.some((tk) => tk.start >= b.after);
    if (!hasBefore || !hasAfter) continue;
    if (b.after <= from) start = Math.max(start, b.after);
    if (b.start >= to) end = Math.min(end, b.start);
  }
  return { start, end };
}

function clauseSlice(fact: string, tokens: FactToken[], from: number, to: number): string {
  const { start, end } = clauseBounds(fact, tokens, from, to);
  // PC-1: dentro del segmento, el subtramo de comas del ancla
  // manda si trae su fecha; si no, el segmento entero, como
  // hasta hoy (ver commaSubSlice).
  return commaSubSlice(fact, start, end, from, to) ?? fact.slice(start, end).replace(/^[\s,;]+|[\s,;]+$/g, "");
}

/** ADV-PC1-C1 (adversaria de PC-1): ¿la cláusula propia de
 *  ESTA ocurrencia del ancla trae fecha extraíble? Su tramo es
 *  el subtramo de comas que la contiene si su segmento va
 *  troceado por comas, y su segmento entero si no (la cláusula
 *  tras la conjunción de la forma mixta: «…, el cumpleaños de
 *  mi abuelo es el 20 de junio y el de mi abuela es el 15 de
 *  marzo»). La vara es la de siempre: extractDateISO, el mismo
 *  extractor que sirve la fecha, como en commaSubSlice y en
 *  clauseServesDateBefore. */
function anchorSpanHasDate(
  fact: string,
  tokens: FactToken[],
  from: number,
  to: number
): boolean {
  const { start, end } = clauseBounds(fact, tokens, from, to);
  const mine = commaSubRange(fact, start, end, from, to);
  const text = mine ? fact.slice(mine.s, mine.e) : fact.slice(start, end);
  return extractDateISO(text) !== null;
}

/** ADV-PC1-C1: la condición de captura de la PRIMERA mención —
 *  su segmento va unido por comas y su propio subtramo de comas
 *  no trae fecha, así que commaSubSlice devuelve null y el
 *  segmento entero (con la fecha de otro) es lo que se sirve.
 *  Sin comas en su segmento no hay captura de esta familia: la
 *  mención previa separada por conjunción o por punto degrada
 *  a la cita honesta de su segmento, y esa cita no se toca. */
function anchorCommaCaptured(
  fact: string,
  tokens: FactToken[],
  from: number,
  to: number
): boolean {
  const { start, end } = clauseBounds(fact, tokens, from, to);
  const mine = commaSubRange(fact, start, end, from, to);
  if (!mine) return false;
  return extractDateISO(fact.slice(mine.s, mine.e)) === null;
}

/** ADV-PC1-C1: qué ocurrencia del ancla manda. Si la primera
 *  mención no está capturada por las comas, la primera, byte a
 *  byte como hasta hoy — la selección no se mueve fuera de la
 *  superficie del cargo. Si lo está (el apositivo o el inciso
 *  dentro de la cláusula de otro, la cláusula previa por
 *  comas), manda la primera ocurrencia posterior cuya cláusula
 *  propia trae su fecha: esa es la que clauseSlice debe
 *  recibir, porque es la única a la que puede servir su tramo.
 *  Si ninguna la trae, la primera, como hasta hoy. La frontera
 *  F-1 no vive aquí: su forma es de una sola ocurrencia, o su
 *  cláusula preguntada no trae fecha en ningún tramo
 *  (condición asentada), así que ninguna ocurrencia supera el
 *  juicio y su desenlace queda intacto; y los residuos
 *  R-A…R-D son de una sola ocurrencia o de cláusula sin tramo
 *  con fecha, así que tampoco se mueven. */
function pickAnchorSpan(
  fact: string,
  tokens: FactToken[],
  spans: { from: number; to: number }[]
): number {
  if (spans.length < 2) return 0;
  if (!anchorCommaCaptured(fact, tokens, spans[0]!.from, spans[0]!.to)) return 0;
  for (let k = 1; k < spans.length; k++) {
    if (anchorSpanHasDate(fact, tokens, spans[k]!.from, spans[k]!.to)) return k;
  }
  return 0;
}

/** ADV-F3-C1, asiento propio (medido al ejecutar esta tanda, en las
 *  tres lenguas): la selección de la rama SELF casa el hecho
 *  combinado por «mi cumplea» esté donde esté, y la extracción
 *  sacaba la primera fecha — con el cumpleaños de la abuela primero
 *  en el hecho, «¿cuándo es mi cumpleaños?» servía el 15 de marzo
 *  como propio. Mismo remedio: la cláusula que contiene la frase de
 *  primera persona que casó en la selección (la misma regex). */
const SELF_BDAY_PHRASE_RE = /mi cumplea|my birthday|meu anivers/i;

/** Auditoría de la 0.1.70 (punto 5a): el pronombre posesivo que
 *  ocupa el lugar de la frase propia en un hecho combinado: «el mío»
 *  (es), «mine» (en), «o meu» (pt, solo sin sustantivo detrás: ante
 *  cópula, «dia», «em», «cai», «fica» o puntuación, para que «o meu
 *  pai» no cuente). Es más débil que la frase explícita, así que solo
 *  vale cuando la cláusula propia de esa ocurrencia trae fecha
 *  extraíble: «…el mío no lo sé» o «…older than mine» no sirven nada
 *  como propio, y la fecha de otra persona nunca se sirve por él. */
const SELF_BDAY_PRONOUN_RE =
  /(?<![\p{L}])(?:el m[ií]o|mine|o meu(?=\s+(?:é|dia|em|cai|fica)(?![\p{L}])|\s*[,.;!?]|\s*$))(?![\p{L}])/iu;

function spansOf(fact: string, re: RegExp): { from: number; to: number }[] {
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  const spans: { from: number; to: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = g.exec(fact)) !== null) {
    spans.push({ from: m.index, to: m.index + m[0].length });
    if (m[0].length === 0) g.lastIndex++;
  }
  return spans;
}

/** Las ocurrencias de primera persona del hecho: las de la frase
 *  explícita si las hay (como hasta hoy); si no, las del pronombre
 *  posesivo cuya cláusula propia trae fecha. */
function selfBirthdaySpans(fact: string): { from: number; to: number }[] {
  const explicit = spansOf(fact, SELF_BDAY_PHRASE_RE);
  if (explicit.length) return explicit;
  const pron = spansOf(fact, SELF_BDAY_PRONOUN_RE);
  if (!pron.length) return [];
  const tokens = factTokens(fact);
  return pron.filter((sp) => extractDateISO(clauseSlice(fact, tokens, sp.from, sp.to)) !== null);
}

function birthdaySelfSlice(fact: string): string | null {
  // ADV-PC1-C1: la frase propia puede ocurrir más de una vez;
  // entre sus ocurrencias manda la misma selección del asiento
  // persona (pickAnchorSpan): la primera cuyo subtramo de comas
  // trae su fecha, y si ninguna, la primera, como hasta hoy.
  const spans = selfBirthdaySpans(fact);
  if (!spans.length) return null;
  const tokens = factTokens(fact);
  const chosen = spans[pickAnchorSpan(fact, tokens, spans)]!;
  const slice = clauseSlice(fact, tokens, chosen.from, chosen.to);
  return slice || null;
}

/** Días hasta la próxima vez que llega ese día y mes (0 = hoy). */
function birthdayCountdown(iso: string, who: string | null, lang: MemoryQueryLang, now: Date = new Date()): string {
  const d = new Date(iso);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let next = new Date(today.getFullYear(), d.getMonth(), d.getDate());
  // El 29 de febrero en un año que no lo tiene: el próximo que sí.
  for (let y = today.getFullYear(); (next.getMonth() !== d.getMonth() || next < today) && y <= today.getFullYear() + 8; y++) {
    next = new Date(y + 1, d.getMonth(), d.getDate());
    if (next.getMonth() === d.getMonth() && next >= today) break;
  }
  if (next < today) next = new Date(today.getFullYear() + 1, d.getMonth(), d.getDate());
  const days = Math.round((next.getTime() - today.getTime()) / 86_400_000);
  const day = formatDay(next, lang);
  const whose =
    lang === "en"
      ? who
        ? `${who}'s birthday`
        : "your birthday"
      : lang === "pt"
        ? who
          ? `o aniversário de ${who}`
          : "o seu aniversário"
        : who
          ? `el cumpleaños de ${who}`
          : "tu cumpleaños";
  if (days === 0) return lang === "en" ? `It's today: ${whose}, ${day}.` : lang === "pt" ? `É hoje: ${whose}, ${day}.` : `Es hoy: ${whose}, ${day}.`;
  if (lang === "en") return `${days} day${days === 1 ? "" : "s"} until ${whose} (${day}).`;
  if (lang === "pt") return `Falta${days === 1 ? "" : "m"} ${days} dia${days === 1 ? "" : "s"} para ${whose} (${day}).`;
  return `Falta${days === 1 ? "" : "n"} ${days} día${days === 1 ? "" : "s"} para ${whose} (${day}).`;
}

function birthdayAnswer(fact: string, who: string | null, lang: MemoryQueryLang): string {
  const iso = extractDateISO(fact, lang);
  if (iso) {
    const day = formatDay(new Date(iso), lang);
    return who
      ? msg("birthday", lang, { who, day })
      : msg("yourBirthday", lang, { day });
  }
  return msg("factQuote", lang, { fact });
}

const STOPWORDS = new Set([
  "como", "cual", "cuales", "cuando", "donde", "que", "qué", "cuál", "cómo", "cuándo", "dónde",
  "tengo", "tiene", "sabes", "sabe", "llama", "llamo", "nombre", "name", "what", "when", "where",
  "which", "whats", "about", "qual", "quando", "onde", "chama", "chamo", "mein", "meu", "minha",
  "mine", "your", "yours", "sobre", "contado", "cuentame", "have", "does",
  // 0.1.75: el verbo «ser/estar» de la pregunta no es un término: «¿a qué
  // soy alérgico?» no encontraba «I'm allergic to peanuts» porque «soy»
  // no estaba en el hecho inglés (ni «sou» en el español).
  "soy", "sou", "estoy", "estou",
  // «favorito/favorite» NO son stopwords: son justo lo que se pregunta
  // («¿cuál es mi color favorito?»); con ellas en la lista la búsqueda
  // se quedaba sin términos (batería trilingüe 0.1.20).
]);

export interface MemoryFactScore {
  /** El hecho con mayor puntuación (su texto), o null si ninguno puntúa. */
  fact: string | null;
  /** Cuántos términos de contenido de la pregunta aparecen en el hecho. */
  score: number;
  /** Cuántos términos de contenido trae la pregunta. */
  tokenCount: number;
}

/**
 * Búsqueda genérica por palabras en los hechos guardados, con la
 * puntuación a la vista. Es la ÚNICA fuente de puntuación: la usa la
 * rama genérica de answerMemoryQuery para elegir el hecho a citar y
 * la sonda de la puerta (memoryGateHit) para decidir si la pregunta
 * entra al loop — puerta y respuesta nunca discrepan (0.1.23).
 */
export function scoreMemoryFacts(mem: MemoryQueryData, question: string): MemoryFactScore {
  // Pieza 4 (resto de ADV-M1): la pregunta se des-fusiona antes de
  // puntuar («mima» → «mi mamá»), como ya hacía la vía de respuesta.
  // Esta función es la ÚNICA fuente de puntuación (puerta, respuesta y
  // testigo de ADV2): sin el plegado aquí, la sonda de la puerta no ve
  // el término «mamá» y la forma fusionada no entra pese a tener el
  // hecho guardado. Idempotente sobre texto ya des-fusionado.
  const tokens = fold(unfuseMi(question))
    .split(/[^a-z0-9]+/)
    // >= 3: «car» y «cor» son términos de búsqueda reales en EN/PT.
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
  let best: { content: string; score: number } | null = null;
  for (const f of mem.facts) {
    const fc = fold(f.content);
    const score = tokens.reduce((n, t) => n + (mentionsTerm(fc, t) ? 1 : 0), 0);
    if (score > 0 && (!best || score > best.score)) best = { content: f.content, score };
  }
  return { fact: best?.content ?? null, score: best?.score ?? 0, tokenCount: tokens.length };
}

/**
 * 0.1.23: ¿la pregunta genérica tiene un hit FUERTE en la memoria?
 * Umbral aprobado por el dueño: score >= 2, o score == 1 cuando la
 * pregunta trae un único término de contenido («¿dónde vivo?» →
 * [vivo]). Con varios términos, un solo término compartido NO basta:
 * es justo el solape típico de las preguntas sobre documentos («¿qué
 * dice mi documento sobre…?») y de la charla, que deben seguir su ruta.
 */
export function memoryGateHit(userText: string, mem: MemoryQueryData): boolean {
  const t = (userText ?? "").trim();
  if (!t || !mem.facts.length) return false;
  const { score, tokenCount } = scoreMemoryFacts(mem, t);
  return score >= 2 || (score === 1 && tokenCount === 1);
}

/**
 * Formas de CONSULTA de memoria (las mismas que responde
 * answerMemoryQuery abajo). Viven como constantes compartidas porque
 * la puerta del chat (classifyIntent) necesita reconocerlas SIN tener
 * la memoria cargada: si la pregunta no entra al loop, la respuesta
 * determinista nunca ocurre (evidencia física 0.1.21: «¿cómo se llama
 * mi mamá?» caía al conocimiento y citaba el Metro de Madrid).
 */
const REL_NAME_Q_RES: RegExp[] = [
  // B4 (barrido «revisa todo», clase 1): las formas clásicas ganan la
  // cola de cortesía que los patrones nuevos de G-M1-R1 ya traían —
  // el dictado con «por favor»/«please» es habla común en los tres
  // idiomas y caía a notKnown con la ficha guardada.
  /¿?c[oó]mo se llama mi ([a-záéíóúñü ]+?)(?:[,\s]+(?:por favor|porfa))?\??$/i,
  /what'?s my ([a-z -]+?)'?s name(?:[,\s]+please)?\??$/i,
  // 0.1.34 (barrido de paridad): «what is my mom's name» (sin contraer) y
  // «what is the name of my mom» caían al modelo sin memoria guardada.
  /what is my ([a-z -]+?)'?s name(?:[,\s]+please)?\??$/i,
  /what is the name of my ([a-z -]+?)(?:[,\s]+please)?\??$/i,
  // B5 (barrido «revisa todo», clase 1): la forma «called» de REL en.
  /what(?:'s| is) my ([a-z -]+?) called(?:[,\s]+please)?\??$/i,
  // Auditoría de la 0.1.70: el artículo masculino «o meu» faltaba
  // («como se chama o meu pai?» caía a «você ainda não me contou isso»
  // con el padre guardado); solo entraba «a minha» y «meu» sin artículo.
  /como se chama (?:[ao] )?(?:minha?|meu) ([a-záéíóúãõçô ]+?)(?:[,\s]+por favor)?\??$/i,
  // G-M1-R1 (post-0.1.69, cruce de Grok): la forma española «¿cuál es
  // el nombre de mi X?» y su espejo portugués no estaban — la inglesa
  // entró en el barrido de paridad de la 0.1.34 y estas no. Sin patrón,
  // la pregunta caía a la rama genérica (punto 5), que solo puntúa
  // hechos: con el nombre guardado SOLO como ficha de persona, la
  // respuesta era «no me lo has contado» teniéndolo. Con el patrón, la
  // forma entra en la rama 1, donde la ficha se sirve por
  // findPersonByRel con la misma respuesta que da el hecho — el
  // asiento equivalente que la ficha 12 de la estantería nombra.
  // scoreMemoryFacts NO se toca: es la única fuente de puntuación de
  // la puerta y del testigo de ADV2, y moverla movería otras rutas.
  // Cola de cortesía («…, por favor») como en las formas de hora y
  // fecha de intent.ts; el dictado sin acentos ni signos casa por las
  // clases (cu[aá]l, (?:é|e)) y la des-fusión previa (unfuseMi).
  /¿?cu[aá]l es el nombre de mi ([a-záéíóúñü ]+?)(?:[,\s]+(?:por favor|porfa))?\??$/i,
  /qual (?:é|e) o nome d[aeo] (?:minha?|meu) ([a-záéíóúãõçô ]+?)(?:[,\s]+por favor)?\??$/i,
];
const SELF_NAME_Q_RES: RegExp[] = [
  /¿?c[oó]mo me llamo\??$/i,
  /what'?s my name\??$/i,
  /como (?:eu )?me chamo\??$/i,
  /qual (?:é|e) (?:o )?meu nome\??$/i,
  // B1+B2 (barrido «revisa todo», clase 1): SELF se quedó sin la
  // forma que G-M1-R1 dio a REL y que REL en ganó en la 0.1.34 —
  // «¿cuál es mi nombre?» y «what is my name?» caían al modelo
  // (puerta false, classifyIntent «conversar») teniendo el hecho.
  /¿?cu[aá]l es mi nombre\??$/i,
  /what is my name\??$/i,
];
const BDAY_PERSON_Q_RES: RegExp[] = [
  /cu[aá]ndo es el cumplea[ñn]os de mi ([a-záéíóúñü ]+?)\??$/i,
  // B6 (barrido «revisa todo», clase 1): la contraída «when's» entra
  // junto a «when is», como SELF y REL ya traían la suya.
  /when(?:'s| is) my ([a-z -]+?)'?s birthday\??$/i,
  // ADV-F2-C5 (adversaria de formas II): la clase pt no traía «ô» y
  // la pregunta por el abuelo nunca entraba en la rama (caía a la cita
  // en crudo), asimetría con sus gemelas de REL_NAME_Q_RES. La «ô»
  // entra JUNTO a la guardia de findBirthdayFact (ADV-F2-C3), nunca
  // antes: sin ella, la dirección simétrica del servicio cruzado
  // quedaba expuesta en cuanto la pregunta entrara.
  /quando (?:é|e) o anivers[aá]rio d[aeo] (?:minha?|meu) ([a-záéíóúãõçô ]+?)\??$/i,
];
const BDAY_SELF_Q_RES: RegExp[] = [
  /cu[aá]ndo es mi cumplea[ñn]os\??$/i,
  /when is my birthday\??$/i,
  /quando (?:é|e) (?:o )?meu anivers[aá]rio\??$/i,
];
// Arreglos «todo es todo» (2026-11-03): «¿cuántos días faltan para mi
// cumpleaños?» caía a la charla, aunque la fecha estuviera guardada.
const BDAY_COUNTDOWN_SELF_RES: RegExp[] = [
  /cu[aá]nto(?:s d[ií]as)? (?:falta|faltan|queda|quedan) para mi cumplea[ñn]os\??$/i,
  /how (?:many days|long) (?:until|till|to|left until|is it until) my birthday\??$/i,
  /quantos dias faltam para o meu anivers[aá]rio\??$/i,
  /quanto falta para o meu anivers[aá]rio\??$/i,
];
const BDAY_COUNTDOWN_PERSON_RES: RegExp[] = [
  /cu[aá]nto(?:s d[ií]as)? (?:falta|faltan|queda|quedan) para el cumplea[ñn]os de (?:mi )?([a-záéíóúñü ]+?)\??$/i,
  /how (?:many days|long) (?:until|till|to|left until|is it until) (?:my )?([a-z -]+?)'?s birthday\??$/i,
  /quantos dias faltam para o anivers[aá]rio d[aeo] (?:minha |meu )?([a-záéíóúãõçô ]+?)\??$/i,
];
const ABOUT_ME_Q_RES: RegExp[] = [
  /qu[eé] (?:sabes|recuerdas|tienes guardado|has guardado) (?:de|sobre) m[ií]\??$/i,
  // B7 (barrido «revisa todo», clase 1): en gana «have saved/stored»
  // y pt los verbos que le faltaban (solo traía «sabe»): «lembra»,
  // «guardou» y «salvou» daban null — salían de la ruta de memoria.
  /what do you (?:know|remember|have saved|have stored) about me\??$/i,
  // C1-H2 (barrido 0.1.96): pt también con «de mim» (es ya tenía
  // «(de|sobre) mí») y con el reflexivo «se lembra».
  /o que (?:você|voce) (?:se )?(?:sabe|lembra|guardou|salvou) (?:de|sobre) mim\??$/i,
  // C1-H2: la pregunta de sí/no, en los tres idiomas.
  /(?:você|voce) (?:se )?lembra de mim\??$/i,
  /te acuerdas de m[ií]\??$/i,
  /do you remember me\??$/i,
];
/**
 * Primera persona (rama genérica de answerMemoryQuery, punto 5).
 * 0.1.42 (barrido): también un pasado en primera persona («¿dónde dejé el
 * coche?», «¿dónde estacioné?»). Con «u» y límites por letra: con \b, la
 * «é» final de «dejé» no cerraba la palabra y la forma nunca casaba.
 */
const FIRST_PERSON_RE =
  /(?<![\p{L}])(?:mi|mis|me|my|mine|i|meu|minha|meus|minhas|soy|sou|estoy|estou|tengo|vivo|trabajo|tenho|moro|chamo|dej[eé]|puse|guard[eé]|estacion[eé]|aparqu[eé]|deixei|estacionei)(?![\p{L}])/iu;

/**
 * 0.1.23: la FORMA de la pregunta genérica (punto 5): interrogativa y
 * en primera persona. Es el guardia exacto de la rama 5, exportado
 * para que la sonda de ChatScreen pre-filtre con él sin duplicarlo.
 * La forma sola NO decide nada: también caza las preguntas sobre
 * documentos y la charla con primera persona. Lo que separa las
 * familias es el hit (memoryGateHit): ¿existe el dato guardado?
 * \bi\b: el «I» inglés («what car do I have?») — sin él la puerta de
 * primera persona no se abría en inglés (batería trilingüe 0.1.20).
 */
/**
 * 0.1.42 (barrido): «¿dónde está la clave del wifi?» no está en primera
 * persona, pero si TODOS sus términos de contenido están en un mismo hecho
 * guardado (y son al menos dos), la pregunta es sobre ese hecho. Pregunta +
 * cobertura total: un documento o la charla rara vez comparten todos los
 * términos con una frase que el usuario guardó.
 */
export function memoryFullCoverageHit(userText: string, mem: MemoryQueryData): boolean {
  const t = (userText ?? "").trim();
  if (!t || !mem.facts.length) return false;
  const isQuestion = /^\s*¿/.test(t) || /\?\s*$/.test(t);
  if (!isQuestion) return false;
  const { score, tokenCount } = scoreMemoryFacts(mem, t);
  return tokenCount >= 2 && score === tokenCount;
}

// ---------------------------------- ADV2-09: el testigo exige el dato

/**
 * Segunda adversaria, ADV2-09: el testigo de H-06 se gana por la
 * FORMA del turno, y dos de las puertas que lo otorgan (la sonda:
 * hit fuerte y cobertura total) deciden por solape de tokens con un
 * hecho — sin mirar si el dato preguntado vive en ese hecho. Con la
 * herramienta de memoria desactivada (un estado que el producto
 * ofrece), la capa determinista no corre y la prosa inventada sobre
 * un dato que NO está en la memoria salía exenta de la red: el
 * hecho del cajón dice «horario» y no contiene ninguna hora.
 *
 * Diseño (a), el medido en la preparación contra el (b): cuando la
 * promoción viene de la sonda, el testigo exige además que el hecho
 * que promueve contenga una INSTANCIA de la clase de dato pedida —
 * la instancia es el dato, no la palabra de la clase. Sin clase
 * reconocida en la pregunta, el testigo no cambia: la exención de
 * H-06 queda intacta. (El diseño (b) — sin testigo cuando la
 * herramienta está apagada — se midió y se rechazó: volteaba la
 * fixture asentada del propio H-06 en ese mismo estado.)
 *
 * Alcance declarado: solo las promociones de la sonda. Los turnos
 * que el clasificador ruta «recordar» conservan el testigo de
 * siempre; esa puerta es otra familia (Núcleo 3). La clase
 * «lugar/dirección» no entra: no es comprobable con una instancia
 * cerrada (los lugares son vocabulario abierto).
 */
export type MemoryDatumClass = "time" | "number" | "date";

/** Palabras-gatillo por clase, cerradas y trilingües (tokens de la
 *  pregunta plegada; las formas son la palabra y sus plurales o
 *  flexiones del mismo concepto, nada más). */
const DATUM_TRIGGER_WORDS: Record<MemoryDatumClass, readonly string[]> = {
  time: [
    "horario", "horarios", "hora", "horas", "hour", "hours",
    "abre", "abren", "cierra", "cierran", "opening", "schedule",
  ],
  number: [
    "numero", "numeros", "telefono", "telefone", "tarjeta", "cartao",
    "clave", "codigo", "number", "numbers", "phone", "card", "code", "senha",
  ],
  date: [
    "cuando", "fecha", "cumpleanos", "aniversario",
    "when", "date", "birthday", "quando",
  ],
};

/** Meses (tokens plegados, es/en/pt): una fecha nombrada ES una
 *  instancia de fecha; un año suelto no lo es. */
const MONTH_TOKENS = new Set([
  "enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto",
  "septiembre", "setiembre", "octubre", "noviembre", "diciembre",
  "january", "february", "march", "april", "may", "june", "july", "august",
  "september", "october", "november", "december",
  "janeiro", "fevereiro", "marco", "maio", "junho", "julho",
  "setembro", "outubro", "novembro", "dezembro",
]);

/** La instancia de cada clase dentro del hecho (texto plegado):
 *  hora = H:MM, «12 am/pm» o un rango («de 8 a 18», «from 9 to 5»,
 *  «das 8 às 18»); número = corrida de ≥3 dígitos con separadores;
 *  fecha = ISO, d/m o un mes nombrado (este último se prueba por
 *  token en factHasDatumInstance). */
const DATUM_INSTANCE_RES: Record<MemoryDatumClass, readonly RegExp[]> = {
  time: [
    /\b\d{1,2}:\d{2}\b/,
    /\b\d{1,2}\s*(?:am|pm)\b/,
    /\bde\s+\d{1,2}\s+a\s+\d{1,2}\b/,
    /\bdas\s+\d{1,2}\s+as\s+\d{1,2}\b/,
    /\bfrom\s+\d{1,2}\s+to\s+\d{1,2}\b/,
  ],
  number: [/\d(?:[\s.\-]?\d){2,}/],
  date: [/\b\d{4}-\d{2}-\d{2}\b/, /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/],
};

/** ¿Contiene el hecho una instancia de la clase pedida? */
export function factHasDatumInstance(fact: string, cls: MemoryDatumClass): boolean {
  const f = fold(fact);
  if (DATUM_INSTANCE_RES[cls].some((re) => re.test(f))) return true;
  if (cls === "date") return f.split(/[^a-z0-9]+/).some((w) => MONTH_TOKENS.has(w));
  return false;
}

/** Las clases de dato que la pregunta pide (vacío = ninguna). */
export function questionDatumClasses(question: string): MemoryDatumClass[] {
  const tokens = new Set(fold(question).split(/[^a-z0-9]+/).filter((w) => w.length > 0));
  return (Object.keys(DATUM_TRIGGER_WORDS) as MemoryDatumClass[]).filter((cls) =>
    DATUM_TRIGGER_WORDS[cls].some((w) => tokens.has(w)),
  );
}

/**
 * El testigo de una promoción de la sonda: ¿puede este turno
 * eximirse de la red como «respondido desde la memoria»? La misma
 * fuente de puntuación que la puerta y la respuesta
 * (scoreMemoryFacts): el hecho que promueve es su mejor hecho. Si
 * la pregunta no pide ninguna clase cerrada, el testigo es el de
 * siempre (true). Si la pide, el hecho debe contener TODAS las
 * clases pedidas (ADV3, A3-05): la exención cubre el turno entero,
 * y con el SOME de antes una sola clase presente dejaba la
 * ausente sin red. Con una sola clase, every ≡ some: el
 * desenlace de las preguntas de una clase no cambia.
 */
export function memoryProbeWitness(question: string, mem: MemoryQueryData): boolean {
  const classes = questionDatumClasses(question);
  if (classes.length === 0) return true;
  const { fact } = scoreMemoryFacts(mem, question);
  if (!fact) return true;
  return classes.every((cls) => factHasDatumInstance(fact, cls));
}

export function isGenericMemoryQuestionShape(userText: string): boolean {
  // Pieza 4 (resto de ADV-M1): paridad con la puerta real — la forma se
  // juzga sobre el texto des-fusionado («¿cómo se llama mima?» trae
  // «mi» tras des-fusionar), igual que isMemoryStyleQuery.
  const t = unfuseMi((userText ?? "").trim());
  if (!t) return false;
  const isQuestion = /^\s*¿/.test(t) || /\?\s*$/.test(t);
  return isQuestion && FIRST_PERSON_RE.test(t);
}

/**
 * ¿Es esto una consulta SOBRE la memoria del usuario? Espejo de las
 * formas que answerMemoryQuery reclama (puntos 1–4). La usa la puerta
 * de intenciones para dejar pasar la pregunta al loop, que es quien
 * puede responderla desde lo guardado.
 *
 * El punto 5 (pregunta genérica en primera persona) NO se espeja a
 * propósito: esa forma es ambigua con las preguntas sobre documentos
 * («¿qué dice mi documento sobre…?», ejemplos de la guía que deben ir
 * al conocimiento) y con charla («¿qué tengo que hacer para…?»). La
 * rama 5 sigue viva dentro del loop para los turnos que entran por
 * otra vía; en la puerta mandan las formas inequívocas. Desde la
 * 0.1.23, esa familia entra por la sonda con hit de ChatScreen
 * (isGenericMemoryQuestionShape + memoryGateHit), no por el
 * clasificador, que se queda puro y sin memoria.
 */
// 0.1.25 (hallazgo físico, Tab A9+ 2026-10-12): el autocorrector o el
// dictado fusionan «mi mamá» en «mima» («mi papá» → «mipa», «mi hijo»
// → «mihijo»). Las formas de consulta exigen «mi» + parentesco como
// palabras separadas y la pregunta fusionada caía al modelo, que
// respondía en primera persona («Mi mamá se llama Marta») y con el
// banner de «sin fuentes». Se reescribe la fusión a su forma canónica
// SOLO para casar las formas de consulta: los dos consumidores de
// este módulo (la puerta vía isMemoryStyleQuery y la respuesta vía
// answerMemoryQuery) normalizan su copia antes de probar las formas.
const MI_FUSIONS: Record<string, string> = {
  mima: "mi mamá",
  mimama: "mi mamá",
  "mimamá": "mi mamá",
  mipa: "mi papá",
  mipapa: "mi papá",
  "mipapá": "mi papá",
  mimadre: "mi madre",
  mipadre: "mi padre",
  mihijo: "mi hijo",
  mihija: "mi hija",
  mihermano: "mi hermano",
  mihermana: "mi hermana",
  miesposo: "mi esposo",
  miesposa: "mi esposa",
  miabuelo: "mi abuelo",
  miabuela: "mi abuela",
};
const MI_FUSION_RE =
  /(^|\s)(mimam[aá]|mima|mipap[aá]|mipa|mimadre|mipadre|mihijo|mihija|mihermano|mihermana|miesposo|miesposa|miabuelo|miabuela)(?=\s|$|[?.,!])/gi;

export function unfuseMi(text: string): string {
  return text.replace(MI_FUSION_RE, (_m, pre: string, w: string) => pre + (MI_FUSIONS[w.toLowerCase()] ?? w));
}

export function isMemoryStyleQuery(userText: string): boolean {
  const t = unfuseMi((userText ?? "").trim()).replace(/\s+([?!.]+)$/, "$1").replace(/[.!]+$/, "");
  if (!t) return false;
  if (REL_NAME_Q_RES.some((re) => re.test(t))) return true;
  if (SELF_NAME_Q_RES.some((re) => re.test(t))) return true;
  if (BDAY_PERSON_Q_RES.some((re) => re.test(t))) return true;
  if (BDAY_SELF_Q_RES.some((re) => re.test(t))) return true;
  if (BDAY_COUNTDOWN_SELF_RES.some((re) => re.test(t))) return true;
  if (BDAY_COUNTDOWN_PERSON_RES.some((re) => re.test(t))) return true;
  if (ABOUT_ME_Q_RES.some((re) => re.test(t))) return true;
  return false;
}

export function answerMemoryQuery(
  userText: string,
  mem: MemoryQueryData,
  lang: MemoryQueryLang
): string | null {
  // 0.1.41 (prueba física): «Que sabes de mi ?» — el espacio antes del
  // signo dejaba fuera todos los patrones anclados con «\??$».
  const t = unfuseMi(userText.trim()).replace(/\s+([?!.]+)$/, "$1").replace(/[.!]+$/, "");
  if (!t) return null;

  // 1) «¿cómo se llama mi REL?» — nombre de una persona guardada.
  const relNameQ = REL_NAME_Q_RES.map((re) => re.exec(t)).find((m) => m !== null) ?? null;
  if (relNameQ) {
    const rel = relNameQ[1].trim();
    const person = findPersonByRel(mem, rel);
    if (person) return msg("personName", lang, { rel, name: person.name, poss: ptPossessive(ptServingRel(person.relationship, rel)) });
    // Puede estar como hecho («mi mamá se llama Marta» con gatillo).
    // B8 (barrido «revisa todo», clase 1; semilla 2 de la adversaria
    // de G-M1-R1): la cláusula que trae el nombre se reconoce en la
    // lengua del HECHO, no solo en español — «se chama» (pt) y
    // «name is» / «is called» (en) guardan el mismo dato y la app
    // decía «no me lo has contado» en ninguna dirección. La
    // canónica es el suelo: el hecho es sirve como hasta hoy.
    const fact = mem.facts.find(
      (f) => BIRTHDAY_RE.test(f.content) === false && NAME_CLAUSE_RE.test(f.content)
        && fold(f.content).split(/[^a-z0-9-]+/).some((w) => w && sameRel(w, rel))
    );
    if (fact) {
      // ADV-F-C1: la extracción espeja las cláusulas del selector —
      // «chama-se» trae el nombre tras el reflexivo, y en el marco
      // «o nome d… é» el nombre va tras la cópula, al final.
      // ADV-F2-C1: los marcos es/en extraen igual, tras su cópula.
      // ADV-F2-C2: el segundo término de la captura no puede ser la
      // conjunción suelta («e» pt, «y» es, «and» en): «…se chama
      // João e ele mora…» servía «João e». La mirada exige la palabra
      // entera, así los nombres compuestos legítimos («María Elena»,
      // «Mary Ann», «João Pedro») se siguen sirviendo enteros.
      const m =
        /(?:se llama|se chama|chama-se|name is|is called)\s+([A-ZÁÉÍÓÚÑÜÀÂÊÔÃÕÇ][\p{L}]+(?: (?!(?:e|y|and)(?![\p{L}]))[\p{L}]+)?)/iu.exec(fact.content) ??
        /^o nome\b[^.!?]*?(?<![\p{L}])é\s+([A-ZÁÉÍÓÚÑÜÀÂÊÔÃÕÇ][\p{L}]+(?: (?!(?:e|y|and)(?![\p{L}]))[\p{L}]+)?)/iu.exec(fact.content) ??
        /^el nombre\b[^.!?]*?(?<![\p{L}])es\s+([A-ZÁÉÍÓÚÑÜÀÂÊÔÃÕÇ][\p{L}]+(?: (?!(?:e|y|and)(?![\p{L}]))[\p{L}]+)?)/iu.exec(fact.content) ??
        /^the name\b[^.!?]*?(?<![\p{L}])is\s+([A-ZÁÉÍÓÚÑÜÀÂÊÔÃÕÇ][\p{L}]+(?: (?!(?:e|y|and)(?![\p{L}]))[\p{L}]+)?)/iu.exec(fact.content);
      // ADV-F-C2, asiento del hecho: la palabra de parentesco tal
      // como está escrita en el hecho (con su acento) es el registro
      // servido en este asiento; de ella sale el género del posesivo.
      const factRel = fact.content.split(/[^\p{L}]+/u).find((w) => w && sameRel(w, rel));
      if (m) return msg("personName", lang, { rel, name: m[1], poss: ptPossessive(ptServingRel(factRel, rel)) });
    }
    return msg("notKnown", lang);
  }

  // 2) «¿cómo me llamo?» — el nombre del propio usuario.
  if (SELF_NAME_Q_RES.some((re) => re.test(t))) {
    const fact = mem.facts.find((f) => /me llamo|my name is|meu nome é/i.test(f.content));
    if (fact) {
      const m = /(?:me llamo|my name is|meu nome é)\s+(.+)$/i.exec(fact.content);
      if (m) return msg("selfName", lang, { name: m[1].replace(/[.!]+$/, "") });
    }
    return msg("notKnown", lang);
  }

  // 3) Cumpleaños: de una persona o el propio.
  const bdayPersonQ = BDAY_PERSON_Q_RES.map((re) => re.exec(t)).find((m) => m !== null) ?? null;
  if (bdayPersonQ) {
    const rel = bdayPersonQ[1].trim();
    const person = findPersonByRel(mem, rel);
    const fact = findBirthdayFact(mem, { rel, personName: person?.name });
    // ADV-F3-C1 (adversaria de formas III): si el hecho guarda dos
    // cumpleaños, se sirve el SEGMENTO de la persona preguntada
    // (birthdayServingSlice): la fecha sale de su cláusula y la
    // palabra que manda el posesivo es la de ese segmento. Sin
    // segmento localizado, el hecho entero, como hasta hoy.
    const served = fact ? birthdayServingSlice(fact, { rel, personName: person?.name }) : null;
    // ADV-F2-C4 (adversaria de formas II): el «who» pt calculaba el
    // posesivo del token PREGUNTADO (ptPossessive(rel)) y servía
    // «sua avo» con la fecha del abuelo — la clase exacta de
    // ADV-F-C2 en la plantilla que aquel cargo no midió. Como en la
    // rama 1 desde F-C2, el género sale del registro SERVIDO: la
    // ficha que la rama ya trajo o, sin ficha, la palabra de
    // parentesco tal como está escrita en el hecho servido.
    const factRel = served?.word ?? fact?.split(/[^\p{L}]+/u).find((w) => w && sameRel(w, rel));
    const servedRel = ptServingRel(person?.relationship ?? factRel, rel);
    // 0.1.24 (auditoría, H-13): en EN el «who» abre la frase
    // («{{who}}'s birthday is on…») y salía en minúscula («your
    // mom's birthday…»); en ES/PT va tras «de», en minúscula bien.
    if (fact) return birthdayAnswer(served?.slice ?? fact, lang === "en" ? `Your ${rel}` : lang === "pt" ? `${ptPossessive(servedRel).toLowerCase()} ${rel}` : `tu ${rel}`, lang);
    return msg("notKnown", lang);
  }
  // Cuenta atrás hasta un cumpleaños guardado (propio o de alguien).
  if (BDAY_COUNTDOWN_SELF_RES.some((re) => re.test(t))) {
    const fact = findBirthdayFact(mem, { self: true });
    const iso = fact ? extractDateISO(birthdaySelfSlice(fact) ?? fact, lang) : null;
    return iso ? birthdayCountdown(iso, null, lang) : msg("notKnown", lang);
  }
  const countdownPerson = BDAY_COUNTDOWN_PERSON_RES.map((re) => re.exec(t)).find((m) => m !== null) ?? null;
  if (countdownPerson) {
    const who = countdownPerson[1].trim();
    const byName = mem.people.find((p) => fold(p.name) === fold(who)) ?? null;
    const byRel = byName ? null : mem.people.find((p) => !!p.relationship && sameRel(p.relationship, who)) ?? null;
    const person = byName ?? byRel;
    const fact = person
      ? findBirthdayFact(mem, { personName: person.name })
      : findBirthdayFact(mem, { rel: who }) ?? findBirthdayFact(mem, { personName: who });
    const served = fact ? birthdayServingSlice(fact, person ? { personName: person.name } : { rel: who, personName: who }) : null;
    const iso = fact ? extractDateISO(served?.slice ?? fact, lang) : null;
    // Quién, como en la respuesta de cumpleaños: el nombre si se preguntó
    // por nombre; si no, el parentesco con su posesivo.
    const isName = !!byName || (!person && /^[A-ZÁÉÍÓÚÑ]/.test(who));
    const label = isName ? (byName?.name ?? who) : lang === "en" ? `your ${who}` : lang === "pt" ? `${ptPossessive(who).toLowerCase()} ${who}` : `tu ${who}`;
    return iso ? birthdayCountdown(iso, label, lang) : msg("notKnown", lang);
  }
  if (BDAY_SELF_Q_RES.some((re) => re.test(t))) {
    const fact = findBirthdayFact(mem, { self: true });
    // ADV-F3-C1, asiento propio: en el hecho combinado se sirve la
    // cláusula de la frase propia (birthdaySelfSlice), no la primera
    // fecha del hecho; sin frase localizada, el hecho entero.
    if (fact) return birthdayAnswer(birthdaySelfSlice(fact) ?? fact, null, lang);
    return msg("notKnown", lang);
  }

  // 4) «¿qué sabes de mí?» — resumen de lo guardado.
  if (ABOUT_ME_Q_RES.some((re) => re.test(t))) {
    const lines: string[] = [];
    for (const f of mem.facts.slice(0, 6)) lines.push(`• ${f.content}`);
    for (const p of mem.people.slice(0, 4))
      lines.push(`• ${p.name}${p.relationship ? ` (${p.relationship})` : ""}`);
    if (!lines.length) return msg("notKnown", lang);
    return `${msg("aboutYou", lang)}\n${lines.join("\n")}`;
  }

  // 5) Genérica sobre datos propios: «¿qué coche tengo?», «¿dónde vivo?»,
  // «¿cuál es mi color favorito?» — solo si la pregunta es interrogativa
  // y menciona algo en primera persona; si no, no es para esta ruta.
  // La forma es isGenericMemoryQuestionShape y la cita sale de
  // scoreMemoryFacts: las mismas piezas que usa la sonda de la puerta
  // (0.1.23), para que puerta y respuesta nunca discrepen.
  if (isGenericMemoryQuestionShape(t)) {
    const { fact } = scoreMemoryFacts(mem, t);
    if (fact) return msg("factQuote", lang, { fact });
    return msg("notKnown", lang);
  }
  // 0.1.42: la otra puerta de la sonda (memoryFullCoverageHit), con la
  // misma regla, para que puerta y respuesta tampoco discrepen aquí.
  if (memoryFullCoverageHit(t, mem)) {
    const { fact } = scoreMemoryFacts(mem, t);
    if (fact) return msg("factQuote", lang, { fact });
  }

  return null;
}
