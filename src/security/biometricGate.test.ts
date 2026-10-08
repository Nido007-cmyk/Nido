/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * biometricGate.test.ts — NIDO: tests del gate biométrico (módulo mockeado).
 * Verifica la política: timeout, cancelación, fallo, ausencia de enrollment
 * y que nunca se "autentica" sin pasar por el SO.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  BiometricCancelled,
  BiometricFailed,
  BiometricUnavailable,
  ensureUnlocked,
  getGateStatus,
  isUnlocked,
  lockNow,
  requireUnlock,
  setBiometricTestModule,
  setLastUnlockAtForTest,
} from "./biometricGate";

function mockModule(over: Record<string, unknown> = {}) {
  const calls: string[] = [];
  setBiometricTestModule({
    hasHardwareAsync: async () => true,
    isEnrolledAsync: async () => true,
    supportedAuthenticationTypesAsync: async () => [1],
    getEnrolledLevelAsync: async () => 3,
    authenticateAsync: async () => {
      calls.push("authenticate");
      return { success: true };
    },
    ...over,
  } as never);
  return calls;
}

beforeEach(() => {
  setBiometricTestModule(null);
  lockNow();
});

describe("getGateStatus", () => {
  it("sin módulo → none", async () => {
    setBiometricTestModule(null);
    await expect(getGateStatus()).resolves.toEqual({
      hasHardware: false,
      enrolled: false,
      method: "none",
    });
  });

  it("hardware + enrolado + tipos → biometrics", async () => {
    mockModule();
    await expect(getGateStatus()).resolves.toMatchObject({ method: "biometrics", enrolled: true });
  });

  it("enrolado sin tipos biométricos → device-credential", async () => {
    mockModule({ supportedAuthenticationTypesAsync: async () => [] });
    await expect(getGateStatus()).resolves.toMatchObject({ method: "device-credential" });
  });

  it("no enrolado → none", async () => {
    mockModule({ isEnrolledAsync: async () => false });
    await expect(getGateStatus()).resolves.toMatchObject({ method: "none", enrolled: false });
  });
});

describe("requireUnlock", () => {
  it("éxito → desbloquea", async () => {
    mockModule();
    await requireUnlock("test");
    expect(isUnlocked()).toBe(true);
  });

  it("cancelación del usuario → BiometricCancelled y sigue bloqueado", async () => {
    mockModule({ authenticateAsync: async () => ({ success: false, error: "user_cancel" }) });
    await expect(requireUnlock("test")).rejects.toBeInstanceOf(BiometricCancelled);
    expect(isUnlocked()).toBe(false);
  });

  it("fallo → BiometricFailed y sigue bloqueado", async () => {
    mockModule({ authenticateAsync: async () => ({ success: false, error: "lockout" }) });
    await expect(requireUnlock("test")).rejects.toBeInstanceOf(BiometricFailed);
    expect(isUnlocked()).toBe(false);
  });

  it("sin enrollment → BiometricUnavailable (no bypass silencioso)", async () => {
    const calls = mockModule({ isEnrolledAsync: async () => false });
    await expect(requireUnlock("test")).rejects.toBeInstanceOf(BiometricUnavailable);
    expect(calls).toHaveLength(0); // ni siquiera se llamó al SO
    expect(isUnlocked()).toBe(false);
  });
});

describe("ensureUnlocked / lockNow", () => {
  it("dentro del timeout no vuelve a pedir autenticación", async () => {
    const calls = mockModule();
    await ensureUnlocked("a");
    await ensureUnlocked("b");
    expect(calls).toEqual(["authenticate"]); // solo una vez
  });

  it("lockNow() fuerza re-autenticación", async () => {
    const calls = mockModule();
    await ensureUnlocked("a");
    lockNow();
    expect(isUnlocked()).toBe(false);
    await ensureUnlocked("b");
    expect(calls).toEqual(["authenticate", "authenticate"]);
  });

  it("timeout expirado → vuelve a pedir", async () => {
    const calls = mockModule();
    setLastUnlockAtForTest(Date.now() - 10 * 60 * 1000);
    expect(isUnlocked()).toBe(false);
    await ensureUnlocked("a");
    expect(calls).toEqual(["authenticate"]);
  });
});
