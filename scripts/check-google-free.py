#!/usr/bin/env python3
"""check-google-free.py — censo de Google en el APK construido (D8).

Decisión D8 del dueño (2026-11-13): el APK normal de NIDO va sin Google.
Este censo se hace sobre el BINARIO, no sobre el árbol de fuentes, y la
compilación falla si encuentra cualquiera de estas cosas:

  dex          referencias a com/google/firebase, com/google/android/gms,
               com/google/android/datatransport,
               com/google/android/finsky (Install Referrer de Google Play)
               o com/android/installreferrer en cualquier classes*.dex;
  manifiesto   los mismos paquetes en el AndroidManifest.xml binario
               (servicios datatransport CCT, receptores de Firebase,
               el servicio del Install Referrer…);
  dependencias com.google.firebase, com.google.android.gms,
               com.google.android.datatransport o
               com.android.installreferrer en el árbol
               releaseRuntimeClasspath que la release publica como
               android-runtime-dependencies.txt.

El manifiesto binario (AXML) guarda sus cadenas en UTF-16LE o en UTF-8;
se buscan las dos codificaciones, sin depender de aapt2.

Uso:
  python3 scripts/check-google-free.py <app-release.apk>
      [--deps android-runtime-dependencies.txt] [--json salida.json] [--github]
Sale 1 si encuentra algo, o si falta el árbol de dependencias pedido
(un censo que no se pudo hacer no cuenta como limpio).
"""
import json
import os
import re
import sys
import zipfile

# Cualquier aparición, no solo los descriptores de tipo (Lcom/…;): así
# cuenta también las cadenas sueltas, y la cifra coincide con la del censo
# de la casa sobre la 0.1.95 (529 en classes2.dex para Firebase).
DEX_MARKERS = {
    "com/google/firebase": b"com/google/firebase",
    "com/google/android/gms": b"com/google/android/gms",
    "com/google/android/datatransport": b"com/google/android/datatransport",
    "com/google/android/finsky": b"com/google/android/finsky",
    "com/android/installreferrer": b"com/android/installreferrer",
}
MANIFEST_MARKERS = [
    "com.google.firebase",
    "com.google.android.gms",
    "com.google.android.datatransport",
    "com.google.android.finsky",
    "com.android.installreferrer",
    "com.google.android.c2dm",
]
DEPS_RE = re.compile(
    r"(com\.google\.firebase|com\.google\.android\.gms|com\.google\.android\.datatransport|com\.android\.installreferrer)"
    r":[A-Za-z0-9_.\-]+:[^\s]+"
)


def dex_census(apk):
    out = {}
    with zipfile.ZipFile(apk) as z:
        for name in sorted(n for n in z.namelist() if re.fullmatch(r"classes\d*\.dex", n)):
            data = z.read(name)
            for label, marker in DEX_MARKERS.items():
                count = data.count(marker)
                if count:
                    out.setdefault(label, {})[name] = count
    return out


def manifest_census(apk):
    with zipfile.ZipFile(apk) as z:
        data = z.read("AndroidManifest.xml")
    out = {}
    for marker in MANIFEST_MARKERS:
        count = data.count(marker.encode("utf-16-le")) + data.count(marker.encode("utf-8"))
        if count:
            out[marker] = count
    return out


def manifest_names(apk, marker):
    """Las cadenas completas del manifiesto que contienen el marcador (para el informe)."""
    with zipfile.ZipFile(apk) as z:
        data = z.read("AndroidManifest.xml")
    found = set()
    for enc in ("utf-16-le", "utf-8"):
        text = data.decode(enc, errors="ignore")
        for m in re.finditer(re.escape(marker) + r"[A-Za-z0-9_.$]*", text):
            found.add(m.group(0))
    return sorted(found)


def deps_census(path):
    with open(path, encoding="utf-8") as f:
        text = f.read()
    return sorted({re.sub(r"\s.*$", "", m.group(0)) for m in DEPS_RE.finditer(text)})


def main(argv):
    args = list(argv)
    github = "--github" in args
    if github:
        args.remove("--github")
    deps_path = None
    json_path = None
    if "--deps" in args:
        i = args.index("--deps")
        deps_path = args[i + 1]
        del args[i : i + 2]
    if "--json" in args:
        i = args.index("--json")
        json_path = args[i + 1]
        del args[i : i + 2]
    if len(args) != 1:
        print(__doc__)
        return 2
    apk = args[0]

    result = {
        "apk": os.path.basename(apk),
        "dex": dex_census(apk),
        "manifest": manifest_census(apk),
        "dependencies": None,
        "problems": [],
    }
    result["manifestNames"] = {m: manifest_names(apk, m) for m in result["manifest"]}
    if deps_path is not None:
        if os.path.isfile(deps_path):
            result["dependencies"] = deps_census(deps_path)
        else:
            result["problems"].append(f"no está el árbol de dependencias: {deps_path}")

    for label, per_file in result["dex"].items():
        total = sum(per_file.values())
        files = ", ".join(f"{k} {v}" for k, v in per_file.items())
        result["problems"].append(f"dex: {total} referencias a {label} ({files})")
    for marker, count in result["manifest"].items():
        names = ", ".join(result["manifestNames"][marker][:6])
        result["problems"].append(f"manifiesto: {marker} ({count}): {names}")
    for dep in result["dependencies"] or []:
        result["problems"].append(f"dependencia: {dep}")

    lines = [
        "## Censo sin Google (D8)",
        "",
        f"APK: `{result['apk']}`",
        "",
        "| Dónde | Qué se busca | Encontrado |",
        "|---|---|---:|",
    ]
    for label in DEX_MARKERS:
        lines.append(f"| dex | `{label}` | {sum(result['dex'].get(label, {}).values())} |")
    for marker in MANIFEST_MARKERS:
        lines.append(f"| manifiesto | `{marker}` | {result['manifest'].get(marker, 0)} |")
    if result["dependencies"] is None:
        lines.append("| dependencias | árbol releaseRuntimeClasspath | no pedido |")
    else:
        lines.append(f"| dependencias | firebase, gms, datatransport, installreferrer | {len(result['dependencies'])} |")
    lines.append("")
    lines.append("**Resultado:** " + ("limpio" if not result["problems"] else f"{len(result['problems'])} hallazgo(s)"))
    for p in result["problems"]:
        lines.append(f"- {p}")
    report = "\n".join(lines) + "\n"

    print(report)
    if json_path:
        with open(json_path, "w", encoding="utf-8") as f:
            json.dump(result, f, indent=2, ensure_ascii=False)
            f.write("\n")
    if github:
        summary = os.environ.get("GITHUB_STEP_SUMMARY")
        if summary:
            with open(summary, "a", encoding="utf-8") as f:
                f.write(report)
        if result["problems"]:
            for p in result["problems"]:
                print(f"::error title=Censo sin Google::{p}")
        else:
            print("::notice title=Censo sin Google::limpio: ni dex, ni manifiesto, ni dependencias")
    return 1 if result["problems"] else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
