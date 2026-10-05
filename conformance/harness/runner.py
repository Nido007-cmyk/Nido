#!/usr/bin/env python3
"""Differential harness for the NIDO protocol conformance suite.

Runs an external implementation (IUT) against the official vectors using the
NDJSON-over-stdio protocol documented in README.md, and diffs each normalized
result against the vector's `expected`.

Usage:
    python3 runner.py --impl ./my-iut [--vectors ../vectors/v0/final] [--only canonicalization]
"""
import argparse
import json
import os
import subprocess
import sys

SKIP = {"manifest.json", "state_machines_tables.json"}


def load_vectors(vectors_dir):
    files = sorted(f for f in os.listdir(vectors_dir) if f.endswith(".json") and f not in SKIP)
    vectors = []
    for f in files:
        with open(os.path.join(vectors_dir, f), encoding="utf-8") as fh:
            data = json.load(fh)
        vectors.extend(data["vectors"])
    return vectors


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--impl", required=True, help="command to start the implementation under test")
    ap.add_argument("--vectors", default=os.path.join(os.path.dirname(__file__), "..", "vectors", "v0", "final"))
    ap.add_argument("--only", default=None, help="only run vectors of this kind")
    args = ap.parse_args()

    vectors = load_vectors(args.vectors)
    if args.only:
        vectors = [v for v in vectors if v["kind"] == args.only]
    print(f"loaded {len(vectors)} vectors", file=sys.stderr)

    proc = subprocess.Popen(
        args.impl, shell=True, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
        stderr=sys.stderr, text=True, bufsize=1,
    )
    assert proc.stdin and proc.stdout

    passed, failed = 0, 0
    failures = []
    results = []
    for v in vectors:
        proc.stdin.write(json.dumps(v, ensure_ascii=False) + "\n")
        proc.stdin.flush()
        line = proc.stdout.readline()
        if not line:
            print(f"IUT closed stdout at vector {v['id']}", file=sys.stderr)
            sys.exit(2)
        try:
            resp = json.loads(line)
        except json.JSONDecodeError:
            print(f"IUT wrote invalid JSON at vector {v['id']}: {line[:200]}", file=sys.stderr)
            sys.exit(2)
        if resp.get("id") != v["id"]:
            print(f"IUT id mismatch: got {resp.get('id')!r}, want {v['id']!r}", file=sys.stderr)
            sys.exit(2)
        got = resp.get("result")
        results.append({"id": v["id"], "result": got})
        if got == v["expected"]:
            passed += 1
        else:
            failed += 1
            failures.append({"id": v["id"], "kind": v["kind"], "expected": v["expected"], "got": got})

    proc.stdin.close()
    proc.wait()

    out_path = os.path.join(os.path.dirname(__file__), "differential-results.json")
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump({"impl": args.impl, "passed": passed, "failed": failed, "failures": failures}, fh, indent=2)
    print(f"passed={passed} failed={failed} (details: {out_path})")
    for f in failures[:20]:
        print(f"  FAIL {f['id']} [{f['kind']}]")
        print(f"    expected: {json.dumps(f['expected'], ensure_ascii=False)[:160]}")
        print(f"    got:      {json.dumps(f['got'], ensure_ascii=False)[:160]}")
    sys.exit(0 if failed == 0 else 1)


if __name__ == "__main__":
    main()
