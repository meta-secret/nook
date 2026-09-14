#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
report="$repo_root/nook-app/nook-platform/docker/sccache-report.sh"
fixture_dir="$(mktemp -d)"
trap 'rm -rf "$fixture_dir"' EXIT

cat >"$fixture_dir/sccache" <<'EOF'
#!/bin/sh
cat "$FAKE_SCCACHE_STATS"
EOF
chmod 0755 "$fixture_dir/sccache"
printf '%s\n' READ_WRITE >"$fixture_dir/publish-mode"
printf '%s\n' READ_ONLY >"$fixture_dir/read-only-mode"

cat >"$fixture_dir/zero-writes.json" <<'EOF'
{"stats":{"compile_requests":339,"requests_executed":279,"cache_hits":{"counts":{}},"cache_misses":{"counts":{"Rust":275}},"cache_errors":{"counts":{}},"cache_write_errors":0,"cache_writes":0}}
EOF
NOOK_SCCACHE_REPORT_BINARY="$fixture_dir/sccache" \
FAKE_SCCACHE_STATS="$fixture_dir/zero-writes.json" \
NOOK_SCCACHE_RUNTIME_MODE_FILE="$fixture_dir/publish-mode" \
SCCACHE_CLIENT_SIDE=1 \
SCCACHE_S3_RW_MODE=READ_ONLY \
  "$report" publication >"$fixture_dir/zero-writes.log" 2>&1
grep -Fq 'NOOK_SCCACHE_PUBLICATION_PENDING_VERIFICATION' "$fixture_dir/zero-writes.log"
grep -Fq '"cache_errors":0' "$fixture_dir/zero-writes.log"
grep -Fq '"cache_write_errors":0' "$fixture_dir/zero-writes.log"
grep -Fq '"cache_writes":0' "$fixture_dir/zero-writes.log"
grep -Fq '"client_side":true' "$fixture_dir/zero-writes.log"
grep -Fq '"counter_reliability":"backend_incomplete"' "$fixture_dir/zero-writes.log"
grep -Fq '"baked_runtime_mode":"READ_ONLY"' "$fixture_dir/zero-writes.log"
grep -Fq '"runtime_mode":"READ_WRITE"' "$fixture_dir/zero-writes.log"
grep -Fq '"runtime_mode_source":"runtime_secret"' "$fixture_dir/zero-writes.log"

cat >"$fixture_dir/completed-writes.json" <<'EOF'
{"stats":{"compile_requests":339,"requests_executed":279,"cache_hits":{"counts":{}},"cache_misses":{"counts":{"Rust":275}},"cache_errors":{"counts":{}},"cache_write_errors":0,"cache_writes":275}}
EOF
NOOK_SCCACHE_REPORT_BINARY="$fixture_dir/sccache" \
FAKE_SCCACHE_STATS="$fixture_dir/completed-writes.json" \
NOOK_SCCACHE_RUNTIME_MODE_FILE="$fixture_dir/publish-mode" \
SCCACHE_CLIENT_SIDE=1 \
SCCACHE_S3_RW_MODE=READ_ONLY \
  "$report" publication >"$fixture_dir/completed-writes.log" 2>&1
grep -Fq '"cache_writes":275' "$fixture_dir/completed-writes.log"
grep -Fq '"runtime_mode":"READ_WRITE"' "$fixture_dir/completed-writes.log"

cat >"$fixture_dir/write-errors.json" <<'EOF'
{"stats":{"compile_requests":339,"requests_executed":279,"cache_hits":{"counts":{}},"cache_misses":{"counts":{"Rust":275}},"cache_errors":{"counts":{"S3":1}},"cache_write_errors":0,"cache_writes":0}}
EOF
set +e
NOOK_SCCACHE_REPORT_BINARY="$fixture_dir/sccache" \
FAKE_SCCACHE_STATS="$fixture_dir/write-errors.json" \
NOOK_SCCACHE_RUNTIME_MODE_FILE="$fixture_dir/publish-mode" \
SCCACHE_CLIENT_SIDE=1 \
  "$report" publication >"$fixture_dir/write-errors.log" 2>&1
write_error_status=$?
set -e
test "$write_error_status" -eq 1
grep -Fq 'NOOK_SCCACHE_PUBLICATION_FAILURE' "$fixture_dir/write-errors.log"
grep -Fq '"cache_errors":1' "$fixture_dir/write-errors.log"

cat >"$fixture_dir/cache-write-errors.json" <<'EOF'
{"stats":{"compile_requests":339,"requests_executed":279,"cache_hits":{"counts":{}},"cache_misses":{"counts":{"Rust":275}},"cache_errors":{"counts":{}},"cache_write_errors":1,"cache_writes":0}}
EOF
set +e
NOOK_SCCACHE_REPORT_BINARY="$fixture_dir/sccache" \
FAKE_SCCACHE_STATS="$fixture_dir/cache-write-errors.json" \
NOOK_SCCACHE_RUNTIME_MODE_FILE="$fixture_dir/publish-mode" \
SCCACHE_CLIENT_SIDE=1 \
  "$report" publication >"$fixture_dir/cache-write-errors.log" 2>&1
cache_write_error_status=$?
set -e
test "$cache_write_error_status" -eq 1
grep -Fq 'NOOK_SCCACHE_PUBLICATION_FAILURE' "$fixture_dir/cache-write-errors.log"
grep -Fq '"cache_errors":0' "$fixture_dir/cache-write-errors.log"
grep -Fq '"cache_write_errors":1' "$fixture_dir/cache-write-errors.log"
if grep -Fq 'NOOK_SCCACHE_PUBLICATION_PENDING_VERIFICATION' "$fixture_dir/cache-write-errors.log"; then
  echo 'cache write error was incorrectly marked pending verification' >&2
  exit 1
fi

NOOK_SCCACHE_REPORT_BINARY="$fixture_dir/sccache" \
FAKE_SCCACHE_STATS="$fixture_dir/zero-writes.json" \
NOOK_SCCACHE_RUNTIME_MODE_FILE="$fixture_dir/read-only-mode" \
SCCACHE_S3_RW_MODE=READ_ONLY \
SCCACHE_CLIENT_SIDE=1 \
  "$report" verification >"$fixture_dir/read-only.log" 2>&1
grep -Fq '"baked_runtime_mode":"READ_ONLY"' "$fixture_dir/read-only.log"
grep -Fq '"runtime_mode":"READ_ONLY"' "$fixture_dir/read-only.log"
grep -Fq '"runtime_mode_source":"runtime_secret"' "$fixture_dir/read-only.log"

set +e
NOOK_SCCACHE_REPORT_BINARY="$fixture_dir/sccache" \
FAKE_SCCACHE_STATS="$fixture_dir/completed-writes.json" \
NOOK_SCCACHE_RUNTIME_MODE_FILE="$fixture_dir/read-only-mode" \
SCCACHE_CLIENT_SIDE=1 \
  "$report" verification >"$fixture_dir/read-only-writes.log" 2>&1
read_only_write_status=$?
set -e
test "$read_only_write_status" -eq 1
grep -Fq 'NOOK_SCCACHE_READ_ONLY_WRITE_FAILURE' "$fixture_dir/read-only-writes.log"

echo 'sccache publication contract: client-side incomplete counters defer to next-head verification'
