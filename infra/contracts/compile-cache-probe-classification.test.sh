#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
classifier="$repo_root/.github/scripts/classify-registry-cache-probe.sh"
probe_output="$(mktemp)"
trap 'rm -f "$probe_output"' EXIT

assert_class() {
  local expected="$1"
  local status="$2"
  local output="$3"
  printf '%s\n' "$output" > "$probe_output"
  actual="$(bash "$classifier" "$status" "$probe_output")"
  if [ "$actual" != "$expected" ]; then
    echo "expected probe class $expected, got $actual" >&2
    exit 1
  fi
}

assert_class available 0 ''
assert_class absent 1 'manifest unknown'
assert_class transient_unavailable 124 ''
assert_class transient_unavailable 2 'context canceled'
assert_class transient_unavailable 1 'dial tcp: lookup registry: temporary failure in name resolution'
assert_class fatal 1 'unauthorized: authentication required'
assert_class fatal 1 'denied: requested access to the resource is denied'
assert_class fatal 1 'invalid reference format'

simulate_compile_probe() {
  local status="$1"
  local output="$2"
  printf '%s\n' "$output" > "$probe_output"
  case "$(bash "$classifier" "$status" "$probe_output")" in
    available) echo cache_import ;;
    absent|transient_unavailable) echo cold_solve ;;
    fatal) return 1 ;;
    *) return 2 ;;
  esac
}

test "$(simulate_compile_probe 124 '')" = cold_solve
test "$(simulate_compile_probe 2 'context canceled')" = cold_solve
if simulate_compile_probe 1 'unauthorized: authentication required'; then
  echo 'fatal authentication probe unexpectedly continued to the cold solve' >&2
  exit 1
fi

echo 'Compile registry probe classification: transient timeout continues cold; auth and invalid references remain terminal'
