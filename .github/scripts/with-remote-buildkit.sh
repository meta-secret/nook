#!/usr/bin/env bash

# Select and health-check ARC's remote BuildKit client. This entrypoint may
# build or export through the Kubernetes BuildKit service, but it never owns a
# container runtime or daemon lifecycle.
set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo "usage: $0 <command> [args...]" >&2
  exit 2
fi

builder="${NOOK_PR_BUILDX_BUILDER:-}"
health_timeout="${NOOK_BUILDKIT_HEALTH_TIMEOUT_SECONDS:-60}"

case "$builder" in
  ''|nook-pr|*[!a-zA-Z0-9_.-]*)
    echo "ARC requires a valid job-scoped remote BuildKit builder" >&2
    exit 2
    ;;
esac

case "$health_timeout" in
  ''|*[!0-9]*|0)
    echo "BuildKit health timeout must be a positive whole number" >&2
    exit 2
    ;;
esac

probe_context="$(mktemp -d "${TMPDIR:-/tmp}/nook-remote-buildkit-probe.XXXXXX")"
printf 'FROM scratch\n' > "$probe_context/Dockerfile"

cleanup() {
  rm -rf "$probe_context"
}
trap cleanup EXIT

run_with_timeout() {
  local timeout_seconds="$1"
  shift

  set -m
  "$@" &
  local command_pid=$!
  set +m
  local deadline=$((SECONDS + timeout_seconds))

  while kill -0 "$command_pid" 2>/dev/null; do
    if [ "$SECONDS" -ge "$deadline" ]; then
      kill -TERM -- "-$command_pid" 2>/dev/null || true
      sleep 2
      kill -KILL -- "-$command_pid" 2>/dev/null || true
      wait "$command_pid" 2>/dev/null || true
      return 124
    fi
    sleep 1
  done

  local status=0
  wait "$command_pid" || status=$?
  return "$status"
}

probe_remote_builder() {
  docker buildx inspect "$builder" --bootstrap >/dev/null 2>&1 \
    && docker buildx build \
      --builder "$builder" \
      --file "$probe_context/Dockerfile" \
      --output type=cacheonly \
      --progress=quiet \
      "$probe_context" >/dev/null 2>&1
}

probe_status=0
run_with_timeout "$health_timeout" probe_remote_builder || probe_status=$?
if [ "$probe_status" -ne 0 ]; then
  if [ "$probe_status" -eq 124 ]; then
    echo "ARC remote BuildKit builder $builder did not respond within ${health_timeout}s" >&2
  else
    echo "ARC remote BuildKit builder $builder is missing or unhealthy" >&2
  fi
  echo "refusing hosted or local daemon recovery from an ARC Pod" >&2
  exit "$probe_status"
fi

echo "Using healthy ARC remote BuildKit builder $builder" >&2
docker buildx use "$builder"
"$@"
