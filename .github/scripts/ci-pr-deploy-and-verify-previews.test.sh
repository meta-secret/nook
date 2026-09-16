#!/usr/bin/env bash
# Regression coverage for the ordinary preview deployment input contract.
set -euo pipefail

script="$(cd "$(dirname "$0")" && pwd)/ci-pr-deploy-and-verify-previews.sh"
repo_root="$(cd "$(dirname "$script")/../.." && pwd)"
remote_taskfile="$repo_root/.task/remote-execution.yml"
remote_workflow="$repo_root/.github/workflows/remote.yml"

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

grep -Fq "REQUESTED_DEPLOYMENT_TAG: '{{.DEPLOYMENT_TAG}}'" "$remote_taskfile" \
  || { echo 'preview deploy input test: remote Task does not capture DEPLOYMENT_TAG' >&2; exit 1; }
grep -Fq 'workflow_args+=(--raw-field "deployment_tag=$REQUESTED_DEPLOYMENT_TAG")' "$remote_taskfile" \
  || { echo 'preview deploy input test: remote Task does not forward deployment_tag' >&2; exit 1; }
grep -Fq 'deployment_tag:' "$remote_workflow" \
  || { echo 'preview deploy input test: remote Actions workflow lacks deployment_tag input' >&2; exit 1; }
for required in \
  'DEPLOYMENT_TAG: ${{ (inputs.tasks || inputs.task) == '\''ci:pr:deploy-and-verify-previews'\'' && inputs.deployment_tag || '\'''\'' }}' \
  'HEAD_SHA: ${{ (inputs.tasks || inputs.task) == '\''ci:pr:deploy-and-verify-previews'\'' && (inputs.source_sha || github.sha) || '\'''\'' }}' \
  'CLOUDFLARE_API_TOKEN: ${{ (inputs.tasks || inputs.task) == '\''ci:pr:deploy-and-verify-previews'\'' && secrets.CLOUD_FLARE_PAGES_TOKEN || '\'''\'' }}' \
  'CLOUDFLARE_ACCOUNT_ID: ${{ (inputs.tasks || inputs.task) == '\''ci:pr:deploy-and-verify-previews'\'' && secrets.CLOUD_FLARE_ACCOUNT_ID || '\'''\'' }}' \
  'NOOK_HOST_PAGES_DEPLOY: ${{ (inputs.tasks || inputs.task) == '\''ci:pr:deploy-and-verify-previews'\'' && '\''1'\'' || '\'''\'' }}'; do
  grep -Fq "$required" "$remote_workflow" \
    || { echo "preview deploy input test: remote preview scope is missing: $required" >&2; exit 1; }
done

echo 'preview deploy input test: ok'
