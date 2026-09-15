#!/bin/sh

set -eu

access_file=/run/secrets/sccache_s3_access_key
secret_file=/run/secrets/sccache_s3_secret_key
runtime_mode_file="${NOOK_SCCACHE_RUNTIME_MODE_FILE:-/run/secrets/sccache_runtime_mode}"
sccache_binary="${NOOK_SCCACHE_BINARY:-/usr/local/bin/sccache}"
fallback_marker="${NOOK_SCCACHE_FALLBACK_MARKER:-/dev/shm/nook-sccache-remote-disabled}"
ready_marker="${NOOK_SCCACHE_READY_MARKER:-/dev/shm/nook-sccache-remote-ready}"
startup_lock="${NOOK_SCCACHE_START_LOCK:-/dev/shm/nook-sccache-start-lock}"

# sccache 0.17 ignores client-side mode whenever SCCACHE_ERROR_LOG is present.
# Runner or parent-image diagnostics must therefore never reach the sccache
# process. The wrapper already captures stderr in a private temporary file and
# emits only stable, credential-free fallback events, preserving useful error
# telemetry without selecting sccache's incompatible error-log path.
unset SCCACHE_ERROR_LOG
if [ -n "${SCCACHE_ERROR_LOG:-}" ]; then
  printf '%s\n' 'NOOK_SCCACHE_CONFIGURATION_FAILURE {"reason":"error_log_conflicts_with_client_side"}' >&2
  exit 2
fi

# Keep compiler requests on sccache's server-side path. Client-side mode can
# leave concurrent remote storage requests waiting indefinitely while the
# compiler waits for cache service work. The daemon's server-side counters are
# authoritative for publication verification, and this default is identical for
# readers and publishers so runtime authority cannot divide BuildKit keys.
: "${SCCACHE_CLIENT_SIDE:=0}"
export SCCACHE_CLIENT_SIDE

# Compile-cache publishers and consumers mount this same secret ID at the same
# path. Secret contents are deliberately absent from BuildKit cache checksums,
# so runtime write authority cannot split otherwise-identical compiler keys.
if [ "${NOOK_SCCACHE_RUNTIME_AUTHORITY:-legacy}" = secret ] \
  && [ ! -r "$runtime_mode_file" ]; then
  echo 'nook-sccache: required runtime authority secret is unavailable' >&2
  exit 2
fi
if [ -r "$runtime_mode_file" ]; then
  SCCACHE_S3_RW_MODE="$(cat "$runtime_mode_file")"
  export SCCACHE_S3_RW_MODE
fi
if [ "${SCCACHE_S3_RW_MODE:-}" != READ_WRITE ]; then
  echo "unsupported SCCACHE_S3_RW_MODE: ${SCCACHE_S3_RW_MODE:-unset}" >&2
  exit 2
fi

# Cache namespaces are non-secret build policy. Keep the policy in a neutral
# ENV so Docker's secret scanner does not mistake it for a credential, then
# materialize the sccache-specific variable only for this compiler invocation.
if [ -n "${NOOK_BUILD_CACHE_NAMESPACE:-}" ]; then
  SCCACHE_S3_KEY_PREFIX="$NOOK_BUILD_CACHE_NAMESPACE"
  export SCCACHE_S3_KEY_PREFIX
fi

# Runtime commands and cache-missed BuildKit compiler vertices mount the same
# stable secret IDs. BuildKit excludes secret contents from cache checksums; the
# IDs and target paths remain constant across all builds.
if [ "${NOOK_SCCACHE_S3_MODE:-local}" = external ] \
  && [ -z "${AWS_ACCESS_KEY_ID:-}" ] \
  && [ ! -r "$access_file" ]; then
  printf '%s\n' 'NOOK_SCCACHE_FALLBACK {"backend":"direct_compile","reason":"credentials_unavailable","remote_writes":0}' >&2
  exec "$@"
fi

if [ -z "${AWS_ACCESS_KEY_ID:-}" ] && [ -r "$access_file" ]; then
  AWS_ACCESS_KEY_ID="$(cat "$access_file")"
  export AWS_ACCESS_KEY_ID
fi
if [ -z "${AWS_SECRET_ACCESS_KEY:-}" ] && [ -r "$secret_file" ]; then
  AWS_SECRET_ACCESS_KEY="$(cat "$secret_file")"
  export AWS_SECRET_ACCESS_KEY
fi

