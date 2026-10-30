#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
report="$repo_root/nook-app/nook-platform/docker/sccache-report.sh"
fixture_dir="$(mktemp -d)"
trap 'rm -rf "$fixture_dir"' EXIT

cat >"$fixture_dir/sccache" <<'EOF'
#!/bin/sh
printf '%s\n' "$*" >>"$FAKE_SCCACHE_CALLS"
case "$1" in
  --show-stats)
    [ "${FAKE_SCCACHE_STATS_UNAVAILABLE:-0}" = 0 ] || exit 1
    cat "$FAKE_SCCACHE_STATS"
    ;;
  --stop-server)
    printf '%s\n' 'PRIVATE_CACHE_LOCATION_MUST_NOT_APPEAR'
    [ "${FAKE_SCCACHE_STOP_FAILS:-0}" = 0 ] || exit 1
    ;;
  *) exit 2 ;;
esac
EOF
chmod 0755 "$fixture_dir/sccache"
printf '%s\n' READ_WRITE >"$fixture_dir/publish-mode"
export FAKE_SCCACHE_CALLS="$fixture_dir/commands"

cat >"$fixture_dir/zero-writes.json" <<'EOF'
{"stats":{"compile_requests":339,"requests_executed":279,"cache_hits":{"counts":{}},"cache_misses":{"counts":{"Rust":275}},"cache_errors":{"counts":{}},"cache_write_errors":0,"cache_writes":0}}
EOF
NOOK_SCCACHE_REPORT_BINARY="$fixture_dir/sccache" \
FAKE_SCCACHE_STATS="$fixture_dir/zero-writes.json" \
NOOK_SCCACHE_RUNTIME_MODE_FILE="$fixture_dir/publish-mode" \
NOOK_SCCACHE_REPORT_DIR="$fixture_dir/reports" \
SCCACHE_CLIENT_SIDE=1 \
SCCACHE_S3_RW_MODE=READ_WRITE \
  bash "$report" publication >"$fixture_dir/zero-writes.log" 2>&1
grep -Fq 'NOOK_SCCACHE_PUBLICATION_PENDING_VERIFICATION' "$fixture_dir/zero-writes.log"
grep -Fq '"cache_errors":0' "$fixture_dir/zero-writes.log"
grep -Fq '"cache_write_errors":0' "$fixture_dir/zero-writes.log"
grep -Fq '"cache_writes":0' "$fixture_dir/zero-writes.log"
grep -Fq '"remote_writes":0' "$fixture_dir/zero-writes.log"
grep -Fq '"client_side":true' "$fixture_dir/zero-writes.log"
grep -Fq '"counter_reliability":"backend_incomplete"' "$fixture_dir/zero-writes.log"
grep -Fq '"baked_runtime_mode":"READ_WRITE"' "$fixture_dir/zero-writes.log"
grep -Fq '"runtime_mode":"READ_WRITE"' "$fixture_dir/zero-writes.log"
grep -Fq '"runtime_mode_source":"runtime_secret"' "$fixture_dir/zero-writes.log"
test -s "$fixture_dir/reports/publication.json"
if NOOK_SCCACHE_REPORT_BINARY="$fixture_dir/sccache" \
  FAKE_SCCACHE_STATS="$fixture_dir/zero-writes.json" \
  NOOK_SCCACHE_RUNTIME_MODE_FILE="$fixture_dir/publish-mode" \
  NOOK_SCCACHE_REPORT_DIR="$fixture_dir/reports" \
  SCCACHE_CLIENT_SIDE=0 \
  SCCACHE_S3_RW_MODE=READ_WRITE \
    bash "$report" --require publication >"$fixture_dir/zero-writes-gate.log" 2>&1; then
  echo 'sccache health gate accepted a zero-hit, zero-write compile' >&2
  exit 1
fi
grep -Fq 'health gate failed for publication' "$fixture_dir/zero-writes-gate.log"

