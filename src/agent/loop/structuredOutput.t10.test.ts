/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * structuredOutput.t10.test.ts — TANDA T-10 (0.1.99), m-22.
 *
 * La vía constreñida validaba su salida con un esquema que no declaraba
 * ni propiedades extra ni el tipo de `arguments`: un JSON con claves
 * inventadas pasaba, y un `arguments` que no era objeto se coercionaba
 * en silencio a {} en toParsedToolCall — la herramienta decidía con
 * argumentos vacíos sin que nadie lo supiera.
 */
import { describe, it, expect } from "vitest";
import { validateStructuredOutput, type SimpleSchema } from "./structuredOutput";
import { generateToolCallJson, type ToolCallEngine } from "./toolCallJson";

const TOOL_CALL_SCHEMA: SimpleSchema = {
  required: ["name"],
  properties: { name: "string", arguments: "object" },
  additionalProperties: false,
};

describe("m-22: el esquema de tool call declara arguments y cierra propiedades", () => {
  it("una clave extra en el nivel superior se rechaza", () => {
    const v = validateStructuredOutput(
      TOOL_CALL_SCHEMA,
      '{"name": "device_time", "arguments": {}, "sorpresa": 1}'
    );
    expect(v.ok).toBe(false);
  });

  it("la llamada válida sigue pasando", () => {
    const v = validateStructuredOutput(
      TOOL_CALL_SCHEMA,
      '{"name": "device_time", "arguments": {}}'
    );
    expect(v.ok).toBe(true);
  });

  it("arguments que no es objeto se rechaza (antes: coerción silenciosa a {})", () => {
    const v = validateStructuredOutput(
      TOOL_CALL_SCHEMA,
      '{"name": "remember_fact", "arguments": "el cielo es azul"}'
    );
    expect(v.ok).toBe(false);
  });

  it("arguments como array también se rechaza: se exige objeto plano", () => {
    const v = validateStructuredOutput(
      TOOL_CALL_SCHEMA,
      '{"name": "remember_fact", "arguments": [1, 2]}'
    );
    expect(v.ok).toBe(false);
  });

  it("sin additionalProperties en el esquema, el comportamiento no cambia (opt-in)", () => {
    const v = validateStructuredOutput(
      { required: ["name"], properties: { name: "string" } },
      '{"name": "device_time", "extra": 1}'
    );
    expect(v.ok).toBe(true);
  });
});

describe("m-22: generateToolCallJson no coercion arguments inválidos", () => {
  it("arguments de tipo erróneo en intento y reparación → null, no una llamada vacía", async () => {
    const engine: ToolCallEngine = {
      generate: async () =>
        '{"name": "remember_fact", "arguments": "el cielo es azul"}',
    };
    const out = await generateToolCallJson(engine, {
      userText: "recuerda que el cielo es azul",
      toolNames: ["remember_fact"],
    });
    expect(out).toBeNull();
  });

  it("la llamada bien formada sigue saliendo como siempre", async () => {
    const engine: ToolCallEngine = {
      generate: async () =>
        '{"name": "remember_fact", "arguments": {"content": "el cielo es azul"}}',
    };
    const out = await generateToolCallJson(engine, {
      userText: "recuerda que el cielo es azul",
      toolNames: ["remember_fact"],
    });
    expect(out).toEqual({
      name: "remember_fact",
      arguments: { content: "el cielo es azul" },
    });
  });
});
