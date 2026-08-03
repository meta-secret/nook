#!/usr/bin/env bash
set -euo pipefail

repo_root="$1"
test_root="$(mktemp -d)"
mock_bin="$test_root/bin"
remote_dir="$test_root/remote"
lock_dir="$test_root/lock"
apply_log="$test_root/apply.log"
remote_script="$test_root/hive-auth-remote.sh"
mkdir -p "$mock_bin" "$remote_dir/secrets" "$lock_dir"
trap 'rm -rf "$test_root"' EXIT
program_source="$(
  sed -n \
    '/HIVE_AUTH_REMOTE_PROGRAM_BEGIN/,/HIVE_AUTH_REMOTE_PROGRAM_END/p' \
    "$repo_root/infra/tasks/hive.yml" |
    sed '1d;$d;s/^        //'
)"
source /dev/stdin <<<"$program_source"
printf '%s\n' "$remote_program" |
  sed "s#/run/lock/nook#$lock_dir#g" >"$remote_script"
chmod +x "$remote_script"

cat >"$mock_bin/flock" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
test "$1" = --exclusive
test "$2" = --timeout
test "$3" = 900
test "$4" = 9
MOCK

cat >"$mock_bin/jq" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
test "$1" = -e
payload="$(cat)"
printf '%s' "$payload" | grep -Fq '"auth_mode":"chatgpt"'
printf '%s' "$payload" | grep -Fq '"access_token":"access-'
printf '%s' "$payload" | grep -Fq '"refresh_token":"refresh-'
account_id="$(printf '%s' "$payload" | sed -n 's/.*"account_id":"\([^"]*\)".*/\1/p')"
test -n "$account_id"
printf 'account=%s\n' "$account_id"
MOCK

cat >"$mock_bin/sudo" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
test "$1" = -n
shift
case "$1" in install|touch|chmod) exit 0 ;; esac
test "$1" = k0s
shift
test "$1" = kubectl
shift
case "$1 $2" in
  "get deployment"|"get pod") ;;
  "apply -f")
    account_id="$(sed -n 's/^account=//p')"
    test -n "$account_id"
    printf '%s\n' "$account_id" >>"$APPLY_LOG"
    ;;
  *)
    echo "unexpected kubectl call: $*" >&2
    exit 1
    ;;
esac
MOCK
chmod +x "$mock_bin/flock" "$mock_bin/jq" "$mock_bin/sudo"

run_rotation() {
  account_id="$1"
  encoded_program="$(base64 <"$remote_script" | tr -d '\n')"
  encoded_mode="$(printf '%s' replace | base64 | tr -d '\n')"
  encoded_dir="$(printf '%s' "$remote_dir" | base64 | tr -d '\n')"
  printf -v remote_command 'bash -c "$(printf %%s %s | base64 -d)" -- "$(printf %%s %s | base64 -d)" "$(printf %%s %s | base64 -d)"' \
    "$encoded_program" "$encoded_mode" "$encoded_dir"
  printf '{"auth_mode":"chatgpt","tokens":{"access_token":"access-%s","refresh_token":"refresh-%s","account_id":"%s"}}\n' \
    "$account_id" "$account_id" "$account_id" |
    PATH="$mock_bin:$PATH" APPLY_LOG="$apply_log" sh -c "$remote_command"
}

run_rotation alpha &
first_pid=$!
run_rotation beta &
second_pid=$!
wait "$first_pid"
wait "$second_pid"

test "$(wc -l <"$apply_log" | tr -d ' ')" -eq 2
grep -Fxq alpha "$apply_log"
grep -Fxq beta "$apply_log"
test -z "$(find "$remote_dir/secrets" -mindepth 1 -print -quit)"
