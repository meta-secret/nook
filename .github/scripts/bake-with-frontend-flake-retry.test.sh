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

mirror_authorization_count="$test_dir/mirror-authorization-count"
mirror_authorization_command="$test_dir/mirror-authorization-command"
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'set -euo pipefail' \
  'count_file="$1"' \
  'count=0' \
  'if [ -f "$count_file" ]; then count="$(<"$count_file")"; fi' \
  'count=$((count + 1))' \
  'printf "%s" "$count" >"$count_file"' \
  'if [ "$count" -eq 1 ]; then' \
  '  printf "%s\n" "#4 resolve image config for docker-image://registry.dev.nokey.sh/docker/dockerfile:1.27.0" "#4 ERROR: failed to authorize: failed to fetch anonymous token: TLS handshake timeout"' \
  '  exit 1' \
  'fi' >"$mirror_authorization_command"
chmod +x "$mirror_authorization_command"
if ! bash "$retry_script" mirror-frontend-authorization \
  "$mirror_authorization_command" "$mirror_authorization_count"; then
  echo 'mirror frontend authorization timeout should retry' >&2
  exit 1
fi
assert_equals "$(<"$mirror_authorization_count")" 2 'mirror frontend authorization retry count'

foreign_mirror_count="$test_dir/foreign-mirror-count"
foreign_mirror_command="$test_dir/foreign-mirror-command"
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'set -euo pipefail' \
  'count_file="$1"' \
  'count=0' \
  'if [ -f "$count_file" ]; then count="$(<"$count_file")"; fi' \
  'count=$((count + 1))' \
  'printf "%s" "$count" >"$count_file"' \
  'printf "%s\n" "#4 resolve image config for docker-image://example.invalid/docker/dockerfile:1.27.0" "#4 ERROR: failed to authorize: failed to fetch anonymous token: TLS handshake timeout"' \
  'exit 1' >"$foreign_mirror_command"
chmod +x "$foreign_mirror_command"
if bash "$retry_script" foreign-frontend-mirror \
  "$foreign_mirror_command" "$foreign_mirror_count"; then
  echo 'foreign frontend mirror timeout must not retry or succeed' >&2
  exit 1
fi
assert_equals "$(<"$foreign_mirror_count")" 1 'foreign mirror retry count'

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

cache_export_count="$test_dir/cache-export-count"
cache_export_command="$test_dir/cache-export-command"
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'set -euo pipefail' \
  'count_file="$1"' \
  'count=0' \
  'if [ -f "$count_file" ]; then count="$(<"$count_file")"; fi' \
  'count=$((count + 1))' \
  'printf "%s" "$count" >"$count_file"' \
  'if [ "$count" -eq 1 ]; then' \
  '  printf "%s\n" "#60 exporting cache to registry" "ERROR: failed to receive status: rpc error: code = Unavailable desc = error reading from server: EOF"' \
  '  exit 1' \
  'fi' >"$cache_export_command"
chmod +x "$cache_export_command"
if ! bash "$retry_script" cache-export "$cache_export_command" "$cache_export_count"; then
  echo 'BuildKit cache-export EOF should retry' >&2
  exit 1
fi
assert_equals "$(<"$cache_export_count")" 2 'cache-export retry count'

metrics_command="$test_dir/metrics-command"
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'printf "%s\n" "#18 exporting cache to registry" "#18 preparing build cache for export 12.5s done" "#18 DONE 15.5s"' >"$metrics_command"
chmod +x "$metrics_command"
metrics_output="$(bash "$retry_script" cache-metrics "$metrics_command")"
if ! grep -Fq 'label=cache-metrics vertex=#18 preparation_seconds=12.5 registry_send_seconds=3.0 total_export_seconds=15.5' <<<"$metrics_output"; then
  echo 'cache export phase metrics must separate preparation from registry sending' >&2
  exit 1
fi

concurrent_map_command="$test_dir/concurrent-map-command"
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'printf "%s\n" "fatal error: concurrent map writes"' \
  'exit 2' >"$concurrent_map_command"
chmod +x "$concurrent_map_command"
set +e
concurrent_map_output="$(bash "$retry_script" concurrent-map "$concurrent_map_command" 2>&1)"
concurrent_map_status=$?
set -e
assert_equals "$concurrent_map_status" 2 'concurrent-map failure status'
if ! grep -Fq '::error title=BuildKit concurrent-map fault::' <<<"$concurrent_map_output"; then
  echo 'concurrent-map fault must receive an actionable annotation' >&2
  exit 1
fi

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
