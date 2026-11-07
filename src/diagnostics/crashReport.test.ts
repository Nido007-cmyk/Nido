/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, it, expect } from "vitest";
import { formatCrashReport, interruptionCause, latestFailure, isFailureExit, maskCrashCrumbs, type CrashReportLike } from "./crashReport";

const base = { status: 0, importance: 100, pssKb: 0, rssKb: 0, trace: null, description: null };

describe("crashReport", () => {
  const report: CrashReportLike = {
    sdkInt: 35,
    device: "samsung SM-X210",
    lastCrash: "time=1\nthread=main\ncom.facebook.react.common.JavascriptException: boom",
    exits: [
      { ...base, timestamp: 1_000, reason: "USER_REQUESTED" },
      { ...base, timestamp: 3_000, reason: "CRASH_NATIVE", status: 6, rssKb: 2_048_000, trace: "signal 6 (SIGABRT)\nlibsqlcipher.so" },
      { ...base, timestamp: 2_000, reason: "LOW_MEMORY" },
    ],
  };

  it("distingue fallos de cierres normales", () => {
    expect(isFailureExit({ ...base, timestamp: 0, reason: "CRASH" })).toBe(true);
    expect(isFailureExit({ ...base, timestamp: 0, reason: "USER_REQUESTED" })).toBe(false);
  });

  it("latestFailure elige el fallo más reciente", () => {
    expect(latestFailure(report)?.reason).toBe("CRASH_NATIVE");
    expect(latestFailure({ ...report, exits: [{ ...base, timestamp: 1, reason: "USER_REQUESTED" }] })).toBeNull();
  });

  it("formatCrashReport incluye dispositivo, motivos ordenados, traza y fallo JS", () => {
    const text = formatCrashReport(report, "1.0.0");
    expect(text).toContain("NIDO 1.0.0 · samsung SM-X210 · Android SDK 35");
    expect(text.indexOf("CRASH_NATIVE")).toBeLessThan(text.indexOf("LOW_MEMORY"));
    expect(text).toContain("RSS 2000 MB");
    expect(text).toContain("libsqlcipher.so");
    expect(text).toContain("JavascriptException: boom");
  });

  it("sin datos no falla", () => {
    const text = formatCrashReport({ sdkInt: 29, device: "x", lastCrash: null, exits: [] }, "1");
    expect(text).toContain("(sin registros)");
    expect(text).toContain("(ninguno)");
  });

  it("SEC-05: el bloque lastCrash sale saneado — clases y marcos sí, rutas y fragmentos no", () => {
    const jsonFragment = `{"coleccion":"Recetas secretas de la abuela","docs":[{"title":"sopa de la casa","body":"texto largo del documento importado por la persona"}]}`;
    const longFrame =
      "	at expo.modules.kotlin.functions.AsyncFunctionComponent.dispatchAsyncFunctionInPromiseWithExtremelyLongGeneratedName(AsyncFunctionComponent.kt:2147483647)";
    const lastCrash = [
      "time=1700000000000",
      "thread=main",
      "java.io.FileNotFoundException: /data/user/0/team.nido.app/cache/recetas-de-la-abuela.pdf: open failed: ENOENT (No such file or directory)",
      "	at expo.modules.filesystem.FileSystemModule.readAsStringAsync(FileSystemModule.kt:123)",
      longFrame,
      `Caused by: org.json.JSONException: Value ${jsonFragment} of type java.lang.String cannot be converted to JSONObject at character 212`,
      "	at org.json.JSONTokener.syntaxError(JSONTokener.java:384)",
      "java.lang.IllegalStateException: file is not a database",
    ].join("\n");
    const text = formatCrashReport({ sdkInt: 35, device: "x", lastCrash, exits: [] }, "1");
    // Se conserva todo lo que diagnostica:
    expect(text).toContain("java.io.FileNotFoundException");
    expect(text).toContain("org.json.JSONException");
    expect(text).toContain("at expo.modules.filesystem.FileSystemModule.readAsStringAsync(FileSystemModule.kt:123)");
    expect(text).toContain(longFrame); // los marcos largos legítimos quedan exentos del tope
    expect(text).toContain("file is not a database");
    expect(text).toContain("at character 212"); // la posición del error JSON se conserva
    expect(text).toContain("<ruta>");
    expect(text).toContain("{<contenido>}");
    // No sale ni la ruta ni el nombre del fichero ni el fragmento del usuario:
    expect(text).not.toContain("/data/user/0/team.nido.app");
    expect(text).not.toContain("recetas-de-la-abuela.pdf");
    expect(text).not.toContain("Recetas secretas de la abuela");
    expect(text).not.toContain("sopa de la casa");
  });

  it("SEC-05: maskCrashCrumbs acota las líneas de mensaje y respeta marcos y cabeceras", () => {
    const longMessage = `java.lang.RuntimeException: ${"x".repeat(300)}`;
    const masked = maskCrashCrumbs(longMessage);
    expect(masked.length).toBe(161); // 160 + la «…»
    expect(masked.endsWith("…")).toBe(true);
    expect(maskCrashCrumbs("time=1700000000000")).toBe("time=1700000000000");
    expect(maskCrashCrumbs("thread=main")).toBe("thread=main");
    const frame = `\tat a.b.C(${"F".repeat(200)}.kt:1)`;
    expect(maskCrashCrumbs(frame)).toBe(frame); // marco: exento del tope
    expect(maskCrashCrumbs("visita file:///cache/export.json y content://docs/9")).toBe("visita <ruta> y <ruta>");
    expect(maskCrashCrumbs("array [1, 2] corto")).toBe("array [1, 2] corto"); // ≤40: intacto
  });

  it("con rótulos localizados, el informe sale en ese idioma (auditoría 2026-10-12)", () => {
    const text = formatCrashReport({ sdkInt: 29, device: "x", lastCrash: null, exits: [] }, "1", {
      exitsTitle: "== Latest exits (Android) ==",
      noRecords: "(no records)",
      traceLabel: "  trace:",
      lastCrashTitle: "== Latest Java/JS crash ==",
      noneLabel: "(none)",
    });
    expect(text).toContain("== Latest exits (Android) ==");
    expect(text).toContain("(no records)");
    expect(text).toContain("(none)");
    expect(text).not.toContain("Últimos cierres");
  });
});

