#!/usr/bin/env bash
# Regression coverage for the ordinary preview deployment input contract.
set -euo pipefail

script="$(cd "$(dirname "$0")" && pwd)/ci-pr-deploy-and-verify-previews.sh"
repo_root="$(cd "$(dirname "$script")/../.." && pwd)"
real_bash="$(command -v bash)"
fixture_root="$(mktemp -d)"
trap 'rm -rf "$fixture_root"' EXIT
fixture_bin="$fixture_root/bin"
helper_calls="$fixture_root/host-helper.calls"
task_calls="$fixture_root/task.calls"
verification_calls="$fixture_root/verification.calls"
github_output="$fixture_root/github-output"
mkdir -p "$fixture_bin"

cat > "$fixture_bin/bash" <<'EOF'
#!/bin/bash
if [ "${1:-}" = "$NOOK_TEST_HOST_HELPER" ]; then
  printf '%s\n' "$*" >> "$NOOK_TEST_HELPER_CALLS"
  if [ -z "${NOOK_TEST_VERIFY_DEPLOYMENT:-}" ]; then
    exit 17
  fi
  if [ "${CF_PAGES_PROJECT_NAME:-}" = 'nook' ]; then
    printf 'NOOK_PREVIEW_URL=https://%s.nokey-sh.pages.dev\n' "$CF_PAGES_BRANCH"
  fi
  exit 0
fi
if [ "${1:-}" = "$NOOK_TEST_VERIFY_DEPLOYMENT" ]; then
  printf '%s|%s|%s|%s|%s|%s\n' \
    "$EXPECTED_EXTENSION_CHANNEL" \
    "$EXPECTED_EXTENSION_COMMIT" \
    "$EXPECTED_EXTENSION_SITE_URL" \
    "$EXPECTED_SIMPLE_VAULT_URL" \
    "$EXPECTED_SENTINEL_VAULT_URL" \
    "$EXTENSION_METADATA_URL" >> "$NOOK_TEST_VERIFICATION_CALLS"
  exit 0
fi
exec "$NOOK_TEST_REAL_BASH" "$@"
EOF
cat > "$fixture_bin/npx" <<'EOF'
#!/bin/bash
printf 'wrangler fixture\n'
EOF
cat > "$fixture_bin/task" <<'EOF'
#!/bin/bash
printf '%s\n' "$*" >> "$NOOK_TEST_TASK_CALLS"
exit 99
EOF
cat > "$fixture_bin/curl" <<'EOF'
#!/bin/bash
set -euo pipefail
output=''
headers=''
write_format=''
url=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o|--output)
      output="$2"
      shift 2
      ;;
    -D|--dump-header)
      headers="$2"
      shift 2
      ;;
    -w|--write-out)
      write_format="$2"
      shift 2
      ;;
    https://*)
      url="$1"
      shift
      ;;
    *)
      shift
      ;;
  esac
done

status=200
body=''
response_headers=''
case "$url" in
  https://*.nokey-sh.pages.dev/simple/)
    status=404
    response_headers=$'cache-control: no-store\r\n'
    ;;
  https://*.nokey-sh.pages.dev/)
    body='<title>Nook — Keys, not accounts</title> https://pr-preview-branch.nokey-simple.pages.dev/ https://pr-preview-branch.nokey-sentinel.pages.dev/'
    ;;
  https://*.nokey-simple.pages.dev/)
    body='<meta name="nook-app-kind" content="simple">'
    response_headers=$'content-security-policy: default-src self\r\nx-content-type-options: nosniff\r\n'
    ;;
  https://*.nokey-simple.pages.dev/extension-connect)
    ;;
  https://*.nokey-sentinel.pages.dev/)
    body='<meta name="nook-app-kind" content="sentinel">'
    response_headers=$'content-security-policy: default-src self\r\nx-content-type-options: nosniff\r\n'
    ;;
  https://*.nokey-sentinel.pages.dev/extension-connect)
    status=404
    ;;
