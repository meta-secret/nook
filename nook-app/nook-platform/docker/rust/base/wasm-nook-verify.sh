#!/usr/bin/env bash
# Nook package leaves of the existing Task-owned BuildKit validation graph.
set -euo pipefail
export LC_ALL=C
runner=/opt/nook/wasm-bindgen-test-runner
inventory=/opt/nook/wasm-browser-inventory

case "${1:?verification phase required}" in
  prepare)
    wasm-pack test --node --release nook-wasm
    cached_runner="$(find /root/.cache/.wasm-pack -type f -name wasm-bindgen-test-runner -print -quit)"
    test -x "$cached_runner"
    install -D -m 0755 "$cached_runner" "$runner"
    touch /opt/nook/wasm-node-tests-passed
    mkdir -p "$inventory"
    # Match the handoff instrumentation without executing a browser or cleaning native profiles.
    coverage_env="$(CARGO_TARGET_DIR=target/llvm-cov-target cargo +"${WASM_COVERAGE_NIGHTLY}" llvm-cov show-env --sh --target wasm32-unknown-unknown)"
    eval "$coverage_env"
    CARGO_TARGET_DIR=target/llvm-cov-target CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUSTFLAGS="-Zno-profiler-runtime -Clink-args=--no-gc-sections --cfg=wasm_bindgen_unstable_test_coverage" cargo +"${WASM_COVERAGE_NIGHTLY}" test --tests --target wasm32-unknown-unknown --release -p nook-wasm --features browser-wasm-tests --no-run --message-format=json-render-diagnostics >"$inventory/compile.json"
    jq -ser '[.[] | select(.reason == "compiler-artifact" and .profile.test == true and .executable != null)] | unique_by(.executable) | if length == 1 and .[0].target.name == "nook_wasm" then .[0].executable else error("expected exactly one nook-wasm test harness") end' "$inventory/compile.json" >"$inventory/artifact"
    wasm="$(cat "$inventory/artifact")"
    test -f "$wasm"
    # Native selection predicates are complementary, including future and ignored test names.
    "$runner" "$wasm" --list >"$inventory/all.raw"
    "$runner" "$wasm" manager:: --list >"$inventory/manager.raw"
    "$runner" "$wasm" --skip manager:: --list >"$inventory/rest.raw"
    for partition in all manager rest; do
      sort "$inventory/$partition.raw" >"$inventory/$partition"
      test -s "$inventory/$partition"
    done
    comm -12 "$inventory/manager" "$inventory/rest" >"$inventory/overlap"
    test ! -s "$inventory/overlap"
    cat "$inventory/manager" "$inventory/rest" | sort >"$inventory/union"
    cmp "$inventory/all" "$inventory/union"
    wc -l "$inventory/all" "$inventory/manager" "$inventory/rest"
    nook-sccache-report wasm-node-compiler
    ;;
  manager|rest)
    partition="$1"
    wasm="$(cat "$inventory/artifact")"
    export TMPDIR="/tmp/nook-wasm-$partition"
    mkdir -p "$TMPDIR" /opt/nook/wasm-browser-profiles
    export LLVM_PROFILE_FILE="/opt/nook/wasm-browser-profiles/$partition-%p-%m.profraw"
    export WASM_BINDGEN_TEST_TIMEOUT=60
    if [ "$partition" = manager ]; then
      "$runner" "$wasm" manager::
    else
      "$runner" "$wasm" --skip manager::
    fi
    ;;
  report)
    # Both immutable branch profiles and the original native profiles are now in the root.
    # Pinned llvm-cov 0.8.7 report accepts no --features; it reads the compiled objects.
    nook_wasm_floor="$(jq -r '.package_lines_percent["nook-wasm"]' nook-core/coverage-floor.json)"
    cargo +"${WASM_COVERAGE_NIGHTLY}" llvm-cov report --target wasm32-unknown-unknown --release -p nook-wasm --fail-under-lines "$nook_wasm_floor"
    touch /opt/nook/wasm-coverage-passed
    ;;
  *) echo "unknown verification phase: $1" >&2; exit 2 ;;
esac
