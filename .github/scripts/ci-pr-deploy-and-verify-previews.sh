#!/usr/bin/env bash
# Deploy and verify Cloudflare Pages preview aliases for a pull request.
#
# Required env:
#   PR_NUMBER, HEAD_SHA
#   CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID
# Optional env:
#   CF_PAGES_BRANCH (defaults to pr-$PR_NUMBER)
#   GITHUB_OUTPUT — when set, writes preview_url/site_url/simple_url/sentinel_url/extension_url
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

: "${PR_NUMBER:?PR_NUMBER is required}"
: "${HEAD_SHA:?HEAD_SHA is required}"
: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN is required}"
: "${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID is required}"

pr="$PR_NUMBER"
export CF_PAGES_BRANCH="${CF_PAGES_BRANCH:-pr-$pr}"
site_url="https://pr-$pr.nokey-sh.pages.dev"
simple_url="https://pr-$pr.nokey-simple.pages.dev"
sentinel_url="https://pr-$pr.nokey-sentinel.pages.dev"

deploy_dir="$(mktemp -d)"
trap 'rm -rf "$deploy_dir"' EXIT

deploy_pages() {
  project="$1"
  dist="$2"
  log="$3"
  # Background in this shell so the caller's $! remains a waitable child. Do not
  # capture this function through command substitution.
  if [ "${NOOK_HOST_PAGES_DEPLOY:-}" = "1" ]; then
    CF_PAGES_PROJECT_NAME="$project" \
      CF_PAGES_PRODUCTION_BRANCH=main \
      CF_PAGES_DIST_DIR="$dist" \
      bash "$ROOT/.github/scripts/ci-pr-host-pages-deploy.sh" \
      >"$log" 2>&1 &
  else
    CF_PAGES_PROJECT_NAME="$project" \
      CF_PAGES_PRODUCTION_BRANCH=main \
      CF_PAGES_DIST_DIR="$dist" \
      task ci:pr:deploy-preview VITE_BASE=/ WASM_BUILD_MODE=dev \
      >"$log" 2>&1 &
  fi
}

deploy_pages nook nook-app/nook-web/nook-web-app/dist "$deploy_dir/unified.log"
unified_pid=$!
deploy_pages nokey-sh nook-app/nook-web/nook-web-app/dist/site "$deploy_dir/site.log"
site_pid=$!
deploy_pages nokey-simple nook-app/nook-web/nook-vault-simple/dist "$deploy_dir/simple.log"
simple_pid=$!
deploy_pages nokey-sentinel nook-app/nook-web/nook-vault-sentinel/dist "$deploy_dir/sentinel.log"
sentinel_pid=$!

wait_for_deploy() {
  pid="$1"
  label="$2"
  log="$3"
  set +e
  wait "$pid"
  status=$?
  set -e
  cat "$log"
  if [ "$status" -ne 0 ]; then
    echo "::error::$label preview deploy failed (exit $status)"
    exit "$status"
  fi
}

wait_for_deploy "$unified_pid" "Unified" "$deploy_dir/unified.log"
wait_for_deploy "$site_pid" "Site" "$deploy_dir/site.log"
wait_for_deploy "$simple_pid" "Simple" "$deploy_dir/simple.log"
wait_for_deploy "$sentinel_pid" "Sentinel" "$deploy_dir/sentinel.log"

clean="$(sed -E 's/\x1b\[[0-9;]*[a-zA-Z]//g' "$deploy_dir/unified.log")"
preview_url="$(printf '%s' "$clean" | grep -oE 'NOOK_PREVIEW_URL=https://[^ ]+' | sed 's/NOOK_PREVIEW_URL=//' | tail -1)"
if [ -z "$preview_url" ]; then
  echo "::error::Unified preview deploy did not emit NOOK_PREVIEW_URL"
  exit 1
fi

