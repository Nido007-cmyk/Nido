#!/usr/bin/env bash
# Publishes reports + log tails of the current run to $DIAG_BRANCH (force-pushed,
# one commit). Called mid-run and at the end of .github/workflows/multilingual-e5.yml.
set -x
D="$RUNNER_TEMP/diag-branch"
rm -rf "$D" && mkdir -p "$D/logs"
for f in parity.json calibration-builtin.json calibration-builtin.md calibration.json calibration.md \
         wiki-vital5-e5.sqlite.json multilingual-e5-small-q8_0.gguf.sha256; do
  [ -f "$W/$f" ] && cp "$W/$f" "$D/"
done
for f in "$DIAG"/*; do [ -f "$f" ] && tail -c 60000 "$f" > "$D/logs/$(basename "$f")"; done
cat > "$D/README.md" <<EOF
Run ${GITHUB_RUN_ID} on ${GITHUB_SHA} (${GITHUB_REF_NAME}) — $(date -u)
E5 revision: ${E5_RESOLVED_REVISION:-?}  GGUF sha256: ${E5_SHA256:-?}
EOF
cd "$D"
git init -q
git checkout -q -b "$DIAG_BRANCH"
git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git add -A
git commit -q -m "multilingual-e5 run ${GITHUB_RUN_ID}"
git push -f "https://x-access-token:${GH_TOKEN}@github.com/${GITHUB_REPOSITORY}.git" "HEAD:refs/heads/$DIAG_BRANCH"
