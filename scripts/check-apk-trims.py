#!/usr/bin/env python3
"""check-apk-trims.py — el juez de los recortes de empaquetado (P-resto).

Los recortes de P-02/P-04/P-05 (plugins/withLlamaTrim.js) eliminan
entradas del APK por listas de exclusión, y un error tipográfico en
una lista elimina una variante EN SILENCIO: la escalera de carga de
llama.rn degrada sin ruido y nadie lo notaría en el aparato. Por eso
el juez no es la lista sino el listado del APK reconstruido, y corre
en CI sobre el APK real de cada build:

  P-02 · la pareja hexagon_opencl ausente; las otras 12 librnllama
         (incluida la genérica, peldaño final) presentes; los 4
         assets de ggml-hexagon/ ausentes.
  P-04 · cero entradas org/bouncycastle/pqc/; los dos ficheros
         x509/CertPathReviewerMessages presentes.
  P-05 · en assets/com/tom_roush/fontbox/resources/cmap/ quedan
         exactamente Identity-H, Identity-V, H, V.

Uso: python3 scripts/check-apk-trims.py <app-release.apk>
Sale 1 nombrando cada violación si el listado no es el esperado.
"""
import sys
import zipfile

LLAMA_DIR = "lib/arm64-v8a/"
TRIMMED = {
    LLAMA_DIR + "librnllama_v8_2_dotprod_i8mm_hexagon_opencl.so",
    LLAMA_DIR + "librnllama_jni_v8_2_dotprod_i8mm_hexagon_opencl.so",
}
KEPT_LLAMA = {
    LLAMA_DIR + n
    for n in (
        "librnllama.so",
        "librnllama_jni.so",
        "librnllama_v8.so",
        "librnllama_jni_v8.so",
        "librnllama_v8_2.so",
        "librnllama_jni_v8_2.so",
        "librnllama_v8_2_dotprod.so",
        "librnllama_jni_v8_2_dotprod.so",
        "librnllama_v8_2_dotprod_i8mm.so",
        "librnllama_jni_v8_2_dotprod_i8mm.so",
        "librnllama_v8_2_i8mm.so",
        "librnllama_jni_v8_2_i8mm.so",
    )
}
HTP_PREFIX = "assets/ggml-hexagon/"
PQC_PREFIX = "org/bouncycastle/pqc/"
X509_KEPT = {
    "org/bouncycastle/x509/CertPathReviewerMessages.properties",
    "org/bouncycastle/x509/CertPathReviewerMessages_de.properties",
}
CMAP_DIR = "assets/com/tom_roush/fontbox/resources/cmap/"
CMAP_KEPT = {"Identity-H", "Identity-V", "H", "V"}


def main() -> int:
    if len(sys.argv) != 2:
        print("uso: check-apk-trims.py <app-release.apk>", file=sys.stderr)
        return 2
    with zipfile.ZipFile(sys.argv[1]) as z:
        names = set(z.namelist())

    failures = []

    present_trimmed = sorted(TRIMMED & names)
    if present_trimmed:
        failures.append(f"P-02: la pareja recortada SIGUE en el APK: {present_trimmed}")
    missing_kept = sorted(KEPT_LLAMA - names)
    if missing_kept:
        failures.append(f"P-02: faltan variantes que deben quedarse: {missing_kept}")
    htp = sorted(n for n in names if n.startswith(HTP_PREFIX))
    if htp:
        failures.append(f"P-02: assets HTP presentes: {htp}")

    pqc = sorted(n for n in names if n.startswith(PQC_PREFIX))
    if pqc:
        failures.append(f"P-04: entradas pqc/ presentes ({len(pqc)}): {pqc[:5]}")
    missing_x509 = sorted(X509_KEPT - names)
    if missing_x509:
        failures.append(f"P-04: faltan los x509 que se quedan: {missing_x509}")

    cmap = {n[len(CMAP_DIR):] for n in names if n.startswith(CMAP_DIR)}
    if cmap != CMAP_KEPT:
        failures.append(
            f"P-05: cmap/ debe quedar exactamente {sorted(CMAP_KEPT)} y quedan {sorted(cmap)}"
        )

    if failures:
        for f in failures:
            print(f"::error title=Recortes de APK::{f}")
        return 1
    print(
        "::notice title=Recortes de APK::P-02 pareja hexagon_opencl y HTP fuera, "
        "12 librnllama dentro · P-04 pqc/ en 0 y x509 intacto · "
        "P-05 cmap/ = Identity-H, Identity-V, H, V"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
