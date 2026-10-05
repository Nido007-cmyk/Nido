#!/usr/bin/env python3
"""Deterministic f64 corpus generator for the Rust/JS number-format differential.

Writes one u64 bit pattern per line (16 lowercase hex chars) to
float_corpus.txt. The generator is seeded and dependency-free so the corpus
is reproducible forever; the file itself is checked in and is the ground
truth (regeneration must produce byte-identical output).

Coverage:
  - hand-picked edge cases (zeros, infinities excluded -- non-finite is
    rejected by the strict parser; subnormals, powers of 10, 2^53
    boundaries, shortest-round-trip stress values),
  - 20_000 pseudo-random bit patterns from a fixed-seed xorshift64*,
    biased to also hit exponent extremes.
"""
import sys

OUT = "float_corpus.txt"
N_RANDOM = 20_000
SEED = 0x9E3779B97F4A7C15


def xorshift64star(state):
    while True:
        state ^= (state >> 12) & 0xFFFFFFFFFFFFFFFF
        state ^= (state << 25) & 0xFFFFFFFFFFFFFFFF
        state ^= (state >> 27) & 0xFFFFFFFFFFFFFFFF
        state = (state * 0x2545F4914F6CDD1D) & 0xFFFFFFFFFFFFFFFF
        yield state


def main():
    edges = [
        0x0000000000000000,  # +0
        0x8000000000000000,  # -0
        0x0000000000000001,  # smallest subnormal
        0x000FFFFFFFFFFFFF,  # largest subnormal
        0x0010000000000000,  # smallest normal
        0x7FEFFFFFFFFFFFFF,  # largest finite
        0x3FF0000000000000,  # 1.0
        0xBFF0000000000000,  # -1.0
        0x4340000000000000,  # 2^53
        0x4330000000000000,  # 2^52
        0x4320000000000000,  # 2^51
        0x4340000000000001,  # 2^53+2
        0x3FF5555555555555,  # 1.333...
        0x3FD5555555555555,  # 0.333...
        0x3FF199999999999A,  # 1.1
        0x400921FB54442D18,  # pi
        0x4005BF0A8B145769,  # e
        0x3EB0C6F7A0B5ED8D,  # 1e-7 boundary region
        0x3E7AD7F29ABCAF48,  # 1e-6
        0x3F1A36E2EB1C432D,  # 1e-5
        0x3FB999999999999A,  # 0.1
        0x3FF0000000000001,  # 1 + eps
        0x3FEFFFFFFFFFFFFF,  # 1 - eps/2
        0x412E848000000000,  # 1e6
        0x42F0000000000000,  # 1e15 (near 2^50)
        0x46293E5939A08CEA,  # 1e21-ish
        0x44B52D02C7E14AF5,  # 1e30-ish
        0x7E43400000000000,  # 1e308-ish
        0x0000000000000002,
        0x8000000000000001,  # smallest negative subnormal
        0xFFF0000000000000,  # placeholder, replaced below
    ]
    # replace the accidental infinity placeholder with a large finite value
    edges[-1] = 0x7FDFFFFFFFFFFFFF

    seen = set()
    ordered = []
    for b in edges:
        if b not in seen:
            seen.add(b)
            ordered.append(b)

    rng = xorshift64star(SEED)
    # bias classes: mix raw random with exponent-forced patterns
    for i in range(N_RANDOM):
        r = next(rng)
        mode = i % 8
        if mode == 0:
            # force tiny exponents (subnormal/near-subnormal region)
            b = (r & 0x800FFFFFFFFFFFFF) | ((next(rng) % 0x20) << 52)
        elif mode == 1:
            # force exponents around the 1e21 / 1e-7 formatting boundaries
            b = (r & 0x800FFFFFFFFFFFFF) | ((0x3E0 + (next(rng) % 0x90)) << 52)
        elif mode == 2:
            # integer-valued magnitudes near 2^53
            b = (0x432 + (next(rng) % 5)) << 52 | (r & 0xFFFFFFFFFFFFF)
        else:
            b = r
        # skip non-finite (inf/NaN): the strict parser rejects them; the
        # differential only covers finite values
        if (b & 0x7FF0000000000000) == 0x7FF0000000000000:
            continue
        if b not in seen:
            seen.add(b)
            ordered.append(b)

    with open(OUT, "w") as f:
        for b in ordered:
            f.write("%016x\n" % b)
    print(f"wrote {len(ordered)} patterns to {OUT}")


if __name__ == "__main__":
    sys.exit(main())
