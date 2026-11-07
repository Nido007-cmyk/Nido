// Auditoría 0.1.79: errores para personas, no `e.message` en crudo.
import { describe, expect, it, vi } from "vitest";

vi.mock("ram-monitor", () => ({
  getDeviceTotalRamBytes: () => 0,
  getMemoryInfo: () => ({ rssBytes: 0, totalPssBytes: 0 }),
}));

import es from "../i18n/locales/es.json";
import { RamBudgetError } from "../inference/ramBudget";
import { errorReason, technicalDetail, userFacingError } from "./userFacingError";

const GB = 1024 * 1024 * 1024;
const t = ((key: string, vars: Record<string, unknown> = {}) => {
  let node: unknown = es;
  for (const part of key.split(".")) node = (node as Record<string, unknown>)?.[part];
  return String(node ?? key).replace(/\{\{(\w+)\}\}/g, (_, k) => String(vars[k]));
}) as never;

describe("errores para personas", () => {
  it("un fallo cualquiera: frase en español y el detalle técnico, sin «Error:» repetido", () => {
    const text = userFacingError(t, new Error("Error: Cannot read property 'x' of undefined"), "es");
    expect(text).toBe("Algo salió mal. Detalle técnico: Cannot read property 'x' of undefined");
  });

  it("sin mensaje: una frase sin detalle vacío", () => {
    expect(userFacingError(t, new Error(""), "es")).toBe("Algo salió mal. Inténtalo de nuevo.");
  });

  it("sin espacio: lo explica y dice qué hacer", () => {
    const text = userFacingError(t, new Error("ENOSPC: no space left on device"), "es");
    expect(text).toContain("No hay suficiente espacio");
    expect(text).not.toContain("ENOSPC");
    expect(errorReason(t, new Error("ENOSPC"), "es")).toContain("Libera espacio");
  });

  it("memoria: el texto legible con las cifras", () => {
    const e = new RamBudgetError("needs roughly 1.0GB", GB, 0.5 * GB, 3 * GB, null, null, null);
    expect(userFacingError(t, e, "es")).toContain("1,0 GB");
    expect(errorReason(t, e, "es")).not.toContain("needs roughly");
  });

  it("detalle: una línea, corto, también con valores que no son Error", () => {
    expect(technicalDetail("a\n  b")).toBe("a b");
    expect(technicalDetail({ message: "x" })).toBe("x");
    expect(technicalDetail(new Error("y".repeat(500))).length).toBe(160);
  });
});
