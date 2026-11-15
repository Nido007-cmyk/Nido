/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * T-11 (0.1.99) · m-13 — la cerca de pegado dejaba pasar la inyección
 * troceada. La cerca de `applyEdit` solo marcaba «pasted» una inserción
 * ÚNICA de ≥24 caracteres CON espacios. Dos vías la saltaban enteras:
 *
 * (a) un token largo sin espacios (URL, base64, hash) de cualquier
 *     longitud entraba como «typed» y llegaba al enrutador
 *     determinista como si lo hubiera tecleado el dueño;
 * (b) pegar en trozos (o teclear con pegado rápido por software) en
 *     inserciones pequeñas dejaba el texto entero como «typed».
 *
 * Cura: (a) una inserción única sin espacios de ≥48 caracteres es
 * pegado por construcción (teclear a mano nunca produce una inserción
 * en bloque así); (b) un rastreador de ráfaga con estado: inserciones
 * puras sin fuente explícita de ≥4 caracteres, con huecos ≤1.500 ms
 * entre ellas, que sumen ≥48 caracteres en ≥3 inserciones se cercan
 * retroactivamente, y la ráfaga abierta sigue cercada mientras siga
 * llegando texto pegado a su cola dentro de la ventana.
 *
 * Falso positivo declarado: cercar por error solo degrada el enrutado;
 * el chat sigue procesando el texto como citado. Las sondas fieles de
 * abajo (tecleo rápido de 1 carácter, palabras predictivas) fijan que
 * el uso humano normal NO se cerca.
 */
import { describe, it, expect } from "vitest";
import {
  applyEdit,
  createBurstState,
  joinSegments,
  routableText,
  type Segment,
} from "./provenance";

const ORDER =
  "Recuérdame mañana a las nueve que llame a Juan al 5551234 y dile que el código es 4815";

describe("m-13(a): token largo sin espacios = pegado", () => {
  it("un token de 300 caracteres sin espacios se cerca entero", () => {
    const token = "a".repeat(300);
    const segs = applyEdit([], "", token);
    expect(joinSegments(segs)).toBe(token);
    expect(segs).toEqual([{ text: token, source: "pasted" }]);
    expect(routableText(segs)).toBe("");
  });

  it("el umbral es 48: 47 caracteres sin espacios quedan como tecleados, 48 se cercan", () => {
    const s47 = applyEdit([], "", "b".repeat(47));
    expect(routableText(s47)).toBe("b".repeat(47));
    const s48 = applyEdit([], "", "c".repeat(48));
    expect(routableText(s48)).toBe("");
  });

  it("control: una inserción corta sin espacios sigue siendo tecleo", () => {
    const segs = applyEdit([], "", "hola");
    expect(segs).toEqual([{ text: "hola", source: "typed" }]);
  });

  it("control: el pegado clásico (≥24 con espacios) sigue cercado", () => {
    const segs = applyEdit([], "", ORDER);
    expect(routableText(segs)).toBe("");
  });
});

describe("m-13(b): pegado en trozos = cercado por ráfaga", () => {
  function typeChunks(chunks: string[], gaps: number[]): Segment[] {
    const burst = createBurstState();
    let segs: Segment[] = [];
    let text = "";
    let now = 0;
    chunks.forEach((chunk, i) => {
      now += i === 0 ? 0 : gaps[i - 1];
      const next = text + chunk;
      segs = applyEdit(segs, text, next, undefined, burst, now);
      text = next;
    });
    return segs;
  }

  it("cinco trozos de 20 caracteres con huecos de 200 ms: TODO cercado", () => {
    const chunks: string[] = [];
    for (let i = 0; i < ORDER.length; i += 20) chunks.push(ORDER.slice(i, i + 20));
    expect(chunks.length).toBeGreaterThanOrEqual(5);
    const segs = typeChunks(chunks, chunks.map(() => 200));
    expect(joinSegments(segs)).toBe(ORDER);
    expect(routableText(segs)).toBe("");
  });

  it("fiel: tecleo rápido de 1 carácter (60 teclas, huecos de 120 ms) NO se cerca", () => {
    const burst = createBurstState();
    let segs: Segment[] = [];
    let text = "";
    let now = 0;
    for (const ch of ORDER.slice(0, 60)) {
      now += 120;
      const next = text + ch;
      segs = applyEdit(segs, text, next, undefined, burst, now);
      text = next;
    }
    // routableText recorta los extremos: se compara contra el texto recortado.
    expect(routableText(segs)).toBe(text.trim());
  });

  it("fiel: palabras predictivas (4 inserciones de 5-8 caracteres) NO se cercan", () => {
    const segs = typeChunks(["comprar ", "leche ", "mañana ", "temprano"], [300, 300, 300]);
    expect(routableText(segs)).toBe("comprar leche mañana temprano");
  });

  it("límite declarado: trozos con huecos >1,5 s NO se cercan", () => {
    const chunks: string[] = [];
    for (let i = 0; i < 100; i += 20) chunks.push(ORDER.slice(i, i + 20));
    const segs = typeChunks(chunks, chunks.map(() => 3000));
    expect(routableText(segs)).toBe(ORDER.slice(0, 100));
  });

  it("una edición que no es inserción pura rompe la ráfaga", () => {
    const burst = createBurstState();
    let segs: Segment[] = [];
    let text = "";
    let now = 0;
    const push = (chunk: string) => {
      now += 200;
      const next = text + chunk;
      segs = applyEdit(segs, text, next, undefined, burst, now);
      text = next;
    };
    push(ORDER.slice(0, 20));
    push(ORDER.slice(20, 40));
    // Borrado de 5 caracteres: rompe la ráfaga.
    const afterDelete = text.slice(0, text.length - 5);
    segs = applyEdit(segs, text, afterDelete, undefined, burst, now + 200);
    text = afterDelete;
    // Dos trozos más (38 caracteres en total): sin la ráfaga anterior
    // no llegan ni a 3 inserciones ni a 48 caracteres: quedan tecleados.
    push(" texto nuevo teclead");
    push("o a trozos grandes");
    expect(routableText(segs)).toContain("texto nuevo tecleado a trozos grandes");
  });

  it("el texto dictado no alimenta la ráfaga (ya tiene su fuente)", () => {
    const burst = createBurstState();
    let segs: Segment[] = [];
    let text = "";
    let now = 0;
    for (let i = 0; i < 5; i++) {
      now += 200;
      const chunk = ORDER.slice(i * 20, i * 20 + 20);
      const next = text + chunk;
      segs = applyEdit(segs, text, next, "dictated", burst, now);
      text = next;
    }
    expect(routableText(segs)).toBe(text);
  });
});
