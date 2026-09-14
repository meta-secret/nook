#!/usr/bin/env bash
set -u

stage="${1:-unknown}"
sccache_binary="${NOOK_SCCACHE_REPORT_BINARY:-/usr/local/bin/nook-sccache}"
runtime_mode_file="${NOOK_SCCACHE_RUNTIME_MODE_FILE:-/run/secrets/sccache_runtime_mode}"
baked_runtime_mode="${SCCACHE_S3_RW_MODE:-UNSET}"
runtime_mode="$baked_runtime_mode"
runtime_mode_source=environment
client_side="${SCCACHE_CLIENT_SIDE:-0}"
case "$client_side" in
  0|1) ;;
  *)
    printf 'nook-sccache-report: unsupported SCCACHE_CLIENT_SIDE value: %s\n' "$client_side" >&2
    exit 2
    ;;
esac
if [ "${NOOK_SCCACHE_RUNTIME_AUTHORITY:-legacy}" = secret ] \
  && [ ! -r "$runtime_mode_file" ]; then
  echo 'nook-sccache-report: required runtime authority secret is unavailable' >&2
  exit 2
fi
if [ -r "$runtime_mode_file" ]; then
  runtime_mode="$(cat "$runtime_mode_file")"
  runtime_mode_source=runtime_secret
fi
if [ "$runtime_mode" != READ_WRITE ]; then
  printf 'nook-sccache-report: unsupported effective runtime mode: %s\n' "$runtime_mode" >&2
  exit 2
fi
if stats_json="$("$sccache_binary" --show-stats --stats-format=json 2>/dev/null)"; then
  report="$(
    jq -c \
      --arg stage "$stage" \
      --arg baked_runtime_mode "$baked_runtime_mode" \
      --arg runtime_mode "$runtime_mode" \
      --arg runtime_mode_source "$runtime_mode_source" \
      --arg client_side "$client_side" '
      def count_values: ([.counts[]?] | add) // 0;
      {
        stage: $stage,
        baked_runtime_mode: $baked_runtime_mode,
        runtime_mode: $runtime_mode,
        runtime_mode_source: $runtime_mode_source,
        client_side: ($client_side == "1"),
        counter_reliability: (if $client_side == "1" then "backend_incomplete" else "authoritative" end),
        publication_status: (if $client_side == "1" and (.stats.cache_writes // 0) == 0 then "pending_verification" else "counters_observed" end),
        compile_requests: (.stats.compile_requests // 0),
        requests_executed: (.stats.requests_executed // 0),
        cache_hits: (.stats.cache_hits | count_values),
        cache_misses: (.stats.cache_misses | count_values),
        cache_errors: (.stats.cache_errors | count_values),
        cache_write_errors: (if (.stats.cache_write_errors | type) == "object" then (.stats.cache_write_errors | count_values) else (.stats.cache_write_errors // 0) end),
        cache_writes: (.stats.cache_writes // 0)
      }
    ' <<<"$stats_json"
  )" || report=""
  if [ -n "$report" ]; then
    printf 'NOOK_SCCACHE_STATS %s\n' "$report"
    if jq -e '.cache_errors > 0 or .cache_write_errors > 0' \
      >/dev/null 2>&1 <<<"$report"; then
      printf 'NOOK_SCCACHE_HEALTH_WARNING %s\n' "$report" >&2
    fi
    if [ "$runtime_mode" = READ_WRITE ] \
      && jq -e '.client_side == true and .cache_errors == 0 and .cache_write_errors == 0 and .cache_writes == 0' \
        >/dev/null 2>&1 <<<"$report"; then
      printf 'NOOK_SCCACHE_PUBLICATION_PENDING_VERIFICATION %s\n' "$report" >&2
    fi
    exit 0
  fi
fi

printf 'nook-sccache-report: statistics unavailable for %s\n' "$stage" >&2
exit 0
