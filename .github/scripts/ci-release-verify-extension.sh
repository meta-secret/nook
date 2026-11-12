#!/usr/bin/env bash
# Verify each production browser extension deployment matches the release commit.
# A release publishes one package per vault target; companion WASM resolves
# each target's expected Simple and Sentinel URLs and metadata file name.
#
# Required env:
#   RELEASE_SHA
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

: "${RELEASE_SHA:?RELEASE_SHA is required}"

for vault_target in nokey meta-secret; do
  selection="$(bun nook-app/nook-web/nook-web-extension/scripts/vault-url.ts "$vault_target")"
  simple_vault_url="$(printf '%s\n' "$selection" | sed -n 's/^simple=//p')"
  sentinel_vault_url="$(printf '%s\n' "$selection" | sed -n 's/^sentinel=//p')"
  metadata_file="$(printf '%s\n' "$selection" | sed -n 's/^metadata=//p')"

  EXTENSION_METADATA_URL="https://nokey.sh/downloads/$metadata_file" \
  EXTENSION_CACHE_BUST="$RELEASE_SHA" \
  EXPECTED_EXTENSION_CHANNEL="production" \
  EXPECTED_EXTENSION_COMMIT="$RELEASE_SHA" \
  EXPECTED_EXTENSION_SITE_URL="https://nokey.sh/" \
  EXPECTED_SIMPLE_VAULT_URL="$simple_vault_url" \
  EXPECTED_SENTINEL_VAULT_URL="$sentinel_vault_url" \
    bash nook-app/nook-web/nook-web-extension/scripts/verify-deployment.sh
done
