/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * convert.ts — NIDO: conversión determinista de unidades.
 *
 * Puro y testeable. Sin red, sin tasas de cambio: solo magnitudes físicas
 * con factores exactos. Acepta alias en español e inglés.
 */

export class ConvertError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConvertError";
  }
}

export type UnitCategory = "length" | "weight" | "temperature" | "volume" | "time";

/** Factor a la unidad base de su categoría (o funciones para temperatura). */
interface UnitDef {
  category: UnitCategory;
  toBase: (x: number) => number;
  fromBase: (x: number) => number;
}

const mul = (f: number): Pick<UnitDef, "toBase" | "fromBase"> => ({
  toBase: (x) => x * f,
  fromBase: (x) => x / f,
});

const UNITS: Record<string, UnitDef> = {
  // length — base: metro
  m: { category: "length", ...mul(1) },
  km: { category: "length", ...mul(1000) },
  cm: { category: "length", ...mul(0.01) },
  mm: { category: "length", ...mul(0.001) },
  mi: { category: "length", ...mul(1609.344) },
  ft: { category: "length", ...mul(0.3048) },
  in: { category: "length", ...mul(0.0254) },
  // weight — base: kilogramo
  kg: { category: "weight", ...mul(1) },
  g: { category: "weight", ...mul(0.001) },
  lb: { category: "weight", ...mul(0.45359237) },
  oz: { category: "weight", ...mul(0.028349523125) },
  // volume — base: litro
  l: { category: "volume", ...mul(1) },
  ml: { category: "volume", ...mul(0.001) },
  gal: { category: "volume", ...mul(3.785411784) },
  cup: { category: "volume", ...mul(0.2365882365) },
  // time — base: segundo
  s: { category: "time", ...mul(1) },
  min: { category: "time", ...mul(60) },
  h: { category: "time", ...mul(3600) },
  day: { category: "time", ...mul(86400) },
  // temperature — base: celsius (con desplazamiento, no solo factor)
  c: {
    category: "temperature",
    toBase: (x) => x,
    fromBase: (x) => x,
  },
  f: {
    category: "temperature",
    toBase: (x) => ((x - 32) * 5) / 9,
    fromBase: (x) => (x * 9) / 5 + 32,
  },
  k: {
    category: "temperature",
    toBase: (x) => x - 273.15,
    fromBase: (x) => x + 273.15,
  },
};

const ALIASES: Record<string, string> = {
  // español
  metro: "m", metros: "m",
  kilometro: "km", kilometros: "km", kilómetro: "km", kilómetros: "km",
  centimetro: "cm", centimetros: "cm", centímetro: "cm", centímetros: "cm",
  milimetro: "mm", milimetros: "mm", milímetro: "mm", milímetros: "mm",
  milla: "mi", millas: "mi",
  pie: "ft", pies: "ft",
  pulgada: "in", pulgadas: "in",
  kilogramo: "kg", kilogramos: "kg", kilo: "kg", kilos: "kg",
  gramo: "g", gramos: "g",
  libra: "lb", libras: "lb",
  onza: "oz", onzas: "oz",
  litro: "l", litros: "l",
  mililitro: "ml", mililitros: "ml",
  galon: "gal", galones: "gal", galón: "gal",
  taza: "cup", tazas: "cup",
  segundo: "s", segundos: "s",
  minuto: "min", minutos: "min",
  hora: "h", horas: "h",
  dia: "day", dias: "day", día: "day", días: "day",
  celsius: "c", centigrados: "c", centígrados: "c", grados: "c",
  fahrenheit: "f",
  kelvin: "k",
  // inglés
  meter: "m", meters: "m",
  kilometer: "km", kilometers: "km",
  centimeter: "cm", centimeters: "cm",
  millimeter: "mm", millimeters: "mm",
  mile: "mi", miles: "mi",
  foot: "ft", feet: "ft",
  inch: "in", inches: "in",
  kilogram: "kg", kilograms: "kg",
  gram: "g", grams: "g",
  pound: "lb", pounds: "lb",
  ounce: "oz", ounces: "oz",
  liter: "l", liters: "l", litre: "l", litres: "l",
  milliliter: "ml", milliliters: "ml",
  gallon: "gal", gallons: "gal",
  second: "s", seconds: "s",
  minute: "min", minutes: "min",
  hour: "h", hours: "h",
  degree: "c", degrees: "c",
};

function normalizeUnit(raw: string): string {
  const key = raw.trim().toLowerCase().replace(/°/g, "");
  return ALIASES[key] ?? key;
}

/** Unidades válidas, para mensajes de error y para el esquema de la herramienta. */
export function validUnits(): string[] {
  return Object.keys(UNITS).sort();
}

/**
 * Convierte `value` de `from` a `to`. Lanza ConvertError (español) si las
 * unidades son desconocidas o de categorías distintas.
 */
export function convertUnits(
  value: number,
  from: string,
  to: string
): { value: number; category: UnitCategory; from: string; to: string } {
  if (!Number.isFinite(value)) throw new ConvertError("valor no numérico");
  const fromKey = normalizeUnit(from);
  const toKey = normalizeUnit(to);
  const fromDef = UNITS[fromKey];
  const toDef = UNITS[toKey];
  if (!fromDef) {
    throw new ConvertError(
      `unidad desconocida: «${from}». Válidas: ${validUnits().join(", ")}`
    );
  }
  if (!toDef) {
    throw new ConvertError(
      `unidad desconocida: «${to}». Válidas: ${validUnits().join(", ")}`
    );
  }
  if (fromDef.category !== toDef.category) {
    throw new ConvertError(
      `no se puede convertir ${fromKey} (${fromDef.category}) a ${toKey} (${toDef.category})`
    );
  }
  const base = fromDef.toBase(value);
  return { value: toDef.fromBase(base), category: fromDef.category, from: fromKey, to: toKey };
}
