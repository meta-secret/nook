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
BUILDX_BUILDER="$builder" "$@"
