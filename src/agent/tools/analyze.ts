/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * analyze.ts — NIDO: intérprete offline de datos tabulares (CSV/TSV).
 *
 * Puro, sin dependencias, testeable. Parsea texto delimitado, infiere
 * tipos por columna, aplica filtros simples y devuelve estadísticas.
 * Todo corre en el teléfono: ningún dato sale del dispositivo.
 */

export interface AnalyzeOptions {
  /** Delimitador. Si se omite, se detecta (, ; tab |). */
  delimiter?: string;
  /** Filtros "columna=valor" / "columna>100", separados por ";" (AND). */
  filter?: string;
  /** Columna por la que ordenar (descendente si empieza con "-"). */
  sortBy?: string;
  /** Limita las filas mostradas (por defecto 5). */
  topN?: number;
}

interface Filter {
  column: string;
  op: "=" | "!=" | ">" | "<" | ">=" | "<=";
  value: string;
}

function detectDelimiter(firstLine: string): string {
  const candidates = [",", ";", "\t", "|"];
  let best = ",";
  let bestCount = 0;
  for (const c of candidates) {
    const n = firstLine.split(c).length - 1;
    if (n > bestCount) {
      bestCount = n;
      best = c;
    }
  }
  return best;
}

/** Parsea una línea respetando comillas dobles. */
function parseLine(line: string, delim: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delim) {
      cells.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  cells.push(cur.trim());
  return cells;
}

export function parseTable(text: string, delimiter?: string): { headers: string[]; rows: string[][] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) throw new Error("El texto no contiene filas.");
  const delim = delimiter ?? detectDelimiter(lines[0]);
  const headers = parseLine(lines[0], delim);
  if (headers.length === 0 || headers.every((h) => h === "")) {
    throw new Error("No se detectaron columnas. ¿Es un CSV válido?");
  }
  const rows = lines.slice(1).map((l) => {
    const cells = parseLine(l, delim);
    while (cells.length < headers.length) cells.push("");
    return cells.slice(0, headers.length);
  });
  return { headers, rows };
}

function parseFilter(raw: string): Filter[] {
  return raw
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const m = s.match(/^(.+?)(>=|<=|!=|=|>|<)(.+)$/);
      if (!m) throw new Error(`Filtro inválido: «${s}». Usa forma columna=valor.`);
      return { column: m[1].trim(), op: m[2] as Filter["op"], value: m[3].trim() };
    });
}

function rowMatches(row: string[], headers: string[], filters: Filter[]): boolean {
  return filters.every((f) => {
    const idx = headers.findIndex((h) => h.toLowerCase() === f.column.toLowerCase());
    if (idx < 0) throw new Error(`La columna «${f.column}» no existe.`);
    const cell = row[idx] ?? "";
    if (f.op === "=") return cell.toLowerCase() === f.value.toLowerCase();
    if (f.op === "!=") return cell.toLowerCase() !== f.value.toLowerCase();
    const a = Number(cell.replace(",", "."));
    const b = Number(f.value.replace(",", "."));
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
    switch (f.op) {
      case ">": return a > b;
      case "<": return a < b;
      case ">=": return a >= b;
      case "<=": return a <= b;
    }
  });
}

function isNumericColumn(values: string[]): boolean {
  const nonEmpty = values.filter((v) => v !== "");
  return nonEmpty.length > 0 && nonEmpty.every((v) => Number.isFinite(Number(v.replace(",", "."))));
}

function fmt(n: number): string {
  return Number(n.toFixed(4)).toLocaleString("es-MX");
}

/**
 * Analiza una tabla y devuelve un informe compacto en español.
 * Pensado para que el modelo lo lea y responda con cifras exactas.
 */
export function analyzeTable(text: string, opts: AnalyzeOptions = {}): string {
  const { headers, rows } = parseTable(text, opts.delimiter);
  const filters = opts.filter ? parseFilter(opts.filter) : [];
  let data = filters.length > 0 ? rows.filter((r) => rowMatches(r, headers, filters)) : rows;

  if (opts.sortBy) {
    const desc = opts.sortBy.startsWith("-");
    const col = desc ? opts.sortBy.slice(1) : opts.sortBy;
    const idx = headers.findIndex((h) => h.toLowerCase() === col.toLowerCase());
    if (idx < 0) throw new Error(`La columna «${col}» no existe.`);
    data = [...data].sort((a, b) => {
      const x = a[idx] ?? "";
      const y = b[idx] ?? "";
      const xn = Number(x.replace(",", "."));
      const yn = Number(y.replace(",", "."));
      const cmp = Number.isFinite(xn) && Number.isFinite(yn) ? xn - yn : x.localeCompare(y);
      return desc ? -cmp : cmp;
    });
  }

  const topN = opts.topN != null && opts.topN > 0 ? Math.min(Math.floor(opts.topN), 20) : 5;
  const out: string[] = [];
  out.push(
    `Tabla: ${data.length} filas × ${headers.length} columnas` +
      (filters.length > 0 ? ` (filtro: ${opts.filter} — de ${rows.length} filas)` : "")
  );
  out.push(`Columnas: ${headers.join(" | ")}`);

  headers.forEach((h, i) => {
    const values = data.map((r) => r[i] ?? "");
    if (isNumericColumn(values)) {
      const nums = values.filter((v) => v !== "").map((v) => Number(v.replace(",", ".")));
      if (nums.length === 0) return;
      const sum = nums.reduce((a, b) => a + b, 0);
      out.push(
        `— ${h} (número): n=${nums.length}, suma=${fmt(sum)}, prom=${fmt(sum / nums.length)}, ` +
          `min=${fmt(Math.min(...nums))}, max=${fmt(Math.max(...nums))}`
      );
    } else {
      const freq = new Map<string, number>();
      for (const v of values) {
        if (v === "") continue;
        freq.set(v, (freq.get(v) ?? 0) + 1);
      }
      const top = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
      out.push(
        `— ${h} (texto): ${freq.size} valores únicos` +
          (top.length > 0 ? `; top: ${top.map(([v, c]) => `«${v}»(${c})`).join(", ")}` : "")
      );
    }
  });

  const shown = data.slice(0, topN);
  if (shown.length > 0) {
    out.push(`Primeras ${shown.length} filas:`);
    for (const r of shown) out.push("  " + r.map((c) => (c === "" ? "·" : c)).join(" | "));
    if (data.length > shown.length) out.push(`…y ${data.length - shown.length} filas más.`);
  }
  return out.join("\n");
}
