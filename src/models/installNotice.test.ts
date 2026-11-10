// @ts-nocheck
/**
 * 0.1.90 · Familia 3 — ningún motivo queda en silencio en la tarjeta.
 * La tabla de prioridad de installNoticeFor, caso por caso.
 */
import { describe, it, expect } from "vitest";
import { installNoticeFor } from "./installNotice";

const st = (over: Partial<{ present: boolean; outdated: boolean; checksumOk: boolean | null }> = {}) => ({
  present: false,
  outdated: false,
  checksumOk: null,
  ...over,
});
const rec = (over: Record<string, unknown> = {}) => ({
  assetId: "qwen3-0.6b-q4km",
  status: "failed",
  sizeBytes: 396705472,
  sha256: "ac2d",
  updatedAt: 0,
  ...over,
});

describe("installNoticeFor", () => {
  it("presente o desactualizado: sin aviso", () => {
    expect(installNoticeFor(st({ present: true }), rec())).toBeNull();
    expect(installNoticeFor(st({ outdated: true }), rec())).toBeNull();
  });

  it("checksumOk false (integridad descubierta por statusOf): aviso de integridad", () => {
    expect(installNoticeFor(st({ checksumOk: false }), null)).toEqual({ kind: "integrity" });
    // Manda sobre el diario: es el hecho más fresco.
    expect(installNoticeFor(st({ checksumOk: false }), rec({ failureCode: "interrupted" }))).toEqual({
      kind: "integrity",
    });
  });

  it("diario failed: cada código con su aviso", () => {
    expect(installNoticeFor(st(), rec({ failureCode: "checksumMismatch" }))).toEqual({ kind: "integrity" });
    expect(installNoticeFor(st(), rec({ failureCode: "sizeMismatch" }))).toEqual({ kind: "sizeMismatch" });
    expect(installNoticeFor(st(), rec({ failureCode: "interrupted" }))).toEqual({ kind: "interrupted" });
    expect(installNoticeFor(st(), rec({ failureCode: "insufficientStorage" }))).toEqual({ kind: "storage" });
    expect(installNoticeFor(st(), rec({ failureCode: "stalled" }))).toEqual({ kind: "stalled" });
    expect(installNoticeFor(st(), rec({ failureCode: "httpError" }))).toEqual({ kind: "failed" });
    expect(installNoticeFor(st(), rec({ failureCode: undefined }))).toEqual({ kind: "failed" });
  });

  it("diario paused con bytes: aviso de parte descargada con sus cifras", () => {
    expect(
      installNoticeFor(st(), rec({ status: "paused", bytesWritten: 1000, sizeBytes: 396705472 }))
    ).toEqual({ kind: "paused", doneBytes: 1000, totalBytes: 396705472 });
    expect(installNoticeFor(st(), rec({ status: "paused", bytesWritten: 0 }))).toBeNull();
  });

  it("diario installed pero no presente: el archivo está y no se pudo comprobar", () => {
    expect(installNoticeFor(st(), rec({ status: "installed" }))).toEqual({ kind: "unverifiable" });
  });

  it("sin diario o en curso: sin aviso", () => {
    expect(installNoticeFor(st(), null)).toBeNull();
    expect(installNoticeFor(st(), undefined)).toBeNull();
    expect(installNoticeFor(st(), rec({ status: "downloading" }))).toBeNull();
    expect(installNoticeFor(st(), rec({ status: "verifying" }))).toBeNull();
  });
});
