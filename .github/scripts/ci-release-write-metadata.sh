#!/usr/bin/env bash
# Write release.json metadata into isolated production dist trees.
#
# Required env:
#   RELEASE_VERSION, RELEASE_TAG, RELEASE_SHA
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

: "${RELEASE_VERSION:?RELEASE_VERSION is required}"
: "${RELEASE_TAG:?RELEASE_TAG is required}"
: "${RELEASE_SHA:?RELEASE_SHA is required}"

metadata="$(jq --null-input \
  --arg version "$RELEASE_VERSION" \
  --arg tag "$RELEASE_TAG" \
  --arg commit "$RELEASE_SHA" \
  --arg released_at "$(date --utc +%Y-%m-%dT%H:%M:%SZ)" \
  '{version: $version, tag: $tag, commit: $commit, released_at: $released_at}')"
printf '%s\n' "$metadata" > nook-app/nook-web/nook-web-app/dist/site/release.json
printf '%s\n' "$metadata" > nook-app/nook-web/nook-vault-simple/dist/release.json
printf '%s\n' "$metadata" > nook-app/nook-web/nook-vault-sentinel/dist/release.json
