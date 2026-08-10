#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
retry_script="$repo_root/.github/scripts/bake-with-frontend-flake-retry.sh"
test_dir="$(mktemp -d)"
trap 'rm -rf "$test_dir"' EXIT

assert_equals() {
  local actual="$1"
  local expected="$2"
  local message="$3"
  if [ "$actual" != "$expected" ]; then
    echo "$message: expected $expected, got $actual" >&2
    exit 1
  fi
}

frontend_count="$test_dir/frontend-count"
frontend_command="$test_dir/frontend-command"
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'set -euo pipefail' \
  'count_file="$1"' \
  'count=0' \
  'if [ -f "$count_file" ]; then count="$(<"$count_file")"; fi' \
  'count=$((count + 1))' \
  'printf "%s" "$count" >"$count_file"' \
  'if [ "$count" -eq 1 ]; then' \
  '  printf "%s\\n" "Dockerfile:1" ">>> # syntax=docker/dockerfile:1.4" "ERROR: target nook-web-e2e: failed to solve: exit code: 2"' \
  '  exit 2' \
  'fi' >"$frontend_command"
chmod +x "$frontend_command"
if ! bash "$retry_script" frontend-disconnect "$frontend_command" "$frontend_count"; then
  echo 'unattributed syntax frontend exit should retry' >&2
  exit 1
fi
assert_equals "$(<"$frontend_count")" 2 'frontend retry count'

application_count="$test_dir/application-count"
application_command="$test_dir/application-command"
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'set -euo pipefail' \
  'printf "%s" 1 >"$1"' \
  'printf "%s\\n" "Dockerfile:24" ">>> RUN bun run test" "ERROR: target nook-web-e2e: failed to solve: exit code: 2"' \
  'exit 2' >"$application_command"
chmod +x "$application_command"
if bash "$retry_script" application-failure "$application_command" "$application_count"; then
  echo 'application failure must not retry or succeed' >&2
  exit 1
fi
assert_equals "$(<"$application_count")" 1 'application retry count'
