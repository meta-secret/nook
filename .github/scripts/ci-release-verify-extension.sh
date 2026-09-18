#!/usr/bin/env bash
# Verify production browser extension deployment matches the release commit.
#
# Required env:
#   RELEASE_SHA
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

: "${RELEASE_SHA:?RELEASE_SHA is required}"

EXTENSION_METADATA_URL="https://nokey.sh/downloads/extension.json" \
EXTENSION_CACHE_BUST="$RELEASE_SHA" \
EXPECTED_EXTENSION_CHANNEL="production" \
EXPECTED_EXTENSION_COMMIT="$RELEASE_SHA" \
EXPECTED_EXTENSION_SITE_URL="https://nokey.sh/" \
EXPECTED_SIMPLE_VAULT_URL="https://simple.nokey.sh/" \
EXPECTED_SENTINEL_VAULT_URL="https://sentinel.nokey.sh/" \
  bash nook-app/nook-web/nook-web-extension/scripts/verify-deployment.sh
