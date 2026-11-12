#!/usr/bin/env bash
# Verify each production browser extension deployment matches the release commit.
# A release publishes one package per vault target; companion WASM resolves
# each target's expected URLs, metadata file, install method, and host.
#
# The default package is checked on the public site. A package the Simple
# vault artifact serves is checked on that artifact's immutable nokey-simple
# deployment, so the release never fetches the hand-attached alias host.
#
# Required env:
#   RELEASE_SHA
#   SIMPLE_DEPLOYMENT_URL  immutable nokey-simple deployment of this release
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

: "${RELEASE_SHA:?RELEASE_SHA is required}"
: "${SIMPLE_DEPLOYMENT_URL:?SIMPLE_DEPLOYMENT_URL is required}"

selection=''
selection_field() {
  printf '%s\n' "$selection" | sed -n "s/^$1=//p"
}

for vault_target in nokey meta-secret; do
  selection="$(
    NOOK_EXTENSION_CHANNEL=production \
    NOOK_EXTENSION_SITE_URL=https://nokey.sh/ \
      bun nook-app/nook-web/nook-web-extension/scripts/vault-url.ts "$vault_target"
  )"
  metadata_file="$(selection_field metadata)"
  package_site="$(selection_field package_site)"
  case "$(selection_field package_host)" in
    site)
      fetch_origin=''
      metadata_url="${package_site}downloads/$metadata_file"
      ;;
    simple-vault)
      fetch_origin="${SIMPLE_DEPLOYMENT_URL%/}/"
      metadata_url="${fetch_origin}downloads/$metadata_file"
      ;;
    *)
      echo "Unknown extension package host for $vault_target" >&2
      exit 1
      ;;
  esac

  EXTENSION_METADATA_URL="$metadata_url" \
  EXTENSION_FETCH_ORIGIN_URL="$fetch_origin" \
  EXTENSION_CACHE_BUST="$RELEASE_SHA" \
  EXPECTED_EXTENSION_CHANNEL="production" \
  EXPECTED_EXTENSION_COMMIT="$RELEASE_SHA" \
  EXPECTED_EXTENSION_SITE_URL="$package_site" \
  EXPECTED_EXTENSION_INSTALL_METHOD="$(selection_field install_method)" \
  EXPECTED_SIMPLE_VAULT_URL="$(selection_field simple)" \
  EXPECTED_SENTINEL_VAULT_URL="$(selection_field sentinel)" \
    bash nook-app/nook-web/nook-web-extension/scripts/verify-deployment.sh
done
