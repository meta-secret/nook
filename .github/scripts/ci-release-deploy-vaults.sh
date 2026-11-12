#!/usr/bin/env bash
# Deploy isolated Simple and Sentinel applications for production release.
#
# The release job runs directly inside the exact browser Pod image. Use its
# dependency-locked Wrangler binary with Node; never launch a nested container.
#
# Required env:
#   CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID
#
# Output (GITHUB_OUTPUT): simple_deployment_url, the immutable nokey-simple
# deployment the release verifies the Simple artifact's own extension package
# from, so the release never fetches the hand-attached alias host.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN is required}"
: "${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID is required}"

wrangler() {
  node /meta-secret/nook/nook-app/nook-web/nook-web-app/node_modules/.bin/wrangler "$@"
}

deploy_logs="$(mktemp -d)"
trap 'rm -rf "$deploy_logs"' EXIT

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
    --commit-dirty=true | tee "$deploy_logs/$project.log"
done

simple_deployment_url="$(
  sed -E 's/\x1b\[[0-9;]*[a-zA-Z]//g' "$deploy_logs/nokey-simple.log" \
    | { grep -oE 'Deployment complete! Take a peek over at https://[^ ]+' || true; } \
    | sed 's/Deployment complete! Take a peek over at //' \
    | tail -1
)"
if [[ ! "$simple_deployment_url" =~ ^https://[0-9a-f]{8}\.nokey-simple\.pages\.dev$ ]]; then
  echo "::error::Simple vault deploy did not emit a canonical immutable nokey-simple deployment URL" >&2
  exit 1
fi
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  echo "simple_deployment_url=$simple_deployment_url" >> "$GITHUB_OUTPUT"
fi
