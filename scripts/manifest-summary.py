#!/usr/bin/env python3
# MIT License
# Copyright (c) 2026 NIDO contributors
# See LICENSE file for details.
"""
manifest-summary.py — permisos y componentes exportados del APK compilado.

Uso (en CI, tras compilar):
    aapt2 dump xmltree --file AndroidManifest.xml app-release.apk > manifest.txt
    python3 scripts/manifest-summary.py manifest.txt [--github]

Imprime los permisos pedidos (con maxSdkVersion si lo hay) y cada actividad,
servicio, receptor o proveedor que otras apps pueden abrir (exported=true o
con intent-filter sin exported explícito). Con --github, además, cada línea
sale como anotación del run, para revisarlo sin descargar el APK.
"""
import re
import sys

COMPONENTS = ("activity", "activity-alias", "service", "receiver", "provider")


def summarize(text):
    perms, comps = [], []
    elements = []  # flat list (depth, name, attrs, parent_index)
    stack = []
    for raw in text.splitlines():
        m = re.match(r"^(\s*)E: ([\w-]+)", raw)
        if m:
            depth = len(m.group(1))
            while stack and elements[stack[-1]][0] >= depth:
                stack.pop()
            parent = stack[-1] if stack else None
            elements.append([depth, m.group(2), {}, parent])
            stack.append(len(elements) - 1)
            continue
        a = re.match(r'^\s*A: (?:http://schemas.android.com/apk/res/android:)?([\w:]+)\(0x[0-9a-f]+\)=(.*)$', raw)
        if a and stack:
            name = a.group(1).split(":")[-1]
            val = a.group(2).strip()
            q = re.match(r'^"([^"]*)"', val)
            if q:
                val = q.group(1)
            elif "0xffffffff" in val:
                val = "true"
            elif re.search(r"\)0x0+$", val):
                val = "false"
            else:
                h = re.search(r"\)0x([0-9a-f]+)$", val)
                if h:
                    val = str(int(h.group(1), 16))
            elements[stack[-1]][2][name] = val
    has_filter = {e[3] for e in elements if e[1] == "intent-filter"}
    for i, (depth, el, attrs, parent) in enumerate(elements):
        if el == "uses-permission":
            p = attrs.get("name", "?")
            if "maxSdkVersion" in attrs:
                p += f" (hasta API {attrs['maxSdkVersion']})"
            perms.append(p)
        elif el in COMPONENTS:
            exported = attrs.get("exported")
            if exported == "true" or (exported is None and i in has_filter):
                perm = attrs.get("permission")
                comps.append(f"{el} {attrs.get('name', '?')}" + (f" [protegido por {perm}]" if perm else ""))
    return perms, comps


def main(argv):
    github = "--github" in argv
    args = [a for a in argv[1:] if a != "--github"]
    if len(args) != 1:
        print(__doc__.strip())
        return 2
    perms, comps = summarize(open(args[0], encoding="utf-8", errors="replace").read())
    out = [f"Permisos ({len(perms)}): " + ", ".join(sorted(perms)),
           f"Componentes exportados ({len(comps)}): " + "; ".join(comps)]
    for line in out:
        print(line)
        if github:
            print(f"::notice title=Manifiesto::{line}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