if [ -n "${AWS_ACCESS_KEY_ID:-}" ] && [ -n "${AWS_SECRET_ACCESS_KEY:-}" ]; then
  : "${SCCACHE_BUCKET:=nook-sccache}"
  : "${SCCACHE_ENDPOINT:=https://sccache.dev.nokey.sh}"
  : "${SCCACHE_REGION:=auto}"
  : "${SCCACHE_S3_USE_SSL:=true}"
  : "${SCCACHE_S3_RW_MODE:=READ_WRITE}"
  export SCCACHE_BUCKET SCCACHE_ENDPOINT SCCACHE_REGION SCCACHE_S3_USE_SSL SCCACHE_S3_RW_MODE
  # A remote read is an optimization, not a compiler availability boundary.
  # One SDK attempt prevents transient DNS/HTTP failures from consuming the
  # five-minute build budget before the wrapper can compile directly.
  : "${AWS_MAX_ATTEMPTS:=1}"
  export AWS_MAX_ATTEMPTS
  # SeaweedFS serves path-style buckets; do not enable virtual-host style.
  unset SCCACHE_S3_ENABLE_VIRTUAL_HOST_STYLE || true
fi

if [ "${NOOK_SCCACHE_S3_MODE:-local}" = external ]; then
  if [ -e "$fallback_marker" ]; then
    printf '%s\n' 'NOOK_SCCACHE_FALLBACK {"backend":"direct_compile","reason":"cache_circuit_open","remote_writes":0}' >&2
    exec "$@"
  fi
  if [ ! -e "$ready_marker" ] && mkdir "$startup_lock" 2>/dev/null; then
    startup_diagnostics="$(mktemp /tmp/nook-sccache-start.XXXXXX)"
    set +e
    timeout "${NOOK_SCCACHE_START_TIMEOUT:-2s}" \
      "$sccache_binary" --start-server > /dev/null 2>"$startup_diagnostics"
    startup_status=$?
    set -e
    if [ "$startup_status" -eq 0 ]; then
      # A descendant Docker stage may expose cumulative daemon counters. Zero
      # them before publishing readiness so every report is a disjoint per-RUN
      # terminal snapshot and aggregate telemetry cannot double-count parents.
      if "$sccache_binary" --zero-stats >/dev/null 2>&1; then
        : >"$ready_marker"
      else
        startup_status=1
        : >"$fallback_marker"
      fi
    else
      : >"$fallback_marker"
    fi
    rm -f "$startup_diagnostics"
    rmdir "$startup_lock"
    if [ "$startup_status" -ne 0 ]; then
      printf '%s\n' 'NOOK_SCCACHE_FALLBACK {"backend":"direct_compile","reason":"server_start_unavailable","remote_writes":0}' >&2
      exec "$@"
    fi
  elif [ ! -e "$ready_marker" ]; then
    startup_wait=0
    while [ "$startup_wait" -lt 20 ] \
      && [ ! -e "$ready_marker" ] \
      && [ ! -e "$fallback_marker" ]; do
      sleep 0.1
      startup_wait=$((startup_wait + 1))
    done
    if [ -e "$fallback_marker" ]; then
      printf '%s\n' 'NOOK_SCCACHE_FALLBACK {"backend":"direct_compile","reason":"cache_circuit_open","remote_writes":0}' >&2
      exec "$@"
    fi
    if [ ! -e "$ready_marker" ]; then
      : >"$fallback_marker"
      printf '%s\n' 'NOOK_SCCACHE_FALLBACK {"backend":"direct_compile","reason":"startup_coordination_timeout","remote_writes":0}' >&2
      exec "$@"
    fi
  fi
fi

compile_diagnostics="$(mktemp /tmp/nook-sccache-compile.XXXXXX)"
set +e
"$sccache_binary" "$@" 2>"$compile_diagnostics"
sccache_status=$?
set -e
if [ "$sccache_status" -eq 0 ]; then
  cat "$compile_diagnostics" >&2
  rm -f "$compile_diagnostics"
  exit 0
fi
if [ "${NOOK_SCCACHE_S3_MODE:-local}" = external ] \
  && grep -Eiq \
    'failed to execute compile|failed to start server|server startup failed|server connection unexpectedly closed' \
    "$compile_diagnostics" \
  && grep -Eiq \
    'dns|name or service not known|temporary failure in name resolution|failed to lookup address|dispatch failure|error sending request|failed to connect|connection (refused|reset|closed)|broken pipe|timed? out|http[^:]* (error|failure)|service unavailable' \
    "$compile_diagnostics"; then
  rm -f "$compile_diagnostics"
  : >"$fallback_marker"
  printf '%s\n' 'NOOK_SCCACHE_FALLBACK {"backend":"direct_compile","reason":"cache_transport_unavailable","remote_writes":0}' >&2
  exec "$@"
fi
cat "$compile_diagnostics" >&2
rm -f "$compile_diagnostics"
exit "$sccache_status"
