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
 * B-resto B-08: la semántica PROPIA del envoltorio. Hasta aquí solo la
 * cubría de refilón downloadManager.test.ts a través del manager; lo
 * que ningún test fijaba vive solo en downloadWakeLock.ts: el conteo de
 * agarres, la liberación nativa solo al soltar el último handle vivo,
 * la idempotencia de la función devuelta y el fallo nativo tragado con
 * el activo ya registrado antes del intento de adquirir.
 *
 * Historia: esta batería nació como caracterización de la semántica
 * del Set (contaba activos, no handles) con la desviación nombrada en
 * el test 2. La compleción de B-08 (cadena post-0.1.69, 2026-11-02)
 * trajo el conteo por handle: el test 2 y el intercalado fijan la
 * semántica CORREGIDA, y la expectativa final del test 5 se corrigió
 * con ellos (soltar también el segundo handle de asset-1 antes de
 * esperar el release nativo, conservando sus cinco propósitos). El
 * resto de la batería sigue siendo caracterización fiel.
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
    // Drenar todo lo sujetado: el conteo es estado de módulo y no debe
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

  it("doble sujeción del mismo activo: un solo nativo al sujetar; el conteo es por handle, no por activo", () => {
    // CORRECCIÓN (B-08 completada, cadena post-0.1.69): la semántica
    // anterior contaba activos en un Set — liberar cualquiera de los
    // dos handles retiraba el activo y, si era el único, liberaba el
    // nativo dejando el otro handle como no-op (desviación nombrada
    // en esta misma batería desde B-resto). Con el conteo por handle,
    // el primer release solo descuenta: el nativo se libera cuando el
    // último handle vivo suelta. Era latente, no vivo: el único
    // llamador (downloadManager) deduplica por activo con su mapa
    // inFlight y nunca sujeta el mismo activo dos veces a la vez;
    // la corrección cierra el riesgo simétrico de mañana.
    const first = hold("asset-1");
    const second = hold("asset-1");
    expect(acquireMock).toHaveBeenCalledTimes(1);
    first();
    expect(releaseMock).not.toHaveBeenCalled();
    second();
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it("agarres intercalados A, A, B: el nativo cae solo cuando suelta el último handle vivo", () => {
    const a1 = hold("asset-1");
    const a2 = hold("asset-1");
    const b = hold("asset-2");
    expect(acquireMock).toHaveBeenCalledTimes(1);
    a1();
    expect(releaseMock).not.toHaveBeenCalled();
    a2();
    expect(releaseMock).not.toHaveBeenCalled();
    b();
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
    // El activo quedó registrado antes del intento: ni su segunda
    // sujeción ni la de otro activo reintentan la adquisición.
    const release1b = hold("asset-1");
    const release2 = hold("asset-2");
    expect(acquireMock).toHaveBeenCalledTimes(1);
    // Conteo (B-08 completada): soltados el primer handle de asset-1
    // y el de asset-2, sigue vivo el segundo handle de asset-1, así
    // que el nativo aún no se libera. (La expectativa original de
    // este test esperaba el release ya aquí: codificaba la semántica
    // del Set, que retiraba el activo al soltar cualquier handle.)
    release1!();
    release2();
    expect(releaseMock).not.toHaveBeenCalled();
    // Y al soltar el último, el release nativo se intenta igualmente,
    // aunque la adquisición hubiera fallado.
    release1b();
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it("el fallo nativo al liberar se traga, y el activo ya salió del registro antes del intento", () => {
    const release = hold("asset-1");
    expect(acquireMock).toHaveBeenCalledTimes(1);
    releaseMock.mockImplementation(() => {
      throw new Error("native release boom");
    });
    expect(() => release()).not.toThrow();
    expect(warnSpy).toHaveBeenCalled();
    // El activo salió del registro antes de intentar el release:
    // sujetarlo de nuevo vuelve a adquirir el nativo desde cero.
    releaseMock.mockReset();
    hold("asset-1");
    expect(acquireMock).toHaveBeenCalledTimes(2);
  });
});
