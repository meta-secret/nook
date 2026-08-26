#!/usr/bin/env bash
# Deploy isolated Simple and Sentinel applications for production release.
#
# The release job runs directly inside the exact browser Pod image. Use its
# dependency-locked Wrangler binary with Node; never launch a nested container.
#
# Required env:
#   CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN is required}"
: "${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID is required}"

wrangler() {
  node /meta-secret/nook/nook-app/nook-web/nook-web-app/node_modules/.bin/wrangler "$@"
}

for spec in \
  "nook-app/nook-web/nook-vault-simple/dist:nokey-simple" \
  "nook-app/nook-web/nook-vault-sentinel/dist:nokey-sentinel"
do
  dist_dir="${spec%%:*}"
  project="${spec#*:}"
  wrangler pages project create "$project" --production-branch=main >/dev/null 2>&1 || true
  wrangler pages deploy \
    "$dist_dir" \
    --project-name="$project" \
    --branch=main \
    --commit-dirty=true
done
