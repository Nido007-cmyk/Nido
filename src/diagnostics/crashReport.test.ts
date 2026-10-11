/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, it, expect } from "vitest";
import { formatCrashReport, latestFailure, isFailureExit, type CrashReportLike } from "./crashReport";

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
});
