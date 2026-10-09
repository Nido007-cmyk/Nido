/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * revocationFailClosed.test.ts — Tests de la corrección fail-closed
 * para persistencia de revocaciones P2P (SEC-REVOCATION-FAILCLOSED, 2026-10-09).
 *
 * Verifica que un peer revocado NO recupere confianza por errores
 * silenciosos de almacenamiento.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NidoBluetoothTransport } from "./nativeTransport";

/** Filesystem en memoria para los tests. */
const memFs = vi.hoisted(() => ({
  files: new Map<string, string>(),
  failRead: false,
  failWrite: false,
  failInfo: false,
}));

vi.mock("expo-file-system/legacy", () => ({
  get documentDirectory() {
    return "/mem/";
  },
  async getInfoAsync(path: string) {
    if (memFs.failInfo) throw new Error("info failed");
    return { exists: memFs.files.has(path) };
  },
  async readAsStringAsync(path: string) {
    if (memFs.failRead) throw new Error("read failed");
    const content = memFs.files.get(path);
    if (content === undefined) throw new Error("file not found");
    return content;
  },
  async writeAsStringAsync(path: string, content: string) {
    if (memFs.failWrite) throw new Error("write failed");
    memFs.files.set(path, content);
  },
  async deleteAsync(path: string, _opts?: unknown) {
    memFs.files.delete(path);
  },
  async moveAsync({ from, to }: { from: string; to: string }) {
    const content = memFs.files.get(from);
    if (content === undefined) throw new Error("tmp not found");
    memFs.files.set(to, content);
    memFs.files.delete(from);
  },
}));

const REVOKED_PATH = "/mem/revoked-peers.json";
const PEER_A = "aa".repeat(32);
const PEER_B = "bb".repeat(32);

function makeTransport() {
  // bindings null: los métodos de revocación no necesitan Bluetooth.
  return new NidoBluetoothTransport(null);
}

beforeEach(() => {
  memFs.files.clear();
  memFs.failRead = false;
  memFs.failWrite = false;
  memFs.failInfo = false;
});

describe("SEC-REVOCATION-FAILCLOSED: instalación nueva", () => {
  it("sin archivo → lista vacía, sano, conexiones permitidas", async () => {
    const t = makeTransport();
    await t.loadRevokedPks();
    const status = t.getRevocationStoreStatus();
    expect(status.loaded).toBe(true);
    expect(status.healthy).toBe(true);
    expect(status.revokedCount).toBe(0);
    expect(await t.isRevoked(PEER_A)).toBe(false);
  });
});

describe("SEC-REVOCATION-FAILCLOSED: archivo válido", () => {
  it("carga revocaciones desde disco", async () => {
    memFs.files.set(REVOKED_PATH, JSON.stringify([PEER_A]));
    const t = makeTransport();
    await t.loadRevokedPks();
    expect(await t.isRevoked(PEER_A)).toBe(true);
    expect(await t.isRevoked(PEER_B)).toBe(false);
    expect(t.getRevocationStoreStatus().healthy).toBe(true);
  });

  it("revokePeer persiste y sobrevive 'reinicio' (nueva instancia)", async () => {
    const t1 = makeTransport();
    await t1.loadRevokedPks();
    await t1.revokePeer(PEER_A);

    // Simular reinicio: nueva instancia del transporte.
    const t2 = makeTransport();
    await t2.loadRevokedPks();
    expect(await t2.isRevoked(PEER_A)).toBe(true);
  });

  it("revocación repetida es idempotente", async () => {
    const t = makeTransport();
    await t.loadRevokedPks();
    await t.revokePeer(PEER_A);
    await t.revokePeer(PEER_A);
    expect(await t.isRevoked(PEER_A)).toBe(true);
    expect(t.getRevocationStoreStatus().revokedCount).toBe(1);
  });

  it("unrevokePeer levanta la revocación y persiste", async () => {
    const t = makeTransport();
    await t.loadRevokedPks();
    await t.revokePeer(PEER_A);
    await t.unrevokePeer(PEER_A);
    expect(await t.isRevoked(PEER_A)).toBe(false);

    const t2 = makeTransport();
    await t2.loadRevokedPks();
    expect(await t2.isRevoked(PEER_A)).toBe(false);
  });
});

