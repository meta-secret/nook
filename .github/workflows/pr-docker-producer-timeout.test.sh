#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

assert_job_timeout() {
  local workflow="$1" job="$2" expected="$3" actual
  actual="$(awk -v job="$job" '
    $0 == "  " job ":" { in_job=1; next }
    in_job && /^  [[:alnum:]_-]+:/ { exit }
    in_job && /timeout-minutes:/ { print $2; exit }
  ' "$workflow")"
  if [ "$actual" != "$expected" ]; then
    echo "$job must have timeout-minutes: $expected (got: ${actual:-missing})" >&2
    exit 1
  fi
}

for job in rust wasm wasm-node-test verify; do
  assert_job_timeout "$repo_root/.github/workflows/pr.yml" "$job" 7
done
for job in dependency-policy deterministic-tests dylint; do
  assert_job_timeout "$repo_root/.github/workflows/rust-ecosystem-checks.yml" "$job" 7
done

echo 'PR Docker producer timeout contract passed'
