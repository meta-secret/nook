#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
wrapper="$repo_root/nook-app/nook-platform/docker/sccache-wrapper.sh"
fixture_dir="$(mktemp -d)"
trap 'rm -rf "$fixture_dir"' EXIT

cat >"$fixture_dir/compiler" <<'EOF'
#!/bin/sh
printf 'direct compiler invoked\n' >&2
exit "${FAKE_COMPILER_STATUS:-0}"
EOF

cat >"$fixture_dir/sccache" <<'EOF'
#!/bin/sh
if [ "${1:-}" = --start-server ]; then
  if [ -n "${FAKE_START_COUNT_FILE:-}" ]; then
    printf 'start\n' >>"$FAKE_START_COUNT_FILE"
  fi
  exit "${FAKE_START_STATUS:-0}"
fi
case "${FAKE_SCCACHE_RESULT:-success}" in
  success)
    test "${SCCACHE_CLIENT_SIDE:-}" = 1
    printf 'effective sccache mode: %s\n' "${SCCACHE_S3_RW_MODE:-unset}" >&2
    exec "$@"
    ;;
  transport)
    printf 'sccache: error: failed to execute compile\nCaused by: error sending request: dns lookup timed out\n' >&2
    exit 2
    ;;
  compiler)
    printf 'sccache: error: failed to execute compile\nCaused by: compiler returned error\n' >&2
    exit 7
    ;;
esac
EOF
chmod 0755 "$fixture_dir/compiler" "$fixture_dir/sccache"

runtime_publish_mode="$fixture_dir/runtime-publish-mode"
printf '%s\n' READ_WRITE >"$runtime_publish_mode"
authority_log="$fixture_dir/runtime-authority.log"
NOOK_SCCACHE_BINARY="$fixture_dir/sccache" \
NOOK_SCCACHE_RUNTIME_AUTHORITY=secret \
NOOK_SCCACHE_RUNTIME_MODE_FILE="$runtime_publish_mode" \
NOOK_SCCACHE_S3_MODE=external \
AWS_ACCESS_KEY_ID=fake AWS_SECRET_ACCESS_KEY=fake \
SCCACHE_S3_RW_MODE=READ_ONLY FAKE_SCCACHE_RESULT=success \
  "$wrapper" "$fixture_dir/compiler" 2>"$authority_log"
grep -Fq 'effective sccache mode: READ_WRITE' "$authority_log"
echo 'Sccache runtime authority: publish secret overrides the neutral baked value'

fallback_log="$fixture_dir/fallback.log"
fallback_marker="$fixture_dir/remote-disabled"
ready_marker="$fixture_dir/remote-ready"
startup_lock="$fixture_dir/start-lock"
NOOK_SCCACHE_BINARY="$fixture_dir/sccache" \
NOOK_SCCACHE_FALLBACK_MARKER="$fallback_marker" \
NOOK_SCCACHE_READY_MARKER="$ready_marker" \
NOOK_SCCACHE_START_LOCK="$startup_lock" \
NOOK_SCCACHE_S3_MODE=external \
AWS_ACCESS_KEY_ID=fake AWS_SECRET_ACCESS_KEY=fake \
SCCACHE_S3_RW_MODE=READ_ONLY FAKE_SCCACHE_RESULT=transport \
  "$wrapper" "$fixture_dir/compiler" 2>"$fallback_log"
grep -Fq 'NOOK_SCCACHE_FALLBACK {"backend":"direct_compile","reason":"cache_transport_unavailable","remote_writes":0}' "$fallback_log"
grep -Fq 'direct compiler invoked' "$fallback_log"
echo 'Sccache read/DNS fault: read-only consumer compiled directly with zero remote writes'

circuit_log="$fixture_dir/circuit.log"
NOOK_SCCACHE_BINARY="$fixture_dir/sccache" \
NOOK_SCCACHE_FALLBACK_MARKER="$fallback_marker" \
NOOK_SCCACHE_READY_MARKER="$ready_marker" \
NOOK_SCCACHE_START_LOCK="$startup_lock" \
NOOK_SCCACHE_S3_MODE=external \
AWS_ACCESS_KEY_ID=fake AWS_SECRET_ACCESS_KEY=fake \
SCCACHE_S3_RW_MODE=READ_ONLY FAKE_SCCACHE_RESULT=compiler \
  "$wrapper" "$fixture_dir/compiler" 2>"$circuit_log"
grep -Fq '"reason":"cache_circuit_open"' "$circuit_log"
grep -Fq 'direct compiler invoked' "$circuit_log"
echo 'Sccache circuit proof: later compiler invocations skipped the unavailable backend'

