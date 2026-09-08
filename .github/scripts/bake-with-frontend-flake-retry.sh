#!/usr/bin/env bash
# Retry a BuildKit command once only for known frontend, client-session, or
# cache-export transport flakes. Application/build failures fail closed.
set -euo pipefail

if [ "$#" -lt 2 ]; then
  echo "usage: bake-with-frontend-flake-retry.sh <log-label> <command> [args...]" >&2
  exit 2
fi

label="$1"
shift

is_buildkit_transport_flake() {
  local log_file="$1"
  # Match only infrastructure transport failures. These can occur while loading
  # the frontend, transferring the source context, or exporting a verified cache.
  grep -Eiq \
    -e 'failed to read dockerfile' \
    -e 'error reading dockerfile' \
    -e 'failed to load LLB definition' \
    -e 'dockerfile: parse error' \
    -e 'error from sender' \
    -e 'rpc error: code = Unavailable' \
    -e 'rpc error: code = DeadlineExceeded' \
    -e 'rpc error: code = Canceled' \
    -e 'no active session for .*: context deadline exceeded' \
    -e 'transport is closing' \
    -e 'connection reset by peer' \
    -e 'use of closed network connection' \
    -e 'unexpected EOF' \
    -e 'error reading from server: EOF' \
    -e 'frontend grpc server closed unexpectedly' \
    -e 'BuildKit is inactive' \
    "$log_file"
}

is_unattributed_syntax_frontend_exit() {
  local log_file="$1"
  # Some BuildKit frontend disconnects are reported only as the Dockerfile
  # directive and an exit status. A failed RUN names the instruction instead,
  # so require the directive evidence before retrying this otherwise-generic
  # status.
  grep -Eiq 'Dockerfile:[0-9]+' "$log_file" \
    && grep -Eiq '>>> # syntax=(registry\.dev\.nokey\.sh/)?docker/dockerfile:' "$log_file" \
    && grep -Eiq 'failed to solve: exit code: 2' "$log_file"
}

is_frontend_authorization_timeout() {
  local log_file="$1"
  # Docker Hub token lookup can fail before the pinned Dockerfile frontend is
  # loaded. Require the transient transport error on that same BuildKit vertex
  # so a later application vertex cannot reuse a successful frontend marker.
  awk '
    /resolve image config for docker-image:\/\/docker\.io\/docker\/dockerfile:/ && $1 ~ /^#[0-9]+$/ {
      frontend_vertex = $1
    }
    /failed to authorize:.*TLS handshake timeout/ && frontend_vertex != "" && $1 == frontend_vertex {
      found = 1
    }
    END { exit(found ? 0 : 1) }
  ' "$log_file"
}

report_buildkit_cache_diagnostics() {
  local log_file="$1"
  local label="$2"
  awk -v label="$label" '
    /^#[0-9]+ exporting cache to registry/ {
      export_vertex[$1] = 1
    }
    export_vertex[$1] && /preparing build cache for export [0-9.]+s done$/ {
      value = $(NF - 1)
      sub(/s$/, "", value)
      preparation[$1] = value + 0
    }
    export_vertex[$1] && /^#[0-9]+ DONE [0-9.]+s$/ {
      value = $3
      sub(/s$/, "", value)
      total[$1] = value + 0
    }
    END {
      for (vertex in total) {
        registry = total[vertex] - preparation[vertex]
        if (registry < 0) registry = 0
        printf "BuildKit cache phase metric: label=%s vertex=%s preparation_seconds=%.1f registry_send_seconds=%.1f total_export_seconds=%.1f\n", label, vertex, preparation[vertex], registry, total[vertex]
      }
    }
  ' "$log_file"
  if grep -Fqi 'fatal error: concurrent map writes' "$log_file"; then
    echo "::error title=BuildKit concurrent-map fault::The selected BuildKit shard reported concurrent map writes; inspect the shard logs and remove it from service before retrying"
  fi
}

# BSD/macOS mktemp requires the X template to end the path.
log_file="$(mktemp "${TMPDIR:-/tmp}/nook-bake-flake.XXXXXX")"
cleanup() {
  rm -f "$log_file"
}
trap cleanup EXIT

for attempt in 1 2; do
  set +e
  "$@" 2>&1 | tee -a "$log_file"
  status=${PIPESTATUS[0]}
  set -e
  report_buildkit_cache_diagnostics "$log_file" "$label"
  if [ "$status" -eq 0 ]; then
    exit 0
  fi
  if [ "$attempt" -eq 2 ]; then
    exit "$status"
  fi
  if ! is_buildkit_transport_flake "$log_file" \
    && ! is_unattributed_syntax_frontend_exit "$log_file" \
    && ! is_frontend_authorization_timeout "$log_file"; then
    echo "task ${label}: non-transient BuildKit failure; not retrying" >&2
    exit "$status"
  fi
  echo "task ${label}: transient BuildKit failure; retrying in 2s..." >&2
  : >"$log_file"
  sleep 2
done

exit 1
