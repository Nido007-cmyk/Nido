#!/usr/bin/env python3
# MIT License
# Copyright (c) 2026 NIDO contributors
# See LICENSE file for details.
"""
compare-apk.py — ¿son iguales dos APK salvo la firma? (compilación reproducible)

Uso:
    python3 scripts/compare-apk.py mi-compilacion.apk app-release.apk

Compara entrada por entrada el contenido de los dos APK (SHA-256 de cada
archivo). Se ignoran solo los archivos de firma v1 de META-INF (*.SF, *.RSA,
*.EC, *.DSA y MANIFEST.MF): la firma v2/v3 vive fuera de las entradas del zip
y tampoco se compara. Todo lo demás —código, recursos, librerías nativas,
el JS empaquetado— tiene que ser idéntico byte a byte.

Sale con código 0 si son iguales y 1 si hay diferencias (las lista).
Solo usa la biblioteca estándar de Python.
"""
import hashlib
import re
import sys
import zipfile

SIGNATURE_FILE = re.compile(r"^META-INF/([^/]+\.(SF|RSA|EC|DSA)|MANIFEST\.MF)$", re.I)


def digest_entries(path):
    out = {}
    with zipfile.ZipFile(path) as z:
        for info in z.infolist():
            if info.is_dir() or SIGNATURE_FILE.match(info.filename):
                continue
            if info.filename in out:
                # Un zip con nombres repetidos es sospechoso: Android y las
                # herramientas pueden leer copias distintas. No se acepta.
                raise SystemExit(f"{path}: entrada repetida {info.filename!r}")
            h = hashlib.sha256()
            with z.open(info) as f:
                for chunk in iter(lambda: f.read(1 << 20), b""):
                    h.update(chunk)
            out[info.filename] = (h.hexdigest(), info.file_size)
    return out


def main(argv):
    github = "--github" in argv
    argv = [a for a in argv if a != "--github"]
    if len(argv) != 3:
        print(__doc__.strip())
        return 2
    a, b = digest_entries(argv[1]), digest_entries(argv[2])
    only_a = sorted(set(a) - set(b))
    only_b = sorted(set(b) - set(a))
    changed = sorted(k for k in set(a) & set(b) if a[k][0] != b[k][0])
    # --github: además, cada diferencia como anotación de GitHub Actions
    # (visible en la página del run sin abrir el log).
    def say(msg, level="error"):
        print(msg)
        if github:
            print(f"::{level} title=compare-apk::{msg}")

    for k in only_a[:40]:
        say(f"solo en {argv[1]}: {k}")
    for k in only_b[:40]:
        say(f"solo en {argv[2]}: {k}")
    for k in changed[:40]:
        say(f"distinto: {k} ({a[k][1]} B vs {b[k][1]} B)")
    total = len(set(a) | set(b))
    if only_a or only_b or changed:
        say(f"DIFERENTES: {len(only_a) + len(only_b) + len(changed)} de {total} archivos.")
        return 1
    say(f"IGUALES: los {total} archivos coinciden byte a byte (sin contar la firma).", "notice")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