startup_log="$fixture_dir/startup.log"
rm -f "$fallback_marker" "$ready_marker"
NOOK_SCCACHE_BINARY="$fixture_dir/sccache" \
NOOK_SCCACHE_FALLBACK_MARKER="$fallback_marker" \
NOOK_SCCACHE_READY_MARKER="$ready_marker" \
NOOK_SCCACHE_START_LOCK="$startup_lock" \
NOOK_SCCACHE_S3_MODE=external \
AWS_ACCESS_KEY_ID=fake AWS_SECRET_ACCESS_KEY=fake \
SCCACHE_S3_RW_MODE=READ_ONLY FAKE_START_STATUS=9 \
  "$wrapper" "$fixture_dir/compiler" 2>"$startup_log"
grep -Fq '"reason":"server_start_unavailable"' "$startup_log"
grep -Fq 'direct compiler invoked' "$startup_log"
echo 'Sccache startup fault: bounded read-only fallback compiled directly'

compiler_log="$fixture_dir/compiler-failure.log"
rm -f "$fallback_marker" "$ready_marker"
set +e
NOOK_SCCACHE_BINARY="$fixture_dir/sccache" \
NOOK_SCCACHE_FALLBACK_MARKER="$fallback_marker" \
NOOK_SCCACHE_READY_MARKER="$ready_marker" \
NOOK_SCCACHE_START_LOCK="$startup_lock" \
NOOK_SCCACHE_S3_MODE=external \
AWS_ACCESS_KEY_ID=fake AWS_SECRET_ACCESS_KEY=fake \
SCCACHE_S3_RW_MODE=READ_ONLY FAKE_SCCACHE_RESULT=compiler \
  "$wrapper" "$fixture_dir/compiler" 2>"$compiler_log"
compiler_status=$?
set -e
test "$compiler_status" -eq 7
grep -Fq 'compiler returned error' "$compiler_log"
if grep -Fq 'NOOK_SCCACHE_FALLBACK' "$compiler_log"; then
  echo 'sccache wrapper contract: compiler failure was incorrectly retried directly' >&2
  exit 1
fi
echo 'Sccache compiler fault: genuine compiler failure remained terminal'

read_write_log="$fixture_dir/read-write-failure.log"
set +e
NOOK_SCCACHE_BINARY="$fixture_dir/sccache" \
NOOK_SCCACHE_FALLBACK_MARKER="$fallback_marker" \
NOOK_SCCACHE_S3_MODE=external \
AWS_ACCESS_KEY_ID=fake AWS_SECRET_ACCESS_KEY=fake \
SCCACHE_S3_RW_MODE=READ_WRITE FAKE_SCCACHE_RESULT=transport \
  "$wrapper" "$fixture_dir/compiler" 2>"$read_write_log"
read_write_status=$?
set -e
test "$read_write_status" -eq 2
grep -Fq 'error sending request: dns lookup timed out' "$read_write_log"
if grep -Eq 'NOOK_SCCACHE_FALLBACK|direct compiler invoked' "$read_write_log"; then
  echo 'sccache wrapper contract: READ_WRITE failure silently lost publication authority' >&2
  exit 1
fi
echo 'Sccache publication fault: read-write cache failure remained terminal'

healthy_start_count="$fixture_dir/healthy-start-count"
healthy_log="$fixture_dir/healthy.log"
rm -f "$fallback_marker" "$ready_marker"
for invocation in 1 2; do
  NOOK_SCCACHE_BINARY="$fixture_dir/sccache" \
  NOOK_SCCACHE_FALLBACK_MARKER="$fallback_marker" \
  NOOK_SCCACHE_READY_MARKER="$ready_marker" \
  NOOK_SCCACHE_START_LOCK="$startup_lock" \
  NOOK_SCCACHE_S3_MODE=external \
  AWS_ACCESS_KEY_ID=fake AWS_SECRET_ACCESS_KEY=fake \
  SCCACHE_S3_RW_MODE=READ_ONLY FAKE_SCCACHE_RESULT=success \
  FAKE_START_COUNT_FILE="$healthy_start_count" \
    "$wrapper" "$fixture_dir/compiler" 2>>"$healthy_log"
done
test "$(wc -l <"$healthy_start_count" | tr -d ' ')" -eq 1
test "$(grep -Fc 'direct compiler invoked' "$healthy_log")" -eq 2
echo 'Sccache healthy startup: two compiler invocations performed one startup probe'
grep -Fq 'direct compiler invoked' "$healthy_log"

echo 'sccache wrapper fallback contract: ok'
