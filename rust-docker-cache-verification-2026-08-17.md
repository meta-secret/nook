# Rust Docker Cache Verification

## Branch
- `cache/rust-docker-cache-proof` (HEAD: `516dc0f81f9eafeaaa5a68f794d970bb0db8f185`)

## Remote Task Runs

### `bake-cache:prove`
- Run URL: https://github.com/meta-secret/nook/actions/runs/31998325348
- Run status: `completed`
- Run conclusion: `success`
- Jobs in run:
  - `Remote / bake-cache:prove` → `success`
  - `Remote / rust-cache:promote` → `skipped`
- Cache proof assertions:
  - Simulation scenarios `A` through `W` execute and report `scenario <letter> ok`.
  - Final line: `bake-cache runtime proof passed`
  - Expected cold-cache imports for git-scoped manifests logged, plus inherited Main cache fallback.
  - Layer-level cache re-use visible with repeated `#CACHED` markers after initial misses.

### `rust:test`
- Run URL: https://github.com/meta-secret/nook/actions/runs/31998331938
- Run status: `completed`
- Run conclusion: `success`
- Jobs in run:
  - `Remote / rust:test` → `success`
  - `Remote / rust-cache:promote` → `skipped`
- Cache proof assertions:
  - Remote build logs show `Exact cache available` for scoped artifacts and `Exact cache absent; Main/fingerprint fallback enabled` for git-scoped misses.
  - Production bake invocation uses `nook-app/docker-bake.hcl` and Rust/WASM bake graph.
  - Representative Rust cache hits in run logs include:
    - `#13 CACHED`, `#16 CACHED`, `#17 CACHED`, ...
    - `#38 CACHED` (sccache binary fetch)
    - `#39 CACHED` / `#53 CACHED` / `#63 CACHED` / `#82 CACHED` (nextest dependency pre-runs)
  - Test execution completed: `Summary [  17.009s] 839 tests run: 839 passed, 0 skipped`
  - Final line: `Remote task passed: rust:test`

## Verification conclusion
Both remote tasks completed successfully and show expected cache behavior:
- simulation proves cache matrix correctness under expected misses and hits
- production path reuses Rust module caches for dependency/setup-heavy steps while correctly using Main/fingerprint fallback where exact git-scope is absent
- no job failures were observed in either run.
