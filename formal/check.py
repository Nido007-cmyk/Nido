#!/usr/bin/env python3
# MIT License
# Copyright (c) 2026 NIDO contributors
# See LICENSE file for details.
"""Ejecuta ProVerif sobre cada modelo y compara con formal/expected.txt."""
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).parent
github = "--github" in sys.argv
expected = {}
for line in (HERE / "expected.txt").read_text().splitlines():
    if line.strip() and not line.startswith("#"):
        name, res = line.split(":", 1)
        expected[name.strip()] = res.split()

ok = True
for name, exp in expected.items():
    out = subprocess.run(["proverif", str(HERE / name)], capture_output=True, text=True, timeout=3000)
    text = out.stdout + out.stderr
    got = []
    for m in re.finditer(r"^RESULT (.*) is (true|false|cannot be proved)\.?$", text, re.M):
        got.append({"true": "true", "false": "false"}.get(m.group(2), "cannot"))
    lines = [l for l in text.splitlines() if l.startswith("RESULT")]
    status = "OK" if got == exp else "DISTINTO"
    if got != exp:
        ok = False
    print(f"== {name}: {status}\n   esperado: {exp}\n   obtenido: {got}")
    for l in lines:
        print("   " + l)
    if out.returncode != 0 or not got:
        ok = False
        print(text[-3000:])
    if github:
        level = "notice" if got == exp else "error"
        print(f"::{level} title=ProVerif {name}::{status} esperado={exp} obtenido={got}")
        for l in lines:
            print(f"::{level} title=ProVerif {name}::{l[:900]}")
        if out.returncode != 0 or not got:
            for l in text.splitlines()[-25:]:
                print(f"::error title=ProVerif {name}::{l[:900]}")
sys.exit(0 if ok else 1)
