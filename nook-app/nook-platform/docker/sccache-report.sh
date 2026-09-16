#!/usr/bin/env bash
set -u

stage="${1:-unknown}"
sccache_binary="${NOOK_SCCACHE_REPORT_BINARY:-/usr/local/bin/nook-sccache}"
runtime_mode_file="${NOOK_SCCACHE_RUNTIME_MODE_FILE:-/run/secrets/sccache_runtime_mode}"
report_dir="${NOOK_SCCACHE_REPORT_DIR:-/opt/nook/sccache-reports}"
require_health=0

if [ "$stage" = --require ]; then
  stage="${2:-}"
  require_health=1
fi

if [ "$stage" = --replay ]; then
  replay_stage="${2:-}"
  case "$replay_stage" in
    ""|*[!A-Za-z0-9._-]*)
      printf 'nook-sccache-report: invalid replay stage: %s\n' "$replay_stage" >&2
      exit 2
      ;;
  esac
  replay_file="$report_dir/$replay_stage.json"
  if [ ! -s "$replay_file" ]; then
    printf 'nook-sccache-report: persisted report is unavailable for %s\n' "$replay_stage" >&2
    exit 1
  fi
  printf 'NOOK_SCCACHE_STATS '
  cat "$replay_file"
  printf '\n'
  exit 0
fi

case "$stage" in
  ""|*[!A-Za-z0-9._-]*)
    printf 'nook-sccache-report: invalid stage: %s\n' "$stage" >&2
    exit 2
    ;;
