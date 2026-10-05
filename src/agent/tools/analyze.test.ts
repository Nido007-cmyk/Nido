import { describe, it, expect } from "vitest";
import { parseTable, analyzeTable } from "./analyze";

const CSV = `fecha,producto,unidades,importe
2026-01-05,pan,10,100
2026-01-06,leche,6,120
2026-01-07,pan,8,80
2026-02-01,huevos,12,180`;

describe("parseTable", () => {
  it("parsea CSV con cabecera", () => {
    const { headers, rows } = parseTable(CSV);
    expect(headers).toEqual(["fecha", "producto", "unidades", "importe"]);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toEqual(["2026-01-05", "pan", "10", "100"]);
  });

  it("detecta punto y coma y tabuladores", () => {
    const { headers } = parseTable("a;b;c\n1;2;3");
    expect(headers).toEqual(["a", "b", "c"]);
  });

  it("respeta comillas con delimitador dentro", () => {
    const { rows } = parseTable('nombre,nota\n"a, b",hola');
    expect(rows[0][0]).toBe("a, b");
  });

  it("rechaza texto vacío", () => {
    expect(() => parseTable("   \n  ")).toThrow();
  });
});

describe("analyzeTable", () => {
  it("calcula estadísticas numéricas y de texto", () => {
    const report = analyzeTable(CSV);
    expect(report).toContain("4 filas × 4 columnas");
    expect(report).toContain("unidades (número)");
    expect(report).toContain("suma=36");
    expect(report).toContain("producto (texto)");
    expect(report).toContain("«pan»(2)");
  });

  it("aplica filtros de igualdad y numéricos", () => {
    const r1 = analyzeTable(CSV, { filter: "producto=pan" });
    expect(r1).toContain("2 filas");
    const r2 = analyzeTable(CSV, { filter: "importe>100" });
    expect(r2).toContain("2 filas");
  });

  it("combina filtros con AND y ordena", () => {
    const r = analyzeTable(CSV, { filter: "producto=pan;unidades>=8", sortBy: "-unidades" });
    expect(r).toContain("2 filas");
    const idx10 = r.indexOf("2026-01-05");
    const idx8 = r.indexOf("2026-01-07");
    expect(idx10).toBeLessThan(idx8);
  });

  it("rechaza filtro malformado y columna inexistente", () => {
    expect(() => analyzeTable(CSV, { filter: "sinoperador" })).toThrow("Filtro inválido");
    expect(() => analyzeTable(CSV, { filter: "noexiste=1" })).toThrow("no existe");
  });

  it("no ejecuta código: el texto es solo datos", () => {
    const evil = "a,b\n1,2\"); console.log('x'); //";
    const r = analyzeTable(evil);
    expect(r).toContain("2 columnas");
  });
});
