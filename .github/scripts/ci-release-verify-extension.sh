#!/usr/bin/env bash
# Verify production browser extension deployment matches the release commit.
#
# Required env:
#   RELEASE_SHA
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

: "${RELEASE_SHA:?RELEASE_SHA is required}"

extension_verified=false
last_extension_output=""
for attempt in $(seq 1 12); do
  set +e
  last_extension_output="$(
    EXTENSION_METADATA_URL="https://nokey.sh/downloads/extension.json" \
    EXTENSION_CACHE_BUST="$RELEASE_SHA-$attempt" \
    EXPECTED_EXTENSION_CHANNEL="production" \
    EXPECTED_EXTENSION_COMMIT="$RELEASE_SHA" \
    EXPECTED_EXTENSION_SITE_URL="https://nokey.sh/" \
    EXPECTED_SIMPLE_VAULT_URL="https://simple.nokey.sh/" \
    EXPECTED_SENTINEL_VAULT_URL="https://sentinel.nokey.sh/" \
      bash nook-app/nook-web/nook-web-extension/scripts/verify-deployment.sh 2>&1
  )"
  extension_status=$?
  set -e
  if [ "$extension_status" -eq 0 ]; then
    printf '%s\n' "$last_extension_output"
    extension_verified=true
    break
  fi
  echo "Waiting for exact-release extension artifacts (attempt $attempt/12)"
  sleep 5
done
if [ "$extension_verified" != true ]; then
  printf '%s\n' "$last_extension_output" >&2
  echo "::error::Production extension artifacts did not converge to the exact release"
  exit 1
fi
