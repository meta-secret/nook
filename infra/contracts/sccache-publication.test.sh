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

cat >"$fixture_dir/zero-writes.json" <<'EOF'
{"stats":{"compile_requests":339,"requests_executed":339,"cache_hits":{"counts":{"Rust":64}},"cache_misses":{"counts":{"Rust":275}},"cache_errors":{"counts":{}},"cache_writes":0}}
EOF
set +e
NOOK_SCCACHE_REPORT_BINARY="$fixture_dir/sccache" \
FAKE_SCCACHE_STATS="$fixture_dir/zero-writes.json" \
SCCACHE_S3_RW_MODE=READ_WRITE \
  "$report" publication >"$fixture_dir/zero-writes.log" 2>&1
zero_write_status=$?
set -e
test "$zero_write_status" -eq 1
grep -Fq 'NOOK_SCCACHE_PUBLICATION_FAILURE' "$fixture_dir/zero-writes.log"
grep -Fq '"cache_errors":0' "$fixture_dir/zero-writes.log"
grep -Fq '"cache_writes":0' "$fixture_dir/zero-writes.log"

cat >"$fixture_dir/completed-writes.json" <<'EOF'
{"stats":{"compile_requests":339,"requests_executed":339,"cache_hits":{"counts":{"Rust":64}},"cache_misses":{"counts":{"Rust":275}},"cache_errors":{"counts":{}},"cache_writes":275}}
EOF
NOOK_SCCACHE_REPORT_BINARY="$fixture_dir/sccache" \
FAKE_SCCACHE_STATS="$fixture_dir/completed-writes.json" \
SCCACHE_S3_RW_MODE=READ_WRITE \
  "$report" publication >"$fixture_dir/completed-writes.log" 2>&1
grep -Fq '"cache_writes":275' "$fixture_dir/completed-writes.log"

echo 'sccache publication contract: zero-error zero-write fails; completed writes pass'
