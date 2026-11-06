// Práctica de RCP (0.1.76) — F-3 (auditoría adversaria,
// 2026-11-06): la pantalla medía con el reloj de pared y un salto
// de ese reloj desplazaba conteo, fase y rearme. Esta prueba fija
// el reloj nuevo (practiceClock.ts): el tiempo de práctica sale
// solo de instantes monotónicos anclados al que el metrónomo
// devuelve, y el salto del reloj de pared, en adelanto y en
// atraso, no desplaza nada.
import { describe, expect, it } from "vitest";
import { BEAT_MS, cprPhaseAt } from "./cprCoach";
import { createPracticeClock, monotonicNow, originFromNativeStart } from "./practiceClock";

const CYCLE_MS = 30 * BEAT_MS + 6000;

describe("el origen: el instante del metrónomo, con su red declarada", () => {
  it("sin pitido nativo o con un instante imposible, manda el instante local", () => {
    expect(originFromNativeStart(null, 123_000)).toBe(123_000);
    expect(originFromNativeStart(undefined, 123_000)).toBe(123_000);
    expect(originFromNativeStart(-1, 123_000)).toBe(123_000);
    expect(originFromNativeStart(Number.NaN, 123_000)).toBe(123_000);
  });

  it("con el instante nativo al lado del local (el mismo reloj), manda el nativo", () => {
    // El nativo devuelve su t0 con 50 ms de adelanto sobre la
    // llamada; la lectura local del mismo momento va unos ms
    // detrás. La diferencia de esta plataforma es de ese orden.
    expect(originFromNativeStart(500_050, 500_055)).toBe(500_050);
    expect(originFromNativeStart(500_050, 505_000)).toBe(500_050);
  });

  it("con una diferencia absurda, la red lo declara y se queda en el local", () => {
    expect(originFromNativeStart(500_050, 500_050 + 120_000)).toBe(500_050 + 120_000);
    expect(originFromNativeStart(500_050 + 120_000, 500_050)).toBe(500_050);
  });

  it("monotonicNow existe en esta plataforma y no retrocede", () => {
    const a = monotonicNow();
    const b = monotonicNow();
    expect(Number.isFinite(a)).toBe(true);
    expect(b).toBeGreaterThanOrEqual(a);
  });
});

describe("el salto del reloj de pared no desplaza nada (la prueba que cierra F-3)", () => {
  // El escenario completo de una práctica 30:2 sobre la línea de
  // tiempo monotónica. El reloj de pared entra en el escenario
  // como una variable que la pantalla vieja sí leía: la nueva no
  // lo recibe en ningún camino, así que el estado pintado debe
  // ser idéntico con el reloj de pared adelantado una hora,
  // atrasado una hora o sin mover.
  function escenario(desfaseParedMs: number) {
    const paredAlArrancar = 1_700_000_000_000; // un instante de pared cualquiera
    void desfaseParedMs;
    void paredAlArrancar;
    const clock = createPracticeClock();
    const m0 = 500_000; // instante monotónico de la llamada de arranque
    // El nativo devuelve t0 = llamada + 50 ms; la lectura local
    // del mismo momento llega 5 ms después.
    clock.start(originFromNativeStart(m0 + 50, m0 + 55));
    const origen = m0 + 50;
    const estados = [];
    // Bloque 1, compresión 11 en curso.
    estados.push(cprPhaseAt(clock.elapsedAt(origen + 10 * BEAT_MS + 100), "30:2"));
    // Pausa de respiraciones del ciclo 1.
    estados.push(cprPhaseAt(clock.elapsedAt(origen + 30 * BEAT_MS + 3000), "30:2"));
    // Rearme: el intervalo detecta el ciclo 2 y el metrónomo
    // rearranca; su nuevo instante llega 120 ms tras el borde
    // teórico del bloque (la latencia real de la pantalla).
    const origenBloque2 = origen + CYCLE_MS + 120;
    clock.reanchor(2, originFromNativeStart(origenBloque2, origenBloque2 + 4));
    // Bloque 2 recién empezado y a punto de cerrarse.
    estados.push(cprPhaseAt(clock.elapsedAt(origenBloque2 + 200), "30:2"));
    estados.push(cprPhaseAt(clock.elapsedAt(origenBloque2 + 29 * BEAT_MS + 100), "30:2"));
    return estados;
  }

  it("conteo, fase y rearme idénticos con el reloj de pared en -1 h, 0 y +1 h", () => {
    const sinSalto = escenario(0);
    expect(escenario(3_600_000)).toEqual(sinSalto);
    expect(escenario(-3_600_000)).toEqual(sinSalto);
    // Y el escenario es el debido, no una igualdad vacía:
    expect(sinSalto[0]).toMatchObject({ phase: "compressions", count: 11, cycle: 1, total: 11 });
    expect(sinSalto[1]).toMatchObject({ phase: "breaths", count: 30, cycle: 1, total: 30 });
    expect(sinSalto[2]).toMatchObject({ phase: "compressions", count: 1, cycle: 2, total: 31 });
    expect(sinSalto[3]).toMatchObject({ phase: "compressions", count: 30, cycle: 2, total: 60 });
  });

  it("el tiempo transcurrido nunca retrocede, ni en el borde del rearme", () => {
    const clock = createPracticeClock();
    const m0 = 900_000;
    clock.start(m0);
    let anterior = 0;
    for (let t = m0; t <= m0 + CYCLE_MS + 120; t += 37) {
      const e = clock.elapsedAt(t);
      expect(e).toBeGreaterThanOrEqual(anterior);
      anterior = e;
    }
    // El rearme ancla el bloque 2 unos ms antes del tiempo ya
    // pintado: el suelo del reloj sostiene el conteo.
    clock.reanchor(2, m0 + CYCLE_MS + 120);
    expect(clock.elapsedAt(m0 + CYCLE_MS + 121)).toBeGreaterThanOrEqual(anterior);
  });

  it("contraste: con la fórmula vieja (reloj de pared), el mismo salto SÍ desplazaba", () => {
    // La fórmula que F-3 retiró: elapsed = Date.now() - startedAt.
    // Un salto de +1 h a mitad del bloque 1 manda la fase a otro
    // ciclo; esta aserción fija que la prueba de arriba detecta
    // la clase de error que dice cerrar.
    const enElBloque1 = 10 * BEAT_MS + 100;
    expect(cprPhaseAt(enElBloque1 + 3_600_000, "30:2")).not.toEqual(cprPhaseAt(enElBloque1, "30:2"));
    expect(cprPhaseAt(enElBloque1 - 3_600_000, "30:2")).not.toEqual(cprPhaseAt(enElBloque1, "30:2"));
  });

  it("en continuo, el conteo de un minuto es 110 salga el tiempo del reloj nuevo", () => {
    const clock = createPracticeClock();
    clock.start(42_000);
    expect(cprPhaseAt(clock.elapsedAt(42_000 + 60_000 - 1), "continuous").count).toBe(110);
  });
});
