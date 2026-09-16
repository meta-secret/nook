#!/usr/bin/env bash
# Regression coverage for the ordinary preview deployment input contract.
set -euo pipefail

script="$(cd "$(dirname "$0")" && pwd)/ci-pr-deploy-and-verify-previews.sh"

if output="$(env -u PR_NUMBER -u HEAD_SHA DEPLOYMENT_TAG=preview-branch bash "$script" 2>&1)"; then
  echo 'preview deploy input test: valid deployment tag unexpectedly reached deployment' >&2
  exit 1
fi
grep -Fq 'HEAD_SHA is required' <<< "$output" \
  || { echo 'preview deploy input test: valid deployment tag was not accepted' >&2; exit 1; }
if grep -Fq 'PR_NUMBER is required' <<< "$output"; then
  echo 'preview deploy input test: deployment still requires PR_NUMBER' >&2
  exit 1
fi

if output="$(env -u PR_NUMBER -u DEPLOYMENT_TAG -u HEAD_SHA bash "$script" 2>&1)"; then
  echo 'preview deploy input test: missing deployment tag unexpectedly passed' >&2
  exit 1
fi
grep -Fq 'DEPLOYMENT_TAG is required' <<< "$output" \
  || { echo 'preview deploy input test: missing deployment tag was not rejected' >&2; exit 1; }

if output="$(env -u PR_NUMBER HEAD_SHA=fixture-sha CLOUDFLARE_API_TOKEN=fixture-token CLOUDFLARE_ACCOUNT_ID=fixture-account DEPLOYMENT_TAG=preview/branch bash "$script" 2>&1)"; then
  echo 'preview deploy input test: unsafe deployment tag unexpectedly passed' >&2
  exit 1
fi
grep -Fq 'DEPLOYMENT_TAG must be a safe Cloudflare preview identifier' <<< "$output" \
  || { echo 'preview deploy input test: unsafe deployment tag was not rejected' >&2; exit 1; }

echo 'preview deploy input test: ok'
