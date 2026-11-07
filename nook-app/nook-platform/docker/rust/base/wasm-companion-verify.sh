#!/usr/bin/env bash
# Companion package leaf of the existing Task-owned BuildKit validation graph.
set -euo pipefail

wasm-pack test --node --release nook-companion-wasm
runner="$(find /root/.cache/.wasm-pack -type f -name wasm-bindgen-test-runner -print -quit)"
test -x "$runner"
install -D -m 0755 "$runner" /opt/nook/wasm-bindgen-test-runner
runner=/opt/nook/wasm-bindgen-test-runner
test -x "$runner"
companion_floor="$(jq -r '.package_lines_percent["nook-companion-wasm"]' nook-core/coverage-floor.json)"
# --no-clean retains native profiles for the following WASM package floor.
# cargo-llvm-cov rejects combining --no-clean with --no-report.
cargo +"${WASM_COVERAGE_NIGHTLY}" llvm-cov test --no-clean --release -p nook-companion-wasm
CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUNNER="$runner" CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUSTFLAGS="-Zno-profiler-runtime -Clink-args=--no-gc-sections --cfg=wasm_bindgen_unstable_test_coverage" cargo +"${WASM_COVERAGE_NIGHTLY}" llvm-cov test --no-clean --target wasm32-unknown-unknown --release -p nook-companion-wasm --fail-under-lines "$companion_floor"
nook-sccache-report --finish wasm-companion-node-compiler
touch /opt/nook/wasm-companion-verified
