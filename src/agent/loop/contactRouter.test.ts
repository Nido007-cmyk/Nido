/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, expect, it } from "vitest";
import {
  extractContactAction,
  looksLikePhone,
  pickExactMatch,
  runContactAction,
  type ContactActionDeps,
  type ContactMatch,
} from "./contactRouter";

describe("extractContactAction — evidencia física (Tab A9+, v0.1.6)", () => {
  it('"Find my cellphone contacts" → buscar (antes caía al chat: "no tengo acceso")', () => {
    expect(extractContactAction("Find my cellphone contacts")).toEqual({ kind: "find", query: null, lang: "en" });
  });
  it('"Busca el contacto Ruben" → buscar Ruben', () => {
    expect(extractContactAction("Busca el contacto Ruben")).toEqual({ kind: "find", query: "Ruben", lang: "es" });
  });
  it('"Call" a secas → llamar, sin destinatario (se pregunta a quién)', () => {
    expect(extractContactAction("Call")).toEqual({ kind: "call", target: null, lang: "en" });
  });
});

describe("extractContactAction — buscar (es / en / pt)", () => {
  it.each([
    ["busca el contacto Ana", "Ana"],
    ["¿Busca a Rubén en mis contactos?", "Rubén"],
    ["muéstrame el contacto de Pedro Pérez", "Pedro Pérez"],
    ["encuentra el contacto Mamá", "Mamá"],
    ["cuál es el teléfono de Laura", "Laura"],
    ["número de teléfono de Carlos", "Carlos"],
    ["busca mis contactos", null],
  ])("es: %p", (text, query) => {
    expect(extractContactAction(text as string)).toEqual({ kind: "find", query, lang: "es" });
  });

  it.each([
    ["find contact Ruben", "Ruben"],
    ["search my contacts for Ana", "Ana"],
    ["look up contact John Smith", "John Smith"],
    ["find Ruben in my contacts", "Ruben"],
    ["what's Ana's number?", "Ana"],
    ["phone number of Mike", "Mike"],
    ["show me my contacts", null],
  ])("en: %p", (text, query) => {
    expect(extractContactAction(text as string)).toEqual({ kind: "find", query, lang: "en" });
  });

  it.each([
    ["procura o contato Ruben", "Ruben"],
    ["mostra meus contatos", null],
    ["qual é o telefone da Ana", "Ana"],
  ])("pt: %p", (text, query) => {
    expect(extractContactAction(text as string)).toEqual({ kind: "find", query, lang: "pt" });
  });
});

describe("extractContactAction — llamar (es / en / pt)", () => {
  it.each([
    ["llama a Ruben", "es", "Ruben"],
    ["Llámale a mi mamá", "es", "mi mamá"],
    ["por favor llama a Ana", "es", "Ana"],
    ["marca al 555 123 4567", "es", "555 123 4567"],
    ["llama", "es", null],
    ["call Ruben", "en", "Ruben"],
    ["please call my mom", "en", "my mom"],
    ["dial +1 555 123 4567", "en", "+1 555 123 4567"],
    ["liga para a Ana", "pt", "Ana"],
    ["ligue pro João", "pt", "João"],
    ["liga", "pt", null],
  ])("%p", (text, lang, target) => {
    expect(extractContactAction(text as string)).toEqual({ kind: "call", target, lang });
  });
});

describe("extractContactAction — SMS (es / en / pt)", () => {
  it("es: destinatario y texto", () => {
    expect(extractContactAction("mándale un sms a Ana que llego tarde")).toEqual({
      kind: "sms",
      target: "Ana",
      message: "llego tarde",
      lang: "es",
    });
  });
  it("es: dos puntos como separador", () => {
    expect(extractContactAction("envía un mensaje de texto a Pedro: ya voy")).toEqual({
      kind: "sms",
      target: "Pedro",
      message: "ya voy",
      lang: "es",
    });
  });
  it("es: sin texto → se pide el texto", () => {
    expect(extractContactAction("mándale un sms a Ana")).toEqual({ kind: "sms", target: "Ana", message: null, lang: "es" });
  });
  it("en: text X that …", () => {
    expect(extractContactAction("text Ana that I'm running late")).toEqual({
      kind: "sms",
      target: "Ana",
      message: "I'm running late",
      lang: "en",
    });
  });
  it("en: send a text to X saying …", () => {
    expect(extractContactAction("send a text to my mom saying hi")).toEqual({
      kind: "sms",
      target: "my mom",
      message: "hi",
      lang: "en",
    });
  });
  it("pt: manda um sms para … dizendo …", () => {
    expect(extractContactAction("manda um sms para a Ana dizendo que chego tarde")).toEqual({
      kind: "sms",
      target: "Ana",
      message: "que chego tarde",
      lang: "pt",
    });
  });
});

