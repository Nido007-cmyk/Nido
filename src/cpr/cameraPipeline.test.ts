// Medidor de ritmo por cámara (0.1.76), de punta a punta: vídeo sintético
// → análisis por fotograma (frameMotion, el mismo algoritmo que el núcleo
// de Kotlin) → estimación → ritmo que se enseña. Escenas con lo que los
// estudios con cámara de móvil señalan como difícil, y escenas sin
// compresiones donde debe callar.
import { describe, expect, it } from "vitest";
import { analyseFrame, BLOCKS, type MotionState } from "./frameMotion";
import { estimateRate, INITIAL_RATE_TRACK, trackRate, type MotionSample } from "./rateEstimator";
import { renderScene, type Scene } from "./syntheticCpr";

/** Lo que haría la pantalla: una estimación cada 0,5 s, con el seguimiento. */
function run(sc: Scene): Array<{ tSec: number; shown: number | null }> {
  let st: MotionState | null = null;
  const samples: MotionSample[] = [];
  const out: Array<{ tSec: number; shown: number | null }> = [];
  let tr = INITIAL_RATE_TRACK;
  let last = 0;
  for (const { tMs, frame } of renderScene(sc)) {
    const r = analyseFrame(frame, st);
    st = r.state;
    if (r.out) {
      const ch: number[] = [];
      for (let b = 0; b < BLOCKS; b++) ch.push(r.out[b * 3], r.out[b * 3 + 1]);
      samples.push({ t: tMs, ch });
    }
    if (tMs - last >= 500) {
      last = tMs;
      const k = trackRate(tr, estimateRate(samples.filter((s) => s.t >= tMs - 7000)), tMs);
      tr = k.state;
      out.push({ tSec: (tMs - 1000) / 1000, shown: k.shown });
    }
  }
  return out;
}

/** Desde el segundo 5 (la ventana ya está llena): todas miden y dentro de ±tol. */
function expectTracks(sc: Scene, bpm: number, tol: number) {
  const late = run(sc).filter((e) => e.tSec >= 5);
  expect(late.length).toBeGreaterThan(5);
  for (const e of late) {
    expect(e.shown).not.toBeNull();
    expect(Math.abs((e.shown as number) - bpm)).toBeLessThanOrEqual(tol);
  }
}

function expectSilent(sc: Scene) {
  for (const e of run(sc)) expect(e.shown).toBeNull();
}

const T = 30_000;

describe("mide el ritmo en escenas realistas", () => {
  it("90, 110 y 130 por minuto, quien comprime ocupa el 40 % de la imagen", { timeout: T }, () => {
    expectTracks({ seconds: 9, bpm: 90, seed: 2 }, 90, 3);
    expectTracks({ seconds: 9, bpm: 110, seed: 1 }, 110, 3);
    expectTracks({ seconds: 9, bpm: 130, seed: 3 }, 130, 3);
  });
  it("quien comprime ocupa solo el 20 % y se mueve 3 px", { timeout: T }, () => {
    expectTracks({ seconds: 9, bpm: 110, personSize: 0.2, amplitudePx: 3, seed: 4 }, 110, 4);
  });
  it("ruido del sensor, parpadeo de la luz y temblor de la cámara", { timeout: T }, () => {
    expectTracks({ seconds: 9, bpm: 105, sensorNoise: 8, flicker: 0.05, shakePx: 1.5, seed: 6 }, 105, 4);
  });
  it("pelo suelto y otra persona moviéndose al fondo", { timeout: T }, () => {
    expectTracks({ seconds: 9, bpm: 110, hair: true, bystander: true, seed: 9 }, 110, 4);
  });
  it("teléfono apaisado: el movimiento cae en el otro eje", { timeout: T }, () => {
    expectTracks({ seconds: 9, bpm: 110, horizontal: true, seed: 10 }, 110, 3);
  });
  it("todo junto (20–25 % de la imagen, 3 px, ruido, luz, temblor, pelo, otra persona)", { timeout: 60_000 }, () => {
    for (const [bpm, seed] of [[95, 21], [110, 22], [125, 21]]) {
      expectTracks(
        { seconds: 9, bpm, personSize: 0.25, amplitudePx: 3, sensorNoise: 8, flicker: 0.05, shakePx: 1, hair: true, bystander: true, seed },
        bpm,
        5
      );
    }
  });
  it("teléfono en el suelo, pantalla arriba: quien comprime se acerca y se aleja (crece y encoge)", { timeout: T }, () => {
    expectTracks({ seconds: 9, bpm: 100, towardCamera: 0.02, personSize: 0.5, seed: 40 }, 100, 3);
    expectTracks({ seconds: 9, bpm: 110, towardCamera: 0.02, personSize: 0.5, sensorNoise: 8, flicker: 0.05, shakePx: 1, hair: true, seed: 41 }, 110, 4);
  });
  it("si el ritmo cambia de 90 a 120, lo sigue en menos de 6 s", { timeout: T }, () => {
    const res = run({ seconds: 15, bpm: (t) => (t < 7 ? 90 : 120), seed: 12 });
    const after = res.filter((e) => e.tSec >= 13);
    for (const e of after) expect(Math.abs((e.shown as number) - 120)).toBeLessThanOrEqual(4);
  });
});

describe("par: sin compresiones calla", () => {
  it("escena quieta, alguien que se mueve sin ritmo, otra persona al fondo", { timeout: 60_000 }, () => {
    expectSilent({ seconds: 9, bpm: 0, seed: 13 });
    expectSilent({ seconds: 9, bpm: 0, fidget: true, seed: 14 });
    expectSilent({ seconds: 9, bpm: 0, bystander: true, seed: 15 });
    expectSilent({ seconds: 9, bpm: 0, towardCamera: 0.02, personSize: 0.5, fidget: true, seed: 42 });
    expectSilent({ seconds: 9, bpm: 0, personSize: 0.25, sensorNoise: 8, flicker: 0.05, shakePx: 1, hair: true, bystander: true, fidget: true, seed: 32 });
  });
});
