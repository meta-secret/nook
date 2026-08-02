#!/usr/bin/env bash
set -euo pipefail

repo_root="$1"
function_source="$(
  sed -n \
    '/HIVE_AUTH_ROTATION_BEGIN/,/HIVE_AUTH_ROTATION_END/p' \
    "$repo_root/infra/tasks/hive.yml" |
    sed '1d;$d;s/^        //;s/\\\$/\$/g'
)"
source /dev/stdin <<<"$function_source"

action_log="$(mktemp)"
auth_file="$(mktemp)"
trap 'rm -f "$action_log" "$auth_file"' EXIT
rotation_mode="success"

kubectl() {
  printf '%s\n' "$*" >>"$action_log"
  case "$1 $2" in
    "get deployment")
      if [[ " $* " == *" --ignore-not-found "* ]]; then
        printf '%s\n' 'deployment.apps/hive'
      else
        printf '%s' '4'
      fi
      ;;
    "get pod") printf '%s\n' 'pod/hive-old' ;;
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
    rotate_hive_auth "$auth_file"
  )
  rotation_status=$?
  set -e
}

# Success quiesces every broker before apply, deletes staging, then restores four workers.
: >"$action_log"
printf '%s\n' replacement >"$auth_file"
rotation_mode="success"
run_rotation
test "$rotation_status" -eq 0
test ! -e "$auth_file"
quiesce_line="$(line_of --replicas=0)"
delete_line="$(line_of --for=delete)"
apply_line="$(line_of 'apply -f -')"
restore_line="$(line_of --replicas=4)"
test "$quiesce_line" -lt "$delete_line"
test "$delete_line" -lt "$apply_line"
test "$apply_line" -lt "$restore_line"

# Failed publication still deletes plaintext staging and restores the prior replica count.
: >"$action_log"
printf '%s\n' replacement >"$auth_file"
rotation_mode="apply-failure"
run_rotation
test "$rotation_status" -ne 0
test ! -e "$auth_file"
apply_line="$(line_of 'apply -f -')"
restore_line="$(line_of --replicas=4)"
test "$apply_line" -lt "$restore_line"
