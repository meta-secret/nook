#!/usr/bin/env bash
# Deploy the web-research catalog to Cloudflare Pages.
#
# Required env:
#   CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID
#   CF_PAGES_PROJECT_NAME, RESEARCH_DIR, WRANGLER_VERSION
#   GITHUB_SHA
# Optional env:
#   EVENT_NAME (pull_request|push|...), PR_NUMBER, GITHUB_REF_NAME
#   GITHUB_OUTPUT — when set, writes deploy_branch and deployment_url
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN is required}"
: "${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID is required}"
: "${CF_PAGES_PROJECT_NAME:?CF_PAGES_PROJECT_NAME is required}"
: "${RESEARCH_DIR:?RESEARCH_DIR is required}"
: "${WRANGLER_VERSION:?WRANGLER_VERSION is required}"
: "${GITHUB_SHA:?GITHUB_SHA is required}"

cd "$RESEARCH_DIR"

if [ "${EVENT_NAME:-}" = "pull_request" ]; then
  : "${PR_NUMBER:?PR_NUMBER is required for pull_request deploys}"
  deploy_branch="pr-$PR_NUMBER"
else
  ref_name="${GITHUB_REF_NAME:-}"
  if [ -z "$ref_name" ]; then
    ref_name="${GITHUB_REF##*/}"
  fi
  : "${ref_name:?GITHUB_REF_NAME or GITHUB_REF is required}"
  deploy_branch="${ref_name//[^A-Za-z0-9_-]/-}"
fi

set +e
out="$(bunx "wrangler@$WRANGLER_VERSION" pages deploy dist \
  --project-name "$CF_PAGES_PROJECT_NAME" \
  --branch "$deploy_branch" \
  --commit-hash "$GITHUB_SHA" 2>&1)"
status=$?
set -e
printf '%s\n' "$out"
if [ "$status" -ne 0 ]; then
  exit "$status"
fi

clean="$(printf '%s' "$out" | sed -E 's/\x1b\[[0-9;]*[a-zA-Z]//g')"
url="$(printf '%s' "$clean" | grep -oE 'https://[a-z0-9-]+\.nook-web-research\.pages\.dev' | tail -1)"
if [ -z "$url" ]; then
  echo "::error::Cloudflare deploy succeeded but did not emit a deployment URL"
  exit 1
fi

if [ -n "${GITHUB_OUTPUT:-}" ]; then
  {
    echo "deploy_branch=$deploy_branch"
    echo "deployment_url=$url"
  } >> "$GITHUB_OUTPUT"
fi
