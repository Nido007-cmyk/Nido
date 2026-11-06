// Medidor de ritmo por cámara (0.1.76): con señales sintéticas como las
// que manda el módulo nativo (desplazamiento por fotograma a ~30 fps).
import { describe, expect, it } from "vitest";
import { estimateRate, INITIAL_CUE_STATE, nextCue, verdictFor, type MotionSample, type Verdict } from "./rateEstimator";

/** PRNG fijo: las pruebas no dependen de la suerte. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function synth(opts: { bpm: number; seconds: number; amp?: number; noise?: number; axis?: "dy" | "dx"; fps?: number; seed?: number; jitterMs?: number }): MotionSample[] {
  const r = rng(opts.seed ?? 7);
  const fps = opts.fps ?? 30;
  const amp = opts.amp ?? 3;
  const out: MotionSample[] = [];
  let prev = 0;
  let t = 1000;
  for (let i = 0; i < opts.seconds * fps; i++) {
    t += 1000 / fps + ((r() - 0.5) * 2 * (opts.jitterMs ?? 4));
    const pos = amp * Math.sin((2 * Math.PI * opts.bpm * t) / 60000);
    const d = pos - prev + (r() - 0.5) * 2 * (opts.noise ?? 0.3);
    prev = pos;
    const other = (r() - 0.5) * 2 * (opts.noise ?? 0.3);
    out.push({ t, dy: opts.axis === "dx" ? other : d, dx: opts.axis === "dx" ? d : other, e: 1 });
  }
  return out;
}

describe("estimateRate", () => {
  for (const bpm of [70, 90, 100, 110, 120, 135, 160]) {
    it(`${bpm} por minuto → ${bpm} ± 3`, () => {
      const est = estimateRate(synth({ bpm, seconds: 6 }));
      expect(est).not.toBeNull();
      expect(Math.abs(est!.bpm - bpm)).toBeLessThanOrEqual(3);
      expect(est!.confidence).toBeGreaterThanOrEqual(0.6);
    });
  }
  it("el otro eje del sensor (teléfono girado) también", () => {
    const est = estimateRate(synth({ bpm: 105, seconds: 6, axis: "dx" }));
    expect(est?.axis).toBe("dx");
    expect(Math.abs(est!.bpm - 105)).toBeLessThanOrEqual(3);
  });
  it("con fotogramas irregulares (15 a 30 fps) sigue", () => {
    const est = estimateRate(synth({ bpm: 110, seconds: 6, fps: 18, jitterMs: 12 }));
    expect(Math.abs(est!.bpm - 110)).toBeLessThanOrEqual(4);
  });
  it("par: solo ruido, o una persona quieta → no dice nada", () => {
    expect(estimateRate(synth({ bpm: 110, seconds: 6, amp: 0, noise: 0.3 }))).toBeNull();
    expect(estimateRate(synth({ bpm: 110, seconds: 6, amp: 0, noise: 1.5, seed: 3 }))).toBeNull();
  });
  it("par: menos de 4 s de datos → todavía nada", () => {
    expect(estimateRate(synth({ bpm: 110, seconds: 3 }))).toBeNull();
  });
  it("mira solo los últimos 6 s: si el ritmo cambia, lo sigue", () => {
    const slow = synth({ bpm: 85, seconds: 8, seed: 1 });
    const fast = synth({ bpm: 115, seconds: 7, seed: 2 }).map((s) => ({ ...s, t: s.t + 8000 }));
    const est = estimateRate([...slow, ...fast]);
    expect(Math.abs(est!.bpm - 115)).toBeLessThanOrEqual(3);
  });
});

describe("barrido: 100 ritmos entre 80 y 139 por minuto, con ruido", () => {
  const run = (noise: number) => {
    let ok = 0;
    let wrong = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const bpm = 80 + (seed % 60);
      const est = estimateRate(synth({ bpm, seconds: 6, noise, seed }));
      if (!est) continue;
      if (Math.abs(est.bpm - bpm) <= 4) ok++;
      else wrong++;
    }
    return { ok, wrong };
  };
  it("ruido moderado: acierta casi siempre y nunca da un ritmo equivocado", () => {
    const r = run(1.0);
    expect(r.ok).toBeGreaterThanOrEqual(95);
    expect(r.wrong).toBe(0);
  });
  it("ruido fuerte: calla más, pero tampoco se equivoca (antes leía 120 como 60)", () => {
    expect(run(1.5).wrong).toBe(0);
  });
  it("movimiento al azar sin ritmo: nunca inventa uno", () => {
    let said = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const r = rng(seed);
      const out: MotionSample[] = [];
      let v = 0;
      for (let i = 0; i < 180; i++) {
        v = 0.9 * v + (r() - 0.5) * 2;
        out.push({ t: 1000 + i * 33, dy: v, dx: (r() - 0.5) * 2, e: 1 });
      }
      if (estimateRate(out)) said++;
    }
    expect(said).toBe(0);
  });
});

describe("veredicto y cuándo hablar", () => {
  it("la guía: 100 a 120", () => {
    expect(verdictFor(92)).toBe("faster");
    expect(verdictFor(100)).toBe("good");
    expect(verdictFor(120)).toBe("good");
    expect(verdictFor(131)).toBe("slower");
  });
  it("habla cuando el veredicto se repite 3 veces, y no se repite enseguida", () => {
    let st = INITIAL_CUE_STATE;
    const say: Array<Verdict | null> = [];
    const step = (v: Verdict | null, t: number) => {
      const r = nextCue(st, v, t);
      st = r.state;
      say.push(r.cue);
    };
    step("faster", 0);
    step("faster", 500);
    step("faster", 1000); // ahora sí
    step("faster", 1500);
    step("faster", 5000); // menos de 8 s: calla
    step("faster", 9100); // 8 s después: lo repite
    step("good", 9600);
    step("good", 10100);
    step("good", 10600); // cambio: lo dice al momento
    step("good", 20000); // «buen ritmo» no se repite antes de 30 s
    expect(say).toEqual([null, null, "faster", null, null, "faster", null, null, "good", null]);
  });
  it("par: veredictos que bailan no se dicen; sin estimación se olvida", () => {
    let st = INITIAL_CUE_STATE;
    const seq: Array<Verdict | null> = ["faster", "good", "faster", null, "slower", "slower"];
    const out = seq.map((v, i) => {
      const r = nextCue(st, v, i * 500);
      st = r.state;
      return r.cue;
    });
    expect(out.every((c) => c === null)).toBe(true);
  });
});
