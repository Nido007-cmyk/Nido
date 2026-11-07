// 0.1.79: «Permitir capturas de pantalla» — apagado por defecto, y los secretos siempre protegidos.
import { describe, expect, it } from "vitest";
import { createScreenCaptureController, windowShouldBeSecure } from "./screenCapture";

function fakeBackend(result: "ok" | "unavailable" = "ok") {
  const calls: boolean[] = [];
  return {
    calls,
    backend: async (secure: boolean) => {
      calls.push(secure);
      return result === "ok" ? secure : null;
    },
  };
}

describe("capturas de pantalla", () => {
  it("regla: protegida salvo que esté permitido y no haya secretos a la vista", () => {
    expect(windowShouldBeSecure(false, 0)).toBe(true);
    expect(windowShouldBeSecure(true, 0)).toBe(false);
    expect(windowShouldBeSecure(true, 1)).toBe(true);
  });

  it("por defecto no toca nada: la ventana nace protegida", async () => {
    const f = fakeBackend();
    const c = createScreenCaptureController(f.backend);
    await c.setAllowed(false);
    expect(f.calls).toEqual([]);
    expect(c.applied()).toBe(true);
  });

  it("permitido: se quita; una pantalla con secretos la protege mientras está a la vista", async () => {
    const f = fakeBackend();
    const c = createScreenCaptureController(f.backend);
    await c.setAllowed(true);
    expect(c.applied()).toBe(false);
    const release = c.hold();
    await c.settled();
    expect(c.applied()).toBe(true);
    release();
    release(); // soltar dos veces no descuenta dos
    await c.settled();
    expect(c.applied()).toBe(false);
    expect(f.calls).toEqual([false, true, false]);
  });

  it("dos pantallas con secretos: hasta soltar la última sigue protegida", async () => {
    const f = fakeBackend();
    const c = createScreenCaptureController(f.backend);
    await c.setAllowed(true);
    const a = c.hold();
    const b = c.hold();
    a();
    await c.settled();
    expect(c.applied()).toBe(true);
    b();
    await c.settled();
    expect(c.applied()).toBe(false);
  });

  it("apagar otra vez (o borrar todo) vuelve a protegerla", async () => {
    const f = fakeBackend();
    const c = createScreenCaptureController(f.backend);
    await c.setAllowed(true);
    await c.setAllowed(false);
    expect(c.applied()).toBe(true);
  });

  it("sin módulo nativo: se da por protegida y se reintenta después", async () => {
    const f = fakeBackend("unavailable");
    const c = createScreenCaptureController(f.backend);
    await c.setAllowed(true);
    expect(c.applied()).toBe(true);
    await c.setAllowed(true);
    expect(f.calls).toEqual([false, false]);
  });
});
