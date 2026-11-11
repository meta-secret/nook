#!/usr/bin/env bash
set -u

sccache_binary="${NOOK_SCCACHE_REPORT_BINARY:-/usr/local/bin/nook-sccache}"
runtime_mode_file="${NOOK_SCCACHE_RUNTIME_MODE_FILE:-/run/secrets/sccache_runtime_mode}"
report_dir="${NOOK_SCCACHE_REPORT_DIR:-/opt/nook/sccache-reports}"
ready_marker="${NOOK_SCCACHE_READY_MARKER:-/dev/shm/nook-sccache-remote-ready}"
access_file="${SCCACHE_S3_ACCESS_KEY_FILE:-/run/secrets/sccache_s3_access_key}"
require_health=0
finish_cache=0
cache_expected=1

while [ "$#" -gt 0 ]; do
  case "$1" in
    --require) require_health=1; shift ;;
    --finish) finish_cache=1; shift ;;
    *) break ;;
  esac
done
stage="${1:-unknown}"
if [ "${NOOK_SCCACHE_S3_MODE:-local}" = external ] \
  && [ -z "${AWS_ACCESS_KEY_ID:-}" ] \
  && [ ! -r "$access_file" ]; then
  # Match the wrapper's existing secret-free direct-compile boundary. There is
  # no cache daemon to finalize when compiler-cache credentials are absent.
  cache_expected=0
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
case "${SCCACHE_MULTILEVEL_CHAIN:-}" in
  "") storage_mode=single_s3 ;;
  disk,s3) storage_mode=disk_s3 ;;
  *)
    echo 'nook-sccache-report: unsupported compiler cache chain' >&2
    exit 2
    ;;
