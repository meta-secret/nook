#!/usr/bin/env bash
set -euo pipefail

test "${NOOK_ARC_RUNNER:-}" = 1
test "${NOOK_CONTAINER_RUNTIME:-}" = podman
test "${DOCKER_HOST:-}" = tcp://127.0.0.1:2375

runtime_version="$(docker version --format '{{.Server.Version}}')"
test "$runtime_version" = 5.8.4
docker info >/dev/null
test "$(docker info --format '{{.Driver}}')" = overlay

image="nook-arc-runtime-smoke:${GITHUB_RUN_ID:-manual}-${GITHUB_RUN_ATTEMPT:-1}"
shared_dir="${RUNNER_TEMP:-/tmp}/nook-arc-runtime-smoke"
cleanup() {
  docker image rm --force "$image" >/dev/null 2>&1 || true
  rm -rf "$shared_dir"
}
trap cleanup EXIT
mkdir -p "$shared_dir"

printf '%s\n' \
  'FROM docker.io/library/alpine:3.22.1@sha256:4bcff63911fcb4448bd4fdacec207030997caf25e9bea4045fa6c8c44de311d1' \
  'RUN printf "%s\n" "arc-runtime-ok" > /nook-arc-runtime' |
  docker buildx build --load --tag "$image" -

docker run --rm \
  --volume "$shared_dir:/nook-output" \
  "$image" \
  sh -ceu 'cat /nook-arc-runtime > /nook-output/result'
test "$(cat "$shared_dir/result")" = arc-runtime-ok
echo "ARC BuildKit-to-Podman runtime smoke passed"
