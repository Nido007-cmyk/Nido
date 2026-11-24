/**
 * Constructor de los ficheros de la Fase 0 a partir del corpus de la casa.
 *
 * Lee  ../../variantes/corpus.json  (2.957 variantes, generador determinista
 * de la casa: variantes/generar-corpus.mjs) y escribe en este directorio:
 *   corpus.jsonl   una línea por variante, sin perder ni una
 *   guarda.jsonl   el subconjunto negativo (guía + negativos + históricos)
 *   particion.json la regla de partición por frase base y sus conteos
 *
 * La frase base de cada variante se reconstruye por orden del corpus (el
 * generador emite cada base seguida de sus variantes) y se VERIFICA
 * reaplicando la transformación del generador a la base: si alguna variante
 * no se reproduce desde su base asignada, el constructor falla en voz alta.
 * Excepción declarada: las frases de voseo y usted de la ruta guía son
 * semillas propias (no derivan de otra base del corpus); su frase base es
 * la propia frase.
 *
 * Partición: determinista por FRASE BASE (ruta|lang|fraseBase), nunca por
 * variante: FNV-1a de 32 bits de la clave; «ciega» si hash % 5 == 0
 * (≈20 % de las bases), «desarrollo» en el resto. Así ninguna variante de
 * una frase base puede estar en una partición distinta de su base.
 */
import { readFileSync, writeFileSync } from "node:fs";

const corpus = JSON.parse(
  readFileSync(new URL("../../variantes/corpus.json", import.meta.url), "utf8")
);
if (corpus.length !== 2957) throw new Error(`corpus inesperado: ${corpus.length} entradas`);

// --- transformaciones del generador (copia fiel de generar-corpus.mjs) ---
const sinAcentos = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
function errata(s) {
  const words = s.split(" ");
  let best = -1, bl = 0;
  words.forEach((w, i) => { if (w.length > bl) { bl = w.length; best = i; } });
  if (best < 0) return s;
  const w = words[best];
  const idx = w.search(/[aeiouáéíóú]/i);
  if (idx < 0) return s;
  words[best] = w.slice(0, idx) + w.slice(idx + 1);
  return words.join(" ");
}
const CORTESIA = { es: (s) => "por favor, " + s, en: (s) => "please, " + s, pt: (s) => "por favor, " + s };
const AYUDA = { es: (s) => "necesito ayuda, " + s, en: (s) => "i need help, " + s, pt: (s) => "preciso de ajuda, " + s };
const PREGUNTA = { es: (s) => s + ", ¿qué hago?", en: (s) => s + ", what should I do?", pt: (s) => s + ", o que eu faço?" };
const MARCO = { es: (s) => "últimamente " + s, en: (s) => "lately " + s, pt: (s) => "ultimamente " + s };
const CIERRE = { es: (s) => s + ", ya no puedo más", en: (s) => s + ", i can't take it anymore", pt: (s) => s + ", não aguento mais" };
const APLICAR = {
  sinAcentos: (s) => sinAcentos(s),
  errata: (s) => errata(s),
  cortesia: (s, lang) => CORTESIA[lang](s),
  ayuda: (s, lang) => AYUDA[lang](s),
  pregunta: (s, lang) => PREGUNTA[lang](s),
  "marco-temporal": (s, lang) => MARCO[lang](s),
  "cierre-desesperado": (s, lang) => CIERRE[lang](s),
};

// --- puerta esperada (vocabulario del plan) desde la ruta de la casa ---
const PUERTA = {
  salud: "salud",
  emergencia: "emergencia",
  crisis: "crisis",
  caida: "caida",
  monoxido: "monoxido",
  "caida-narrada": "ninguna", // control negativo de caída: ninguna puerta debe declarar
  guia: "ninguna",
  negativos: "ninguna",
  "negativos-historicos": "ninguna",
};
const SUBCORPUS_GUARDA = { guia: "guia", negativos: "negativos", "negativos-historicos": "historicos" };

// --- partición determinista por frase base ---
function fnv1a(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h;
}
const particionDe = (ruta, lang, fraseBase) =>
  fnv1a(`${ruta}|${lang}|${fraseBase}`) % 5 === 0 ? "ciega" : "desarrollo";

