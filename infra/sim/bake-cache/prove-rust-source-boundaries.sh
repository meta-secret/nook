#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
sim_dir="$repo_root/infra/sim/bake-cache"
product_dockerfile="$repo_root/nook-app/nook-platform/docker/rust/product.Dockerfile"
nightly_dockerfile="$repo_root/nook-app/nook-platform/docker/rust/nightly.Dockerfile"
first_log="$(mktemp "${TMPDIR:-/tmp}/nook-dylint-boundary-first.XXXXXX")"
second_log="$(mktemp "${TMPDIR:-/tmp}/nook-dylint-boundary-second.XXXXXX")"
source_block="$(mktemp "${TMPDIR:-/tmp}/nook-wasm-source-block.XXXXXX")"
proof_nonce="$(date +%s)-$$"
cleanup() {
  rm -f "$first_log" "$second_log" "$source_block"
}
trap cleanup EXIT

awk '
  /^FROM builder-wasm-deps AS builder-wasm-source$/ { capture = 1 }
  /^FROM builder-wasm-source AS builder-wasm-clippy$/ { capture = 0 }
  capture { print }
' "$product_dockerfile" >"$source_block"

test "$(grep -Fc 'cargo build --lib --release --target wasm32-unknown-unknown -p nook-wasm' "$source_block")" -eq 8
test "$(grep -Fc 'cargo build --lib --release --target wasm32-unknown-unknown -p nook-companion-wasm' "$source_block")" -eq 8
if grep -Fq -- '-p nook-wasm -p nook-companion-wasm' "$source_block"; then
  echo "WASM source prewarm must not use a joint package feature graph" >&2
  exit 1
fi
awk '
  /COPY nook-app\/nook-platform\/dylint\/nook-domain-api\/ dylint\/nook-domain-api\// {
    lint_copy = NR
  }
  /nook-sccache-report rust-dylint-self-test/ { self_test = NR }
  /COPY nook-app\/nook-platform\/ nook-app\/nook-platform\// && !product_copy {
    product_copy = NR
  }
  /cargo dylint --all -- --all-targets/ { product_lint = NR }
  END {
    exit !(lint_copy < self_test && self_test < product_copy && product_copy < product_lint)
  }
' "$nightly_dockerfile"

docker buildx bake --progress=plain \
  -f "$sim_dir/docker-bake.hcl" \
  --set "dylint-split.context=$sim_dir" \
  --set "dylint-split.args.PRODUCT_SOURCE=${proof_nonce}-first" \
  dylint-split >"$first_log" 2>&1
docker buildx bake --progress=plain \
  -f "$sim_dir/docker-bake.hcl" \
  --set "dylint-split.context=$sim_dir" \
  --set "dylint-split.args.PRODUCT_SOURCE=${proof_nonce}-second" \
  dylint-split >"$second_log" 2>&1

self_test_step="$(awk '/bake-sim-dylint-self-test-expensive/ { print $1; exit }' "$second_log")"
product_step="$(awk '/bake-sim-dylint-product-expensive/ { print $1; exit }' "$second_log")"
test -n "$self_test_step"
test -n "$product_step"
grep -Fxq "$self_test_step CACHED" "$second_log"
if grep -Fxq "$product_step CACHED" "$second_log"; then
  echo "Product source change must invalidate only the final Dylint stage" >&2
  exit 1
fi

echo "Rust source-boundary cache proof: ok"
