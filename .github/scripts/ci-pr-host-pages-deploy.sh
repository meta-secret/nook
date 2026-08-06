#!/usr/bin/env bash
# Deploy one Cloudflare Pages project from a host dist directory with pinned wrangler.
#
# Required env:
#   CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, CF_PAGES_BRANCH
#   CF_PAGES_PROJECT_NAME, CF_PAGES_DIST_DIR
# Optional env:
#   CF_PAGES_PRODUCTION_BRANCH (default: main)
#   NOOK_WRANGLER_VERSION (default: 4.114.0)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN is required}"
: "${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID is required}"
: "${CF_PAGES_BRANCH:?CF_PAGES_BRANCH is required}"
: "${CF_PAGES_PROJECT_NAME:?CF_PAGES_PROJECT_NAME is required}"
: "${CF_PAGES_DIST_DIR:?CF_PAGES_DIST_DIR is required}"

production_branch="${CF_PAGES_PRODUCTION_BRANCH:-main}"
wrangler_version="${NOOK_WRANGLER_VERSION:-4.114.0}"
deploy_dir="$CF_PAGES_DIST_DIR"
case "$deploy_dir" in
  /*) ;;
  *) deploy_dir="$ROOT/$deploy_dir" ;;
esac
if [ ! -d "$deploy_dir" ]; then
  echo "error: Cloudflare Pages deploy directory not found: $deploy_dir" >&2
  exit 1
fi

wrangler() {
  npx --yes "wrangler@${wrangler_version}" "$@"
}

wrangler pages project create "$CF_PAGES_PROJECT_NAME" \
  --production-branch="$production_branch" >/dev/null 2>&1 || true

set +e
deploy_output="$(
  wrangler pages deploy "$deploy_dir" \
    --project-name="$CF_PAGES_PROJECT_NAME" \
    --branch="${CF_PAGES_BRANCH}" \
    --commit-dirty=true 2>&1
)"
deploy_status=$?
set -e
echo "$deploy_output"
if [ "$deploy_status" -ne 0 ]; then
  exit "$deploy_status"
fi

clean_output="$(printf '%s' "$deploy_output" | sed -E 's/\x1b\[[0-9;]*[a-zA-Z]//g')"
deployment_url="$(
  printf '%s' "$clean_output" \
    | grep -oE 'https://[a-zA-Z0-9.-]+\.pages\.dev[a-zA-Z0-9./_-]*' \
    | tail -1
)"
if [ -z "$deployment_url" ]; then
  echo "Could not parse Cloudflare deployment URL from wrangler output" >&2
  exit 1
fi
echo "NOOK_PREVIEW_URL=$deployment_url"
