#!/usr/bin/env bash

set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo "usage: $0 <command> [args...]" >&2
  exit 2
fi

run_id="${GITHUB_RUN_ID:-local}"
run_attempt="${GITHUB_RUN_ATTEMPT:-0}"
builder="nook-buildkit-${run_id}-${run_attempt}-$$-${RANDOM}"
builder="${builder//[^a-zA-Z0-9_.-]/-}"

if [ "$(uname -s)" = Darwin ]; then
  redis_image="${SCCACHE_REDIS_IMAGE:-redis:8.2.2-alpine}"
  gateway="$({
    docker run --rm "$redis_image" sh -c 'ping -4 -c 1 host.docker.internal'
  } | awk -F '[()]' '/^PING / { gateway = $2 } END { print gateway }')"
else
  gateway="$(docker network inspect bridge --format '{{(index .IPAM.Config 0).Gateway}}')"
fi
case "$gateway" in
  ''|*[!0-9.]*)
    echo "unable to resolve the Docker host IPv4 address for isolated BuildKit" >&2
    exit 1
    ;;
esac

cleanup() {
  echo "Removing isolated BuildKit builder $builder"
  docker buildx rm --force "$builder" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# Never reuse a caller-selected builder. Each invocation owns a fresh BuildKit
# daemon and removes its container and state when the wrapped command exits.
docker buildx create \
  --name "$builder" \
  --driver docker-container \
  --bootstrap

echo "Running with isolated BuildKit builder $builder"
BUILDX_BUILDER="$builder" SCCACHE_REDIS_HOST_IP="$gateway" "$@"
