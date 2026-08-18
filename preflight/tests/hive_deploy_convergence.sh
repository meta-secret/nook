#!/usr/bin/env bash
set -euo pipefail

repo_root="$1"
helpers="$(
  sed -n '/HIVE_DEPLOY_CONVERGENCE_HELPERS_BEGIN/,/HIVE_DEPLOY_CONVERGENCE_HELPERS_END/p' \
    "$repo_root/infra/tasks/hive.yml" |
    sed '1d;$d;s/^        //'
)"
eval "$helpers"

sleep() { :; }

MOCK_POD_JSON='{"items":[]}'
READY_VALUES=()
ready_calls="$(mktemp)"
kubectl() {
  if test "$1 $2" = "get pods"; then
    printf '%s\n' "$MOCK_POD_JSON"
    return
  fi
  echo "unexpected kubectl invocation: $*" >&2
  return 1
}

MOCK_POD_JSON='{
  "items": [
    {"metadata":{"name":"evicted","deletionTimestamp":null},"status":{"phase":"Failed"}},
    {"metadata":{"name":"finished","deletionTimestamp":"2026-08-17T00:00:00Z"},"status":{"phase":"Succeeded"}}
  ]
}'
test -z "$(hive_active_graph_client_pods hive)"
hive_wait_for_graph_client_drain hive 2 0

MOCK_POD_JSON='{
  "items": [
    {"metadata":{"name":"running","deletionTimestamp":null},"status":{"phase":"Running"}},
    {"metadata":{"name":"pending","deletionTimestamp":null},"status":{"phase":"Pending"}},
    {"metadata":{"name":"deleting","deletionTimestamp":"2026-08-17T00:00:00Z"},"status":{"phase":"Running"}}
  ]
}'
drain_error="$(mktemp)"
ready_error="$(mktemp)"
trap 'rm -f "$drain_error" "$ready_error" "$ready_calls"' EXIT
if hive_wait_for_graph_client_drain hive 2 0 2>"$drain_error"; then
  echo "active graph clients must fail a bounded drain" >&2
  exit 1
fi
grep -Fq 'running' "$drain_error"
grep -Fq 'pending' "$drain_error"
grep -Fq 'deleting' "$drain_error"

MOCK_POD_JSON='{
  "items": [
    {"metadata":{"name":"ready-1"},"status":{"phase":"Running","containerStatuses":[{"name":"hive","ready":true}]}},
    {"metadata":{"name":"ready-2"},"status":{"phase":"Running","containerStatuses":[{"name":"hive","ready":true}]}},
    {"metadata":{"name":"ready-3"},"status":{"phase":"Running","containerStatuses":[{"name":"hive","ready":true}]}},
    {"metadata":{"name":"ready-4"},"status":{"phase":"Running","containerStatuses":[{"name":"hive","ready":true}]}},
    {"metadata":{"name":"terminating-ready","deletionTimestamp":"2026-08-17T00:00:00Z"},"status":{"phase":"Running","containerStatuses":[{"name":"hive","ready":true}]}},
    {"metadata":{"name":"not-ready"},"status":{"phase":"Running","containerStatuses":[{"name":"hive","ready":false}]}}
  ]
}'
test "$(hive_ready_worker_count)" -eq 4
hive_ready_worker_count() {
  call_number="$(( $(wc -l < "$ready_calls") + 1 ))"
  printf 'x\n' >>"$ready_calls"
  printf '%s' "${READY_VALUES[$((call_number - 1))]:-${READY_VALUES[-1]:-0}}"
}

READY_VALUES=(4 3 4 4 4)
: >"$ready_calls"
hive_wait_for_ready_pool 6 0 3
test "$(wc -l < "$ready_calls" | tr -d ' ')" -eq 5

READY_VALUES=(4 3 4 3)
: >"$ready_calls"
if hive_wait_for_ready_pool 4 0 3 2>"$ready_error"; then
  echo "an unstable pool must fail after the bounded sample count" >&2
  exit 1
fi
grep -Fq 'did not stabilize at four ready workers' "$ready_error"
