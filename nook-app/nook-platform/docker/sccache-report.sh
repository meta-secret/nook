#!/usr/bin/env bash
set -u

stage="${1:-unknown}"
if stats_json="$(/usr/local/bin/nook-sccache --show-stats --stats-format=json 2>/dev/null)"; then
  report="$(
    jq -c --arg stage "$stage" '
      def count_values: ([.counts[]?] | add) // 0;
      {
        stage: $stage,
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
    exit 0
  fi
fi

printf 'nook-sccache-report: statistics unavailable for %s\n' "$stage" >&2
exit 0
