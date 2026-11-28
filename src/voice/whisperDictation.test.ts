/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const fs = vi.hoisted(() => ({ deleted: [] as string[] }));
vi.mock("expo-file-system/legacy", () => ({
  documentDirectory: "file:///docs/",
  deleteAsync: async (p: string) => {
    fs.deleted.push(p);
  },
}));
const trust = vi.hoisted(() => ({ fail: false, checked: [] as string[] }));
vi.mock("../models/modelTrust", () => ({
  assertTrustedModelFile: async (a: { id: string }) => {
    trust.checked.push(a.id);
    if (trust.fail) throw new Error("untrusted");
  },
}));

import {
  WHISPER_BASE_MEMORY_BYTES,
  WHISPER_LIVE_MARGIN_BYTES,
  cleanWhisperText,
  dictationWavPath,
  transcribeWithWhisper,
  whisperAsset,
  whisperFitsNow,
  whisperLanguageFor,
  type WhisperRuntime,
} from "./whisperDictation";

const MiB = 1024 * 1024;

beforeEach(() => {
  fs.deleted.length = 0;
  trust.fail = false;
  trust.checked.length = 0;
});

describe("0.1.124 — dictado con Whisper (piezas)", () => {
  it("el catálogo trae el modelo de voz multilingüe base, opcional", () => {
    const a = whisperAsset();
    expect(a?.id).toBe("whisper-base");
    expect(a?.kind).toBe("speech");
    expect(a?.required).toBe(false);
    // Multilingüe (no «.en»): entiende es/en/pt.
    expect(a?.sourceUrl).toMatch(/ggml-base\.bin$/);
  });

  it("solo se intenta si cabe en la memoria de AHORA (cifra publicada de whisper.cpp base)", () => {
    const need = WHISPER_BASE_MEMORY_BYTES + WHISPER_LIVE_MARGIN_BYTES;
    const snap = (avail: number) => ({ totalRamBytes: 3416 * MiB, rssBytes: 0, availBytes: avail, lowMemThresholdBytes: 216 * MiB });
    expect(whisperFitsNow(snap(need + 216 * MiB), 147951465)).toBe(true);
    expect(whisperFitsNow(snap(need + 216 * MiB - 1), 147951465)).toBe(false);
    // Sin lectura de memoria no se arriesga.
    expect(whisperFitsNow(null, 147951465)).toBe(false);
    expect(whisperFitsNow({ totalRamBytes: 1, rssBytes: 0 }, 147951465)).toBe(false);
  });

  it("idioma según la interfaz; el resto, autodetección", () => {
    expect(whisperLanguageFor("es-MX")).toBe("es");
    expect(whisperLanguageFor("en")).toBe("en");
    expect(whisperLanguageFor("pt-BR")).toBe("pt");
    expect(whisperLanguageFor("fr")).toBe("auto");
    expect(whisperLanguageFor(undefined)).toBe("auto");
  });

  it("limpia las marcas de no-habla de Whisper", () => {
    expect(cleanWhisperText(" Hola, ¿qué tal? ")).toBe("Hola, ¿qué tal?");
    expect(cleanWhisperText("[BLANK_AUDIO]")).toBe("");
    expect(cleanWhisperText("(música) Recuérdame llamar [Música]")).toBe("Recuérdame llamar");
    expect(cleanWhisperText(null)).toBe("");
  });

  it("el WAV temporal vive en la caché", () => {
    expect(dictationWavPath("file:///cache/", 42)).toBe("file:///cache/dictation-42.wav");
  });
});

describe("0.1.124 — transcribeWithWhisper", () => {
  const runtime = (result: string | Error) => {
    const calls: { path: string; opts: Record<string, unknown> }[] = [];
    let released = 0;
    const rt: WhisperRuntime = {
      initWhisper: async () => ({
        transcribe: (path, opts) => {
          calls.push({ path, opts });
          return { promise: result instanceof Error ? Promise.reject(result) : Promise.resolve({ result }) };
        },
        release: async () => {
          released++;
        },
      }),
    };
    return { rt, calls, released: () => released };
  };

  it("pasa por la puerta de confianza, transcribe en el idioma de la interfaz, libera y BORRA el audio", async () => {
    const r = runtime(" Recuérdame comprar pan ");
    await expect(transcribeWithWhisper("file:///cache/d.wav", { uiLanguage: "es", runtime: r.rt })).resolves.toBe(
      "Recuérdame comprar pan",
    );
    expect(trust.checked).toEqual(["whisper-base"]);
    expect(r.calls[0].opts).toMatchObject({ language: "es", translate: false });
    expect(r.released()).toBe(1);
    expect(fs.deleted).toEqual(["file:///cache/d.wav"]);
  });

  it("si Whisper falla, lanza, libera y también borra el audio", async () => {
    const r = runtime(new Error("boom"));
    await expect(transcribeWithWhisper("file:///cache/e.wav", { runtime: r.rt })).rejects.toThrow("boom");
    expect(r.released()).toBe(1);
    expect(fs.deleted).toEqual(["file:///cache/e.wav"]);
  });

  it("un modelo que no pasa la puerta de confianza no se abre, y el audio se borra igual", async () => {
    trust.fail = true;
    const r = runtime("x");
    await expect(transcribeWithWhisper("file:///cache/f.wav", { runtime: r.rt })).rejects.toThrow("untrusted");
    expect(r.calls).toHaveLength(0);
    expect(fs.deleted).toEqual(["file:///cache/f.wav"]);
  });
});
