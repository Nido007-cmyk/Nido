/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * 0.1.42: el barrido del router como puerta de regresión.
 *
 * El corpus es sintético (plantillas × variantes de escritura), así que el
 * porcentaje no es «lo que acierta con usuarios reales»; sirve para que un
 * cambio en un patrón no rompa en silencio formas que ya funcionaban. Los
 * mínimos están un poco por debajo de lo medido en 0.1.42; la charla debe
 * seguir al 100 %: nunca una acción que nadie pidió.
 */
import { describe, expect, it } from "vitest";
import { memoryFullCoverageHit } from "../agent/loop/memoryQuery";
import {
  AMBIGUOUS_MESSAGE,
  buildCorpus,
  EXPECTED,
  NEAR_MISS,
  PENDING_ROUTES,
  ROUTER_ROUTES,
  routeOf,
  runSweep,
  summarize,
  SWEEP_MEMORY,
  type Family,
} from "./routerSweep.pure";

const MIN_RATE: Record<Family, number> = {
  remember: 0.98,
  selfFact: 0.98,
  reminder: 0.98,
  timer: 0.98,
  note: 0.98,
  memoryQuestion: 0.9,
  calc: 0.98,
  convert: 0.98,
  date: 0.88,
  chat: 1,
  // 0.1.43 (paso 2): mínimos MEDIDOS al crear las familias (tasa real
  // del barrido, redondeada hacia abajo a la centésima; nunca un
  // número deseado). Antes de los arreglos del paso: contact 136/142
  // = 0,9577 y calendar 171/178 = 0,9607; con los tres arreglos
  // (enmienda del dueño), las cinco familias miden 1,0000 y su
  // mínimo es 1.
  contact: 1,
  reminderManage: 1,
  calendar: 1,
  noteDelete: 1,
  weeklyPlan: 1,
};

describe("barrido del router", () => {
  const corpus = buildCorpus();
  const results = runSweep(corpus);

  it("el corpus es grande y determinista", () => {
    expect(corpus.length).toBeGreaterThan(5000);
    const again = buildCorpus();
    expect(again.map((c) => c.text)).toEqual(corpus.map((c) => c.text));
  });

  it("cada familia supera su mínimo", () => {
    for (const s of summarize(results)) {
      const rate = s.ok / s.total;
      expect({ family: s.family, rate: rate >= MIN_RATE[s.family] }).toEqual({ family: s.family, rate: true });
    }
  });

  it("la charla nunca dispara una acción", () => {
    const falseActions = results.filter((r) => r.family === "chat" && !r.ok).map((r) => r.text);
    expect(falseActions).toEqual([]);
  });
});

describe("formas nuevas del barrido (0.1.42)", () => {
  const cases: Array<[string, Family]> = [
    ["oye, recuérdame llamar a mamá mañana a las 5", "reminder"],
    ["pon un recordatorio para mañana a las 9: dentista", "reminder"],
    ["can you remind me to call John tomorrow at 5pm", "reminder"],
    ["¿me puedes recordar mañana a las 8 sacar la basura?", "reminder"],
    ["pon un temporizador de media hora", "timer"],
    ["set a timer for half an hour", "timer"],
    ["cuenta 5 minutos", "timer"],
    ["7 al cuadrado", "calc"],
    ["what is 3 cubed", "calc"],
    ["toma en cuenta que soy vegetariano", "remember"],
    ["just so you know, my sister is called Ana", "remember"],
    ["anota en tu memoria que mi coche es azul", "remember"],
    ["tengo 2 hijos", "remember"],
    ["¿dónde dejé el coche?", "memoryQuestion"],
    ["¿dónde está la clave del wifi?", "memoryQuestion"],
  ];
  it.each(cases)("%s → %s", (text, expected) => {
    expect(EXPECTED[expected]).toContain(routeOf(text));
  });

  it("«anota …» sin «en tu memoria» sigue siendo una nota", () => {
    expect(routeOf("anota comprar leche")).toBe("noteSave");
  });
});

describe("memoryFullCoverageHit", () => {
  it("pregunta cuyos términos están todos en un hecho → sí", () => {
    expect(memoryFullCoverageHit("¿dónde está la clave del wifi?", SWEEP_MEMORY)).toBe(true);
  });
  it("sin signo de pregunta, o sin memoria → no", () => {
    expect(memoryFullCoverageHit("la clave del wifi", SWEEP_MEMORY)).toBe(false);
    expect(memoryFullCoverageHit("¿dónde está la clave del wifi?", { ...SWEEP_MEMORY, facts: [] })).toBe(false);
  });
  it("cobertura parcial → no", () => {
    expect(memoryFullCoverageHit("¿cuál es la capital de Francia?", SWEEP_MEMORY)).toBe(false);
  });
});

