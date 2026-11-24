/**
 * eval-gates.mjs · Fase 0 del plan de ingeniería de NIDO.
 *
 * Ejecuta el corpus de puertas (corpus.jsonl + guarda.jsonl de este
 * directorio) contra las funciones puras REALES de un árbol del repo y
 * produce las tasas de la casa sin intervención manual:
 *   - recall por puerta primaria × idioma (la puerta que manda en cada ruta)
 *   - recall por puerta × idioma × tipo de variante
 *   - sensibilidad por tipo de variante (base, sinAcentos, errata, …)
 *   - por cada puerta binaria (health/emergency/crisis/co): TP/FP/FN/TN,
 *     recall y precisión, global y por idioma
 *   - falsos positivos sobre el corpus de guarda
 *   - matriz de confusión primaria (puerta esperada × puerta que respondió)
 *
 * Uso (con el tsx del árbol, igual que variantes/correr.mjs de la casa):
 *   npx tsx eval-gates.mjs <raizArbol> [--out salida.json] [--corpus <dir>]
 *
 * Definiciones (las del censo de la casa, para que las cifras sean las
 * mismas y no otras):
 *   obtenido.health    = isHealthQuestion(frase)
 *   obtenido.emergency = isEmergencySituation(frase)
 *   obtenido.crisis    = isSelfHarmMessage(frase) || crisisQuestionKind(frase)
 *   obtenido.co        = matchSafetyAnswer(frase, lang).kind empieza por "co"
 *   primaria por ruta (analizar.mjs de la casa):
 *     salud -> health · emergencia -> emergency · crisis -> crisis
 *     caida -> emergency · caida-narrada -> NO emergency · monoxido -> co
 *     guia -> ninguna puerta · negativos -> NO crisis
 *     negativos-historicos -> NO emergency y NO crisis
 * La «puerta que respondió» de la matriz de confusión usa la prioridad
 * crisis > monoxido > emergencia > salud > ninguna SOLO como convención
 * de lectura de la matriz; las tasas nunca dependen de esa prioridad.
 * El script no escribe nada en el árbol medido: solo lo lee.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const root = args.find((a) => !a.startsWith("--"));
if (!root) {
  console.error("uso: npx tsx eval-gates.mjs <raizArbol> [--out salida.json] [--corpus <dir>]");
  process.exit(2);
}
const outPath = args.includes("--out") ? args[args.indexOf("--out") + 1] : null;
const corpusDir = args.includes("--corpus")
  ? resolve(args[args.indexOf("--corpus") + 1])
  : new URL(".", import.meta.url).pathname;

const leerJsonl = (nombre) =>
  readFileSync(resolve(corpusDir, nombre), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const corpus = leerJsonl("corpus.jsonl");
const guarda = leerJsonl("guarda.jsonl");
const idsGuarda = new Set(guarda.map((l) => l.id));
const subcorpusDe = new Map(guarda.map((l) => [l.id, l.subcorpus]));
// Segunda fuente de guarda (DIRIMEN-FORMATO-GUARDA, D-1): si el corpus
// trae guarda-ampliada.jsonl, se lee y se mide en su propia sección de
// la salida (guardaAmpliada). Si no existe, este script se comporta
// exactamente como la F0 lo verificó: misma salida byte a byte.
const guardaAmpliada = existsSync(resolve(corpusDir, "guarda-ampliada.jsonl"))
  ? leerJsonl("guarda-ampliada.jsonl")
  : null;

const eg = await import(pathToFileURL(`${root}/src/routing/emergencyGate.ts`).href);
const sa = await import(pathToFileURL(`${root}/src/agent/loop/safetyAnswers.ts`).href);
const pf = await import(pathToFileURL(`${root}/src/rag/packFacts.ts`).href);

const PUERTAS = ["health", "emergency", "crisis", "co"];
const primaria = {
  salud: (o) => o.health === true,
  emergencia: (o) => o.emergency === true,
  crisis: (o) => o.crisis === true,
  caida: (o) => o.emergency === true,
  "caida-narrada": (o) => o.emergency === false,
  monoxido: (o) => o.co === true,
  guia: (o) => !o.health && !o.emergency && !o.crisis && !o.co,
  negativos: (o) => o.crisis === false,
  "negativos-historicos": (o) => o.emergency === false && o.crisis === false,
};
const respondida = (o) =>
  o.crisis ? "crisis" : o.co ? "monoxido" : o.emergency ? "emergencia" : o.health ? "salud" : "ninguna";
const tasa = (ok, total) => (total ? Math.round((1000 * ok) / total) / 10 : null);

// --- ejecución ---
const R = [];
for (const e of corpus) {
  const hit = sa.matchSafetyAnswer(e.texto, e.lang);
  const obtenido = {
    health: eg.isHealthQuestion(e.texto),
    emergency: eg.isEmergencySituation(e.texto),
    crisis: sa.isSelfHarmMessage(e.texto) || pf.crisisQuestionKind(e.texto),
    co: !!(hit && typeof hit.kind === "string" && hit.kind.startsWith("co")),
  };
  R.push({ ...e, obtenido, okPrimaria: primaria[e.ruta](obtenido) });
}

// --- agregados ---
const agrega = (filas, clave) => {
  const a = {};
  for (const r of filas) {
    const k = clave(r);
    a[k] = a[k] || { ok: 0, total: 0 };
    a[k].total++; if (r.okPrimaria) a[k].ok++;
  }
  for (const v of Object.values(a)) v.tasa = tasa(v.ok, v.total);
  return a;
};
const primariaPorRutaIdioma = agrega(R, (r) => `${r.ruta}/${r.lang}`);
const sensibilidadPorTipo = agrega(R, (r) => r.tipo);
const recallPorPuertaIdiomaTipo = agrega(R, (r) => `${r.ruta}/${r.lang}/${r.tipo}`);
const totalOk = R.filter((r) => r.okPrimaria).length;

const binaria = (filas) => {
  const out = {};
  for (const g of PUERTAS) {
    let tp = 0, fp = 0, fn = 0, tn = 0;
    for (const r of filas) {
      const esp = r.esperado[g], obt = r.obtenido[g];
      if (esp && obt) tp++; else if (!esp && obt) fp++; else if (esp && !obt) fn++; else tn++;
    }
    out[g] = { tp, fp, fn, tn, recall: tasa(tp, tp + fn), precision: tasa(tp, tp + fp) };
  }
  return out;
};
const puertasBinarias = { global: binaria(R) };
for (const lang of ["es", "en", "pt"]) puertasBinarias[lang] = binaria(R.filter((r) => r.lang === lang));

// --- matriz de confusión primaria ---
const matriz = {};
for (const r of R) {
  const esp = r.puerta, resp = respondida(r.obtenido);
  matriz[esp] = matriz[esp] || {};
  matriz[esp][resp] = (matriz[esp][resp] || 0) + 1;
}
const crisisRuta = R.filter((r) => r.puerta === "crisis");
const confusionNombrada = {
  crisisEsperadaRespondidaComoSalud: crisisRuta.filter((r) => !r.obtenido.crisis && r.obtenido.health).length,
  crisisEsperadaSinNingunaPuerta: crisisRuta.filter(
    (r) => !r.obtenido.crisis && !r.obtenido.health && !r.obtenido.emergency && !r.obtenido.co
  ).length,
};

// --- guarda: falsos positivos ---
const G = R.filter((r) => idsGuarda.has(r.id));
const guardaRes = {
  total: G.length,
  conAlgunaPuerta: G.filter((r) => r.obtenido.health || r.obtenido.emergency || r.obtenido.crisis || r.obtenido.co).length,
  porPuerta: Object.fromEntries(PUERTAS.map((g) => [g, G.filter((r) => r.obtenido[g]).length])),
  porSubcorpus: {},
  idsConAlgunaPuerta: G.filter((r) => r.obtenido.health || r.obtenido.emergency || r.obtenido.crisis || r.obtenido.co).map((r) => r.id),
};
for (const sub of ["guia", "negativos", "historicos"]) {
  const filas = G.filter((r) => subcorpusDe.get(r.id) === sub);
  guardaRes.porSubcorpus[sub] = {
    total: filas.length,
    conAlgunaPuerta: filas.filter((r) => r.obtenido.health || r.obtenido.emergency || r.obtenido.crisis || r.obtenido.co).length,
    porPuerta: Object.fromEntries(PUERTAS.map((g) => [g, filas.filter((r) => r.obtenido[g]).length])),
  };
}

// --- guarda ampliada: conteos por puerta y cubo ---
// Sus líneas nunca entran en R: ni primaria, ni binarias, ni matriz,
// ni sensibilidad, ni totales. Se evalúan con las mismas cuatro
// expresiones de `obtenido` del corpus y se agregan por cubo, que es
// el instrumento con el que la F0 mide su propia guarda.
let guardaAmpliadaRes = null;
if (guardaAmpliada) {
  const filasAmp = guardaAmpliada.map((e) => {
    const hit = sa.matchSafetyAnswer(e.texto, e.lang);
    return {
      ...e,
      obtenido: {
        health: eg.isHealthQuestion(e.texto),
        emergency: eg.isEmergencySituation(e.texto),
        crisis: sa.isSelfHarmMessage(e.texto) || pf.crisisQuestionKind(e.texto),
        co: !!(hit && typeof hit.kind === "string" && hit.kind.startsWith("co")),
      },
    };
  });
  const porSubcorpusAmp = {};
  for (const sub of ["ciega-guia", "ciega-ficcion", "ciega-modismos", "ciega-prevencion", "ciega-historicos", "ciega-medico"]) {
    const filas = filasAmp.filter((r) => r.subcorpus === sub);
    porSubcorpusAmp[sub] = {
      total: filas.length,
      conAlgunaPuerta: filas.filter((r) => r.obtenido.health || r.obtenido.emergency || r.obtenido.crisis || r.obtenido.co).length,
      porPuerta: Object.fromEntries(PUERTAS.map((g) => [g, filas.filter((r) => r.obtenido[g]).length])),
    };
  }
  guardaAmpliadaRes = {
    total: filasAmp.length,
    porSubcorpus: porSubcorpusAmp,
    idsConPuertaFuerte: filasAmp
      .filter((r) => r.obtenido.crisis || r.obtenido.emergency || r.obtenido.co)
      .map((r) => r.id),
  };
}

// --- fallos de primaria por ruta/idioma (ids, para ir a la frase) ---
const fallosPrimaria = {};
for (const r of R) {
  if (r.okPrimaria) continue;
  const k = `${r.ruta}/${r.lang}`;
  fallosPrimaria[k] = fallosPrimaria[k] || [];
  fallosPrimaria[k].push(r.id);
}

const salida = {
  arbol: root,
  corpus: { lineas: corpus.length, guarda: guarda.length },
  totalPrimaria: { ok: totalOk, total: R.length, tasa: tasa(totalOk, R.length) },
  primariaPorRutaIdioma,
  sensibilidadPorTipo,
  recallPorPuertaIdiomaTipo,
  puertasBinarias,
  matrizConfusion: matriz,
  confusionNombrada,
  guarda: guardaRes,
  ...(guardaAmpliadaRes ? { guardaAmpliada: guardaAmpliadaRes } : {}),
  fallosPrimaria,
};

// --- tabla legible ---
const pct = (v) => (v.tasa === null ? "  n/a" : `${v.ok}/${v.total} · ${v.tasa.toFixed(1)} %`);
console.log(`== TASAS POR PUERTA PRIMARIA · árbol: ${root} ==`);
for (const [k, v] of Object.entries(primariaPorRutaIdioma).sort()) console.log(k.padEnd(26), pct(v));
console.log("TOTAL primaria".padEnd(26), pct(salida.totalPrimaria));
console.log("\n== SENSIBILIDAD POR TIPO DE VARIANTE (puerta primaria) ==");
for (const [k, v] of Object.entries(sensibilidadPorTipo).sort()) console.log(k.padEnd(22), pct(v));
console.log("\n== GUARDA (falsos positivos sobre el corpus negativo) ==");
console.log(`líneas de guarda: ${guardaRes.total} · con alguna puerta declarando: ${guardaRes.conAlgunaPuerta}`);
for (const [sub, v] of Object.entries(guardaRes.porSubcorpus))
  console.log(`  ${sub}: ${v.conAlgunaPuerta}/${v.total} con alguna puerta · por puerta ${JSON.stringify(v.porPuerta)}`);
if (guardaAmpliadaRes) {
  console.log("\n== GUARDA AMPLIADA (segunda fuente: la ciega gastada del F3) ==");
  console.log(`líneas de guarda ampliada: ${guardaAmpliadaRes.total} · ids con puerta fuerte (crisis/emergencia/co): ${guardaAmpliadaRes.idsConPuertaFuerte.length}`);
  for (const [sub, v] of Object.entries(guardaAmpliadaRes.porSubcorpus))
    console.log(`  ${sub}: ${v.conAlgunaPuerta}/${v.total} con alguna puerta · por puerta ${JSON.stringify(v.porPuerta)}`);
}
console.log("\n== CONFUSIÓN NOMBRADA ==");
console.log(`crisis esperada respondida como salud: ${confusionNombrada.crisisEsperadaRespondidaComoSalud}`);
console.log(`crisis esperada sin ninguna puerta:    ${confusionNombrada.crisisEsperadaSinNingunaPuerta}`);

if (outPath) {
  writeFileSync(resolve(outPath), JSON.stringify(salida, null, 1) + "\n");
  console.log(`\nJSON escrito en ${outPath}`);
} else {
  console.log("\n== JSON ==");
  console.log(JSON.stringify(salida, null, 1));
}
