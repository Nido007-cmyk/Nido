/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * dispatcher.t10.test.ts — TANDA T-10 (0.1.99): disponibilidad del
 * despacho de herramientas.
 *
 * M-15: ninguna herramienta tenía plazo: un handler colgado dejaba el
 * turno (y la batería) esperando para siempre. La costura única es
 * dispatchToolCallDetailed: la carrera envuelve SOLO el handler, nunca
 * la espera humana de confirmación.
 *
 * M-17: la validación central solo miraba tipos: NaN/Infinity pasaban
 * como «number» (JSON admite 1e999) y las restricciones que las
 * descripciones ya prometen (enum, formato ISO, topes) no se imponían.
 */
import { describe, it, expect } from "vitest";
import {
  validateToolCall,
  dispatchToolCallDetailed,
  DEFAULT_TOOL_TIMEOUT_MS,
} from "./dispatcher";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("M-15: plazo por herramienta en el despacho", () => {
  it("un handler que nunca resuelve se da por fallido con resultado DESCONOCIDO", async () => {
    const r = await dispatchToolCallDetailed(
      { name: "device_time", arguments: {} },
      { device_time: () => new Promise<string>(() => {}) },
      { toolTimeoutMs: 40 }
    );
    expect(r.status).toBe("failed");
    expect(r.text).toMatch(/desconocido/i);
    // La observación avisa de que la acción puede haber completado tarde:
    // el modelo no debe reintentar una mutación a ciegas.
    expect(r.text).toMatch(/tarde|reintent/i);
  });

  it("un handler lento pero dentro del plazo ejecuta normal", async () => {
    const r = await dispatchToolCallDetailed(
      { name: "device_time", arguments: {} },
      {
        device_time: async () => {
          await wait(20);
          return "2026-11-14T10:00:00";
        },
      },
      { toolTimeoutMs: 1000 }
    );
    expect(r.status).toBe("executed");
    expect(r.text).toBe("2026-11-14T10:00:00");
  });

  it("el rechazo tardío de un handler ya vencido no queda sin manejar", async () => {
    const r = await dispatchToolCallDetailed(
      { name: "device_time", arguments: {} },
      {
        device_time: async () => {
          await wait(60);
          throw new Error("fallo tardío");
        },
      },
      { toolTimeoutMs: 20 }
    );
    expect(r.status).toBe("failed");
    // Si el rechazo tardío quedara sin catch, vitest marcaría un
    // unhandled rejection y la suite entera lo señalaría.
    await wait(100);
  });

  it("abortar la señal durante el despacho cierra como cancelado", async () => {
    const controller = new AbortController();
    const p = dispatchToolCallDetailed(
      { name: "device_time", arguments: {} },
      { device_time: () => new Promise<string>(() => {}) },
      { signal: controller.signal, toolTimeoutMs: 60_000 }
    );
    setTimeout(() => controller.abort(), 20);
    const r = await p;
    expect(r.status).toBe("cancelled");
  });

  it("el plazo por defecto existe y es generoso (handlers con E/S real)", () => {
    expect(DEFAULT_TOOL_TIMEOUT_MS).toBeGreaterThanOrEqual(30_000);
    expect(DEFAULT_TOOL_TIMEOUT_MS).toBeLessThanOrEqual(300_000);
  });
});

describe("M-17: la validación central impone lo que las descripciones prometen", () => {
  it("NaN e Infinity no pasan como number", () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const r = validateToolCall({
        name: "convert_units",
        arguments: { value, from: "km", to: "m" },
      });
      expect(r.ok).toBe(false);
    }
  });

  it("una cadena numérica gigante tampoco: coerciona a Infinity y se rechaza", () => {
    const r = validateToolCall({
      name: "convert_units",
      arguments: { value: "9".repeat(400), from: "km", to: "m" },
    });
    expect(r.ok).toBe(false);
  });

  it("un número finito en cadena sigue aceptándose (comportamiento de hoy)", () => {
    const r = validateToolCall({
      name: "convert_units",
      arguments: { value: "2.5", from: "km", to: "m" },
    });
    expect(r.ok).toBe(true);
  });

  it("remember_fact.category fuera del enum se rechaza (antes degradaba en silencio)", () => {
    const bad = validateToolCall({
      name: "remember_fact",
      arguments: { content: "le gusta el té", category: "inventada" },
    });
    expect(bad.ok).toBe(false);
    const good = validateToolCall({
      name: "remember_fact",
      arguments: { content: "le gusta el té", category: "preference" },
    });
    expect(good.ok).toBe(true);
  });

  it("delete_memory.kind solo admite fact o person", () => {
    expect(
      validateToolCall({ name: "delete_memory", arguments: { id: "1", kind: "otra" } }).ok
    ).toBe(false);
    expect(
      validateToolCall({ name: "delete_memory", arguments: { id: "1", kind: "person" } }).ok
    ).toBe(true);
  });

  it("create_reminder.at exige ISO con fecha y hora (formato prometido)", () => {
    const base = { name: "create_reminder", arguments: { text: "llamar" } };
    expect(validateToolCall({ ...base, arguments: { text: "llamar", at: "mañana a las 9" } }).ok).toBe(false);
    expect(validateToolCall({ ...base, arguments: { text: "llamar", at: "2026-11-20 09:00" } }).ok).toBe(false);
    expect(validateToolCall({ ...base, arguments: { text: "llamar", at: "2026-13-40T09:00" } }).ok).toBe(false);
    expect(validateToolCall({ ...base, arguments: { text: "llamar", at: "2026-11-20T09:00" } }).ok).toBe(true);
    expect(validateToolCall({ ...base, arguments: { text: "llamar", at: "2026-11-20T09:00:00.000Z" } }).ok).toBe(true);
  });

  it("create_calendar_event.start/end exigen ISO-8601 (lo que su descripción promete)", () => {
    const bad = validateToolCall({
      name: "create_calendar_event",
      arguments: { title: "Dentista", start: "20/11/2026" },
    });
    expect(bad.ok).toBe(false);
    const good = validateToolCall({
      name: "create_calendar_event",
      arguments: { title: "Dentista", start: "2026-09-27T10:00:00", end: "2026-09-27T11:00:00" },
    });
    expect(good.ok).toBe(true);
  });

  it("analyze_table.top_n respeta el «máx. 20» de su descripción", () => {
    const bad = validateToolCall({
      name: "analyze_table",
      arguments: { text: "a,b\n1,2", top_n: 25 },
    });
    expect(bad.ok).toBe(false);
    const good = validateToolCall({
      name: "analyze_table",
      arguments: { text: "a,b\n1,2", top_n: 20 },
    });
    expect(good.ok).toBe(true);
  });

  it("sin restricción poblada no hay tope inventado: un string enorme sigue válido", () => {
    const r = validateToolCall({
      name: "save_note",
      arguments: { title: "t", body: "x".repeat(100_000) },
    });
    expect(r.ok).toBe(true);
  });
});
