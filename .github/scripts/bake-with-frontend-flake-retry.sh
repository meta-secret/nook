#!/usr/bin/env bash
# Retry a BuildKit command once only for the known immediate BuildKit
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

is_unattributed_syntax_frontend_exit() {
  local log_file="$1"
  # Some BuildKit frontend disconnects are reported only as the Dockerfile
  # directive and an exit status. A failed RUN names the instruction instead,
  # so require the directive evidence before retrying this otherwise-generic
  # status.
  grep -Eiq 'Dockerfile:[0-9]+' "$log_file" \
    && grep -Eiq '>>> # syntax=docker/dockerfile:' "$log_file" \
    && grep -Eiq 'failed to solve: exit code: 2' "$log_file"
}

is_frontend_authorization_timeout() {
  local log_file="$1"
  # Docker Hub token lookup can fail before the pinned Dockerfile frontend is
  # loaded. Require both frontend resolution and the transient transport error
  # so an identical timeout from an application RUN step still fails closed.
  grep -Eiq 'resolve image config for docker-image://docker\.io/docker/dockerfile:' "$log_file" \
    && grep -Eiq 'failed to authorize:.*TLS handshake timeout' "$log_file"
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
