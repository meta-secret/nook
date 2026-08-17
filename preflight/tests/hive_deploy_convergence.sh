#!/usr/bin/env bash
set -euo pipefail

repo_root="$1"
source "$repo_root/infra/scripts/hive-deploy-convergence.sh"

sleep() { :; }

MOCK_POD_JSON='{"items":[]}'
READY_VALUES=()
ready_index=0
kubectl() {
  if test "$1 $2" = "get pods"; then
    printf '%s\n' "$MOCK_POD_JSON"
    return
  fi
  if test "$1 $2 $3" = "get deployment hive"; then
    value="${READY_VALUES[$ready_index]:-${READY_VALUES[-1]:-0}}"
    ready_index=$((ready_index + 1))
    printf '%s' "$value"
    return
  fi
  echo "unexpected kubectl invocation: $*" >&2
  return 1
}

MOCK_POD_JSON='{
  "items": [
    {"metadata":{"name":"evicted","deletionTimestamp":null},"status":{"phase":"Failed"}},
    {"metadata":{"name":"finished","deletionTimestamp":null},"status":{"phase":"Succeeded"}},
    {"metadata":{"name":"deleting","deletionTimestamp":"2026-08-17T00:00:00Z"},"status":{"phase":"Running"}}
  ]
}'
test -z "$(hive_active_graph_client_pods hive)"
hive_wait_for_graph_client_drain hive 2 0

MOCK_POD_JSON='{
  "items": [
    {"metadata":{"name":"running","deletionTimestamp":null},"status":{"phase":"Running"}},
    {"metadata":{"name":"pending","deletionTimestamp":null},"status":{"phase":"Pending"}}
  ]
}'
drain_error="$(mktemp)"
ready_error="$(mktemp)"
trap 'rm -f "$drain_error" "$ready_error"' EXIT
if hive_wait_for_graph_client_drain hive 2 0 2>"$drain_error"; then
  echo "active graph clients must fail a bounded drain" >&2
  exit 1
fi
grep -Fq 'running' "$drain_error"
grep -Fq 'pending' "$drain_error"

READY_VALUES=(4 3 4 4 4)
ready_index=0
hive_wait_for_ready_pool 6 0 3
test "$ready_index" -eq 5

READY_VALUES=(4 3 4 3)
ready_index=0
if hive_wait_for_ready_pool 4 0 3 2>"$ready_error"; then
  echo "an unstable pool must fail after the bounded sample count" >&2
  exit 1
fi
grep -Fq 'did not stabilize at four ready workers' "$ready_error"
