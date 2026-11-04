/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Arreglos «todo es todo» (2026-11-03): la búsqueda de hechos es por
 * palabras, y un dato guardado en otra lengua no aparecía («vivo en
 * Tucson» ante «where do I live?»). Equivalencias es/en/pt de las
 * palabras con que la gente guarda y pregunta sus datos, plegadas (sin
 * acentos). Un grupo por concepto; una palabra cuenta como cualquiera de
 * su grupo.
 */
const MEMORY_EQUIV_GROUPS: readonly string[][] = [
  ["live", "lives", "vivo", "vive", "vivimos", "moro", "mora", "moramos", "resido"],
  ["allergic", "allergy", "allergies", "alergico", "alergica", "alergia", "alergias"],
  ["car", "coche", "carro", "auto"],
  ["birthday", "cumpleanos", "aniversario"],
  ["password", "contrasena", "senha", "clave"],
  ["address", "direccion", "endereco"],
  ["work", "works", "job", "trabajo", "trabajas", "trabalho", "emprego", "empleo"],
  ["phone", "telefono", "telefone", "celular", "movil"],
  ["blood", "sangre", "sangue"],
  ["favorite", "favourite", "favorito", "favorita"],
  ["color", "colour", "cor"],
  ["food", "comida"],
  ["doctor", "medico", "medica"],
  ["medicine", "medication", "medicamento", "medicina", "remedio", "pastilla", "pastillas"],
  ["dog", "perro", "perra", "cachorro", "cao"],
  ["cat", "gato", "gata"],
  ["wife", "esposa", "mujer", "mulher"],
  ["husband", "esposo", "marido"],
  ["school", "escuela", "colegio", "escola"],
  ["bank", "banco"],
  ["insurance", "seguro"],
  ["plate", "placa", "matricula"],
  ["height", "altura", "mido"],
  ["weight", "peso"],
  ["team", "equipo"],
  ["city", "ciudad", "cidade"],
  ["country", "pais"],
];
const MEMORY_EQUIV = new Map<string, string[]>();
for (const g of MEMORY_EQUIV_GROUPS) for (const w of g) MEMORY_EQUIV.set(w, g.filter((x) => x !== w));
export function equivalentsOf(token: string): string[] {
  return MEMORY_EQUIV.get(token) ?? [];
}


/**
 * ¿Aparece `w` como palabra entera del texto (ya normalizado), o en
 * plural (+s / +es)? Así «car» encuentra «car» y «cars» pero no
 * «carne», y «ana» no encuentra «mañana» (antes se buscaba como
 * subcadena).
 */
export function hasWord(text: string, w: string): boolean {
  if (!w) return false;
  const esc = w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${esc}(?:e?s)?(?![\\p{L}\\p{N}])`, "u").test(text);
}

/** La palabra o una de sus equivalentes en las otras dos lenguas, como palabra entera. */
export function mentionsTerm(text: string, w: string): boolean {
  return hasWord(text, w) || equivalentsOf(w).some((v) => hasWord(text, v));
}
