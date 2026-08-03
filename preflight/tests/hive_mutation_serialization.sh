#!/usr/bin/env bash
set -euo pipefail

repo_root="$1"
test_root="$(mktemp -d)"
lock_dir="$test_root/lock"
guard_dir="$test_root/critical-section"
event_log="$test_root/events"
mkdir -p "$lock_dir"
trap 'rm -rf "$test_root"' EXIT

extract_lock() {
  start_marker="$1"
  end_marker="$2"
  source_file="$3"
  sed -n "/$start_marker/,/$end_marker/p" "$source_file" |
    sed '1d;$d;s/^          //;s/^        //' |
    sed "s#/run/lock/nook#$lock_dir#g"
}

auth_lock="$(extract_lock HIVE_AUTH_MUTATION_LOCK_BEGIN HIVE_AUTH_MUTATION_LOCK_END \
  "$repo_root/infra/tasks/hive.yml")"
deploy_lock="$(extract_lock HIVE_DEPLOY_MUTATION_LOCK_BEGIN HIVE_DEPLOY_MUTATION_LOCK_END \
  "$repo_root/infra/tasks/hive.yml")"
neo4j_lock="$(extract_lock NEO4J_HIVE_MUTATION_LOCK_BEGIN NEO4J_HIVE_MUTATION_LOCK_END \
  "$repo_root/infra/tasks/neo4j.yml")"

sudo() {
  test "$1" = -n
  shift
  case "$1" in install|touch|chmod) ;; *) return 2 ;; esac
}
export -f sudo

flock() {
  descriptor="${*: -1}"
  lock_key="$(stat -f '%i' "/dev/fd/$descriptor")"
  NOOK_TEST_HELD_LOCK="$NOOK_TEST_FLOCK_ROOT/$lock_key"
  export NOOK_TEST_HELD_LOCK
  for _attempt in $(seq 1 500); do
    if mkdir "$NOOK_TEST_HELD_LOCK" 2>/dev/null; then
      return
    fi
    sleep 0.01
  done
  return 1
}
export -f flock
export NOOK_TEST_FLOCK_ROOT="$test_root/flock"
mkdir -p "$NOOK_TEST_FLOCK_ROOT"

run_transaction() {
  transaction="$1"
  lock_source="$2"
  bash -c "
    set -euo pipefail
    $lock_source
    if ! mkdir '$guard_dir' 2>/dev/null; then
      printf 'overlap:%s\n' '$transaction' >>'$event_log'
      exit 1
    fi
    printf 'enter:%s\n' '$transaction' >>'$event_log'
    sleep 0.15
    printf 'exit:%s\n' '$transaction' >>'$event_log'
    rmdir '$guard_dir'
    rmdir \"\$NOOK_TEST_HELD_LOCK\"
  "
}

assert_serialized_pair() {
  first_name="$1"
  first_lock="$2"
  second_name="$3"
  second_lock="$4"
  : >"$event_log"
  run_transaction "$first_name" "$first_lock" &
  first_pid=$!
  run_transaction "$second_name" "$second_lock" &
  second_pid=$!
  wait "$first_pid"
  wait "$second_pid"
  ! grep -Fq overlap: "$event_log"
  test "$(grep -c '^enter:' "$event_log")" -eq 2
  test "$(grep -c '^exit:' "$event_log")" -eq 2
  first_exit="$(sed -n '2p' "$event_log")"
  second_enter="$(sed -n '3p' "$event_log")"
  case "$first_exit:$second_enter" in exit:*:enter:*) ;; *) exit 1 ;; esac
}

assert_serialized_pair auth "$auth_lock" deploy "$deploy_lock"
assert_serialized_pair auth "$auth_lock" neo4j "$neo4j_lock"
