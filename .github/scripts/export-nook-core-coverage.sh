#!/usr/bin/env bash
set -euo pipefail

docker_bin="${DOCKER:-docker}"
docker_image="${DOCKER_IMAGE:-nook-web:local}"
out_dir="${COVERAGE_OUT_DIR:-coverage/nook-core}"

rm -rf "$out_dir"
mkdir -p "$out_dir"

cid="$(
  "$docker_bin" create \
    --platform linux/amd64 \
    --ipc=host \
    -w /meta-secret/nook \
    "$docker_image" \
    bash -c '
      set -euo pipefail
      out="/tmp/nook-core-coverage"
      rm -rf "$out"
      mkdir -p "$out"

      cargo llvm-cov clean --workspace
      cargo llvm-cov nextest --no-report --profile ci -p nook-core
      cargo llvm-cov report --summary-only > "$out/summary.txt"
      cargo llvm-cov report --json --summary-only > "$out/summary.json"
      cargo llvm-cov report --lcov --output-path "$out/lcov.info"
      cp nook-core/coverage-floor.json "$out/coverage-floor.json"
    '
)"

cleanup() {
  "$docker_bin" rm -f "$cid" >/dev/null 2>&1 || true
}
trap cleanup EXIT

"$docker_bin" start -a "$cid"
"$docker_bin" cp "$cid:/tmp/nook-core-coverage/." "$out_dir/"