describe("interruptionCause (prueba física 2026-11-06)", () => {
  const exit = (timestamp: number, reason: string) => ({
    timestamp, reason, description: null, status: 0, importance: 100, pssKb: 0, rssKb: 0, trace: null,
  });
  const report = (exits: ReturnType<typeof exit>[]) => ({ lastCrash: null, exits, sdkInt: 34, device: "t" });
  const T = 1_800_000_000_000;

  it("un cierre por memoria justo después de empezar la respuesta → memoria", () => {
    expect(interruptionCause(T, report([exit(T + 20_000, "LOW_MEMORY")]))).toBe("memory");
  });

  it("otro fallo → crash; un cierre normal → unknown", () => {
    expect(interruptionCause(T, report([exit(T + 1000, "CRASH_NATIVE")]))).toBe("crash");
    expect(interruptionCause(T, report([exit(T + 1000, "USER_REQUESTED")]))).toBe("unknown");
  });

  it("un cierre por memoria ANTES de la respuesta, o mucho después, no se le atribuye", () => {
    expect(interruptionCause(T, report([exit(T - 1000, "LOW_MEMORY")]))).toBe("unknown");
    expect(interruptionCause(T, report([exit(T + 2 * 3600_000, "LOW_MEMORY")]))).toBe("unknown");
  });

  it("manda el primer cierre tras empezar", () => {
    expect(interruptionCause(T, report([exit(T + 9000, "CRASH"), exit(T + 1000, "LOW_MEMORY")]))).toBe("memory");
  });

  it("sin informe o sin hora: unknown", () => {
    expect(interruptionCause(T, null)).toBe("unknown");
    expect(interruptionCause(Number.NaN, report([exit(T, "LOW_MEMORY")]))).toBe("unknown");
  });
});
