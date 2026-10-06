import { describe, it, expect, vi, afterEach } from "vitest";
import {
  isPermissionRequestInFlight,
  isPermissionFlowActive,
  withPermissionRequest,
  PERMISSION_FLOW_GRACE_MS,
  __resetPermissionGuardForTests,
} from "./permissionGuard";

afterEach(() => {
  __resetPermissionGuardForTests();
  vi.restoreAllMocks();
});

describe("permissionGuard (T-permiso-2026-10-06)", () => {
  it("bandera apagada por defecto", () => {
    expect(isPermissionRequestInFlight()).toBe(false);
    expect(isPermissionFlowActive()).toBe(false);
  });

  it("withPermissionRequest activa la bandera durante la ejecución", async () => {
    let seenInside = false;
    await withPermissionRequest(async () => {
      seenInside = isPermissionRequestInFlight();
      expect(isPermissionFlowActive()).toBe(true);
      return 42;
    });
    expect(seenInside).toBe(true);
  });

  it("withPermissionRequest devuelve el valor de fn", async () => {
    await expect(withPermissionRequest(async () => "ok")).resolves.toBe("ok");
  });

  it("withPermissionRequest limpia la bandera aunque fn lance", async () => {
    await expect(
      withPermissionRequest(async () => {
        throw new Error("permiso denegado");
      })
    ).rejects.toThrow("permiso denegado");
    expect(isPermissionRequestInFlight()).toBe(false);
  });

  it("la ventana de gracia cubre la carrera promesa-resuelta vs AppState active", async () => {
    const now = Date.now();
    const spy = vi.spyOn(Date, "now").mockReturnValue(now);
    await withPermissionRequest(async () => true);
    // La promesa ya se resolvió (bandera apagada) pero el flujo sigue activo.
    expect(isPermissionRequestInFlight()).toBe(false);
    expect(isPermissionFlowActive()).toBe(true);
    // Dentro de la ventana de gracia sigue activo.
    spy.mockReturnValue(now + PERMISSION_FLOW_GRACE_MS - 1);
    expect(isPermissionFlowActive()).toBe(true);
    // Fuera de la ventana, el gate vuelve a su comportamiento normal.
    spy.mockReturnValue(now + PERMISSION_FLOW_GRACE_MS + 1);
    expect(isPermissionFlowActive()).toBe(false);
  });

  it("contrato del gate de App.tsx: no re-bloquear durante el flujo de permiso", async () => {
    // Simula el listener de AppState de App.tsx con la guardia aplicada.
    let lockCalls = 0;
    let navigations: string[] = [];
    const screenRef = { current: "chat" };
    const handler = (s: string) => {
      if (isPermissionFlowActive()) return;
      if (s === "background" || s === "inactive") {
        lockCalls++;
      } else if (s === "active" && (screenRef.current === "chat" || screenRef.current === "required-setup")) {
        navigations.push("locked");
      }
    };

    // 1. Sin permiso en curso: el diálogo del sistema SÍ re-bloqueaba (bug).
    handler("inactive");
    expect(lockCalls).toBe(1);

    // 2. Con permiso en curso: pausa transitoria ignorada (fix).
    lockCalls = 0;
    const pending = withPermissionRequest(
      () => new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 50))
    );
    // El diálogo aparece mientras la promesa está pendiente.
    await new Promise((r) => setTimeout(r, 10));
    handler("inactive");
    expect(lockCalls).toBe(0);
    handler("active");
    expect(navigations).toHaveLength(0);
    await pending;
    // Tras resolverse, dentro de la ventana de gracia tampoco re-bloquea.
    handler("active");
    expect(navigations).toHaveLength(0);
  });
});