esac
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
  if [ "$finish_cache" -eq 1 ]; then
    # Server-side compilation awaits ordinary write-through requests before
    # returning to Cargo. Stop the daemon before BuildKit snapshots its local
    # cache. Upstream detached read-hit backfills have no complete drain API.
    # The shutdown command prints storage locations, so never forward its output.
    if ! "$sccache_binary" --stop-server >/dev/null 2>&1; then
      printf 'nook-sccache-report: cache shutdown failed for %s\n' "$stage" >&2
      exit 1
    fi
    rm -f "$ready_marker"
    printf 'NOOK_SCCACHE_FINALIZED {"stage":"%s"}\n' "$stage"
  fi
  if command -v jq >/dev/null 2>&1; then
    report="$(
      jq -c \
        --arg stage "$stage" \
        --arg baked_runtime_mode "$baked_runtime_mode" \
        --arg runtime_mode "$runtime_mode" \
        --arg runtime_mode_source "$runtime_mode_source" \
        --arg storage_mode "$storage_mode" \
        --arg client_side "$client_side" '
        def count_values: ([.counts[]?] | add) // 0;
        def scalar_or_counts: if type == "object" then count_values else (. // 0) end;
        def measured_level($backend):
          if (.stats.multi_level | type) == "array" and (.stats.multi_level | length) == 2 then
            [.stats.multi_level[] | select(.name | endswith("(" + $backend + ")"))] |
            if length == 1 then .[0] else error("missing configured storage level") end |
            if all(.hits, .writes, .write_failures, .backfills_to;
              type == "number" and . >= 0 and . <= 9007199254740991 and floor == .) then .
            else error("invalid storage counter") end
          else error("invalid configured storage levels") end;
        def level_count($backend; $counter):
          measured_level($backend) | .[$counter] |
          if type == "number" and . >= 0 and . <= 9007199254740991 and floor == . then .
          else error("invalid storage counter") end;
        def storage_count($backend; $counter; $single):
          if $storage_mode == "disk_s3" then level_count($backend; $counter) else $single end;
        storage_count("disk"; "write_failures"; 0) as $local_write_errors |
        storage_count("s3"; "write_failures"; (.stats.cache_write_errors | scalar_or_counts)) as $remote_write_errors |
        storage_count("s3"; "writes"; (.stats.cache_writes // 0)) as $remote_writes |
        {
          stage: $stage,
          baked_runtime_mode: $baked_runtime_mode,
          runtime_mode: $runtime_mode,
          runtime_mode_source: $runtime_mode_source,
          client_side: ($client_side == "1"),
          counter_reliability: (if $client_side == "1" then "backend_incomplete" else "authoritative" end),
          publication_status: (if $client_side == "1" and $remote_writes == 0 then "pending_verification" else "counters_observed" end),
          compile_requests: (.stats.compile_requests // 0),
          requests_executed: (.stats.requests_executed // 0),
          cache_hits: (.stats.cache_hits | count_values),
          cache_misses: (.stats.cache_misses | count_values),
          cache_errors: (.stats.cache_errors | count_values),
          cache_write_errors: ([(.stats.cache_write_errors | scalar_or_counts), ($local_write_errors + $remote_write_errors)] | max),
          cache_writes: (.stats.cache_writes // 0),
          local_hits: storage_count("disk"; "hits"; 0),
          remote_hits: storage_count("s3"; "hits"; (.stats.cache_hits | count_values)),
          local_writes: storage_count("disk"; "writes"; 0),
          remote_writes: $remote_writes,
          local_write_errors: $local_write_errors,
          remote_write_errors: $remote_write_errors,
          local_backfills: storage_count("disk"; "backfills_to"; 0),
          compile_failures: (.stats.compile_fails | scalar_or_counts)
        }
      ' <<<"$stats_json" 2>/dev/null
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
        NOOK_SCCACHE_STORAGE_MODE="$storage_mode" \
        NOOK_SCCACHE_CLIENT_SIDE="$client_side" \
          "$json_runtime" -e '
            const stats = JSON.parse(process.env.NOOK_SCCACHE_STATS_JSON);
            const count = (value) => value && typeof value === "object"
              ? Object.values(value.counts || {}).reduce((sum, item) => sum + Number(item || 0), 0)
              : Number(value || 0);
            const scalarOrCounts = (value) => value && typeof value === "object" ? count(value) : Number(value || 0);
            const cacheWrites = Number(stats.stats.cache_writes || 0);
            /** @typedef {object} StorageStatisticsRequest
             * @property {string} mode
             * @property {unknown} nativeLevels
             * @property {number} singleHits
             * @property {number} singleWrites
             * @property {number} singleWriteErrors
             */
            /** @typedef {object} StorageLevelRequest
             * @property {"disk" | "s3"} backend
             */
            class NativeStorageStatistics {
              /** @param {StorageStatisticsRequest} request */
              constructor(request) {
                this.request = request;
              }
              /** @param {StorageLevelRequest} request */
              measuredLevel(request) {
                const levels = this.request.nativeLevels;
                switch (Array.isArray(levels) && levels.length === 2) {
                  case true: break;
                  case false: throw new Error("invalid configured storage levels");
                }
                const matches = levels.filter((level) => typeof level.name === "string" &&
                  level.name.endsWith("(" + request.backend + ")"));
                switch (matches.length) {
                  case 1: break;
                  default: throw new Error("missing configured storage level");
                }
                const level = matches[0];
                for (const counter of ["hits", "writes", "write_failures", "backfills_to"]) {
                  switch (Number.isSafeInteger(level[counter]) && level[counter] >= 0) {
                    case true: break;
                    case false: throw new Error("invalid storage counter");
                  }
                }
                return level;
              }
              measure() {
                switch (this.request.mode) {
                  case "single_s3":
                    return {
                      local_hits: 0, remote_hits: this.request.singleHits,
                      local_writes: 0, remote_writes: this.request.singleWrites,
                      local_write_errors: 0, remote_write_errors: this.request.singleWriteErrors,
                      local_backfills: 0,
                    };
                  case "disk_s3": break;
                  default: throw new Error("unsupported compiler cache chain");
                }
                /** @type {StorageLevelRequest} */
                const diskRequest = { backend: "disk" };
                /** @type {StorageLevelRequest} */
                const s3Request = { backend: "s3" };
                const disk = this.measuredLevel(diskRequest);
                const s3 = this.measuredLevel(s3Request);
                return {
                  local_hits: disk.hits, remote_hits: s3.hits,
                  local_writes: disk.writes, remote_writes: s3.writes,
                  local_write_errors: disk.write_failures, remote_write_errors: s3.write_failures,
                  local_backfills: disk.backfills_to,
                };
              }
            }
            /** @type {StorageStatisticsRequest} */
            const storageRequest = {
              mode: process.env.NOOK_SCCACHE_STORAGE_MODE,
              nativeLevels: stats.stats.multi_level,
              singleHits: count(stats.stats.cache_hits),
              singleWrites: cacheWrites,
              singleWriteErrors: count(stats.stats.cache_write_errors),
            };
            const storage = new NativeStorageStatistics(storageRequest).measure();
            const PublicationStatus = Object.freeze({ Pending: "pending_verification", Observed: "counters_observed" });
            let publicationStatus = PublicationStatus.Observed;
            switch (process.env.NOOK_SCCACHE_CLIENT_SIDE === "1" && storage.remote_writes === 0) {
              case true: publicationStatus = PublicationStatus.Pending; break;
              case false: break;
            }
            const report = {
              stage: process.env.NOOK_SCCACHE_STAGE,
              baked_runtime_mode: process.env.NOOK_SCCACHE_BAKED_RUNTIME_MODE,
              runtime_mode: process.env.NOOK_SCCACHE_RUNTIME_MODE,
              runtime_mode_source: process.env.NOOK_SCCACHE_RUNTIME_MODE_SOURCE,
              client_side: process.env.NOOK_SCCACHE_CLIENT_SIDE === "1",
              counter_reliability: process.env.NOOK_SCCACHE_CLIENT_SIDE === "1" ? "backend_incomplete" : "authoritative",
              publication_status: publicationStatus,
              compile_requests: Number(stats.stats.compile_requests || 0),
              requests_executed: Number(stats.stats.requests_executed || 0),
              cache_hits: count(stats.stats.cache_hits),
              cache_misses: count(stats.stats.cache_misses),
              cache_errors: count(stats.stats.cache_errors),
              cache_write_errors: Math.max(count(stats.stats.cache_write_errors),
                storage.local_write_errors + storage.remote_write_errors),
              cache_writes: cacheWrites,
              ...storage,
              compile_failures: scalarOrCounts(stats.stats.compile_fails),
            };
            process.stdout.write(JSON.stringify(report));
          ' 2>/dev/null
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
        && jq -e '.client_side == true and .cache_errors == 0 and .cache_write_errors == 0 and .remote_writes == 0' \
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
              report.cache_errors === 0 && report.cache_write_errors === 0 && report.remote_writes === 0)
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
  if [ "$finish_cache" -eq 1 ]; then
    printf 'nook-sccache-report: invalid statistics for cache snapshot %s\n' "$stage" >&2
  else
    printf 'nook-sccache-report: invalid statistics for %s\n' "$stage" >&2
  fi
  exit 1
fi

printf 'nook-sccache-report: statistics unavailable for %s\n' "$stage" >&2
if [ "$require_health" -eq 1 ] \
  || { [ "$finish_cache" -eq 1 ] && [ "$cache_expected" -eq 1 ]; }; then
  exit 1
fi
exit 0
