/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * 0.1.122: la caché del prompt en disco guarda SOLO texto público. Aquí se
 * cobra la mitad de la garantía que vive en el prompt (el tramo público no
 * lleva memoria ni fecha, en los tres idiomas, las tres intenciones y los
 * tres niveles de catálogo) y las piezas puras del módulo. La otra mitad
 * (el motor solo guarda en un contexto que procesó el texto público) está
 * en LlamaEngine.test.ts.
 */
import { describe, expect, it } from "vitest";
import { buildSystemPrompt, buildSystemPromptParts } from "../agent/loop/agentLoop";
import {
  PROMPT_CACHE_MAX_FILES,
  PROMPT_CACHE_PROBE_USER,
  filesToPrune,
  probeMessages,
  promptCacheFileName,
  publicSliceFromFormatted,
  textFingerprint,
} from "./promptDiskCache";

const INTENTS = ["actuar", "recordar", "conversar"] as const;
const LEVELS = ["full", "minimal", "none"] as const;
const LANGS = ["es", "en", "pt"] as const;
const SECRET = "- [familia] Mi hija se llama Lucía y es alérgica a la penicilina";

describe("0.1.122 — tramo público del prompt del agente", () => {
  for (const lang of LANGS) {
    for (const intent of INTENTS) {
      for (const level of LEVELS) {
        it(`${lang}/${intent}/${level}: público sin memoria ni fecha, prefijo exacto del prompt`, () => {
          const { publicPrefix, full } = buildSystemPromptParts(intent, SECRET, lang, level);
          expect(full.startsWith(publicPrefix)).toBe(true);
          expect(full).toBe(buildSystemPrompt(intent, SECRET, lang, level));
          // Nada del usuario en lo que puede ir a disco.
          expect(publicPrefix).not.toContain("Lucía");
          expect(publicPrefix).not.toContain("<untrusted source=\"memory\"");
          // Ni la fecha: ni el año en curso ni la fecha ISO de hoy.
          const now = new Date();
          const pad = (n: number) => String(n).padStart(2, "0");
          const iso = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
          expect(publicPrefix).not.toContain(iso);
          expect(publicPrefix).not.toContain(String(now.getFullYear()));
          // El tramo público es el mismo con memoria, sin ella o con otra.
          expect(buildSystemPromptParts(intent, "", lang, level).publicPrefix).toBe(publicPrefix);
          expect(buildSystemPromptParts(intent, "- [x] otra cosa", lang, level).publicPrefix).toBe(publicPrefix);
          // La memoria sí llega al prompt entero, detrás del tramo público.
          expect(full.indexOf("Lucía")).toBeGreaterThan(publicPrefix.length - 1);
          // La regla de seguridad va ANTES de la memoria, como siempre.
          expect(publicPrefix).toMatch(/untrusted/);
        });
      }
    }
  }

  it("la pista de intención sigue siendo lo último que lee el modelo", () => {
    const { full } = buildSystemPromptParts("actuar", SECRET, "es", "full");
    expect(full.lastIndexOf("Lucía")).toBeLessThan(full.length - 1);
    expect(full.trimEnd().split("\n").pop()).not.toContain("Lucía");
  });
});

describe("0.1.122 — piezas de promptDiskCache", () => {
  it("el chat de sondeo solo lleva el tramo público y un marcador fijo", () => {
    expect(probeMessages("PUBLICO\n")).toEqual([
      { role: "system", content: "PUBLICO\n" },
      { role: "user", content: PROMPT_CACHE_PROBE_USER },
    ]);
    expect(PROMPT_CACHE_PROBE_USER).toBe(".");
  });

  it("corta el chat formateado justo al final del tramo público", () => {
    const fmt = "<|im_start|>system\nPUBLICO\n<|im_end|>\n<|im_start|>user\n.<|im_end|>";
    expect(publicSliceFromFormatted(fmt, "PUBLICO\n")).toBe("<|im_start|>system\nPUBLICO\n");
    // Gemma mete el sistema dentro del turno del usuario: también vale.
    expect(publicSliceFromFormatted("<bos><start_of_turn>user\nPUBLICO\n\n.", "PUBLICO\n")).toBe(
      "<bos><start_of_turn>user\nPUBLICO\n",
    );
    expect(publicSliceFromFormatted(fmt, "NO ESTÁ")).toBeNull();
    expect(publicSliceFromFormatted(fmt, "")).toBeNull();
  });

  it("la llave cambia con todo lo que cambia el estado guardado", () => {
    const base = { modelFile: "qwen.gguf", nCtx: 2048, profile: "cpu-q8", engineVersion: "0.13.0-rc.9", appVersion: "0.1.122", publicSlice: "abc" };
    const name = promptCacheFileName(base);
    expect(name).toMatch(/^qwen\.gguf-2048-cpu-q8-[0-9a-f]{8}-[0-9a-f]{16}\.bin$/);
    expect(promptCacheFileName(base)).toBe(name);
    for (const change of [
      { modelFile: "otro.gguf" },
      { nCtx: 4096 },
      { profile: "accel" },
      { engineVersion: "0.13.0-rc.12" },
      { appVersion: "0.1.123" },
      { publicSlice: "abd" },
    ]) {
      expect(promptCacheFileName({ ...base, ...change })).not.toBe(name);
    }
    // Nombres de fichero raros no rompen la ruta.
    expect(promptCacheFileName({ ...base, modelFile: "../a b/c.gguf" })).not.toContain("/");
  });

  it("la huella es estable y distingue textos casi iguales", () => {
    expect(textFingerprint("hola")).toBe(textFingerprint("hola"));
    expect(textFingerprint("hola")).not.toBe(textFingerprint("holb"));
    expect(textFingerprint("")).toMatch(/^[0-9a-f]{16}$/);
  });

  it("la poda deja los más recientes", () => {
    const files = Array.from({ length: PROMPT_CACHE_MAX_FILES + 2 }, (_, i) => ({ name: `f${i}.bin`, mtime: i }));
    expect(filesToPrune(files)).toEqual(["f1.bin", "f0.bin"]);
    expect(filesToPrune(files.slice(0, 3))).toEqual([]);
    expect(filesToPrune(files, 0)).toHaveLength(files.length);
  });
});
