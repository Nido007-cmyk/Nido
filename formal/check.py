#!/usr/bin/env python3
# MIT License
# Copyright (c) 2026 NIDO contributors
# See LICENSE file for details.
"""Ejecuta ProVerif sobre cada modelo y compara con formal/expected.txt.

Cada modelo corre por separado, con límite de tiempo y de memoria, y su
salida se guarda en formal/out/<modelo>.log. Si ProVerif se queda sin
memoria o sin tiempo, se informa cuál modelo fue y qué resultados alcanzó
a dar, en vez de que el sistema corte todo el paso.
"""
import os
import re
import resource
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).parent
OUT = HERE / "out"
OUT.mkdir(exist_ok=True)
github = "--github" in sys.argv
only = [a for a in sys.argv[1:] if not a.startswith("--")]
TIMEOUT_S = int(os.environ.get("PROVERIF_TIMEOUT", "2400"))
MEM_GB = float(os.environ.get("PROVERIF_MEM_GB", "10"))

expected = {}
for line in (HERE / "expected.txt").read_text().splitlines():
    if line.strip() and not line.startswith("#"):
        name, res = line.split(":", 1)
        expected[name.strip()] = res.split()


def limit_memory() -> None:
    lim = int(MEM_GB * 1024**3)
    resource.setrlimit(resource.RLIMIT_AS, (lim, lim))


def note(level: str, title: str, msg: str) -> None:
    print(f"   {msg}")
    if github:
        print(f"::{level} title={title}::{msg[:900]}")


ok = True
for name, exp in expected.items():
    if only and name not in only:
        continue
    log = OUT / (name + ".log")
    start = time.time()
    reason = ""
    with log.open("w") as fh:
        try:
            proc = subprocess.run(
                ["proverif", str(HERE / name)],
                stdout=fh,
                stderr=subprocess.STDOUT,
                timeout=TIMEOUT_S,
                preexec_fn=limit_memory,
            )
            code = proc.returncode
        except subprocess.TimeoutExpired:
            code = -1
            reason = f"sin terminar tras {TIMEOUT_S} s"
    secs = time.time() - start
    peak_mb = resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss // 1024
    text = log.read_text(errors="replace")
    if code != 0 and not reason:
        reason = f"código de salida {code}" + (" (¿sin memoria?)" if "Out of memory" in text or code < 0 else "")
    got = []
    lines = []
    for m in re.finditer(r"^RESULT (.*) is (true|false|cannot be proved)\.?$", text, re.M):
        got.append({"true": "true", "false": "false"}.get(m.group(2), "cannot"))
        lines.append(m.group(0))
    status = "OK" if (got == exp and code == 0) else "DISTINTO"
    if status != "OK":
        ok = False
    level = "notice" if status == "OK" else "error"
    title = f"ProVerif {name}"
    print(f"== {name}: {status} ({secs:.0f} s, pico ~{peak_mb} MB)")
    note(level, title, f"{status} esperado={exp} obtenido={got} tiempo={secs:.0f}s memoria~{peak_mb}MB")
    for l in lines:
        note(level, title, l)
    if reason:
        note("error", title, "ProVerif no terminó: " + reason)
        for l in text.splitlines()[-15:]:
            note("error", title, l)
sys.exit(0 if ok else 1)
