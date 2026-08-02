#!/usr/bin/env bash
set -euo pipefail

repo_root="$1"
function_source="$(
  sed -n \
    '/HIVE_AUTH_SYNC_BEGIN/,/HIVE_AUTH_SYNC_END/p' \
    "$repo_root/infra/tasks/hive.yml" |
    sed '1d;$d;s/^        //'
)"
source /dev/stdin <<<"$function_source"

task_log="$(mktemp)"
trap 'rm -f "$task_log"' EXIT
ssh_mode="existing"

ssh() {
  case "$ssh_mode" in
    existing) printf '%s\n' 'secret/hive-codex-auth' ;;
    missing) return 0 ;;
    error)
      printf '%s\n' 'control plane unavailable' >&2
      return 255
      ;;
    unexpected) printf '%s\n' 'secret/unrelated' ;;
  esac
}

task() {
  printf '%s\n' "$*" >>"$task_log"
}

# An existing cluster-owned Secret is authoritative even when a local file is set.
: >"$task_log"
ssh_mode="existing"
HIVE_CODEX_AUTH_FILE="/stale/local/auth.json" sync_hive_auth
test ! -s "$task_log"

# Only a successful empty --ignore-not-found result permits initial bootstrap.
: >"$task_log"
ssh_mode="missing"
HIVE_CODEX_AUTH_FILE="/current/local/auth.json" sync_hive_auth
test "$(cat "$task_log")" = "infra:hive:auth:rotate"

# Transport, authorization, and control-plane failures never invoke rotation.
: >"$task_log"
ssh_mode="error"
if HIVE_CODEX_AUTH_FILE="/stale/local/auth.json" sync_hive_auth; then
  echo "lookup failure unexpectedly permitted Hive auth rotation" >&2
  exit 1
fi
test ! -s "$task_log"

# An unexpected successful response also fails closed.
: >"$task_log"
ssh_mode="unexpected"
if HIVE_CODEX_AUTH_FILE="/stale/local/auth.json" sync_hive_auth; then
  echo "unexpected lookup response permitted Hive auth rotation" >&2
  exit 1
fi
test ! -s "$task_log"
