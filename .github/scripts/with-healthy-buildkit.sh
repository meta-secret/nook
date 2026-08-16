#!/usr/bin/env bash

set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo "usage: $0 <command> [args...]" >&2
  exit 2
fi

docker_bin="${DOCKER:-docker}"
health_timeout="${NOOK_BUILDKIT_HEALTH_TIMEOUT_SECONDS:-60}"
cleanup_timeout="${NOOK_BUILDKIT_CLEANUP_TIMEOUT_SECONDS:-15}"

# Never default to a shared docker-container builder. Delivery used to reuse
# `nook-pr` across local and self-hosted runs; one wedged or concurrent build
# could exhaust the host. Hosted CI must pass a job-scoped builder from
# docker/setup-buildx-action. Local optional CI uses the daemon-embedded
# BuildKit default. Taskfiles must never pass --builder; this wrapper selects
# the active default with `docker buildx use` when a job builder is present.
builder="${NOOK_PR_BUILDX_BUILDER:-}"

case "$builder" in
  nook-pr)
    echo "refusing shared BuildKit builder name 'nook-pr'; hosted jobs must use the job-scoped setup-buildx builder, and local CI uses the docker-context daemon builder" >&2
    exit 2
    ;;
esac

case "$health_timeout:$cleanup_timeout" in
  *[!0-9:]*|0:*|*:0)
    echo "BuildKit timeouts must be positive whole seconds" >&2
    exit 2
    ;;
esac

if [ -z "$builder" ]; then
  echo "Using default docker buildx builder (Taskfiles must not pass --builder)" >&2
fi

if [ -n "$builder" ]; then
case "$builder" in
  ''|*[!a-zA-Z0-9_.-]*)
    echo "invalid job-scoped BuildKit builder name: $builder" >&2
    exit 2
    ;;
esac

container="buildx_buildkit_${builder}0"
state_volume="${container}_state"

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
  # Within one hosted job this reuses the ephemeral setup-buildx builder so
  # registry cache restores and later Bake targets keep warm layers. It must
  # never fall back to a cross-job shared name.
  echo "Using healthy job-scoped BuildKit builder $builder" >&2
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

"$docker_bin" buildx use "$builder"
fi

# A cache ref can remain valid while an interrupted registry transfer leaves a
# blob unreadable on a fresh runner. Retry the complete workload once only for
# that precise transport failure. Do not clear cache inputs: the second pull
# must validate the same immutable exact-head graph.
is_transient_registry_cache_short_read() {
  local log_file="$1"
  grep -Eiq \
    -e 'short read: expected [0-9]+ bytes but got [0-9]+: unexpected EOF' \
    "$log_file"
}

workload_log="$(mktemp "${TMPDIR:-/tmp}/nook-buildkit-workload.XXXXXX")"
cleanup_workload_log() {
  rm -f "$workload_log"
}
trap cleanup_workload_log EXIT

for attempt in 1 2; do
  set +e
  "$@" 2>&1 | tee -a "$workload_log"
  workload_status=${PIPESTATUS[0]}
  set -e

  if [ "$workload_status" -eq 0 ]; then
    exit 0
  fi
  if [ "$attempt" -eq 2 ] || ! is_transient_registry_cache_short_read "$workload_log"; then
    exit "$workload_status"
  fi

  echo "BuildKit registry cache blob read was truncated; retrying workload once..." >&2
  : >"$workload_log"
  sleep 2
done
