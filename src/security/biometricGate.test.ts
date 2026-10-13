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
    mockModule({
      supportedAuthenticationTypesAsync: async () => [],
      isEnrolledAsync: async () => false,
      getEnrolledLevelAsync: async () => 1,
    });
    await expect(getGateStatus()).resolves.toMatchObject({ method: "device-credential" });
  });

  it("no enrolado → none", async () => {
    mockModule({ isEnrolledAsync: async () => false, getEnrolledLevelAsync: async () => 0 });
    await expect(getGateStatus()).resolves.toMatchObject({ method: "none", enrolled: false });
  });

  it("solo PIN, sin hardware biométrico (Tab A9+) → enrolled, device-credential", async () => {
    // Evidencia física v0.1.24: la Tab A9+ no tiene lector de huella; con el
    // PIN recién puesto el gate decía «no tiene biometría ni PIN».
    mockModule({
      hasHardwareAsync: async () => false,
      isEnrolledAsync: async () => false,
      supportedAuthenticationTypesAsync: async () => [],
      getEnrolledLevelAsync: async () => 1, // SECRET: KeyguardManager.isDeviceSecure
    });
    await expect(getGateStatus()).resolves.toEqual({
      hasHardware: false,
      enrolled: true,
      method: "device-credential",
    });
  });

  it("hardware biométrico presente pero sin enrolar, con PIN → device-credential", async () => {
    mockModule({
      hasHardwareAsync: async () => true,
      isEnrolledAsync: async () => false,
      getEnrolledLevelAsync: async () => 1,
    });
    await expect(getGateStatus()).resolves.toMatchObject({
      enrolled: true,
      method: "device-credential",
    });
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
    const calls = mockModule({
      isEnrolledAsync: async () => false,
      getEnrolledLevelAsync: async () => 0,
    });
    await expect(requireUnlock("test")).rejects.toBeInstanceOf(BiometricUnavailable);
    expect(calls).toHaveLength(0); // ni siquiera se llamó al SO
    expect(isUnlocked()).toBe(false);
  });

  it("solo PIN (sin hardware biométrico) → pide autenticación al SO y desbloquea", async () => {
    const calls = mockModule({
      hasHardwareAsync: async () => false,
      isEnrolledAsync: async () => false,
      supportedAuthenticationTypesAsync: async () => [],
      getEnrolledLevelAsync: async () => 1,
    });
    await requireUnlock("test");
    expect(calls).toEqual(["authenticate"]); // el SO muestra su prompt con fallback a PIN
    expect(isUnlocked()).toBe(true);
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

describe("unlockForSecret (0.1.29, B-2: una sola política para la clave)", () => {
  it("desbloqueo correcto → unlocked", async () => {
    mockModule();
    const { unlockForSecret } = await import("./biometricGate");
    await expect(unlockForSecret("x")).resolves.toBe("unlocked");
  });

  it("teléfono sin biometría ni PIN → no-lock (la pantalla avisa y continúa)", async () => {
    mockModule({ hasHardwareAsync: async () => false, isEnrolledAsync: async () => false, getEnrolledLevelAsync: async () => 0 });
    const { unlockForSecret } = await import("./biometricGate");
    await expect(unlockForSecret("x")).resolves.toBe("no-lock");
  });

  it("solo PIN → pide el PIN (unlocked), no se salta la puerta", async () => {
    const calls = mockModule({ hasHardwareAsync: async () => false, isEnrolledAsync: async () => false, getEnrolledLevelAsync: async () => 1 });
    const { unlockForSecret } = await import("./biometricGate");
    await expect(unlockForSecret("x")).resolves.toBe("unlocked");
    expect(calls).toEqual(["authenticate"]);
  });

  it("cancelado o fallido → lanza (no se muestra nada)", async () => {
    const { unlockForSecret } = await import("./biometricGate");
    mockModule({ authenticateAsync: async () => ({ success: false, error: "user_cancel" }) });
    await expect(unlockForSecret("x")).rejects.toBeInstanceOf(BiometricCancelled);
    mockModule({ authenticateAsync: async () => ({ success: false, error: "lockout" }) });
    await expect(unlockForSecret("x")).rejects.toBeInstanceOf(BiometricFailed);
  });
});
