#!/usr/bin/env bash
# Deploy isolated development applications to Cloudflare Pages.
#
# Required env:
#   CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID
#   CI_MAIN_VITE_BASE, CI_MAIN_VITE_VAULT_SYNC_INTERVAL_MS
# Optional env:
#   GITHUB_OUTPUT — when set, writes site_pages_url/simple_pages_url/sentinel_pages_url
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN is required}"
: "${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID is required}"
: "${CI_MAIN_VITE_BASE:?CI_MAIN_VITE_BASE is required}"
: "${CI_MAIN_VITE_VAULT_SYNC_INTERVAL_MS:?CI_MAIN_VITE_VAULT_SYNC_INTERVAL_MS is required}"

deploy() {
  project="$1"
  branch="$2"
  dist="$3"
  output="$4"
  label="$5"
  set +e
  out="$(CF_PAGES_PROJECT_NAME="$project" CF_PAGES_PRODUCTION_BRANCH=main CF_PAGES_BRANCH="$branch" CF_PAGES_DIST_DIR="$dist" bash "$ROOT/.github/scripts/ci-pr-host-pages-deploy.sh" 2>&1)"
  status=$?
  set -e
  echo "$out"
  if [ "$status" -ne 0 ]; then
    echo "::error::$label development deploy failed (exit $status)"
    exit "$status"
  fi
  clean="$(printf '%s' "$out" | sed -E 's/\x1b\[[0-9;]*[a-zA-Z]//g')"
  url="$(printf '%s' "$clean" | grep -oE 'NOOK_PREVIEW_URL=https://[^ ]+' | sed 's/NOOK_PREVIEW_URL=//' | tail -1)"
  if [ -z "$url" ]; then
    echo "::error::$label development deploy did not emit a URL"
    exit 1
  fi
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    echo "$output=$url" >> "$GITHUB_OUTPUT"
  fi
}

# Every development surface uses the stable non-production branch alias so
# the main-channel build cannot replace the public production deployment.
deploy nokey-sh development nook-app/nook-web/nook-web-app/dist/site site_pages_url Site
deploy nokey-simple development nook-app/nook-web/nook-vault-simple/dist simple_pages_url Simple
deploy nokey-sentinel development nook-app/nook-web/nook-vault-sentinel/dist sentinel_pages_url Sentinel
