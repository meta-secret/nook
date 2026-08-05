#!/usr/bin/env bash
# Stage commit-keyed nook-core/auth coverage artifacts for upload.
#
# Required env:
#   COVERAGE_SOURCE_DIR — directory containing summary/lcov artifacts
#   COMMIT_SHA
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

: "${COVERAGE_SOURCE_DIR:?COVERAGE_SOURCE_DIR is required}"
: "${COMMIT_SHA:?COMMIT_SHA is required}"

mkdir -p coverage/main
for file in summary.txt summary.json lcov.info coverage-floor.json; do
  test -s "$COVERAGE_SOURCE_DIR/$file"
  cp "$COVERAGE_SOURCE_DIR/$file" "coverage/main/$file"
done
jq -n \
  --arg commit_sha "$COMMIT_SHA" \
  '{schema_version: 1, commit_sha: $commit_sha}' \
  > coverage/main/manifest.json
