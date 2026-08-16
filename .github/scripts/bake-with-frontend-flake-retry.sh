#!/usr/bin/env bash
# Retry a Bake command once only for the known immediate BuildKit
# frontend/Dockerfile-load flake. Application/build failures fail closed.
set -euo pipefail

if [ "$#" -lt 2 ]; then
  echo "usage: bake-with-frontend-flake-retry.sh <log-label> <command> [args...]" >&2
  exit 2
fi

label="$1"
shift

is_buildkit_frontend_flake() {
  local log_file="$1"
  # Match only infrastructure flakes that occur before or while loading the
  # Dockerfile/frontend, not RUN-step application failures.
  grep -Eiq \
    -e 'failed to read dockerfile' \
    -e 'error reading dockerfile' \
    -e 'failed to load LLB definition' \
    -e 'dockerfile: parse error' \
    -e 'error from sender' \
    -e 'rpc error: code = Unavailable' \
    -e 'rpc error: code = DeadlineExceeded' \
    -e 'rpc error: code = Canceled' \
    -e 'transport is closing' \
    -e 'connection reset by peer' \
    -e 'use of closed network connection' \
    -e 'unexpected EOF' \
    -e 'error reading from server: EOF' \
    -e 'frontend grpc server closed unexpectedly' \
    -e 'BuildKit is inactive' \
    "$log_file"
}

is_immediate_dockerfile_load_flake() {
  local log_file="$1"
  # BuildKit sometimes terminates immediately after loading the Dockerfile
  # frontend. The failed Main run reported only Dockerfile:1 and the solver's
  # exit code, with no .dockerignore or build-context progress. Keep this
  # narrow so RUN-step and cache-export failures still fail closed.
  grep -Fq 'Dockerfile:1' "$log_file" \
    && grep -Fq 'failed to solve: exit code: 2' "$log_file" \
    && ! grep -Fq 'load .dockerignore' "$log_file"
}

# BSD/macOS mktemp requires the X template to end the path.
log_file="$(mktemp "${TMPDIR:-/tmp}/nook-bake-flake.XXXXXX")"
cleanup() {
  rm -f "$log_file"
}
trap cleanup EXIT

for attempt in 1 2; do
  set +e
  "$@" > >(tee -a "$log_file") 2> >(tee -a "$log_file" >&2)
  status=$?
  set -e
  if [ "$status" -eq 0 ]; then
    exit 0
  fi
  if [ "$attempt" -eq 2 ]; then
    exit "$status"
  fi
  if ! is_buildkit_frontend_flake "$log_file" \
    && ! is_immediate_dockerfile_load_flake "$log_file"; then
    echo "task ${label}: non-transient Bake failure; not retrying" >&2
    exit "$status"
  fi
  echo "task ${label}: transient Bake failure; retrying in 2s..." >&2
  : >"$log_file"
  sleep 2
done

exit 1