cat >"$fixture_dir/completed-writes.json" <<'EOF'
{"stats":{"compile_requests":339,"requests_executed":279,"cache_hits":{"counts":{}},"cache_misses":{"counts":{"Rust":275}},"cache_errors":{"counts":{}},"cache_write_errors":0,"cache_writes":275}}
EOF
NOOK_SCCACHE_REPORT_BINARY="$fixture_dir/sccache" \
FAKE_SCCACHE_STATS="$fixture_dir/completed-writes.json" \
NOOK_SCCACHE_RUNTIME_MODE_FILE="$fixture_dir/publish-mode" \
NOOK_SCCACHE_REPORT_DIR="$fixture_dir/reports" \
SCCACHE_CLIENT_SIDE=1 \
SCCACHE_S3_RW_MODE=READ_WRITE \
  bash "$report" publication >"$fixture_dir/completed-writes.log" 2>&1
grep -Fq '"cache_writes":275' "$fixture_dir/completed-writes.log"
grep -Fq '"remote_writes":275' "$fixture_dir/completed-writes.log"
grep -Fq '"runtime_mode":"READ_WRITE"' "$fixture_dir/completed-writes.log"

cat >"$fixture_dir/authoritative-hits.json" <<'EOF'
{"stats":{"compile_requests":339,"requests_executed":279,"cache_hits":{"counts":{"Rust":275}},"cache_misses":{"counts":{}},"cache_errors":{"counts":{}},"cache_write_errors":0,"cache_writes":0}}
EOF
NOOK_SCCACHE_REPORT_BINARY="$fixture_dir/sccache" \
FAKE_SCCACHE_STATS="$fixture_dir/authoritative-hits.json" \
NOOK_SCCACHE_RUNTIME_MODE_FILE="$fixture_dir/publish-mode" \
NOOK_SCCACHE_REPORT_DIR="$fixture_dir/reports" \
SCCACHE_CLIENT_SIDE=0 \
SCCACHE_S3_RW_MODE=READ_WRITE \
  bash "$report" --require publication >"$fixture_dir/authoritative-hits.log" 2>&1
grep -Fq '"cache_hits":275' "$fixture_dir/authoritative-hits.log"

cat >"$fixture_dir/write-errors.json" <<'EOF'
{"stats":{"compile_requests":339,"requests_executed":279,"cache_hits":{"counts":{}},"cache_misses":{"counts":{"Rust":275}},"cache_errors":{"counts":{"S3":1}},"cache_write_errors":0,"cache_writes":0}}
EOF
NOOK_SCCACHE_REPORT_BINARY="$fixture_dir/sccache" \
FAKE_SCCACHE_STATS="$fixture_dir/write-errors.json" \
NOOK_SCCACHE_RUNTIME_MODE_FILE="$fixture_dir/publish-mode" \
NOOK_SCCACHE_REPORT_DIR="$fixture_dir/reports" \
SCCACHE_CLIENT_SIDE=1 \
  bash "$report" publication >"$fixture_dir/write-errors.log" 2>&1
grep -Fq 'NOOK_SCCACHE_HEALTH_WARNING' "$fixture_dir/write-errors.log"
grep -Fq '"cache_errors":1' "$fixture_dir/write-errors.log"

cat >"$fixture_dir/cache-write-errors.json" <<'EOF'
{"stats":{"compile_requests":339,"requests_executed":279,"cache_hits":{"counts":{}},"cache_misses":{"counts":{"Rust":275}},"cache_errors":{"counts":{}},"cache_write_errors":1,"cache_writes":0}}
EOF
NOOK_SCCACHE_REPORT_BINARY="$fixture_dir/sccache" \
FAKE_SCCACHE_STATS="$fixture_dir/cache-write-errors.json" \
NOOK_SCCACHE_RUNTIME_MODE_FILE="$fixture_dir/publish-mode" \
NOOK_SCCACHE_REPORT_DIR="$fixture_dir/reports" \
SCCACHE_CLIENT_SIDE=1 \
  bash "$report" publication >"$fixture_dir/cache-write-errors.log" 2>&1
