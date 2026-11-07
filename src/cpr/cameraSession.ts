/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * Práctica de RCP — el ciclo de vida de la cámara del medidor, sin React.
 *
 * Encender la cámara es asíncrono (Camera2 tarda en abrir). Si mientras
 * tanto se para la práctica o NIDO pasa a segundo plano, el encendido que
 * llega tarde NO debe quedarse con la cámara abierta sin que nadie la vea:
 * cada apagado sube la «generación», y un encendido de una generación
 * vieja se cierra en cuanto llega.
 */

export type CameraState = "off" | "starting" | "on" | "failed" | "paused";

export interface CameraBackend {
  /** Abre la cámara; resuelve con la función que la cierra, o null si no se pudo. */
  open(onError: () => void): Promise<(() => void) | null>;
}

export interface CameraSession {
  start(): void;
  /** Apaga (o cancela un encendido en curso). `paused`: se apagó por salir de la vista. */
  stop(paused?: boolean): void;
  state(): CameraState;
}

export function createCameraSession(backend: CameraBackend, onState: (s: CameraState) => void): CameraSession {
  let gen = 0;
  let close: (() => void) | null = null;
  let current: CameraState = "off";
  const set = (s: CameraState) => {
    current = s;
    onState(s);
  };

  return {
    start() {
      const mine = ++gen;
      close?.();
      close = null;
      set("starting");
      let opened: Promise<(() => void) | null>;
      try {
        opened = backend.open(() => {
          if (mine !== gen) return;
          close?.();
          close = null;
          set("failed");
        });
      } catch {
        set("failed");
        return;
      }
      void opened.then(
        (closeFn) => {
          if (mine !== gen) {
            // Se apagó mientras se encendía: cerrarla ya.
            closeFn?.();
            return;
          }
          if (!closeFn) {
            set("failed");
            return;
          }
          close = closeFn;
          set("on");
        },
        () => {
          if (mine === gen) set("failed");
        },
      );
    },
    stop(paused = false) {
      gen++;
      close?.();
      close = null;
      set(paused ? "paused" : "off");
    },
    state: () => current,
  };
}
