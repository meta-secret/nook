#!/usr/bin/env bash

set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo "usage: $0 <command> [args...]" >&2
  exit 2
fi

docker_bin="${DOCKER:-docker}"
builder="${NOOK_PR_BUILDX_BUILDER:-nook-pr}"
health_timeout="${NOOK_BUILDKIT_HEALTH_TIMEOUT_SECONDS:-60}"
cleanup_timeout="${NOOK_BUILDKIT_CLEANUP_TIMEOUT_SECONDS:-15}"
container="buildx_buildkit_${builder}0"
state_volume="${container}_state"

case "$builder" in
  ''|*[!a-zA-Z0-9_.-]*)
    echo "invalid PR BuildKit builder name: $builder" >&2
    exit 2
    ;;
esac
case "$health_timeout:$cleanup_timeout" in
  *[!0-9:]*|0:*|*:0)
    echo "BuildKit timeouts must be positive whole seconds" >&2
    exit 2
    ;;
esac

probe_context="$(mktemp -d "${TMPDIR:-/tmp}/nook-buildkit-probe.XXXXXX")"
printf 'FROM scratch\n' > "$probe_context/Dockerfile"

run_with_timeout() {
  local timeout_seconds="$1"
  shift

  # Job control gives the timed command its own process group even in this
  # non-interactive shell. Docker Buildx launches child processes, so timing
  # out only the immediate shell would leave the actual client wedged.
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

probe_builder() {
  "$docker_bin" buildx inspect "$builder" --bootstrap >/dev/null 2>&1 &&
    "$docker_bin" buildx build \
      --builder "$builder" \
      --file "$probe_context/Dockerfile" \
      --output type=cacheonly \
      --progress=quiet \
      "$probe_context" >/dev/null 2>&1
}

remove_unhealthy_builder() {
  echo "Removing unhealthy BuildKit builder $builder" >&2

  local status=0
  run_with_timeout "$cleanup_timeout" "$docker_bin" rm --force "$container" >/dev/null 2>&1 || status=$?
  if [ "$status" -eq 124 ]; then
    echo "timed out force-removing BuildKit container $container" >&2
    return 1
  fi

  status=0
  run_with_timeout "$cleanup_timeout" "$docker_bin" buildx rm --force "$builder" >/dev/null 2>&1 || status=$?
  if [ "$status" -eq 124 ]; then
    echo "timed out removing BuildKit builder registration $builder" >&2
    return 1
  fi

  # The direct container kill is what unblocks a wedged daemon. Remove any
  # orphaned state volume too so the replacement cannot inherit corrupt state.
  run_with_timeout "$cleanup_timeout" "$docker_bin" volume rm --force "$state_volume" >/dev/null 2>&1 || true
}

probe_status=0
run_with_timeout "$health_timeout" probe_builder || probe_status=$?
rm -rf "$probe_context"

if [ "$probe_status" -eq 0 ]; then
  echo "Reusing healthy BuildKit builder $builder"
else
  if [ "$probe_status" -eq 124 ]; then
    echo "BuildKit builder $builder did not respond within ${health_timeout}s" >&2
  else
    echo "BuildKit builder $builder is missing or unhealthy" >&2
  fi

  remove_unhealthy_builder

  create_status=0
  run_with_timeout "$health_timeout" \
    "$docker_bin" buildx create \
      --name "$builder" \
      --driver docker-container \
      --bootstrap || create_status=$?
  if [ "$create_status" -eq 124 ]; then
    echo "timed out bootstrapping replacement BuildKit builder $builder" >&2
    remove_unhealthy_builder || true
    exit 1
  fi
  if [ "$create_status" -ne 0 ]; then
    echo "failed to bootstrap replacement BuildKit builder $builder" >&2
    exit "$create_status"
  fi
fi

BUILDX_BUILDER="$builder" "$@"