grep -Fq 'NOOK_SCCACHE_HEALTH_WARNING' "$fixture_dir/cache-write-errors.log"
grep -Fq '"cache_errors":0' "$fixture_dir/cache-write-errors.log"
grep -Fq '"cache_write_errors":1' "$fixture_dir/cache-write-errors.log"
if grep -Fq 'NOOK_SCCACHE_PUBLICATION_PENDING_VERIFICATION' "$fixture_dir/cache-write-errors.log"; then
  echo 'cache write error was incorrectly marked pending verification' >&2
  exit 1
fi
if grep -Fq -- '--stop-server' "$FAKE_SCCACHE_CALLS"; then
  echo 'plain native telemetry unexpectedly stopped the compiler cache daemon' >&2
  exit 1
fi

cat >"$fixture_dir/multilevel.json" <<'EOF'
{"stats":{"compile_requests":7,"requests_executed":7,"cache_hits":{"counts":{"Rust":5}},"cache_misses":{"counts":{"Rust":2}},"cache_errors":{"counts":{}},"cache_write_errors":0,"cache_writes":2,"compile_fails":0,"multi_level":[{"name":"L0 (disk)","location":"PRIVATE_CACHE_LOCATION_MUST_NOT_APPEAR","hits":4,"misses":3,"writes":2,"write_failures":0,"backfills_from":0,"backfills_to":1},{"name":"L1 (s3)","location":"PRIVATE_CACHE_LOCATION_MUST_NOT_APPEAR","hits":1,"misses":2,"writes":2,"write_failures":0,"backfills_from":1,"backfills_to":0}]}}
EOF

# Exercise both installed JSON parsers. The native Rust image contains jq;
# host-native callers may use Node instead. Both must produce identical counters.
mkdir "$fixture_dir/no-jq"
for program in cat mkdir rm node; do
  ln -s "$(command -v "$program")" "$fixture_dir/no-jq/$program"
done
for parser in native no-jq; do
  parser_path="$PATH"
  if [ "$parser" = no-jq ]; then parser_path="$fixture_dir/no-jq"; fi
  : >"$FAKE_SCCACHE_CALLS"
  touch "$fixture_dir/ready"
  NOOK_SCCACHE_REPORT_BINARY="$fixture_dir/sccache" \
  FAKE_SCCACHE_STATS="$fixture_dir/multilevel.json" \
  NOOK_SCCACHE_RUNTIME_MODE_FILE="$fixture_dir/publish-mode" \
  NOOK_SCCACHE_REPORT_DIR="$fixture_dir/reports" \
  NOOK_SCCACHE_READY_MARKER="$fixture_dir/ready" \
  SCCACHE_CLIENT_SIDE=0 SCCACHE_S3_RW_MODE=READ_WRITE PATH="$parser_path" \
    /bin/bash "$report" --require --finish "multi-$parser" >"$fixture_dir/multi-$parser.log" 2>&1
  test "$(cat "$FAKE_SCCACHE_CALLS")" = "$(printf '%s\n' '--show-stats --stats-format=json' '--stop-server')"
  test ! -e "$fixture_dir/ready"
  for counter in '"cache_hits":5' '"local_hits":4' '"remote_hits":1' \
    '"local_writes":2' '"remote_writes":2' '"local_backfills":1' \
    '"local_write_errors":0' '"remote_write_errors":0' '"compile_failures":0'; do
    grep -Fq "$counter" "$fixture_dir/multi-$parser.log"
  done
  grep -Fq 'NOOK_SCCACHE_FINALIZED' "$fixture_dir/multi-$parser.log"
  if grep -Fq 'PRIVATE_CACHE_LOCATION_MUST_NOT_APPEAR' "$fixture_dir/multi-$parser.log"; then
    echo 'sccache reporter exposed a storage location' >&2
    exit 1
  fi
done

