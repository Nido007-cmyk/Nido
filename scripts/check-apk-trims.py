#!/usr/bin/env python3
"""check-apk-trims.py — el juez de los recortes de empaquetado (P-resto).

Los recortes de P-02/P-04/P-05 (plugins/withLlamaTrim.js) eliminan
entradas del APK por listas de exclusión, y un error tipográfico en
una lista elimina una variante EN SILENCIO: la escalera de carga de
llama.rn degrada sin ruido y nadie lo notaría en el aparato. Por eso
el juez no es la lista sino el listado del APK reconstruido, y corre
en CI sobre el APK real de cada build:

  P-02 · INVERTIDO por VEL-5 (2026-11-22): la pareja hexagon_opencl
         PRESENTE, con el símbolo ggml_backend_hexagon_reg DEFINIDO
         en su .dynsym (la lección del issue #858 de PocketPal: un
         build puede perder el backend en silencio); las otras 12
         librnllama (incluida la genérica, peldaño final) presentes;
         los 5 assets de ggml-hexagon/ presentes, ni uno más.
  P-04 · cero entradas org/bouncycastle/pqc/; los dos ficheros
         x509/CertPathReviewerMessages presentes.
  P-05 · en assets/com/tom_roush/fontbox/resources/cmap/ quedan
         exactamente Identity-H, Identity-V, H, V.

Uso: python3 scripts/check-apk-trims.py <app-release.apk>
Sale 1 nombrando cada violación si el listado no es el esperado.
"""
import struct
import sys
import zipfile

LLAMA_DIR = "lib/arm64-v8a/"
HEXAGON_PAIR = {
    LLAMA_DIR + "librnllama_v8_2_dotprod_i8mm_hexagon_opencl.so",
    LLAMA_DIR + "librnllama_jni_v8_2_dotprod_i8mm_hexagon_opencl.so",
}
HEXAGON_MAIN_SO = LLAMA_DIR + "librnllama_v8_2_dotprod_i8mm_hexagon_opencl.so"
HEXAGON_SYMBOL = "ggml_backend_hexagon_reg"
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
HTP_ASSETS = {HTP_PREFIX + f"libggml-htp-{v}.so" for v in ("v73", "v75", "v79", "v81", "v85")}
PQC_PREFIX = "org/bouncycastle/pqc/"
X509_KEPT = {
    "org/bouncycastle/x509/CertPathReviewerMessages.properties",
    "org/bouncycastle/x509/CertPathReviewerMessages_de.properties",
}
CMAP_DIR = "assets/com/tom_roush/fontbox/resources/cmap/"
CMAP_KEPT = {"Identity-H", "Identity-V", "H", "V"}


