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
{"stats":{"compile_requests":339,"requests_executed":279,"cache_hits":{"counts":{}},"cache_misses":{"counts":{"Rust":275}},"cache_errors":{"counts":{}},"cache_writes":0}}
EOF
set +e
NOOK_SCCACHE_REPORT_BINARY="$fixture_dir/sccache" \
FAKE_SCCACHE_STATS="$fixture_dir/zero-writes.json" \
NOOK_SCCACHE_RUNTIME_MODE_FILE="$fixture_dir/publish-mode" \
SCCACHE_S3_RW_MODE=READ_ONLY \
  "$report" publication >"$fixture_dir/zero-writes.log" 2>&1
zero_write_status=$?
set -e
test "$zero_write_status" -eq 1
grep -Fq 'NOOK_SCCACHE_PUBLICATION_FAILURE' "$fixture_dir/zero-writes.log"
grep -Fq '"cache_errors":0' "$fixture_dir/zero-writes.log"
grep -Fq '"cache_writes":0' "$fixture_dir/zero-writes.log"
grep -Fq '"baked_runtime_mode":"READ_ONLY"' "$fixture_dir/zero-writes.log"
grep -Fq '"runtime_mode":"READ_WRITE"' "$fixture_dir/zero-writes.log"
grep -Fq '"runtime_mode_source":"runtime_secret"' "$fixture_dir/zero-writes.log"

cat >"$fixture_dir/completed-writes.json" <<'EOF'
{"stats":{"compile_requests":339,"requests_executed":279,"cache_hits":{"counts":{}},"cache_misses":{"counts":{"Rust":275}},"cache_errors":{"counts":{}},"cache_writes":275}}
EOF
NOOK_SCCACHE_REPORT_BINARY="$fixture_dir/sccache" \
FAKE_SCCACHE_STATS="$fixture_dir/completed-writes.json" \
NOOK_SCCACHE_RUNTIME_MODE_FILE="$fixture_dir/publish-mode" \
SCCACHE_S3_RW_MODE=READ_ONLY \
  "$report" publication >"$fixture_dir/completed-writes.log" 2>&1
grep -Fq '"cache_writes":275' "$fixture_dir/completed-writes.log"
grep -Fq '"runtime_mode":"READ_WRITE"' "$fixture_dir/completed-writes.log"

NOOK_SCCACHE_REPORT_BINARY="$fixture_dir/sccache" \
FAKE_SCCACHE_STATS="$fixture_dir/zero-writes.json" \
NOOK_SCCACHE_RUNTIME_MODE_FILE="$fixture_dir/read-only-mode" \
SCCACHE_S3_RW_MODE=READ_ONLY \
  "$report" verification >"$fixture_dir/read-only.log" 2>&1
grep -Fq '"baked_runtime_mode":"READ_ONLY"' "$fixture_dir/read-only.log"
grep -Fq '"runtime_mode":"READ_ONLY"' "$fixture_dir/read-only.log"
grep -Fq '"runtime_mode_source":"runtime_secret"' "$fixture_dir/read-only.log"

echo 'sccache publication contract: runtime-secret authority agrees with telemetry'
