// «Reportar esta respuesta»: el borrador lleva pregunta, respuesta y
// versión; nada sale sin que el usuario lo envíe (solo se construye un
// enlace mailto a la dirección pública del README).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildAnswerReportMailto, langOf, REPORT_ADDRESS, REPORT_FIELD_MAX } from "./reportAnswer";

const parse = (url: string) => {
  const [head, query] = url.split("?");
  const p = new URLSearchParams(query.replace(/\+/g, "%2B"));
  return { to: head.replace("mailto:", ""), subject: p.get("subject") ?? "", body: p.get("body") ?? "" };
};

describe("reportAnswer", () => {
  it("es/en/pt: pregunta, respuesta, versión y aviso de revisar", () => {
    for (const [lang, word] of [["es", "Revisa"], ["en", "Review"], ["pt", "Revise"]] as const) {
      const m = parse(buildAnswerReportMailto({ question: "¿qué hago si me quemo?", answer: "Enfría con agua 20 minutos.", lang, version: "0.1.75" }));
      expect(m.to).toBe(REPORT_ADDRESS);
      expect(m.subject).toContain("NIDO");
      expect(m.body.startsWith(word)).toBe(true);
      expect(m.body).toContain("¿qué hago si me quemo?");
      expect(m.body).toContain("Enfría con agua 20 minutos.");
      expect(m.body).toContain("0.1.75");
    }
  });
  it("respuestas largas se recortan; signos raros no rompen el enlace", () => {
    const long = "a&b=c?d#e+".repeat(500);
    const url = buildAnswerReportMailto({ question: undefined, answer: long, lang: "en", version: "x" });
    expect(url).not.toMatch(/[#\s]/);
    const m = parse(url);
    expect(m.body).toContain("—");
    expect(m.body).toContain(`${long.slice(0, REPORT_FIELD_MAX)}…`);
    expect(m.body).not.toContain(long);
  });
  it("lengua desconocida → inglés", () => {
    expect(langOf("fr-FR")).toBe("en");
    expect(langOf("pt-BR")).toBe("pt");
  });
  it("la dirección es la del README", () => {
    expect(readFileSync("README.md", "utf8")).toContain(REPORT_ADDRESS);
  });
});
