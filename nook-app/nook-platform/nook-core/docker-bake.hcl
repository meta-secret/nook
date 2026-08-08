// nook-core build targets: cargo-chef dependency cache + native verify warm-up.
// Native dependency warm-up on top of builder-wasm-deps (nextest/clippy/coverage graphs).
// The selected builder caches this linux/amd64 lineage locally; hosted CI also restores the Rust Zot refs.

target "builder-core-deps" {
  inherits   = ["_sccache"]
  context    = "."
  dockerfile = "nook-app/nook-platform/docker/rust/product.Dockerfile"
  target     = "builder-core-deps"
  platforms  = ["linux/amd64"]
}

// Standalone dependency restore for explicit dependency-only solves.
target "builder-core-deps-restore" {
  inherits   = ["builder-core-deps"]
  cache-from = rust_deps_cache_from
}

// Explicit writer for the native deps Zot scope.
target "builder-core-deps-publish" {
  inherits = ["builder-core-deps-restore"]
  cache-to   = rust_deps_cache_to
}

// Dirty-safe local formatter publisher. This target contains manifests,
// synthetic crate roots, and compiled dependencies. It contains no real source.
target "builder-core-deps-input-publish" {
  inherits = ["builder-core-deps-restore"]
  cache-to = rust_native_deps_input_cache_to
}

// Shared platform source overlay on cooked deps. Product leaves resolve this
// internal stage from the same Dockerfile, preserving one stable cache lineage.
target "rust-platform" {
  inherits   = ["_sccache"]
  context    = "."
  dockerfile = "nook-app/nook-platform/docker/rust/product.Dockerfile"
  target     = "rust-platform"
  platforms  = ["linux/amd64"]
  output = ["type=cacheonly"]
}

target "builder-wasm-deps" {
  inherits   = ["_sccache"]
  context    = "."
  dockerfile = "nook-app/nook-platform/docker/rust/product.Dockerfile"
  target     = "builder-wasm-deps"
  platforms  = ["linux/amd64"]
}

// Standalone dependency restore for explicit dependency-only solves.
target "builder-wasm-deps-restore" {
  inherits   = ["builder-wasm-deps"]
  cache-from = rust_wasm_deps_cache_from
}

// Explicit writer for the WASM deps Zot scope. Main writes
// GHA_RUST_WASM_DEPS_SCOPE; isolated writes use the exact git scope.
target "builder-wasm-deps-publish" {
  inherits = ["builder-wasm-deps-restore"]
  cache-to   = rust_wasm_deps_cache_to
}

target "builder-wasm-deps-input-publish" {
  inherits = ["builder-wasm-deps-restore"]
  cache-to = rust_wasm_deps_input_cache_to
}

// Native verify warm-up (nextest --no-run, clippy, llvm-cov). Parallel with builder-wasm.
// Persist this source-sensitive boundary separately from manifest-only dependencies so hosted
// runners do not repeat unchanged coverage builds after a non-Rust PR push.
target "builder-debug" {
  inherits   = ["_sccache"]
  context    = "."
  dockerfile = "nook-app/nook-platform/docker/rust/product.Dockerfile"
  target     = "builder-debug"
  platforms  = ["linux/amd64"]
  cache-from = rust_native_source_cache_from
  cache-to   = rust_native_source_cache_to
}

// Small local-output target for the rare case where a commit-keyed main coverage artifact is
// unavailable. It reuses builder-debug's cached Rust layers without exporting the full app image.
target "coverage-export" {
  inherits   = ["_sccache"]
  context    = "."
  dockerfile = "nook-app/nook-platform/docker/rust/product.Dockerfile"
  target     = "coverage-export"
  platforms  = ["linux/amd64"]
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
  dockerfile = "nook-app/nook-platform/docker/rust/product.Dockerfile"
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
  dockerfile = "nook-app/nook-platform/docker/rust/product.Dockerfile"
  target     = "nook-rust-lint"
  platforms  = ["linux/amd64"]
  cache-from = rust_native_source_cache_from
  cache-to   = rust_native_source_cache_to
}

target "_nook-rust-coverage-common" {
  inherits   = ["_sccache"]
  context    = "."
  dockerfile = "nook-app/nook-platform/docker/rust/product.Dockerfile"
  target     = "nook-rust-coverage"
  platforms  = ["linux/amd64"]
  cache-from = rust_native_source_cache_from
  cache-to   = rust_native_source_cache_to
}

// Focused native leaves load sealed dependency-plus-source images.
// The regular DOCKER_RUST_IMAGE tag keeps the existing runtime command surface.
target "nook-rust-test" {
  inherits = ["_nook-rust-test-common"]
  tags     = [DOCKER_RUST_IMAGE]
  output   = ["type=docker"]
}

target "nook-rust-lint" {
  inherits = ["_nook-rust-lint-common"]
  tags     = [DOCKER_RUST_IMAGE]
  output   = ["type=docker"]
}

target "nook-rust-coverage" {
  inherits = ["_nook-rust-coverage-common"]
  tags     = [DOCKER_RUST_IMAGE]
  output   = ["type=docker"]
}

group "ci-rust" {
  targets = ["coverage-export", "rust-format-check"]
}