describe("extractContactAction — adversarial: NO debe disparar", () => {
  it.each([
    // Mensajería NIDO: tiene su propio flujo cifrado.
    "mándale un mensaje por nido a Ana",
    "envía un sms por NIDO a Pedro",
    // "mensaje" a secas es ambiguo (SMS vs NIDO): sigue el flujo actual.
    "mándale un mensaje a Ana",
    // Preguntas y frases que contienen las palabras pero no son peticiones.
    "¿cómo se llama la capital de Francia?",
    "llama la atención que nadie vino",
    "call me Ishmael",
    "call it a day",
    "call of duty es un juego",
    "text messages are cool",
    "text me the summary",
    "what is the phone number format in Spain?",
    "el número de Avogadro es muy grande",
    "qué es un contacto eléctrico",
    "",
    "   ",
  ])("%p", (text) => {
    expect(extractContactAction(text)).toBeNull();
  });
});

describe("looksLikePhone / pickExactMatch", () => {
  it("reconoce números con separadores y rechaza nombres", () => {
    expect(looksLikePhone("+1 (555) 123-4567")).toBe(true);
    expect(looksLikePhone("555 1234")).toBe(true);
    expect(looksLikePhone("12345")).toBe(false);
    expect(looksLikePhone("Ana 555")).toBe(false);
  });
  it("desempata por nombre exacto sin acentos ni mayúsculas", () => {
    const m: ContactMatch[] = [
      { name: "Rubén", phones: ["1"] },
      { name: "Rubén García", phones: ["2"] },
    ];
    expect(pickExactMatch(m, "ruben")?.phones).toEqual(["1"]);
    expect(pickExactMatch(m, "Rub")).toBeNull();
  });
});

// ------------------------------------------------------------ ejecución

function deps(over: Partial<ContactActionDeps> & { contacts?: ContactMatch[] } = {}) {
  const dispatched: Array<{ name: string; args: Record<string, unknown> }> = [];
  const searched: string[] = [];
  const d: ContactActionDeps = {
    search:
      over.search ??
      (async (q) => {
        searched.push(q);
        const all = over.contacts ?? [];
        const n = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
        return { ok: true, matches: all.filter((c) => n(c.name).includes(n(q))) };
      }),
    dispatch:
      over.dispatch ??
      (async (name, args) => {
        dispatched.push({ name, args });
        return { status: "executed", text: "Abriendo…" };
      }),
    isDisabled: over.isDisabled ?? (() => false),
  };
  return { d, dispatched, searched };
}

