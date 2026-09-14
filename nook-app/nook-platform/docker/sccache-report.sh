#!/usr/bin/env bash
set -u

stage="${1:-unknown}"
sccache_binary="${NOOK_SCCACHE_REPORT_BINARY:-/usr/local/bin/nook-sccache}"
runtime_mode_file="${NOOK_SCCACHE_RUNTIME_MODE_FILE:-/run/secrets/sccache_runtime_mode}"
baked_runtime_mode="${SCCACHE_S3_RW_MODE:-UNSET}"
runtime_mode="$baked_runtime_mode"
runtime_mode_source=environment
if [ "${NOOK_SCCACHE_RUNTIME_AUTHORITY:-legacy}" = secret ] \
  && [ ! -r "$runtime_mode_file" ]; then
  echo 'nook-sccache-report: required runtime authority secret is unavailable' >&2
  exit 2
fi
if [ -r "$runtime_mode_file" ]; then
  runtime_mode="$(cat "$runtime_mode_file")"
  runtime_mode_source=runtime_secret
fi
case "$runtime_mode" in
  READ_ONLY|READ_WRITE) ;;
  *)
    printf 'nook-sccache-report: unsupported effective runtime mode: %s\n' "$runtime_mode" >&2
    exit 2
    ;;
esac
if stats_json="$("$sccache_binary" --show-stats --stats-format=json 2>/dev/null)"; then
  report="$(
    jq -c \
      --arg stage "$stage" \
      --arg baked_runtime_mode "$baked_runtime_mode" \
      --arg runtime_mode "$runtime_mode" \
      --arg runtime_mode_source "$runtime_mode_source" '
      def count_values: ([.counts[]?] | add) // 0;
      {
        stage: $stage,
        baked_runtime_mode: $baked_runtime_mode,
        runtime_mode: $runtime_mode,
        runtime_mode_source: $runtime_mode_source,
        compile_requests: (.stats.compile_requests // 0),
        requests_executed: (.stats.requests_executed // 0),
        cache_hits: (.stats.cache_hits | count_values),
        cache_misses: (.stats.cache_misses | count_values),
        cache_errors: (.stats.cache_errors | count_values),
        cache_writes: (.stats.cache_writes // 0)
      }
    ' <<<"$stats_json"
  )" || report=""
  if [ -n "$report" ]; then
    printf 'NOOK_SCCACHE_STATS %s\n' "$report"
    if [ "$runtime_mode" = READ_WRITE ] \
      && jq -e '.cache_errors > 0 or (.cache_misses > 0 and .cache_writes == 0)' \
        >/dev/null 2>&1 <<<"$report"; then
      printf 'NOOK_SCCACHE_PUBLICATION_FAILURE %s\n' "$report" >&2
      exit 1
    fi
    if [ "$runtime_mode" = READ_ONLY ] \
      && jq -e '.cache_writes > 0' >/dev/null 2>&1 <<<"$report"; then
      printf 'NOOK_SCCACHE_READ_ONLY_WRITE_FAILURE %s\n' "$report" >&2
      exit 1
    fi
    exit 0
  fi
fi

printf 'nook-sccache-report: statistics unavailable for %s\n' "$stage" >&2
exit 0