cat >"$fixture_dir/local-hits.json" <<'EOF'
{"stats":{"compile_requests":3,"requests_executed":3,"cache_hits":{"counts":{"Rust":3}},"cache_misses":{"counts":{}},"cache_errors":{"counts":{}},"cache_write_errors":0,"cache_writes":0,"compile_fails":0,"multi_level":[{"name":"L0 (disk)","location":"private","hits":3,"misses":0,"writes":0,"write_failures":0,"backfills_from":0,"backfills_to":0},{"name":"L1 (s3)","location":"private","hits":0,"misses":0,"writes":0,"write_failures":0,"backfills_from":0,"backfills_to":0}]}}
EOF
NOOK_SCCACHE_REPORT_BINARY="$fixture_dir/sccache" \
FAKE_SCCACHE_STATS="$fixture_dir/local-hits.json" \
NOOK_SCCACHE_RUNTIME_MODE_FILE="$fixture_dir/publish-mode" \
NOOK_SCCACHE_REPORT_DIR="$fixture_dir/reports" \
SCCACHE_CLIENT_SIDE=0 SCCACHE_S3_RW_MODE=READ_WRITE \
  bash "$report" --require --finish local-hits >"$fixture_dir/local-hits.log" 2>&1
grep -Fq '"local_hits":3' "$fixture_dir/local-hits.log"
grep -Fq '"remote_hits":0' "$fixture_dir/local-hits.log"
grep -Fq '"remote_writes":0' "$fixture_dir/local-hits.log"

cat >"$fixture_dir/local-writes-only.json" <<'EOF'
{"stats":{"compile_requests":2,"requests_executed":2,"cache_hits":{"counts":{}},"cache_misses":{"counts":{"Rust":2}},"cache_errors":{"counts":{}},"cache_write_errors":0,"cache_writes":2,"compile_fails":0,"multi_level":[{"name":"L0 (disk)","location":"private","hits":0,"misses":2,"writes":2,"write_failures":0,"backfills_from":0,"backfills_to":0},{"name":"L1 (s3)","location":"private","hits":0,"misses":2,"writes":0,"write_failures":1,"backfills_from":0,"backfills_to":0}]}}
EOF
if NOOK_SCCACHE_REPORT_BINARY="$fixture_dir/sccache" \
  FAKE_SCCACHE_STATS="$fixture_dir/local-writes-only.json" \
  NOOK_SCCACHE_RUNTIME_MODE_FILE="$fixture_dir/publish-mode" \
  NOOK_SCCACHE_REPORT_DIR="$fixture_dir/reports" \
  SCCACHE_CLIENT_SIDE=0 SCCACHE_S3_RW_MODE=READ_WRITE \
    bash "$report" --require --finish local-writes >"$fixture_dir/local-writes.log" 2>&1; then
  echo 'sccache health gate accepted local writes as remote publication' >&2
  exit 1
fi
grep -Fq '"cache_writes":2' "$fixture_dir/local-writes.log"
grep -Fq '"remote_writes":0' "$fixture_dir/local-writes.log"
grep -Fq '"remote_write_errors":1' "$fixture_dir/local-writes.log"
grep -Fq '"cache_write_errors":1' "$fixture_dir/local-writes.log"

cat >"$fixture_dir/compile-failure.json" <<'EOF'
{"stats":{"compile_requests":3,"requests_executed":3,"cache_hits":{"counts":{"Rust":1}},"cache_misses":{"counts":{}},"cache_errors":{"counts":{}},"cache_write_errors":0,"cache_writes":0,"compile_fails":2}}
EOF
if NOOK_SCCACHE_REPORT_BINARY="$fixture_dir/sccache" \
  FAKE_SCCACHE_STATS="$fixture_dir/compile-failure.json" \
  NOOK_SCCACHE_RUNTIME_MODE_FILE="$fixture_dir/publish-mode" \
  NOOK_SCCACHE_REPORT_DIR="$fixture_dir/reports" \
  SCCACHE_CLIENT_SIDE=0 SCCACHE_S3_RW_MODE=READ_WRITE \
    bash "$report" --require failed-compile >"$fixture_dir/compile-failure.log" 2>&1; then
  echo 'sccache health gate ignored the native compilation failure counter' >&2
  exit 1
fi
grep -Fq '"compile_failures":2' "$fixture_dir/compile-failure.log"

