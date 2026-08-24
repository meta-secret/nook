#!/usr/bin/env bash
# Deploy isolated Simple and Sentinel applications for production release.
#
# The delivery runner guarantees Docker, not a pinned host Node/npm. Use the Node
# image already consumed by the web build so release deployment has an explicit CLI
# runtime without adding npm or Wrangler to every PR image.
#
# Required env:
#   CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN is required}"
: "${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID is required}"

docker run --rm \
  --env CLOUDFLARE_API_TOKEN \
  --env CLOUDFLARE_ACCOUNT_ID \
  --env HOME=/tmp \
  --user "$(id -u):$(id -g)" \
  --volume "$PWD:/workspace" \
  --workdir /workspace \
  registry.dev.nokey.sh/library/node:24-trixie-slim \
  sh -euc '
    for spec in \
      "nook-app/nook-web/nook-vault-simple/dist:nokey-simple" \
      "nook-app/nook-web/nook-vault-sentinel/dist:nokey-sentinel"
    do
      dist_dir="${spec%%:*}"
      project="${spec#*:}"
      npx --yes wrangler@4 pages project create "$project" --production-branch=main >/dev/null 2>&1 || true
      npx --yes wrangler@4 pages deploy \
        "$dist_dir" \
        --project-name="$project" \
        --branch=main \
        --commit-dirty=true
    done
  '