body="$(mktemp)"
headers="$(mktemp)"
verified=false
for attempt in $(seq 1 60); do
  site_status="$(curl --connect-timeout 3 --max-time 8 -sS -o "$body" -w '%{http_code}' "$site_url/" || true)"
  retired_status="$(curl --connect-timeout 3 --max-time 8 -sS -D "$headers" -o /dev/null -w '%{http_code}' "$site_url/simple/" || true)"
  site_ok=false
  if [ "$site_status" = "200" ] \
    && grep -Fq '<title>Nook — Keys, not accounts</title>' "$body" \
    && grep -Fq "$simple_url/" "$body" \
    && grep -Fq "$sentinel_url/" "$body" \
    && [ "$retired_status" = "404" ] \
    && tr -d '\r' < "$headers" | grep -Eiq '^cache-control:.*no-store'; then
    site_ok=true
  fi

  simple_status="$(curl --connect-timeout 3 --max-time 8 -sS -D "$headers" -o "$body" -w '%{http_code}' "$simple_url/" || true)"
  simple_extension="$(curl --connect-timeout 3 --max-time 8 -sS -o /dev/null -w '%{http_code}' "$simple_url/extension-connect" || true)"
  simple_ok=false
  if [ "$simple_status" = "200" ] \
    && grep -Fq '<meta name="nook-app-kind" content="simple"' "$body" \
    && tr -d '\r' < "$headers" | grep -Eiq '^content-security-policy:' \
    && tr -d '\r' < "$headers" | grep -Eiq '^x-content-type-options:[[:space:]]*nosniff' \
    && [ "$simple_extension" = "200" ]; then
    simple_ok=true
  fi

  sentinel_status="$(curl --connect-timeout 3 --max-time 8 -sS -D "$headers" -o "$body" -w '%{http_code}' "$sentinel_url/" || true)"
  sentinel_extension="$(curl --connect-timeout 3 --max-time 8 -sS -o /dev/null -w '%{http_code}' "$sentinel_url/extension-connect" || true)"
  sentinel_ok=false
  if [ "$sentinel_status" = "200" ] \
    && grep -Fq '<meta name="nook-app-kind" content="sentinel"' "$body" \
    && tr -d '\r' < "$headers" | grep -Eiq '^content-security-policy:' \
    && tr -d '\r' < "$headers" | grep -Eiq '^x-content-type-options:[[:space:]]*nosniff' \
    && [ "$sentinel_extension" = "404" ]; then
    sentinel_ok=true
  fi

  if [ "$site_ok" = true ] && [ "$simple_ok" = true ] && [ "$sentinel_ok" = true ]; then
    verified=true
    break
  fi
  echo "Waiting for isolated aliases (attempt $attempt/60; site=$site_status/$retired_status, simple=$simple_status/$simple_extension, sentinel=$sentinel_status/$sentinel_extension)"
  sleep 2
done
if [ "$verified" != true ]; then
  echo "::error::Isolated Pages aliases did not expose the expected site, Simple, and Sentinel boundaries"
  exit 1
fi
extension_verified=false
last_extension_output=''
for attempt in $(seq 1 30); do
  set +e
  last_extension_output="$(
    EXTENSION_METADATA_URL="$site_url/downloads/extension.json" \
    EXTENSION_CACHE_BUST="$HEAD_SHA-$attempt" \
    EXPECTED_EXTENSION_CHANNEL="pr-$pr" \
    EXPECTED_EXTENSION_COMMIT="$HEAD_SHA" \
    EXPECTED_EXTENSION_SITE_URL="$site_url/" \
    EXPECTED_SIMPLE_VAULT_URL="$simple_url/" \
    EXPECTED_SENTINEL_VAULT_URL="$sentinel_url/" \
      bash nook-app/nook-web/nook-web-extension/scripts/verify-deployment.sh 2>&1
  )"
  extension_status=$?
  set -e
  if [ "$extension_status" -eq 0 ]; then
    printf '%s\n' "$last_extension_output"
    extension_verified=true
    break
  fi
  echo "Waiting for exact-head extension metadata (attempt $attempt/30)"
  sleep 2
done
if [ "$extension_verified" != true ]; then
  printf '%s\n' "$last_extension_output" >&2
  echo "::error::Extension metadata did not converge to the exact PR head"
  exit 1
fi
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  {
    echo "preview_url=$preview_url"
    echo "site_url=$site_url"
    echo "simple_url=$simple_url"
    echo "sentinel_url=$sentinel_url"
    echo "extension_url=$site_url/downloads/nook-passwords-pr-$pr.zip"
  } >> "$GITHUB_OUTPUT"
fi
