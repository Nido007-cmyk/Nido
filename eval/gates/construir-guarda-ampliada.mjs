/**
 * construir-guarda-ampliada.mjs · Constructor de la guarda ampliada.
 *
 * Deriva `corpus/guarda-ampliada.jsonl` (546 líneas) desde su fuente
 * sellada `corpus/fuente-ciega-guarda.jsonl` (las 600 líneas de guarda
 * de la ciega del experimento F3, gastada como examen el 2026-11-24;
 * sha256 del fichero completo de la ciega:
 * fbe4bad07bf081711adc6fef83e3a16261b831cc60d757ee39a57c796a2837cc,
 * el de SELLO-CIEGA.md del experimento). La fuente aterriza entera, no
 * solo la selección, para que la selección misma sea re-derivable y
 * auditable desde el repo.
 *
 * Gobierno: DIRIMEN-FORMATO-GUARDA (casa, 2026-11-24), decisiones
 * D-3 a D-8. En corto:
 *   - Entran enteras las cinco subfamilias ficcion, modismos,
 *     prevencion, historicos y medico, y de guia solo las 16 bases
 *     cerradas de D-5 (lista incrustada abajo, por (lang, fraseBase)).
 *   - Cada bloque de la fuente se reconstruye desde su línea base y se
 *     VERIFICA reaplicando la transformación (cortesía o sinAcentos,
 *     las definiciones del generador de la ciega): si alguna variante
 *     no se reproduce desde su base, el constructor falla en voz alta.
 *   - Los ids `g0001`…`g0546` se asignan en orden ascendente del id de
 *     la ciega (`ciegaId`, que queda guardado en cada línea).
 *   - Al cerrar, los conteos se cobran contra los gobernados
 *     (546 líneas; 99/99/99/99/102/48 por cubo; 184 bases) y cualquier
 *     diferencia tumba el constructor.
 *
 * Este material es guarda permanente (particion "guarda"): no es
 * partición de examen ni de entrenamiento de ningún experimento.
 */
import { readFileSync, writeFileSync } from "node:fs";