// --- reconstrucción de bases con verificación ---
const lineas = [];
const fallosReconstruccion = [];
let baseActual = null; // {ruta, lang, frase}
for (const e of corpus) {
  const transforms = e.transformaciones;
  let fraseBase, tipo;
  if (transforms.length === 0) {
    fraseBase = e.frase; tipo = "base";
    baseActual = { ruta: e.ruta, lang: e.lang, frase: e.frase };
  } else if (transforms.length === 1 && (transforms[0] === "voseo" || transforms[0] === "usted")) {
    fraseBase = e.frase; tipo = transforms[0]; // semilla propia, no deriva de otra base
  } else if (transforms.length === 1 && APLICAR[transforms[0]]) {
    if (!baseActual || baseActual.ruta !== e.ruta || baseActual.lang !== e.lang) {
      fallosReconstruccion.push({ id: e.id, motivo: "sin base previa en su ruta/lang", frase: e.frase });
      fraseBase = e.frase;
    } else {
      fraseBase = baseActual.frase;
      const reproducida = APLICAR[transforms[0]](fraseBase, e.lang);
      if (reproducida !== e.frase) {
        fallosReconstruccion.push({ id: e.id, motivo: "la transformación no reproduce la variante", base: fraseBase, esperada: reproducida, frase: e.frase });
      }
    }
    tipo = transforms[0];
  } else {
    fallosReconstruccion.push({ id: e.id, motivo: `transformaciones no reconocidas: ${transforms.join("+")}`, frase: e.frase });
    fraseBase = e.frase; tipo = transforms.join("+");
  }
  lineas.push({
    id: "v" + String(e.id).padStart(4, "0"),
    texto: e.frase,
    fraseBase,
    ruta: e.ruta,
    puerta: PUERTA[e.ruta],
    lang: e.lang,
    tipo,
    esperado: e.esperado,
    particion: particionDe(e.ruta, e.lang, fraseBase),
  });
}
if (fallosReconstruccion.length) {
  console.error("RECONSTRUCCIÓN FALLIDA:", JSON.stringify(fallosReconstruccion, null, 1));
  process.exit(1);
}
console.log(`bases reconstruidas y verificadas: ${lineas.length} variantes, 0 fallos`);

// --- salidas ---
const aJsonl = (arr) => arr.map((l) => JSON.stringify(l)).join("\n") + "\n";
writeFileSync(new URL("./corpus.jsonl", import.meta.url), aJsonl(lineas));

const guarda = lineas
  .filter((l) => SUBCORPUS_GUARDA[l.ruta])
  .map((l) => ({ ...l, subcorpus: SUBCORPUS_GUARDA[l.ruta] }));
writeFileSync(new URL("./guarda.jsonl", import.meta.url), aJsonl(guarda));

// --- particion.json: regla y conteos ---
const bases = new Map();
for (const l of lineas) {
  const k = `${l.ruta}|${l.lang}|${l.fraseBase}`;
  if (!bases.has(k)) bases.set(k, { ruta: l.ruta, lang: l.lang, fraseBase: l.fraseBase, particion: l.particion, variantes: 0 });
  bases.get(k).variantes++;
}
const conteo = (arr, f) => arr.reduce((a, x) => { const k = f(x); a[k] = (a[k] || 0) + 1; return a; }, {});
const particion = {
  regla:
    "Partición fija por FRASE BASE, nunca por variante. Clave: ruta|lang|fraseBase. " +
    "Hash FNV-1a de 32 bits sobre la clave (offset 0x811c9dc5, primo 0x01000193). " +
    "La base es «ciega» si hash % 5 == 0 y «desarrollo» en el resto (≈20 % de bases a la ciega). " +
    "Todas las variantes de una base heredan la partición de su base: la fase 3 puede entrenar " +
    "con la partición de desarrollo sin ver jamás una variante de una frase que la ciega examina. " +
    "La regla es determinista y se recalcula con construir-jsonl.mjs; cualquier cambio de corpus " +
    "se ve en el diff de corpus.jsonl y en este fichero.",
  funcion: "fnv1a32(ruta + '|' + lang + '|' + fraseBase) % 5 == 0 -> ciega",
  bases: {
    total: bases.size,
    porParticion: conteo([...bases.values()], (b) => b.particion),
  },
  variantes: {
    total: lineas.length,
    porParticion: conteo(lineas, (l) => l.particion),
    porRuta: conteo(lineas, (l) => l.ruta),
    porRutaEIdioma: conteo(lineas, (l) => `${l.ruta}/${l.lang}`),
    porTipo: conteo(lineas, (l) => l.tipo),
  },
  guarda: { total: guarda.length, porSubcorpus: conteo(guarda, (l) => l.subcorpus) },
};
writeFileSync(new URL("./particion.json", import.meta.url), JSON.stringify(particion, null, 1) + "\n");
console.log(JSON.stringify(particion, null, 1));
