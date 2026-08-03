#!/usr/bin/env bash
set -euo pipefail

repo_root="$1"
function_source="$(
  sed -n \
    '/HIVE_AUTH_ROTATION_BEGIN/,/HIVE_AUTH_ROTATION_END/p' \
    "$repo_root/infra/scripts/hive-auth-rotate.sh" |
    sed '1d;$d'
)"
source /dev/stdin <<<"$function_source"

action_log="$(mktemp)"
auth_file="$(mktemp)"
remote_dir="$(mktemp -d)"
trap 'rm -f "$action_log" "$auth_file" "$remote_dir/hive-mutation.lock"; rmdir "$remote_dir"' EXIT
rotation_mode="success"
deployment_mode="present"
bootstrap_secret_mode="absent"

flock() {
  printf 'flock %s\n' "$*" >>"$action_log"
  if test "$rotation_mode" = "lock-failure"; then
    return 1
  fi
}

kubectl() {
  printf '%s\n' "$*" >>"$action_log"
  case "$1 $2" in
    "get secret")
      if test "$bootstrap_secret_mode" = "present"; then
        printf '%s\n' 'secret/hive-codex-auth'
      fi
      ;;
    "get deployment")
      if [[ " $* " == *" --ignore-not-found "* ]]; then
        if test "$deployment_mode" = "present"; then
          printf '%s\n' 'deployment.apps/hive'
        fi
      else
        printf '%s' '4'
      fi
      ;;
    "get pod")
      if test "$rotation_mode" = "pod-list-failure"; then
        return 1
      fi
      printf '%s\n' 'pod/hive-old'
      ;;
    "create secret") printf '%s\n' 'replacement-secret' ;;
    "apply -f")
      cat >/dev/null
      if test "$rotation_mode" = "apply-failure"; then
        return 1
      fi
      ;;
  esac
}

line_of() {
  grep -n -F -- "$1" "$action_log" | head -1 | cut -d: -f1
}

run_rotation() {
  set +e
  (
    set -e
    publish_hive_auth "$auth_file" replace ""
  )
  rotation_status=$?
  set -e
}

# Bootstrap rechecks under the lock and preserves a credential published by a waiter.
: >"$action_log"
printf '%s\n' replacement >"$auth_file"
rotation_mode="success"
bootstrap_secret_mode="present"
set +e
(
  set -e
  publish_hive_auth "$auth_file" bootstrap ""
)
rotation_status=$?
set -e
test "$rotation_status" -eq 0
test ! -e "$auth_file"
! grep -Fq -- 'get deployment' "$action_log"
! grep -Fq -- 'apply -f -' "$action_log"
bootstrap_secret_mode="absent"

# A lock failure still deletes plaintext staging without touching Kubernetes.
: >"$action_log"
printf '%s\n' replacement >"$auth_file"
rotation_mode="lock-failure"
deployment_mode="present"
run_rotation
test "$rotation_status" -ne 0
test ! -e "$auth_file"
! grep -Fq -- 'get deployment' "$action_log"

# Success quiesces every broker before apply, deletes staging, then restores four workers.
: >"$action_log"
printf '%s\n' replacement >"$auth_file"
rotation_mode="success"
deployment_mode="present"
run_rotation
test "$rotation_status" -eq 0
test ! -e "$auth_file"
quiesce_line="$(line_of --replicas=0)"
lock_line="$(line_of 'flock --exclusive --timeout 900 9')"
delete_line="$(line_of --for=delete)"
apply_line="$(line_of 'apply -f -')"
restore_line="$(line_of --replicas=4)"
test "$lock_line" -lt "$quiesce_line"
test "$quiesce_line" -lt "$delete_line"
test "$delete_line" -lt "$apply_line"
test "$apply_line" -lt "$restore_line"

# Orphaned brokers are awaited even when their Deployment is already absent.
: >"$action_log"
printf '%s\n' replacement >"$auth_file"
rotation_mode="success"
deployment_mode="absent"
run_rotation
test "$rotation_status" -eq 0
test ! -e "$auth_file"
delete_line="$(line_of --for=delete)"
apply_line="$(line_of 'apply -f -')"
test "$delete_line" -lt "$apply_line"

# An unverifiable quiescence fails closed without publishing and still restores workers.
: >"$action_log"
printf '%s\n' replacement >"$auth_file"
rotation_mode="pod-list-failure"
deployment_mode="present"
run_rotation
test "$rotation_status" -ne 0
test ! -e "$auth_file"
! grep -Fq -- 'apply -f -' "$action_log"
quiesce_line="$(line_of --replicas=0)"
restore_line="$(line_of --replicas=4)"
test "$quiesce_line" -lt "$restore_line"

# Failed publication still deletes plaintext staging and restores the prior replica count.
: >"$action_log"
printf '%s\n' replacement >"$auth_file"
rotation_mode="apply-failure"
deployment_mode="present"
run_rotation
test "$rotation_status" -ne 0
test ! -e "$auth_file"
apply_line="$(line_of 'apply -f -')"
restore_line="$(line_of --replicas=4)"
test "$apply_line" -lt "$restore_line"