describe("SEC-REVOCATION-FAILCLOSED: archivo corrupto → fail-closed", () => {
  it("JSON corrupto → no-saludable, isRevoked retorna true (bloqueo)", async () => {
    memFs.files.set(REVOKED_PATH, "{corrupto!!!");
    const t = makeTransport();
    await t.loadRevokedPks();
    const status = t.getRevocationStoreStatus();
    expect(status.loaded).toBe(true);
    expect(status.healthy).toBe(false);
    // Fail-closed: ante estado incierto, tratar como revocado.
    expect(await t.isRevoked(PEER_A)).toBe(true);
    expect(await t.isRevoked(PEER_B)).toBe(true);
  });

  it("JSON válido pero estructura inválida (no array) → no-saludable", async () => {
    memFs.files.set(REVOKED_PATH, JSON.stringify({ foo: "bar" }));
    const t = makeTransport();
    await t.loadRevokedPks();
    expect(t.getRevocationStoreStatus().healthy).toBe(false);
    expect(await t.isRevoked(PEER_A)).toBe(true);
  });

  it("error de lectura con archivo existente → no-saludable", async () => {
    memFs.files.set(REVOKED_PATH, JSON.stringify([PEER_A]));
    memFs.failRead = true;
    const t = makeTransport();
    await t.loadRevokedPks();
    expect(t.getRevocationStoreStatus().healthy).toBe(false);
  });

  it("resetRevocationStore recupera el estado corrupto explícitamente", async () => {
    memFs.files.set(REVOKED_PATH, "{corrupto!!!");
    const t = makeTransport();
    await t.loadRevokedPks();
    expect(t.getRevocationStoreStatus().healthy).toBe(false);

    const ok = await t.resetRevocationStore();
    expect(ok).toBe(true);
    const status = t.getRevocationStoreStatus();
    expect(status.healthy).toBe(true);
    expect(status.revokedCount).toBe(0);
    // Después del reset explícito, las conexiones vuelven a permitirse.
    expect(await t.isRevoked(PEER_A)).toBe(false);
  });
});

describe("SEC-REVOCATION-FAILCLOSED: fallos de escritura", () => {
  it("revokePeer lanza si la persistencia falla (no éxito silencioso)", async () => {
    const t = makeTransport();
    await t.loadRevokedPks();
    memFs.failWrite = true;
    await expect(t.revokePeer(PEER_A)).rejects.toThrow(/NO se pudo guardar/);
    // Pero el bloqueo en memoria sigue activo para esta sesión.
    expect(await t.isRevoked(PEER_A)).toBe(true);
  });

  it("unrevokePeer lanza si la persistencia falla", async () => {
    const t = makeTransport();
    await t.loadRevokedPks();
    await t.revokePeer(PEER_A);
    memFs.failWrite = true;
    await expect(t.unrevokePeer(PEER_A)).rejects.toThrow();
  });
});

describe("SEC-REVOCATION-FAILCLOSED: escritura atómica", () => {
  it("una escritura interrumpida no destruye el estado válido anterior", async () => {
    // Estado válido previo: PEER_A revocado.
    memFs.files.set(REVOKED_PATH, JSON.stringify([PEER_A]));
    const t = makeTransport();
    await t.loadRevokedPks();

    // Simular fallo durante la escritura del tmp (moveAsync fallaría
    // si el tmp no existe, pero aquí simulamos fallo en write).
    memFs.failWrite = true;
    await expect(t.revokePeer(PEER_B)).rejects.toThrow();

    // El archivo original debe seguir intacto (no se tocó).
    memFs.failWrite = false;
    const raw = memFs.files.get(REVOKED_PATH);
    expect(JSON.parse(raw!)).toEqual([PEER_A.toLowerCase()]);
  });
});

describe("SEC-REVOCATION-FAILCLOSED: concurrencia", () => {
  it("cargas concurrentes no producen estado inconsistente", async () => {
    memFs.files.set(REVOKED_PATH, JSON.stringify([PEER_A]));
    const t = makeTransport();
    // Dos cargas concurrentes.
    await Promise.all([t.loadRevokedPks(), t.loadRevokedPks()]);
    expect(await t.isRevoked(PEER_A)).toBe(true);
    expect(t.getRevocationStoreStatus().revokedCount).toBe(1);
  });

  it("revocación concurrente con verificación", async () => {
    const t = makeTransport();
    await t.loadRevokedPks();
    await Promise.all([t.revokePeer(PEER_A), t.revokePeer(PEER_B)]);
    expect(await t.isRevoked(PEER_A)).toBe(true);
    expect(await t.isRevoked(PEER_B)).toBe(true);
  });
});
