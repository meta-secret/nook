#!/usr/bin/env bash
set -euo pipefail

test "${NOOK_ARC_RUNNER:-}" = 1
shared_dir="${RUNNER_TEMP:-/tmp}/nook-arc-runtime-smoke"
cleanup() {
  rm -rf "$shared_dir"
}
trap cleanup EXIT
mkdir -p "$shared_dir"

printf '%s\n' \
  'FROM registry.dev.nokey.sh/library/alpine:3.22.1@sha256:4bcff63911fcb4448bd4fdacec207030997caf25e9bea4045fa6c8c44de311d1' \
  'RUN printf "%s\n" "arc-runtime-ok" > /nook-arc-runtime' \
  'FROM scratch' \
  'COPY --from=0 /nook-arc-runtime /result' |
  docker buildx build --output "type=local,dest=$shared_dir" -

test "$(cat "$shared_dir/result")" = arc-runtime-ok
echo "ARC node-local rootless BuildKit smoke passed"