def dynsym_defined(data: bytes, symbol: str) -> bool:
    """¿Está `symbol` DEFINIDO en la .dynsym de este ELF (32 o 64)?

    Definido = la entrada existe y su st_shndx no es SHN_UNDEF (0):
    una referencia sin definir pasaría el listado del APK y el
    backend faltaría igual, que es el silencio del #858. Las dos
    clases se soportan porque el APK mezcla las dos: la variante
    host de llama.rn es ELF64 AArch64 y los assets HTP son ELF32
    Hexagon. Solo little-endian (todo Android lo es).
    """
    if len(data) < 52 or data[:4] != b"\x7fELF" or data[5] != 1:
        return False
    elf64 = data[4] == 2
    if not elf64 and data[4] != 1:
        return False
    if elf64:
        (e_shoff,) = struct.unpack_from("<Q", data, 0x28)
        (e_shentsize,) = struct.unpack_from("<H", data, 0x3A)
        (e_shnum,) = struct.unpack_from("<H", data, 0x3C)
        sh_min = 64
    else:
        (e_shoff,) = struct.unpack_from("<I", data, 0x20)
        (e_shentsize,) = struct.unpack_from("<H", data, 0x2E)
        (e_shnum,) = struct.unpack_from("<H", data, 0x30)
        sh_min = 40
    if e_shoff == 0 or e_shentsize < sh_min:
        return False
    if e_shnum == 0:
        # Numeración extendida: el conteo real va en sh_size de la
        # cabecera de sección 0.
        if elf64:
            (e_shnum,) = struct.unpack_from("<Q", data, e_shoff + 0x20)
        else:
            (e_shnum,) = struct.unpack_from("<I", data, e_shoff + 0x14)

    def section(i):
        off = e_shoff + i * e_shentsize
        sh_type, = struct.unpack_from("<I", data, off + 4)
        if elf64:
            sh_offset, = struct.unpack_from("<Q", data, off + 0x18)
            sh_size, = struct.unpack_from("<Q", data, off + 0x20)
            sh_link, = struct.unpack_from("<I", data, off + 0x28)
            sh_entsize, = struct.unpack_from("<Q", data, off + 0x38)
        else:
            sh_offset, = struct.unpack_from("<I", data, off + 0x10)
            sh_size, = struct.unpack_from("<I", data, off + 0x14)
            sh_link, = struct.unpack_from("<I", data, off + 0x18)
            sh_entsize, = struct.unpack_from("<I", data, off + 0x24)
        return sh_type, sh_offset, sh_size, sh_link, sh_entsize

    for i in range(e_shnum):
        sh_type, sh_offset, sh_size, sh_link, sh_entsize = section(i)
        if sh_type != 11:  # SHT_DYNSYM
            continue
        _, str_offset, str_size, _, _ = section(sh_link)
        strtab = data[str_offset:str_offset + str_size]
        entsize = sh_entsize or (24 if elf64 else 16)
        for j in range(sh_size // entsize):
            ent = sh_offset + j * entsize
            (st_name,) = struct.unpack_from("<I", data, ent)
            # st_shndx: offset 6 en la entrada ELF64, 14 en la ELF32.
            (st_shndx,) = struct.unpack_from("<H", data, ent + (6 if elf64 else 14))
            if st_name == 0 or st_name >= len(strtab):
                continue
            end = strtab.find(b"\x00", st_name)
            name = strtab[st_name:end].decode("ascii", "replace")
            if name == symbol:
                return st_shndx != 0
        return False
    return False


def main() -> int:
    if len(sys.argv) != 2:
        print("uso: check-apk-trims.py <app-release.apk>", file=sys.stderr)
        return 2
    with zipfile.ZipFile(sys.argv[1]) as z:
        names = set(z.namelist())
        hexagon_bytes = z.read(HEXAGON_MAIN_SO) if HEXAGON_MAIN_SO in names else None

    failures = []

    missing_hexagon = sorted(HEXAGON_PAIR - names)
    if missing_hexagon:
        failures.append(f"P-02/VEL-5: falta la pareja hexagon_opencl que debe estar DENTRO: {missing_hexagon}")
    if hexagon_bytes is not None and not dynsym_defined(hexagon_bytes, HEXAGON_SYMBOL):
        failures.append(
            f"P-02/VEL-5: {HEXAGON_SYMBOL} no está DEFINIDO en la .dynsym de la variante "
            "hexagon_opencl: el backend puede faltar en silencio (lección del #858)"
        )
    missing_kept = sorted(KEPT_LLAMA - names)
    if missing_kept:
        failures.append(f"P-02: faltan variantes que deben quedarse: {missing_kept}")
    htp = {n for n in names if n.startswith(HTP_PREFIX)}
    if htp != HTP_ASSETS:
        failures.append(
            f"P-02/VEL-5: los assets HTP deben ser exactamente {sorted(HTP_ASSETS)} "
            f"y son {sorted(htp)}"
        )

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
        "::notice title=Recortes de APK::P-02/VEL-5 pareja hexagon_opencl y 5 HTP dentro, "
        "símbolo del backend definido, 14 librnllama dentro · P-04 pqc/ en 0 y x509 intacto · "
        "P-05 cmap/ = Identity-H, Identity-V, H, V"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