/**
 * 0.1.43 (la promesa del hilo de Reddit): el hueco era que 17 rutas del
 * router no las probaba ninguna familia y nadie lo veía. Estos dos
 * tests vigilan el inventario completo: una ruta nueva en el código
 * (un kind nuevo en TOOL_KINDS, una vía nueva en routeOf) obliga a
 * ejercitarla en una familia o a declararla en PENDING_ROUTES.
 */
describe("cobertura de rutas del router (0.1.43)", () => {
  const covered = new Set(Object.values(EXPECTED).flat());

  it("toda ruta del router está en una familia del barrido o en la deuda declarada", () => {
    const accounted = new Set([...covered, ...PENDING_ROUTES]);
    const missing = ROUTER_ROUTES.filter((r) => !accounted.has(r));
    expect(missing).toEqual([]);
  });

  it("ninguna ruta está a la vez cubierta por una familia y pendiente", () => {
    const both = PENDING_ROUTES.filter((r) => covered.has(r));
    expect(both).toEqual([]);
  });
});

describe("casi órdenes de las familias nuevas (0.1.43, paso 2)", () => {
  // Frases que parecen una orden pero no lo son: el 100 % tiene que
  // quedarse en charla. Sin mínimo diluido: una sola que dispare
  // rompe este test. (Al medir, 3 disparaban la búsqueda de
  // contactos; el dueño ordenó arreglarlas en este mismo paso y
  // viven en NEAR_MISS como cualquier otra: ver el bloque de
  // arreglos de abajo.)
  for (const [family, list] of Object.entries(NEAR_MISS)) {
    it(`${family}: ninguna casi orden dispara una acción`, () => {
      const fired = list
        .map(([, text]) => ({ text, route: routeOf(text) }))
        .filter(({ route }) => !["chat", "model", "canned"].includes(route));
      expect(fired).toEqual([]);
    });
  }
});

describe("caso ambiguo: «un mensaje a X» sin canal (0.1.43, paso 2)", () => {
  // Sin decir SMS ni NIDO, las dos salidas son legítimas: contact o
  // nidoSend (que confirma antes de enviar). Otra ruta sería un fallo.
  it.each(AMBIGUOUS_MESSAGE.map(([lang, text]) => [lang, text] as const))("[%s] %s → contact o nidoSend", (_lang, text) => {
    expect(["contact", "nidoSend"]).toContain(routeOf(text));
  });
});

/**
 * Arreglos del paso 2 (enmienda del dueño al encargo: «arregla los
 * tres fallos ahora, dentro de este paso», 2026-10-15). El encargo
 * original reservaba los arreglos del router a la v0.1.44; medidos
 * los fallos, el dueño ordenó adelantarlos y quedan aquí como
 * regresión permanente, con el «antes» medido en cada comentario.
 */
describe("arreglos del paso 2 (0.1.43)", () => {
  it("[contact/pt] «envia uma mensagem de texto para a Ana» → contact", () => {
    // Antes: model. El patrón SMS pt solo admitía «um» antes de
    // sms/torpedo/mensagem de texto; con «uma mensagem» no casaba.
    expect(routeOf("envia uma mensagem de texto para a Ana")).toBe("contact");
  });

  it("[calendar/pt] «cria um evento amanhã» → calendarCreate", () => {
    // Antes: model. El patrón consume «um evento» en el verbo, el
    // resto es solo la fecha y la guarda de título vacío descartaba
    // la acción; ahora el título es el sustantivo genérico. La
    // consulta disfrazada («agenda de hoy») se sigue descartando.
    expect(routeOf("cria um evento amanhã")).toBe("calendarCreate");
  });

  it("las casi órdenes que disparaban la búsqueda de contactos ya no disparan", () => {
    // Antes: contact, con queries «mi casa ya no funciona»,
    // «i lost Juan» y «casa não funciona mais». La forma pelada
    // «teléfono de X» / «X's number» ahora exige que X parezca un
    // nombre (contactRouter, isPlausibleBareName).
    for (const text of ["el teléfono de mi casa ya no funciona", "i lost Juan's number", "o telefone de casa não funciona mais"]) {
      expect(["chat", "model", "canned"]).toContain(routeOf(text));
    }
  });
});
