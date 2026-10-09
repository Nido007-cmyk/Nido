/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * revocationRecovery.test.ts — FASE 2 (cierre UI).
 *
 * Cubre los pass-throughs de recuperación del almacenamiento de
 * revocaciones agregados en UI-FASE-1:
 * - getRevocationStoreStatus() delega al transporte
 * - resetRevocationStore() delega al transporte
 * - Sin soporte en transporte: status sano por defecto, reset lanza error
 *   explícito (sin éxito falso)
 */

import { describe, it, expect, vi } from "vitest";
import { NidoMessenger } from "./messenger";

function makeMessenger(transport: any): NidoMessenger {
  const m = new NidoMessenger(transport);
  // Marcar como vivo para que assertLive() no lance.
  (m as any).live = true;
  return m;
}

describe("revocation store recovery pass-throughs", () => {
  it("getRevocationStoreStatus delega al transporte", async () => {
    const transport = {
      getRevocationStoreStatus: () => ({
        loaded: true,
        healthy: false,
        revokedCount: 3,
      }),
    };
    const m = makeMessenger(transport);
    const status = await m.getRevocationStoreStatus();
    expect(status.healthy).toBe(false);
    expect(status.revokedCount).toBe(3);
  });

  it("getRevocationStoreStatus sin soporte asume sano", async () => {
    const m = makeMessenger({});
    const status = await m.getRevocationStoreStatus();
    expect(status.healthy).toBe(true);
    expect(status.loaded).toBe(true);
  });

  it("resetRevocationStore delega al transporte y retorna resultado", async () => {
    const transport = {
      resetRevocationStore: vi.fn(async () => true),
    };
    const m = makeMessenger(transport);
    const ok = await m.resetRevocationStore();
    expect(ok).toBe(true);
    expect(transport.resetRevocationStore).toHaveBeenCalledTimes(1);
  });

  it("resetRevocationStore sin soporte lanza error explícito (no éxito falso)", async () => {
    const m = makeMessenger({});
    await expect(m.resetRevocationStore()).rejects.toThrow();
  });

  it("resetRevocationStore propaga fallo del transporte", async () => {
    const transport = {
      resetRevocationStore: vi.fn(async () => {
        throw new Error("fallo de escritura");
      }),
    };
    const m = makeMessenger(transport);
    await expect(m.resetRevocationStore()).rejects.toThrow("fallo de escritura");
  });
});