esac

if [ -n "$output" ]; then
  printf '%s' "$body" > "$output"
fi
if [ -n "$headers" ]; then
  printf '%s' "$response_headers" > "$headers"
fi
if [ "$write_format" = '%{http_code}' ]; then
  printf '%s' "$status"
fi
EOF
chmod +x "$fixture_bin/bash" "$fixture_bin/npx" "$fixture_bin/task"
chmod +x "$fixture_bin/curl"

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

if output="$(
  env \
    PATH="$fixture_bin:$PATH" \
    NOOK_TEST_REAL_BASH="$real_bash" \
    NOOK_TEST_HOST_HELPER="$repo_root/.github/scripts/ci-pr-host-pages-deploy.sh" \
    NOOK_TEST_HELPER_CALLS="$helper_calls" \
    NOOK_TEST_TASK_CALLS="$task_calls" \
    NOOK_HOST_PAGES_DEPLOY=1 \
    NOOK_WRANGLER_VERSION=fixture \
    DEPLOYMENT_TAG=preview-branch \
    HEAD_SHA=0123456789abcdef0123456789abcdef01234567 \
    CLOUDFLARE_API_TOKEN=fixture-token \
    CLOUDFLARE_ACCOUNT_ID=fixture-account \
    "$real_bash" "$script" 2>&1
)"; then
  echo 'preview deploy path test: native host helper unexpectedly passed' >&2
  exit 1
fi
grep -Fq 'ci-pr-host-pages-deploy.sh' "$helper_calls" \
  || { echo 'preview deploy path test: native host helper was not selected' >&2; exit 1; }
test ! -s "$task_calls" \
  || { echo 'preview deploy path test: Docker-backed Task path was selected' >&2; exit 1; }

if output="$(
  env \
    PATH="$fixture_bin:$PATH" \
    NOOK_TEST_REAL_BASH="$real_bash" \
    NOOK_TEST_HOST_HELPER="$repo_root/.github/scripts/ci-pr-host-pages-deploy.sh" \
    NOOK_TEST_VERIFY_DEPLOYMENT="nook-app/nook-web/nook-web-extension/scripts/verify-deployment.sh" \
    NOOK_TEST_HELPER_CALLS="$helper_calls" \
    NOOK_TEST_TASK_CALLS="$task_calls" \
    NOOK_TEST_VERIFICATION_CALLS="$verification_calls" \
    NOOK_HOST_PAGES_DEPLOY=1 \
    NOOK_WRANGLER_VERSION=fixture \
    DEPLOYMENT_TAG=preview-branch \
    HEAD_SHA=0123456789abcdef0123456789abcdef01234567 \
    CLOUDFLARE_API_TOKEN=fixture-token \
    CLOUDFLARE_ACCOUNT_ID=fixture-account \
    GITHUB_OUTPUT="$github_output" \
    "$real_bash" "$script" 2>&1
)"; then
  :
else
  printf '%s\n' "$output" >&2
  echo 'preview deploy extension contract test: deployment unexpectedly failed' >&2
  exit 1
fi
grep -Fxq \
  'pr-preview-branch|0123456789abcdef0123456789abcdef01234567|https://pr-preview-branch.nokey-sh.pages.dev/|https://pr-preview-branch.nokey-simple.pages.dev/|https://pr-preview-branch.nokey-sentinel.pages.dev/|https://pr-preview-branch.nokey-sh.pages.dev/downloads/extension.json' \
  "$verification_calls" \
  || { echo 'preview deploy extension contract test: verifier did not receive the isolated PR channel and exact aliases' >&2; exit 1; }
grep -Fxq 'extension_url=https://pr-preview-branch.nokey-sh.pages.dev/downloads/nook-passwords-pr-preview-branch.zip' "$github_output" \
  || { echo 'preview deploy extension contract test: output did not expose the isolated PR archive' >&2; exit 1; }

echo 'preview deploy input test: ok'
