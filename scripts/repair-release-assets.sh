#!/usr/bin/env bash
# Auditoría completa 2026-10-31 (F7-06): reparación de activos de una
# release ya publicada. Los adjuntos posteriores a la publicación
# (SBOM y lista de dependencias) van con continue-on-error: un fallo
# transitorio dejaba la release incompleta para siempre, porque en
# cualquier push posterior el job decide publish=false y ningún paso
# de adjunto volvía a intentarse. Este script se ejecuta en esa
# rama: comprueba los activos esperados y adjunta los que falten.
#
# Qué puede reparar y qué no:
# - nido-sbom.cdx.json: se regenera del lockfile con
#   scripts/generate-sbom.mjs (determinista). La versión del paquete
#   no cambia entre la publicación y la reparación (el tag sale de
#   package.json), así que el lockfile de este checkout es el de la
#   release.
# - android-runtime-dependencies.txt: sale del artefacto de ESTA
#   corrida (el job descarga los artefactos también en la rama de
#   reparación) y se valida con las mismas guardas de F7-02 antes
#   de subirlo.
# - app-release.apk y su .sha256: NO se reparan aquí. Un APK
#   recompilado es otro artefacto, no el publicado; si faltan, el
#   script falla en voz alta para que la release incompleta se vea.
#
# Uso: repair-release-assets.sh <tag> <dir-dist>
set -euo pipefail
TAG="${1:?tag de la release}"
DIST="${2:?directorio con los artefactos de la corrida}"

have() { grep -qx "$1" <<<"$ASSETS"; }

ASSETS="$(gh release view "$TAG" --repo "$GITHUB_REPOSITORY" --json assets --jq '.assets[].name')"

if ! have "app-release.apk" || ! have "app-release.apk.sha256"; then
  echo "::error title=Release incompleta::a $TAG le falta el APK o su suma y eso no se repara recompilando; hace falta intervención manual."
  exit 1
fi

if have "nido-sbom.cdx.json"; then
  echo "SBOM: ya está en $TAG."
else
  node scripts/generate-sbom.mjs nido-sbom.cdx.json
  test -s nido-sbom.cdx.json
  gh release upload "$TAG" nido-sbom.cdx.json --repo "$GITHUB_REPOSITORY"
  echo "::notice title=Release reparada::SBOM regenerado y adjuntado a $TAG."
fi

if have "android-runtime-dependencies.txt"; then
  echo "Lista de dependencias: ya está en $TAG."
else
  test -s "$DIST/android-runtime-dependencies.txt"
  head -1 "$DIST/android-runtime-dependencies.txt" | grep -qE "^Project .:app.$"
  grep -q '^(\*) - ' "$DIST/android-runtime-dependencies.txt"
  gh release upload "$TAG" "$DIST/android-runtime-dependencies.txt" --repo "$GITHUB_REPOSITORY"
  echo "::notice title=Release reparada::lista de dependencias adjuntada a $TAG."
fi

echo "Activos de $TAG comprobados."
