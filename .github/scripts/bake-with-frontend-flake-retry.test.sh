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
  '  printf "%s\\n" "Dockerfile:1" ">>> # syntax=registry.dev.nokey.sh/docker/dockerfile:1.4" "ERROR: target nook-web-e2e: failed to solve: exit code: 2"' \
  '  exit 2' \
  'fi' >"$frontend_command"
chmod +x "$frontend_command"
if ! bash "$retry_script" frontend-disconnect "$frontend_command" "$frontend_count"; then
  echo 'unattributed syntax frontend exit should retry' >&2
  exit 1
fi
assert_equals "$(<"$frontend_count")" 2 'frontend retry count'

authorization_count="$test_dir/authorization-count"
authorization_command="$test_dir/authorization-command"
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'set -euo pipefail' \
  'count_file="$1"' \
  'count=0' \
  'if [ -f "$count_file" ]; then count="$(<"$count_file")"; fi' \
  'count=$((count + 1))' \
  'printf "%s" "$count" >"$count_file"' \
  'if [ "$count" -eq 1 ]; then' \
  '  (sleep 0.1; printf "%s\n" "#2 resolve image config for docker-image://docker.io/docker/dockerfile:1.4" "#2 ERROR: failed to authorize: failed to fetch anonymous token: TLS handshake timeout") &' \
  '  exit 1' \
  'fi' >"$authorization_command"
chmod +x "$authorization_command"
if ! bash "$retry_script" frontend-authorization "$authorization_command" "$authorization_count"; then
  echo 'frontend authorization timeout should retry' >&2
  exit 1
fi
assert_equals "$(<"$authorization_count")" 2 'frontend authorization retry count'

session_count="$test_dir/session-count"
session_command="$test_dir/session-command"
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'set -euo pipefail' \
  'count_file="$1"' \
  'count=0' \
  'if [ -f "$count_file" ]; then count="$(<"$count_file")"; fi' \
  'count=$((count + 1))' \
  'printf "%s" "$count" >"$count_file"' \
  'if [ "$count" -eq 1 ]; then' \
  '  printf "%s\n" "ERROR: failed to solve: DeadlineExceeded: no active session for abc: context deadline exceeded"' \
  '  exit 130' \
  'fi' >"$session_command"
chmod +x "$session_command"
if ! bash "$retry_script" session-timeout "$session_command" "$session_count"; then
  echo 'BuildKit client session timeout should retry' >&2
  exit 1
fi
assert_equals "$(<"$session_count")" 2 'session retry count'

application_count="$test_dir/application-count"
application_command="$test_dir/application-command"
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'set -euo pipefail' \
  'count_file="$1"' \
  'count=0' \
  'if [ -f "$count_file" ]; then count="$(<"$count_file")"; fi' \
  'count=$((count + 1))' \
  'printf "%s" "$count" >"$count_file"' \
  'printf "%s\\n" "Dockerfile:24" ">>> RUN bun run test" "ERROR: target nook-web-e2e: failed to solve: exit code: 2"' \
  'exit 2' >"$application_command"
chmod +x "$application_command"
if bash "$retry_script" application-failure "$application_command" "$application_count"; then
  echo 'application failure must not retry or succeed' >&2
  exit 1
fi
assert_equals "$(<"$application_count")" 1 'application retry count'

later_vertex_count="$test_dir/later-vertex-count"
later_vertex_command="$test_dir/later-vertex-command"
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'set -euo pipefail' \
  'count_file="$1"' \
  'count=0' \
  'if [ -f "$count_file" ]; then count="$(<"$count_file")"; fi' \
  'count=$((count + 1))' \
  'printf "%s" "$count" >"$count_file"' \
  'printf "%s\n" "#2 resolve image config for docker-image://docker.io/docker/dockerfile:1.4" "#2 DONE 0.5s" "#7 [application 1/1] RUN curl https://example.invalid" "#7 ERROR: failed to authorize: failed to fetch anonymous token: TLS handshake timeout"' \
  'exit 1' >"$later_vertex_command"
chmod +x "$later_vertex_command"
if bash "$retry_script" later-vertex-failure "$later_vertex_command" "$later_vertex_count"; then
  echo 'later vertex authorization timeout must not retry or succeed' >&2
  exit 1
fi
assert_equals "$(<"$later_vertex_count")" 1 'later vertex retry count'
