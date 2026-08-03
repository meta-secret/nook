#!/usr/bin/env bash
set -euo pipefail

repo_root="$1"
test_root="$(mktemp -d)"
mock_bin="$test_root/bin"
remote_dir="$test_root/remote"
barrier_dir="$test_root/barrier"
apply_log="$test_root/apply.log"
mkdir -p "$mock_bin" "$remote_dir/secrets" "$barrier_dir"
trap 'rm -rf "$test_root"' EXIT

cat >"$mock_bin/flock" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
touch "$BARRIER_DIR/$$"
for _attempt in $(seq 1 200); do
  count="$(find "$BARRIER_DIR" -type f | wc -l | tr -d ' ')"
  if test "$count" -ge 2; then
    exit 0
  fi
  sleep 0.01
done
echo "concurrent rotation did not reach the lock barrier" >&2
exit 1
MOCK

cat >"$mock_bin/sudo" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
test "$1" = -n
shift
test "$1" = k0s
shift
test "$1" = kubectl
shift
case "$1 $2" in
  "get deployment"|"get pod") ;;
  "create secret")
    auth_file=""
    for argument in "$@"; do
      case "$argument" in
        --from-file=auth.json=*) auth_file="${argument#--from-file=auth.json=}" ;;
      esac
    done
    test -n "$auth_file"
    printf 'path=%s content=%s\n' "$auth_file" "$(jq -r .tokens.account_id "$auth_file")"
    ;;
  "apply -f") cat >>"$APPLY_LOG" ;;
  *)
    echo "unexpected kubectl call: $*" >&2
    exit 1
    ;;
esac
MOCK
chmod +x "$mock_bin/flock" "$mock_bin/sudo"

run_rotation() {
  account_id="$1"
  printf '{"auth_mode":"chatgpt","tokens":{"access_token":"access-%s","refresh_token":"refresh-%s","account_id":"%s"}}\n' \
    "$account_id" "$account_id" "$account_id" |
    PATH="$mock_bin:$PATH" \
      BARRIER_DIR="$barrier_dir" \
      APPLY_LOG="$apply_log" \
      bash "$repo_root/infra/scripts/hive-auth-rotate.sh" replace "$remote_dir"
}

run_rotation alpha &
first_pid=$!
run_rotation beta &
second_pid=$!
wait "$first_pid"
wait "$second_pid"

test "$(wc -l <"$apply_log" | tr -d ' ')" -eq 2
grep -Fq 'content=alpha' "$apply_log"
grep -Fq 'content=beta' "$apply_log"
test "$(cut -d' ' -f1 "$apply_log" | sort -u | wc -l | tr -d ' ')" -eq 2
test -z "$(find "$remote_dir/secrets" -mindepth 1 -print -quit)"
