#!/usr/bin/env bash
# MIT License
# Copyright (c) 2026 NIDO contributors
# See LICENSE file for details.
#
# Tests modules/nido-vectors VectorIndexCore.kt on a computer (needs kotlinc
# on PATH, a JDK, python3 + numpy). Usage: run.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
core="$here/../android/src/main/java/expo/modules/nidovectors/VectorIndexCore.kt"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
python3 "$here/check.py" gen "$work"
kotlinc "$core" "$here/Harness.kt" -include-runtime -d "$work/h.jar" 2>&1 | grep -v "^warning" || true
java -jar "$work/h.jar" "$work" 384 0.05 12
python3 "$here/check.py" check "$work"
