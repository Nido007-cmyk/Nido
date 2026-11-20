/**
 * CURA-VIA-RAPIDA en el móvil (paquete de arreglos, §1; dirimen
 * de la casa 2026-11-19, portado de la batería de PC): la vía
 * determinista de recordatorios reclamaba turnos de enumeración
 * multiaacción — el extractor busca el verbo de aviso en
 * cualquier sitio del texto y la guardia de lead (`isOrderLead`)
 * aceptaba cualquier preámbulo que CONTUVIERA una fecha
 * parseable, así que la enumeración entera pasaba por «una fecha
 * delante del verbo» y el turno se servía con solo el
 * recordatorio, perdiendo las demás subtareas en silencio.
 *
 * La cura pasa la rama de fecha de la guardia de contención a
 * identidad: retirado lo que el parser cobra como fecha y las
 * palabras de cortesía/enlace, el preámbulo ha de quedar vacío.
 * Esta batería fija las dos caras: los textos verbatim de S7 y
 * S12 y las variantes de la clase devuelven null, y los leads
 * legítimos firmados (fecha sola delante, en sus formas
 * es/en/pt; cortesía con fecha) siguen creando.
 */

import { describe, it, expect } from "vitest";
import { extractReminderAction, isOrderLead } from "./actionRouter.js";

// Los dos textos íntegros del arnés de PC (scripts/bucleEscenarios.ts,
// §4 del ARNÉS): no se recortan ni se parafrasean.
const S7_TEXT =
  "Organiza una cena con mi pareja este viernes: mira cuándo estoy libre, avísale por un mensaje, busca restaurantes cerca de casa, créame el evento en el calendario y ponme un recordatorio para el evento.";
const S12_TEXT =
  "Haz todo esto, en orden: (1) consulta mi disponibilidad de mañana, (2) manda un mensaje a Ana avisando de la cena, (3) manda un mensaje a Luis avisando de la cena, (4) busca un restaurante cerca de casa y (5) créame un recordatorio para comprar pan.";

describe("CURA-VIA-RAPIDA: la enumeración multiaacción no se reclama", () => {
  it("S7 verbatim → null (el recordatorio es el nodo n5 de cinco)", () => {
    expect(extractReminderAction(S7_TEXT)).toBeNull();
  });

  it("S12 verbatim → null (el recordatorio es la subtarea 5 de cinco)", () => {
    expect(extractReminderAction(S12_TEXT)).toBeNull();
  });

  it("recordatorio en nodo intermedio, con la fecha de otra subtarea en el preámbulo → null", () => {
    expect(
      extractReminderAction(
        "Organiza la cena de este viernes, ponme un recordatorio para el evento y avisa a mi pareja",
      ),
    ).toBeNull();
  });

  it("preámbulo con fecha y otros verbos → null", () => {
    expect(
      extractReminderAction(
        "Mañana compro los boletos y reviso el correo, recuérdame llevar el pasaporte",
      ),
    ).toBeNull();
  });

  it("preámbulo de cortesía con material de otra orden → null", () => {
    expect(
      extractReminderAction(
        "Oye, mañana es el cumpleaños de Ana y hay que felicitarla, recuérdame comprar el regalo",
      ),
    ).toBeNull();
  });

  it("la misma clase en inglés → null", () => {
    expect(
      extractReminderAction(
        "Check my calendar for tomorrow, send a message to Ana, and remind me to buy the tickets",
      ),
    ).toBeNull();
  });

  it("la misma clase en portugués → null", () => {
    expect(
      extractReminderAction(
        "Vê a minha agenda de amanhã, manda uma mensagem à Ana e me lembra de comprar pão",
      ),
    ).toBeNull();
  });
});

describe("CURA-VIA-RAPIDA: los leads legítimos firmados no se mueven", () => {
  it("«mañana recuérdame comprar pan» sigue creando", () => {
    expect(extractReminderAction("mañana recuérdame comprar pan")).not.toBeNull();
  });

  it("«en media hora recuérdame la junta» sigue creando", () => {
    expect(extractReminderAction("en media hora recuérdame la junta")).not.toBeNull();
  });

  it("«el viernes a las 6 me recuerdas llamar a mi tía» (0.1.41) sigue creando", () => {
    expect(
      extractReminderAction("el viernes a las 6 me recuerdas llamar a mi tía"),
    ).not.toBeNull();
  });

  it("«este viernes recuérdame comprar pan» (fecha sola con demostrativo) sigue creando", () => {
    expect(extractReminderAction("este viernes recuérdame comprar pan")).not.toBeNull();
  });

  it("«oye, mañana recuérdame comprar pan» (cortesía con fecha) sigue creando", () => {
    expect(extractReminderAction("oye, mañana recuérdame comprar pan")).not.toBeNull();
  });

  it("«tomorrow remind me to buy milk» sigue creando", () => {
    expect(extractReminderAction("tomorrow remind me to buy milk")).not.toBeNull();
  });

  it("«amanhã às 7 me lembra de comprar pão» sigue creando", () => {
    expect(extractReminderAction("amanhã às 7 me lembra de comprar pão")).not.toBeNull();
  });
});

describe("CURA-VIA-RAPIDA: isOrderLead, de contención a identidad", () => {
  it("acepta nada, la cortesía sola y la fecha sola en sus formas", () => {
    expect(isOrderLead("")).toBe(true);
    expect(isOrderLead("oye,")).toBe(true);
    expect(isOrderLead("mañana")).toBe(true);
    expect(isOrderLead("en media hora")).toBe(true);
    expect(isOrderLead("el viernes a las 6")).toBe(true);
    expect(isOrderLead("este viernes")).toBe(true);
    expect(isOrderLead("el 15 de marzo")).toBe(true);
  });

  it("rechaza el preámbulo que contiene una fecha y material de otras órdenes", () => {
    expect(isOrderLead("Organiza una cena con mi pareja este viernes:")).toBe(false);
    expect(isOrderLead("Mañana compro los boletos y reviso el correo,")).toBe(false);
    expect(isOrderLead("consulta mi disponibilidad de mañana,")).toBe(false);
    expect(isOrderLead("traduce al inglés:")).toBe(false);
  });
});
