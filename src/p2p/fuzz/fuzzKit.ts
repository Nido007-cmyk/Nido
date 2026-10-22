/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * fuzzKit.ts — utilidades de fuzzing por mutación (SOLO TESTS).
 *
 * Generador determinista (xorshift128+) a partir de una semilla, para que
 * cualquier fallo se reproduzca con la misma semilla. Los mutadores son los
 * clásicos de los fuzzers por mutación (AFL/libFuzzer): voltear bits,
 * cambiar bytes por valores "interesantes", insertar, borrar, truncar,
 * duplicar trozos y empalmar con otra entrada del corpus.
 *
 * No es fuzzing guiado por cobertura (como cargo-fuzz en Signal): es fuzzing
 * aleatorio con mutaciones sobre entradas válidas, que en CI corre unos
 * cientos de casos por objetivo y en el job semanal cientos de miles.
 */

export const FUZZ_ITERATIONS = (() => {
  const raw = typeof process !== "undefined" ? process.env?.FUZZ_ITERATIONS : undefined;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 300;
})();

export const FUZZ_SEED = (() => {
  const raw = typeof process !== "undefined" ? process.env?.FUZZ_SEED : undefined;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? Math.floor(n) : 0x5eed_1d0;
})();

export class Rng {
  private s0: number;
  private s1: number;
  constructor(seed: number) {
    this.s0 = (seed ^ 0x9e3779b9) >>> 0 || 1;
    this.s1 = (seed * 0x85ebca6b) >>> 0 || 2;
  }
  /** Entero de 32 bits sin signo. */
  u32(): number {
    let x = this.s0;
    const y = this.s1;
    this.s0 = y;
    x ^= x << 23;
    x ^= x >>> 17;
    x ^= y ^ (y >>> 26);
    this.s1 = x >>> 0;
    return (this.s0 + this.s1) >>> 0;
  }
  /** Entero en [0, n). */
  int(n: number): number {
    return n <= 0 ? 0 : this.u32() % n;
  }
  bytes(n: number): Uint8Array {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = this.u32() & 0xff;
    return out;
  }
  pick<T>(xs: readonly T[]): T {
    return xs[this.int(xs.length)];
  }
}

const INTERESTING = [0x00, 0x01, 0x05, 0x7f, 0x80, 0xff, 0x20, 0x22, 0x7b, 0x7d, 0x5b, 0x5d, 0x3a, 0x2c];

/** Aplica de 1 a 4 mutaciones al azar. Nunca devuelve el mismo objeto. */
export function mutate(rng: Rng, input: Uint8Array, corpus: readonly Uint8Array[] = []): Uint8Array {
  let b = input.slice();
  const rounds = 1 + rng.int(4);
  for (let r = 0; r < rounds; r++) {
    const op = rng.int(8);
    if (b.length === 0 && op !== 3) {
      b = rng.bytes(1 + rng.int(8));
      continue;
    }
    switch (op) {
      case 0: {
        const i = rng.int(b.length);
        b[i] ^= 1 << rng.int(8);
        break;
      }
      case 1: {
        b[rng.int(b.length)] = rng.pick(INTERESTING);
        break;
      }
      case 2: {
        b[rng.int(b.length)] = rng.u32() & 0xff;
        break;
      }
      case 3: {
        const at = rng.int(b.length + 1);
        const ins = rng.bytes(1 + rng.int(16));
        const out = new Uint8Array(b.length + ins.length);
        out.set(b.subarray(0, at), 0);
        out.set(ins, at);
        out.set(b.subarray(at), at + ins.length);
        b = out;
        break;
      }
      case 4: {
        const at = rng.int(b.length);
        const len = 1 + rng.int(Math.min(32, b.length - at));
        const out = new Uint8Array(b.length - len);
        out.set(b.subarray(0, at), 0);
        out.set(b.subarray(at + len), at);
        b = out;
        break;
      }
      case 5: {
        b = b.slice(0, rng.int(b.length));
        break;
      }
      case 6: {
        const at = rng.int(b.length);
        const len = 1 + rng.int(Math.min(64, b.length - at));
        const chunk = b.slice(at, at + len);
        const to = rng.int(b.length + 1);
        const out = new Uint8Array(b.length + chunk.length);
        out.set(b.subarray(0, to), 0);
        out.set(chunk, to);
        out.set(b.subarray(to), to + chunk.length);
        b = out;
        break;
      }
      default: {
        if (corpus.length === 0) {
          b[rng.int(b.length)] ^= 0xff;
          break;
        }
        const other = rng.pick(corpus);
        const cut = rng.int(b.length + 1);
        const cut2 = rng.int(other.length + 1);
        const out = new Uint8Array(cut + (other.length - cut2));
        out.set(b.subarray(0, cut), 0);
        out.set(other.subarray(cut2), cut);
        b = out;
      }
    }
  }
  return b;
}

/** Valor JSON aleatorio (para validadores que reciben `unknown`). */
export function randomJson(rng: Rng, depth = 0): unknown {
  const k = rng.int(depth > 3 ? 6 : 9);
  switch (k) {
    case 0:
      return null;
    case 1:
      return rng.int(2) === 0;
    case 2:
      return rng.pick([0, -1, 1, 2 ** 53, -(2 ** 53), 1.5, NaN, Infinity, 1e308, rng.u32()]);
    case 3:
      return rng.pick(["", "a", "x".repeat(5000), "\u0000", "\ud800", "TASK_REQUEST", "00".repeat(32)]);
    case 4:
      return String.fromCharCode(...rng.bytes(rng.int(40)));
    case 5:
      return undefined;
    case 6: {
      const arr: unknown[] = [];
      for (let i = rng.int(5); i > 0; i--) arr.push(randomJson(rng, depth + 1));
      return arr;
    }
    default: {
      const o: Record<string, unknown> = {};
      const keys = ["id", "t", "v", "type", "taskId", "scope", "body", "text", "pk", "sig", "ts", "expiresAt", "__proto__", "constructor"];
      for (let i = rng.int(6); i > 0; i--) o[rng.pick(keys)] = randomJson(rng, depth + 1);
      return o;
    }
  }
}

/** Ejecuta `fn` y exige que termine sin lanzar algo que no sea Error. */
export function expectOnlyErrors(fn: () => unknown): { threw: boolean; value?: unknown } {
  try {
    return { threw: false, value: fn() };
  } catch (e) {
    if (!(e instanceof Error)) throw new Error(`Se lanzó un no-Error: ${String(e)}`);
    if (e instanceof TypeError || e instanceof RangeError) {
      throw new Error(`Excepción cruda (${e.constructor.name}): ${e.message}`);
    }
    return { threw: true };
  }
}
