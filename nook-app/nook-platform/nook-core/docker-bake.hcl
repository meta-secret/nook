// nook-core build targets: cargo-chef dependency cache + native verify warm-up.
// Native dependency warm-up on top of builder-wasm-deps (nextest/clippy/coverage graphs).
// The selected builder caches this linux/amd64 lineage locally; hosted CI also restores the Rust Zot refs.

target "builder-core-deps" {
  inherits   = ["_sccache"]
  context    = "."
  dockerfile = "nook-app/docker/rust.Dockerfile"
  target     = "builder-core-deps"
  platforms  = ["linux/amd64"]
  cache-from = rust_deps_cache_from
  cache-to   = rust_deps_cache_to
}

target "builder-wasm-deps" {
  inherits   = ["_sccache"]
  context    = "."
  dockerfile = "nook-app/docker/rust.Dockerfile"
  target     = "builder-wasm-deps"
  platforms  = ["linux/amd64"]
  // Main owns the complete dependency-fingerprinted WASM lineage. Pull requests restore it
  // read-only, avoiding both dependency rebuilds and competition with the larger native dependency
  // cache. The restore list also imports rust-base + native deps so cook layers cannot orphan when
  // sibling scopes advance independently.
  //
  // Cache proof: a repeated solve for the same fingerprint must hit CACHED for both chef cooks.
  cache-from = rust_wasm_deps_cache_from
  cache-to   = rust_wasm_deps_cache_to
}

// Native verify warm-up (nextest --no-run, clippy, llvm-cov). Parallel with builder-wasm.
// Persist this source-sensitive boundary separately from manifest-only dependencies so hosted
// runners do not repeat unchanged coverage builds after a non-Rust PR push.
target "builder-debug" {
  inherits   = ["_sccache"]
  context    = "."
  dockerfile = "nook-app/nook-platform/nook-core/Dockerfile"
  target     = "builder-debug"
  platforms  = ["linux/amd64"]
  contexts = {
    builder-core-deps = "target:builder-core-deps"
  }
  cache-from = rust_native_source_cache_from
  cache-to   = rust_native_source_cache_to
}

// Small local-output target for the rare case where a commit-keyed main coverage artifact is
// unavailable. It reuses builder-debug's cached Rust layers without exporting the full app image.
target "coverage-export" {
  inherits   = ["_sccache"]
  context    = "."
  dockerfile = "nook-app/nook-platform/nook-core/Dockerfile"
  target     = "coverage-export"
  platforms  = ["linux/amd64"]
  contexts = {
    builder-core-deps = "target:builder-core-deps"
  }
  // Main verifies this graph read-only, then exports the already-solved local builder state in a
  // separate post-verification step without a second reconstruction job.
  cache-from = rust_native_source_cache_from
  cache-to   = rust_native_source_cache_to
}

// Narrow source-sealed runtime for focused native tests. It deliberately branches before
// builder-debug so a remote `rust:test` does not pay for coverage, clippy, or any WASM stage.
target "_nook-rust-test-common" {
  inherits   = ["_sccache"]
  context    = "."
  dockerfile = "nook-app/docker/rust.Dockerfile"
  target     = "nook-rust-test"
  platforms  = ["linux/amd64"]
  // Focused Remote rust:test runs own a branch-scoped Zot export. Trusted Main remains the
  // fallback restore source, while untrusted pull-request workflows never receive write access.
  cache-from = rust_native_source_cache_from
  cache-to   = rust_native_source_cache_to
}

target "_nook-rust-lint-common" {
  inherits   = ["_sccache"]
  context    = "."
  dockerfile = "nook-app/docker/rust.Dockerfile"
  target     = "nook-rust-lint"
  platforms  = ["linux/amd64"]
  cache-from = rust_native_source_cache_from
  cache-to   = rust_native_source_cache_to
}

target "_nook-rust-coverage-common" {
  inherits   = ["_sccache"]
  context    = "."
  dockerfile = "nook-app/docker/rust.Dockerfile"
  target     = "nook-rust-coverage"
  platforms  = ["linux/amd64"]
  cache-from = rust_native_source_cache_from
  cache-to   = rust_native_source_cache_to
}