esac
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
  if command -v jq >/dev/null 2>&1; then
    report="$(
      jq -c \
        --arg stage "$stage" \
        --arg baked_runtime_mode "$baked_runtime_mode" \
        --arg runtime_mode "$runtime_mode" \
        --arg runtime_mode_source "$runtime_mode_source" \
        --arg client_side "$client_side" '
        def count_values: ([.counts[]?] | add) // 0;
        def scalar_or_counts: if type == "object" then count_values else (. // 0) end;
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
          cache_writes: (.stats.cache_writes // 0),
          remote_writes: (.stats.cache_writes // 0),
          compile_failures: (.stats.compile_errors | scalar_or_counts)
        }
      ' <<<"$stats_json"
    )" || report=""
  else
    json_runtime="$(command -v node || command -v bun || true)"
    if [ -n "$json_runtime" ]; then
      report="$(
        NOOK_SCCACHE_STATS_JSON="$stats_json" \
        NOOK_SCCACHE_STAGE="$stage" \
        NOOK_SCCACHE_BAKED_RUNTIME_MODE="$baked_runtime_mode" \
        NOOK_SCCACHE_RUNTIME_MODE="$runtime_mode" \
        NOOK_SCCACHE_RUNTIME_MODE_SOURCE="$runtime_mode_source" \
        NOOK_SCCACHE_CLIENT_SIDE="$client_side" \
          "$json_runtime" -e '
            const stats = JSON.parse(process.env.NOOK_SCCACHE_STATS_JSON);
            const count = (value) => value && typeof value === "object"
              ? Object.values(value.counts || {}).reduce((sum, item) => sum + Number(item || 0), 0)
              : Number(value || 0);
            const scalarOrCounts = (value) => value && typeof value === "object" ? count(value) : Number(value || 0);
            const cacheWrites = Number(stats.stats.cache_writes || 0);
            const report = {
              stage: process.env.NOOK_SCCACHE_STAGE,
              baked_runtime_mode: process.env.NOOK_SCCACHE_BAKED_RUNTIME_MODE,
              runtime_mode: process.env.NOOK_SCCACHE_RUNTIME_MODE,
              runtime_mode_source: process.env.NOOK_SCCACHE_RUNTIME_MODE_SOURCE,
              client_side: process.env.NOOK_SCCACHE_CLIENT_SIDE === "1",
              counter_reliability: process.env.NOOK_SCCACHE_CLIENT_SIDE === "1" ? "backend_incomplete" : "authoritative",
              publication_status: process.env.NOOK_SCCACHE_CLIENT_SIDE === "1" && cacheWrites === 0 ? "pending_verification" : "counters_observed",
              compile_requests: Number(stats.stats.compile_requests || 0),
              requests_executed: Number(stats.stats.requests_executed || 0),
              cache_hits: count(stats.stats.cache_hits),
              cache_misses: count(stats.stats.cache_misses),
              cache_errors: count(stats.stats.cache_errors),
              cache_write_errors: count(stats.stats.cache_write_errors),
              cache_writes: cacheWrites,
              remote_writes: cacheWrites,
              compile_failures: scalarOrCounts(stats.stats.compile_errors),
            };
            process.stdout.write(JSON.stringify(report));
          '
      )" || report=""
    else
      report=""
    fi
  fi
  if [ -n "$report" ]; then
    mkdir -p "$report_dir"
    printf '%s\n' "$report" >"$report_dir/$stage.json"
    printf 'NOOK_SCCACHE_STATS %s\n' "$report"
    json_runtime=""
    if ! command -v jq >/dev/null 2>&1; then
      json_runtime="$(command -v node || command -v bun || true)"
    fi
    if command -v jq >/dev/null 2>&1; then
      if jq -e '.cache_errors > 0 or .cache_write_errors > 0' \
        >/dev/null 2>&1 <<<"$report"; then
        printf 'NOOK_SCCACHE_HEALTH_WARNING %s\n' "$report" >&2
      fi
      if [ "$runtime_mode" = READ_WRITE ] \
        && jq -e '.client_side == true and .cache_errors == 0 and .cache_write_errors == 0 and .cache_writes == 0' \
          >/dev/null 2>&1 <<<"$report"; then
        printf 'NOOK_SCCACHE_PUBLICATION_PENDING_VERIFICATION %s\n' "$report" >&2
      fi
    elif [ -n "$json_runtime" ]; then
      NOOK_SCCACHE_REPORT_JSON="$report" \
        "$json_runtime" -e '
          const report = JSON.parse(process.env.NOOK_SCCACHE_REPORT_JSON);
          if (report.cache_errors > 0 || report.cache_write_errors > 0)
            console.error("NOOK_SCCACHE_HEALTH_WARNING " + JSON.stringify(report));
          if (report.runtime_mode === "READ_WRITE" && report.client_side === true &&
              report.cache_errors === 0 && report.cache_write_errors === 0 && report.cache_writes === 0)
            console.error("NOOK_SCCACHE_PUBLICATION_PENDING_VERIFICATION " + JSON.stringify(report));
        ' >&2
    fi
    health_status=0
    if [ "$require_health" -eq 1 ]; then
      if command -v jq >/dev/null 2>&1; then
        jq -e '
          .baked_runtime_mode == "READ_WRITE" and
          .runtime_mode == "READ_WRITE" and
          .counter_reliability == "authoritative" and
          .client_side == false and
          .compile_requests > 0 and
          .requests_executed > 0 and
          .cache_errors == 0 and
          .cache_write_errors == 0 and
          .compile_failures == 0 and
          (.cache_hits > 0 or (.cache_misses > 0 and .remote_writes > 0))
        ' >/dev/null 2>&1 <<<"$report" || health_status=1
      elif [ -n "$json_runtime" ]; then
        NOOK_SCCACHE_REPORT_JSON="$report" \
          "$json_runtime" -e '
            const report = JSON.parse(process.env.NOOK_SCCACHE_REPORT_JSON);
            const healthy = report.baked_runtime_mode === "READ_WRITE" &&
              report.runtime_mode === "READ_WRITE" &&
              report.counter_reliability === "authoritative" &&
              report.client_side === false &&
              report.compile_requests > 0 &&
              report.requests_executed > 0 &&
              report.cache_errors === 0 &&
              report.cache_write_errors === 0 &&
              report.compile_failures === 0 &&
              (report.cache_hits > 0 || (report.cache_misses > 0 && report.remote_writes > 0));
            process.exit(healthy ? 0 : 1);
          ' >/dev/null 2>&1 || health_status=1
      else
        health_status=1
      fi
    fi
    if [ "$health_status" -ne 0 ]; then
      printf 'nook-sccache-report: health gate failed for %s (requires authoritative remote use, healthy transport, and hits or cold-publisher writes)\n' "$stage" >&2
      exit 1
    fi
    exit 0
  fi
fi

printf 'nook-sccache-report: statistics unavailable for %s\n' "$stage" >&2
if [ "$require_health" -eq 1 ]; then
  exit 1
fi
exit 0