describe("runContactAction", () => {
  it("busca y lista coincidencias en el idioma del usuario", async () => {
    const { d } = deps({ contacts: [{ name: "Rubén Díaz", phones: ["+52 55 1234 5678"] }] });
    const out = await runContactAction({ kind: "find", query: "Ruben", lang: "es" }, d);
    expect(out.response).toContain("Encontré esto en tus contactos");
    expect(out.response).toContain("Rubén Díaz — +52 55 1234 5678");
  });

  it("sin nombre pregunta cuál buscar (no vuelca la agenda)", async () => {
    const { d, searched } = deps({ contacts: [{ name: "Ana", phones: ["1"] }] });
    const out = await runContactAction({ kind: "find", query: null, lang: "en" }, d);
    expect(out.response).toBe("Which name should I look for in your contacts?");
    expect(searched).toHaveLength(0);
  });

  it("no encontrado → mensaje honesto", async () => {
    const { d } = deps({ contacts: [] });
    const out = await runContactAction({ kind: "find", query: "Zoe", lang: "pt" }, d);
    expect(out.response).toBe("Não encontrei “Zoe” nos seus contatos.");
  });

  it("permiso denegado → se muestra el motivo en el idioma del usuario, no se inventa", async () => {
    const { d, dispatched } = deps({
      search: async () => ({ ok: false, message: "No diste permiso de contactos.", reason: "denied" }),
    });
    const out = await runContactAction({ kind: "call", target: "Ana", lang: "en" }, d);
    expect(out.response).toContain("You didn't allow access to contacts");
    expect(dispatched).toHaveLength(0);
  });

  it("permiso bloqueado → explica dónde activarlo (pt)", async () => {
    const { d } = deps({ search: async () => ({ ok: false, message: "x", reason: "blocked" }) });
    const out = await runContactAction({ kind: "find", query: "Ana", lang: "pt" }, d);
    expect(out.response).toContain("Configurações do telefone");
  });

  it("error sin motivo estructurado → se informa el error real", async () => {
    const { d } = deps({ search: async () => ({ ok: false, message: "Not implemented" }) });
    const out = await runContactAction({ kind: "find", query: "Ana", lang: "es" }, d);
    expect(out.response).toBe("No pude completar la acción: Not implemented");
  });

  it('"llama a Ruben": busca → un resultado → place_call con SU número por la compuerta', async () => {
    const { d, dispatched } = deps({ contacts: [{ name: "Rubén", phones: ["555 111 2222"] }] });
    const out = await runContactAction({ kind: "call", target: "Ruben", lang: "es" }, d);
    expect(dispatched).toEqual([{ name: "place_call", args: { phone: "555 111 2222" } }]);
    expect(out.response).toBe("Abrí el marcador con 555 111 2222. Pulsa llamar para confirmar.");
  });

  it("número directo: no busca en la agenda", async () => {
    const { d, dispatched, searched } = deps();
    await runContactAction({ kind: "call", target: "+1 555 123 4567", lang: "en" }, d);
    expect(searched).toHaveLength(0);
    expect(dispatched[0]).toEqual({ name: "place_call", args: { phone: "+1 555 123 4567" } });
  });

  it("varios resultados → pregunta cuál, NO llama a nadie", async () => {
    const { d, dispatched } = deps({
      contacts: [
        { name: "Ana López", phones: ["1"] },
        { name: "Ana Ruiz", phones: ["2"] },
      ],
    });
    const out = await runContactAction({ kind: "call", target: "Ana", lang: "es" }, d);
    expect(dispatched).toHaveLength(0);
    expect(out.response).toContain("¿Cuál?");
    expect(out.response).toContain("Ana López");
    expect(out.response).toContain("Ana Ruiz");
  });

  it("contacto sin teléfono → lo dice, no llama", async () => {
    const { d, dispatched } = deps({ contacts: [{ name: "Ana", phones: [] }] });
    const out = await runContactAction({ kind: "call", target: "Ana", lang: "en" }, d);
    expect(dispatched).toHaveLength(0);
    expect(out.response).toBe("Ana doesn't have a phone number saved.");
  });

  it("el usuario cancela la confirmación → no se finge la llamada", async () => {
    const { d } = deps({
      contacts: [{ name: "Ana", phones: ["555 000 1111"] }],
      dispatch: async () => ({ status: "cancelled", text: "cancelada" }),
    });
    const out = await runContactAction({ kind: "call", target: "Ana", lang: "es" }, d);
    expect(out.response).toBe("Entendido, no hice nada.");
  });

  it("el handler devuelve un error sin lanzar → se informa como fallo", async () => {
    const { d } = deps({
      contacts: [{ name: "Ana", phones: ["555 000 1111"] }],
      dispatch: async () => ({ status: "executed", text: "No pude abrir el marcador del teléfono." }),
    });
    const out = await runContactAction({ kind: "call", target: "Ana", lang: "es" }, d);
    expect(out.response).toContain("No pude completar la acción");
  });

  it("herramienta apagada por el usuario → no busca ni despacha", async () => {
    const { d, dispatched, searched } = deps({
      contacts: [{ name: "Ana", phones: ["1"] }],
      isDisabled: (t) => t === "place_call",
    });
    const out = await runContactAction({ kind: "call", target: "Ana", lang: "es" }, d);
    expect(searched).toHaveLength(0);
    expect(dispatched).toHaveLength(0);
    expect(out.response).toContain("está desactivada");
  });

  it("find_contact apagada → no se lee la agenda ni para llamar", async () => {
    const { d, searched } = deps({
      contacts: [{ name: "Ana", phones: ["1"] }],
      isDisabled: (t) => t === "find_contact",
    });
    const out = await runContactAction({ kind: "call", target: "Ana", lang: "en" }, d);
    expect(searched).toHaveLength(0);
    expect(out.response).toContain("“find_contact” tool is turned off");
  });

  it("SMS: despacha send_sms con número y texto exactos", async () => {
    const { d, dispatched } = deps({ contacts: [{ name: "Ana", phones: ["555 000 1111"] }] });
    const out = await runContactAction(
      { kind: "sms", target: "Ana", message: "llego tarde 🙏", lang: "es" },
      d,
    );
    expect(dispatched).toEqual([{ name: "send_sms", args: { phone: "555 000 1111", message: "llego tarde 🙏" } }]);
    expect(out.response).toContain("Tú decides si lo envías");
  });

  it("SMS sin texto → pregunta qué escribir, no despacha", async () => {
    const { d, dispatched } = deps({ contacts: [{ name: "Ana", phones: ["1"] }] });
    const out = await runContactAction({ kind: "sms", target: "Ana", message: null, lang: "es" }, d);
    expect(dispatched).toHaveLength(0);
    expect(out.response).toContain("¿Qué le escribo a Ana?");
  });

  it("una excepción en la búsqueda nunca sale del router", async () => {
    const { d } = deps({
      search: async () => {
        throw new Error("boom");
      },
    });
    const out = await runContactAction({ kind: "find", query: "Ana", lang: "es" }, d);
    expect(out.response).toContain("boom");
  });
});