if NOOK_SCCACHE_REPORT_BINARY="$fixture_dir/sccache" \
  FAKE_SCCACHE_STATS="$fixture_dir/local-hits.json" FAKE_SCCACHE_STOP_FAILS=1 \
  NOOK_SCCACHE_RUNTIME_MODE_FILE="$fixture_dir/publish-mode" \
  NOOK_SCCACHE_REPORT_DIR="$fixture_dir/reports" \
  SCCACHE_CLIENT_SIDE=0 SCCACHE_S3_RW_MODE=READ_WRITE \
    bash "$report" --finish shutdown-failure >"$fixture_dir/shutdown-failure.log" 2>&1; then
  echo 'cache snapshot accepted failed daemon shutdown' >&2
  exit 1
fi
grep -Fq 'cache shutdown failed' "$fixture_dir/shutdown-failure.log"
if grep -Fq 'PRIVATE_CACHE_LOCATION_MUST_NOT_APPEAR' "$fixture_dir/shutdown-failure.log"; then
  echo 'failed shutdown exposed a storage location' >&2
  exit 1
fi

printf '%s\n' 'PRIVATE_INVALID_STATISTICS' >"$fixture_dir/invalid.json"
if NOOK_SCCACHE_REPORT_BINARY="$fixture_dir/sccache" \
  FAKE_SCCACHE_STATS="$fixture_dir/invalid.json" \
  NOOK_SCCACHE_RUNTIME_MODE_FILE="$fixture_dir/publish-mode" \
  NOOK_SCCACHE_REPORT_DIR="$fixture_dir/reports" \
  SCCACHE_CLIENT_SIDE=0 SCCACHE_S3_RW_MODE=READ_WRITE \
    bash "$report" --finish invalid-stats >"$fixture_dir/invalid-stats.log" 2>&1; then
  echo 'cache snapshot accepted invalid statistics' >&2
  exit 1
fi
grep -Fq 'invalid statistics for cache snapshot' "$fixture_dir/invalid-stats.log"
if grep -Fq PRIVATE_INVALID_STATISTICS "$fixture_dir/invalid-stats.log"; then
  echo 'statistics parser exposed raw backend diagnostics' >&2
  exit 1
fi

: >"$FAKE_SCCACHE_CALLS"
NOOK_SCCACHE_REPORT_BINARY="$fixture_dir/sccache" \
FAKE_SCCACHE_STATS_UNAVAILABLE=1 \
NOOK_SCCACHE_RUNTIME_MODE_FILE="$fixture_dir/publish-mode" \
NOOK_SCCACHE_REPORT_DIR="$fixture_dir/reports" \
NOOK_SCCACHE_S3_MODE=external SCCACHE_S3_ACCESS_KEY_FILE="$fixture_dir/no-credentials" \
AWS_ACCESS_KEY_ID= AWS_SECRET_ACCESS_KEY= \
SCCACHE_CLIENT_SIDE=0 SCCACHE_S3_RW_MODE=READ_WRITE \
  bash "$report" --finish secret-free >"$fixture_dir/secret-free.log" 2>&1
test "$(cat "$FAKE_SCCACHE_CALLS")" = '--show-stats --stats-format=json'
grep -Fq 'statistics unavailable' "$fixture_dir/secret-free.log"
if NOOK_SCCACHE_REPORT_BINARY="$fixture_dir/sccache" \
  FAKE_SCCACHE_STATS_UNAVAILABLE=1 \
  NOOK_SCCACHE_RUNTIME_MODE_FILE="$fixture_dir/publish-mode" \
  NOOK_SCCACHE_REPORT_DIR="$fixture_dir/reports" \
  NOOK_SCCACHE_S3_MODE=local \
  SCCACHE_CLIENT_SIDE=0 SCCACHE_S3_RW_MODE=READ_WRITE \
    bash "$report" --finish cache-unavailable >"$fixture_dir/cache-unavailable.log" 2>&1; then
  echo 'cache snapshot accepted unavailable required cache statistics' >&2
  exit 1
fi

echo 'sccache publication contract: native counters, isolated snapshots, and health semantics verified'
