#!/usr/bin/env bash
# Static contract for the isolated build:compile workflow boundary.
set -euo pipefail

workflows_dir="$(cd "$(dirname "$0")" && pwd)"
remote="$workflows_dir/remote.yml"
batch_job="$(sed -n '/^  batch:$/,/^  web-verify:$/p' "$remote")"
compile_timeout="    timeout-minutes: \${{ (inputs.tasks || inputs.task) == 'build:compile' && 3 || 360 }}"

printf '%s\n' "$batch_job" | grep -Fqx -- "$compile_timeout" \
  || { echo 'remote compile contract: build:compile must use three minutes and other batch tasks must retain 360 minutes' >&2; exit 1; }

[[ "$(printf '%s\n' "$batch_job" | grep -Fxc -- "$compile_timeout")" -eq 1 ]] \
  || { echo 'remote compile contract: the conditional compile timeout must appear exactly once' >&2; exit 1; }

printf '%s\n' "$batch_job" | grep -Fq -- "== 'build:compile' && 3 || 360" \
  || { echo 'remote compile contract: non-compile batch tasks must preserve their 360-minute timeout' >&2; exit 1; }

for required in \
  "if [ \"\$REQUESTED_REMOTE_TASKS\" != \"build:compile\" ]; then" \
  'build:compile must be dispatched as the only remote task.' \
  "(inputs.tasks || inputs.task) != 'web:verify'" \
  "(inputs.tasks || inputs.task) != 'ci:pr'" \
  "(inputs.tasks || inputs.task) != 'ci:pr:e2e'"; do
  printf '%s\n' "$batch_job" | grep -Fq -- "$required" \
    || { echo "remote compile contract: missing selector isolation: $required" >&2; exit 1; }
done

echo 'remote compile contract test: ok'
