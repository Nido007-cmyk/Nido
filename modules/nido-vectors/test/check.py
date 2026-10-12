#!/usr/bin/env python3
# MIT License
# Copyright (c) 2026 NIDO contributors
# See LICENSE file for details.
"""Generates data for Harness.kt and checks its results against numpy (the
same cosine as cosineSimilarityInt8 in src/rag/pure.ts)."""
import json, struct, sys
import numpy as np

mode, d = sys.argv[1], sys.argv[2]
DIMS, FLOOR, LIMIT, N, NQ = 384, 0.05, 12, 5000, 40
rng = np.random.default_rng(7)
if mode == "gen":
    V = rng.integers(-127, 128, size=(N, DIMS), dtype=np.int16).astype(np.int8)
    V[17] = 0  # zero vector: score 0
    ids = rng.permutation(10 * N)[:N].astype(np.int64) + 1
    with open(f"{d}/rows.bin", "wb") as f:
        for i in range(N):
            f.write(struct.pack("<q", int(ids[i])) + V[i].tobytes())
    Q = rng.normal(size=(NQ, DIMS))
    Q[:5] = V[100:105].astype(np.float64) * 0.01 + rng.normal(scale=0.001, size=(5, DIMS))  # near-duplicates
    Q[5] = 0  # zero query
    with open(f"{d}/queries.bin", "wb") as f:
        f.write(Q.astype("<f8").tobytes())
    np.save(f"{d}/V.npy", V); np.save(f"{d}/ids.npy", ids); np.save(f"{d}/Q.npy", Q)
    sys.exit(0)

V, ids, Q = np.load(f"{d}/V.npy"), np.load(f"{d}/ids.npy"), np.load(f"{d}/Q.npy")
# Index file format
raw = open(f"{d}/test.nvi", "rb").read()
assert raw[:4] == b"NVI1", raw[:4]
dims, n = struct.unpack("<ii", raw[4:12])
assert (dims, n) == (DIMS, N)
assert len(raw) == 12 + 8 * N + N * DIMS
assert np.array_equal(np.frombuffer(raw[12:12 + 4 * N], "<i4"), ids.astype(np.int32))
assert np.array_equal(np.frombuffer(raw[12 + 8 * N:], np.int8).reshape(N, DIMS), V)

Vf = V.astype(np.float64)
norms = np.linalg.norm(Vf, axis=1)
bad = 0
for qi, line in enumerate(open(f"{d}/results.jsonl")):
    r = json.loads(line)
    q = Q[qi]
    qn = np.linalg.norm(q)
    s = np.where((norms > 0) & (qn > 0), (Vf @ q) / (np.where(norms > 0, norms, 1) * (qn if qn > 0 else 1)), 0.0)
    passed = s >= FLOOR - 1e-6
    exp_count = int(np.sum(s >= FLOOR))
    order = np.argsort(-s, kind="stable")
    exp = [i for i in order if s[i] >= FLOOR][:LIMIT]
    ok = abs(r["gatedCount"] - exp_count) <= 1  # float32 vs float64 at the floor
    ok &= len(r["ids"]) == len(exp)
    # scores match the reference for the same ids
    id_to_i = {int(ids[i]): i for i in range(N)}
    for rid, rs in zip(r["ids"], r["scores"]):
        ok &= abs(s[id_to_i[rid]] - rs) < 1e-4
    # best-first, and the set equals the reference top (ties aside)
    ok &= all(r["scores"][k] >= r["scores"][k + 1] for k in range(len(r["scores"]) - 1))
    if exp:
        ok &= abs(r["scores"][0] - s[exp[0]]) < 1e-4
        ok &= abs(r["scores"][-1] - s[exp[-1]]) < 1e-4
        ok &= r["gatedMin"] is not None and abs(r["gatedMin"] - s[passed].min()) < 1e-4
    else:
        ok &= r["gatedMin"] is None
    if qi < 5:  # near-duplicate of V[100+qi] must come first
        ok &= r["ids"][0] == int(ids[100 + qi])
    if qi == 5:  # zero query: every score 0 → none passes a positive floor
        ok &= r["gatedCount"] == 0 and r["ids"] == []
    if not ok:
        bad += 1
        print("MISMATCH", qi, r["ids"][:5], [int(ids[i]) for i in exp[:5]], r["gatedCount"], exp_count)
print(f"checked {qi + 1} queries, {bad} mismatches")
sys.exit(1 if bad else 0)
