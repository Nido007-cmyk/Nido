// Práctica de RCP: la cámara del medidor nunca queda abierta sin verse.
import { describe, expect, it } from "vitest";
import { createCameraSession, type CameraBackend, type CameraState } from "./cameraSession";

function fakeBackend() {
  const log: string[] = [];
  const pending: Array<(v: (() => void) | null) => void> = [];
  let onError: (() => void) | null = null;
  const backend: CameraBackend = {
    open(err) {
      log.push("open");
      onError = err;
      return new Promise((resolve) => pending.push(resolve));
    },
  };
  const finishOpen = (ok = true) => pending.shift()?.(ok ? () => log.push("close") : null);
  return { backend, log, finishOpen, fail: () => onError?.() };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("cámara del medidor", () => {
  it("se enciende, y al parar se cierra", async () => {
    const f = fakeBackend();
    const states: CameraState[] = [];
    const s = createCameraSession(f.backend, (x) => states.push(x));
    s.start();
    f.finishOpen();
    await tick();
    expect(s.state()).toBe("on");
    s.stop();
    expect(f.log).toEqual(["open", "close"]);
    expect(states).toEqual(["starting", "on", "off"]);
  });

  it("par: parar mientras se enciende la cierra en cuanto llega", async () => {
    const f = fakeBackend();
    const s = createCameraSession(f.backend, () => {});
    s.start();
    s.stop();
    f.finishOpen();
    await tick();
    expect(f.log).toEqual(["open", "close"]);
    expect(s.state()).toBe("off");
  });

  it("segundo plano: queda en pausa; al volver se enciende otra vez", async () => {
    const f = fakeBackend();
    const s = createCameraSession(f.backend, () => {});
    s.start();
    f.finishOpen();
    await tick();
    s.stop(true);
    expect(s.state()).toBe("paused");
    s.start();
    f.finishOpen();
    await tick();
    expect(s.state()).toBe("on");
    expect(f.log).toEqual(["open", "close", "open"]);
  });

  it("par: ir y volver muy rápido no deja dos cámaras abiertas", async () => {
    const f = fakeBackend();
    const s = createCameraSession(f.backend, () => {});
    s.start();
    s.stop(true);
    s.start();
    f.finishOpen(); // la vieja llega: se cierra
    f.finishOpen(); // la nueva llega: se queda
    await tick();
    expect(f.log).toEqual(["open", "open", "close"]);
    expect(s.state()).toBe("on");
    s.stop();
    expect(f.log).toEqual(["open", "open", "close", "close"]);
  });

  it("no se pudo abrir, o falló después: «failed»; un error viejo no cambia nada", async () => {
    const f = fakeBackend();
    const s = createCameraSession(f.backend, () => {});
    s.start();
    f.finishOpen(false);
    await tick();
    expect(s.state()).toBe("failed");
    s.start();
    f.finishOpen();
    await tick();
    f.fail();
    expect(s.state()).toBe("failed");
    expect(f.log).toEqual(["open", "open", "close"]);
  });
});