const leerJsonl = (url) =>
  readFileSync(url, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const fuente = leerJsonl(new URL("./corpus/fuente-ciega-guarda.jsonl", import.meta.url));
if (fuente.length !== 600) throw new Error(`fuente inesperada: ${fuente.length} líneas (esperadas 600)`);

// --- transformaciones del generador de la ciega (definiciones de la F0) ---
const sinAcentos = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const CORTESIA = { es: (s) => "por favor, " + s, en: (s) => "please, " + s, pt: (s) => "por favor, " + s };
const APLICAR = {
  cortesia: (s, lang) => CORTESIA[lang](s),
  sinAcentos: (s) => sinAcentos(s),
};

// --- selección de guía: las 16 bases cerradas de D-5, por (lang, fraseBase) ---
const GUIA_SELECCION = new Set([
  "es|¿qué tiempo hará mañana en la playa?",
  "es|¿cuántas onzas hay en un litro?",
  "es|¿cuántos días faltan para navidad?",
  "es|léeme el último mensaje de mi hermana",
  "es|pon una alarma para las seis y media",
  "en|how many ounces are in a liter",
  "en|save my cousin's address in my contacts",
  "en|set an alarm for six thirty",
  "en|translate good night into portuguese",
  "en|what will the weather be like at the beach tomorrow",
  "pt|como vai estar o tempo na praia amanhã",
  "pt|leia para mim a última mensagem da minha irmã",
  "pt|lembre-me de regar as plantas no domingo",
  "pt|quantas onças tem um litro",
  "pt|quantos dias faltam para o natal",
  "pt|traduza boa noite para o espanhol",
]);
const SUBS_ENTERAS = new Set(["ficcion", "modismos", "prevencion", "historicos", "medico"]);
const CUBOS = ["ciega-guia", "ciega-ficcion", "ciega-modismos", "ciega-prevencion", "ciega-historicos", "ciega-medico"];

// --- agrupar en bloques y verificar la reconstrucción ---
const bloques = []; // {sub, lang, fraseBase, lineas: [{ciegaId, frase, tipo}]}
let bloqueActual = null;
const fallos = [];
for (const l of fuente) {
  const marcador = l.transformaciones.find((t) => t.startsWith("guarda:"));
  if (!marcador) { fallos.push({ ciegaId: l.id, motivo: "sin marcador guarda:<sub>" }); continue; }
  const sub = marcador.slice("guarda:".length);
  const resto = l.transformaciones.filter((t) => t !== marcador);
  if (resto.length === 0) {
    bloqueActual = { sub, lang: l.lang, fraseBase: l.frase, lineas: [{ ciegaId: l.id, frase: l.frase, tipo: "base" }] };
    bloques.push(bloqueActual);
  } else if (resto.length === 1 && APLICAR[resto[0]]) {
    if (!bloqueActual || bloqueActual.sub !== sub || bloqueActual.lang !== l.lang) {
      fallos.push({ ciegaId: l.id, motivo: "variante sin bloque previo de su subfamilia e idioma", frase: l.frase });
      continue;
    }
    const reproducida = APLICAR[resto[0]](bloqueActual.fraseBase, l.lang);
    if (reproducida !== l.frase) {
      fallos.push({ ciegaId: l.id, motivo: "la transformación no reproduce la variante", base: bloqueActual.fraseBase, esperada: reproducida, frase: l.frase });
    }
    bloqueActual.lineas.push({ ciegaId: l.id, frase: l.frase, tipo: resto[0] });
  } else {
    fallos.push({ ciegaId: l.id, motivo: `transformaciones no reconocidas: ${l.transformaciones.join("+")}`, frase: l.frase });
  }
  const esp = l.esperado;
  if (!(esp && esp.health === false && esp.emergency === false && esp.crisis === false && esp.co === false)) {
    fallos.push({ ciegaId: l.id, motivo: "el esperado crudo de la fuente no es todo falso", frase: l.frase });
  }
}
if (fallos.length) {
  console.error("RECONSTRUCCIÓN FALLIDA:", JSON.stringify(fallos, null, 1));
  process.exit(1);
}

// --- selección y conversión (D-5, D-6) ---
const seleccionados = [];
for (const b of bloques) {
  const entra = SUBS_ENTERAS.has(b.sub) || (b.sub === "guia" && GUIA_SELECCION.has(`${b.lang}|${b.fraseBase}`));
  if (!entra) continue;
  for (const ln of b.lineas) {
    seleccionados.push({
      texto: ln.frase,
      fraseBase: b.fraseBase,
      ruta: "guarda",
      puerta: "ninguna",
      lang: b.lang,
      tipo: ln.tipo,
      esperado: { health: false, emergency: false, crisis: false, co: false },
      particion: "guarda",
      subcorpus: `ciega-${b.sub}`,
      ciegaId: ln.ciegaId,
    });
  }
}
seleccionados.sort((a, b) => a.ciegaId - b.ciegaId);
const lineas = seleccionados.map((l, i) => ({
  id: "g" + String(i + 1).padStart(4, "0"),
  texto: l.texto,
  fraseBase: l.fraseBase,
  ruta: l.ruta,
  puerta: l.puerta,
  lang: l.lang,
  tipo: l.tipo,
  esperado: l.esperado,
  particion: l.particion,
  subcorpus: l.subcorpus,
  ciegaId: l.ciegaId,
}));

// --- cobro de conteos contra los gobernados (D-3, D-8) ---
const porCubo = {};
const basesPorCubo = {};
for (const c of CUBOS) {
  const filas = lineas.filter((l) => l.subcorpus === c);
  porCubo[c] = filas.length;
  basesPorCubo[c] = new Set(filas.map((l) => `${l.lang}|${l.fraseBase}`)).size;
}
const ESPERADO = { "ciega-guia": 48, "ciega-ficcion": 102, "ciega-modismos": 99, "ciega-prevencion": 99, "ciega-historicos": 99, "ciega-medico": 99 };
const BASES_ESPERADAS = { "ciega-guia": 16, "ciega-ficcion": 36, "ciega-modismos": 33, "ciega-prevencion": 33, "ciega-historicos": 33, "ciega-medico": 33 };
const errores = [];
if (lineas.length !== 546) errores.push(`total ${lineas.length} ≠ 546`);
for (const c of CUBOS) {
  if (porCubo[c] !== ESPERADO[c]) errores.push(`${c}: ${porCubo[c]} líneas ≠ ${ESPERADO[c]}`);
  if (basesPorCubo[c] !== BASES_ESPERADAS[c]) errores.push(`${c}: ${basesPorCubo[c]} bases ≠ ${BASES_ESPERADAS[c]}`);
}
const basesGuiaHalladas = bloques.filter((b) => b.sub === "guia" && GUIA_SELECCION.has(`${b.lang}|${b.fraseBase}`)).length;
if (basesGuiaHalladas !== 16) errores.push(`bases de guía de la lista cerrada halladas: ${basesGuiaHalladas} ≠ 16`);
if (errores.length) {
  console.error("CONTEOS NO GOBERNADOS:", errores.join(" · "));
  process.exit(1);
}

writeFileSync(
  new URL("./corpus/guarda-ampliada.jsonl", import.meta.url),
  lineas.map((l) => JSON.stringify(l)).join("\n") + "\n"
);
console.log(`guarda-ampliada.jsonl: ${lineas.length} líneas · ${Object.values(basesPorCubo).reduce((a, b) => a + b, 0)} bases`);
for (const c of CUBOS) console.log(`  ${c}: ${porCubo[c]} líneas · ${basesPorCubo[c]} bases`);
console.log("reconstrucción verificada: 0 fallos; conteos gobernados exactos");
