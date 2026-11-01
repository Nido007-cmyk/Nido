/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const acquireMock = vi.fn(() => true);
const releaseMock = vi.fn();
vi.mock("download-wake-lock", () => ({
  acquireDownloadWakeLock: () => acquireMock(),
  releaseDownloadWakeLock: () => releaseMock(),
}));

import { holdWakeLockForDownload } from "./downloadWakeLock";

/**
 * B-resto B-08: la semántica PROPIA del envoltorio, fijada tal como el
 * código la lee hoy (caracterización, no rediseño). Hasta aquí solo la
 * cubría de refilón downloadManager.test.ts a través del manager; lo
 * que ningún test fijaba vive solo en downloadWakeLock.ts: la
 * deduplicación por Set, la liberación nativa solo al soltar el último
 * activo, la idempotencia de la función devuelta y el fallo nativo
 * tragado con el activo ya registrado antes del intento de adquirir.
 */
describe("downloadWakeLock — semántica del envoltorio", () => {
  let held: Array<() => void>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    held = [];
    acquireMock.mockReset();
    acquireMock.mockImplementation(() => true);
    releaseMock.mockReset();
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    // Drenar todo lo sujetado: el Set es estado de módulo y no debe
    // filtrarse entre tests.
    for (const release of held.splice(0)) release();
    warnSpy.mockRestore();
  });

  const hold = (assetId: string): (() => void) => {
    const release = holdWakeLockForDownload(assetId);
    held.push(release);
    return release;
  };

  it("un solo activo: adquiere al sujetar y libera el nativo al soltar", () => {
    const release = hold("asset-1");
    expect(acquireMock).toHaveBeenCalledTimes(1);
    release();
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it("doble sujeción del mismo activo: un solo nativo al sujetar; el Set cuenta activos, no handles", () => {
    // DESVIACIÓN NOMBRADA (B-resto B-08): el censo de la tanda (§4.4.1)
    // afirmaba que liberar el primer handle NO suelta el bloqueo
    // nativo. Medido contra el código, eso no se sostiene: el Set
    // deduplica la ADQUISICIÓN por activo (un solo acquire), pero no
    // lleva cuenta de handles — liberar CUALQUIERA de los dos handles
    // retira el activo del Set y, si era el único, libera el nativo;
    // el otro handle queda como no-op. Este test fija el
    // comportamiento REAL, tal como el código lo lee hoy: corregirlo
    // (conteo por handle) sería rediseñar el envoltorio, fuera de
    // esta tanda. Hoy es latente, no vivo: el único llamador
    // (downloadManager) deduplica por activo con su mapa inFlight y
    // nunca sujeta el mismo activo dos veces a la vez.
    const first = hold("asset-1");
    const second = hold("asset-1");
    expect(acquireMock).toHaveBeenCalledTimes(1);
    first();
    expect(releaseMock).toHaveBeenCalledTimes(1);
    second();
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it("activos distintos concurrentes: el nativo se suelta solo con el último", () => {
    const a = hold("asset-1");
    const b = hold("asset-2");
    expect(acquireMock).toHaveBeenCalledTimes(1);
    a();
    expect(releaseMock).not.toHaveBeenCalled();
    b();
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it("la función de liberación es idempotente: dos llamadas, un solo release nativo", () => {
    const release = hold("asset-1");
    release();
    release();
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it("el fallo nativo al adquirir se traga, y el activo ya quedó registrado antes del intento", () => {
    acquireMock.mockImplementation(() => {
      throw new Error("native acquire boom");
    });
    let release1: (() => void) | undefined;
    expect(() => {
      release1 = hold("asset-1");
    }).not.toThrow();
    expect(warnSpy).toHaveBeenCalled();
    expect(acquireMock).toHaveBeenCalledTimes(1);
    // El activo quedó en el Set antes del intento: ni su segunda
    // sujeción ni la de otro activo reintentan la adquisición.
    hold("asset-1");
    const release2 = hold("asset-2");
    expect(acquireMock).toHaveBeenCalledTimes(1);
    // Y al soltar el último, el release nativo se intenta igualmente,
    // aunque la adquisición hubiera fallado: el código lo lee así hoy.
    release1!();
    release2();
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it("el fallo nativo al liberar se traga, y el activo ya salió del Set antes del intento", () => {
    const release = hold("asset-1");
    expect(acquireMock).toHaveBeenCalledTimes(1);
    releaseMock.mockImplementation(() => {
      throw new Error("native release boom");
    });
    expect(() => release()).not.toThrow();
    expect(warnSpy).toHaveBeenCalled();
    // El activo salió del Set antes de intentar el release: sujetarlo
    // de nuevo vuelve a adquirir el nativo desde cero.
    releaseMock.mockReset();
    hold("asset-1");
    expect(acquireMock).toHaveBeenCalledTimes(2);
  });
});
