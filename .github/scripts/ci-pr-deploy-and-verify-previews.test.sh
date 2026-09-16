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
mkdir -p "$fixture_bin"

cat > "$fixture_bin/bash" <<'EOF'
#!/usr/bin/env bash
if [ "${1:-}" = "$NOOK_TEST_HOST_HELPER" ]; then
  printf '%s\n' "$*" >> "$NOOK_TEST_HELPER_CALLS"
  exit 17
fi
exec "$NOOK_TEST_REAL_BASH" "$@"
EOF
cat > "$fixture_bin/npx" <<'EOF'
#!/usr/bin/env bash
printf 'wrangler fixture\n'
EOF
cat > "$fixture_bin/task" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$NOOK_TEST_TASK_CALLS"
exit 99
EOF
chmod +x "$fixture_bin/bash" "$fixture_bin/npx" "$fixture_bin/task"

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

echo 'preview deploy input test: ok'
