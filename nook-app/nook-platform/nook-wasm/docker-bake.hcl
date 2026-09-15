// nook-wasm build target: wasm32 clippy + release package + release-test compile + Node tests.
// Clippy and `cargo build --tests --release` use the joined builder-wasm-source graph, while each
// wasm-pack package export uses its package-specific source/build sibling before the final join.
// The WASM branch starts from builder-wasm-deps; native verification extends it as builder-core-deps. Hosted BuildKit
// runs them concurrently; only their small generated outputs join at web-artifacts.
// Loadable nook-rust / nook-rust-fast / nook-rust-browser tags live here next to their commons.

variable "DOCKER_RUST_IMAGE" {
  default = "nook-rust:local"
}

variable "DOCKER_RUST_FAST_IMAGE" {
  default = "nook-rust-fast:local"
}

variable "DOCKER_RUST_BROWSER_IMAGE" {
  default = "nook-rust-browser:local"
}

// Passed to every target that reaches the internal builder-wasm Dockerfile stage.
variable "WASM_BUILD_MODE" {
  default = "dev"
}

target "builder-wasm" {
  inherits   = ["_sccache"]
  context    = "."
  dockerfile = "nook-app/nook-platform/docker/rust/product.Dockerfile"
  target     = "builder-wasm"
  platforms  = ["linux/amd64"]
  args = {
    WASM_BUILD_MODE = WASM_BUILD_MODE
  }
  # Node verification reaches source-sensitive clippy, package, coverage, and
  # wasm-pack test stages. Restoring only the dependency graph makes a fresh
  # runner replay that entire chain even when the verified WASM source graph
  # already exists.
  cache-from = rust_wasm_source_cache_from
}

// Focused remote cache diagnostics compile the package graph without crossing
// into clippy, Rust tests, or Node-test execution stages.
target "builder-wasm-build-cache-probe" {
  inherits = ["builder-wasm"]
  target   = "builder-wasm-build"
  cache-to = []
  output   = ["type=cacheonly"]
}

// The normal producer publishes this reusable compiler phase before clippy,
// tests, wasm-bindgen packaging, and artifact export.
target "builder-wasm-build-publish" {
  inherits = ["builder-wasm"]
  target   = "builder-wasm-source"
  cache-to = rust_wasm_source_cache_to
}

target "_nook-rust-fast-common" {
  context    = "."
  dockerfile = "nook-app/nook-platform/docker/rust/product.Dockerfile"
  target     = "nook-rust-fast"
  platforms  = ["linux/amd64"]
  cache-from = rust_wasm_deps_cache_from
}

target "rust-format-check" {
  context    = "."
  dockerfile = "nook-app/nook-platform/docker/rust/product.Dockerfile"
  target     = "rust-format-check"
  platforms  = ["linux/amd64"]
  cache-from = rust_native_source_cache_from
}

target "wasm-export" {
  inherits   = ["_sccache"]
  context    = "."
  dockerfile = "nook-app/nook-platform/docker/rust/product.Dockerfile"
  target     = "wasm-export"
  platforms  = ["linux/amd64"]
  args = {
    WASM_BUILD_MODE = WASM_BUILD_MODE
  }
  cache-from = rust_wasm_source_cache_from
  cache-to   = []
}

target "focused-web-artifacts" {
  inherits   = ["_sccache"]
  context    = "."
  dockerfile = "nook-app/nook-platform/docker/rust/product.Dockerfile"
  target     = "focused-web-artifacts"
  platforms  = ["linux/amd64"]
  cache-from = rust_wasm_source_cache_from
  cache-to   = rust_wasm_source_cache_to
}

// Small scratch output exported to the host between the parallel prepare phase and slim web build.
target "web-artifacts" {
  inherits   = ["_sccache"]
  context    = "."
  dockerfile = "nook-app/nook-platform/docker/rust/product.Dockerfile"
  target     = "web-artifacts"
  platforms  = ["linux/amd64"]
  args = {
    WASM_BUILD_MODE = WASM_BUILD_MODE
  }
  cache-from = rust_wasm_source_cache_from
  cache-to   = rust_wasm_source_cache_to
}

// Source-sealed Rust runtime used only by explicit rust/wasm Task commands.
target "_nook-rust-common" {
  inherits   = ["_sccache"]
  context    = "."
  dockerfile = "nook-app/nook-platform/docker/rust/product.Dockerfile"
  target     = "nook-rust"
  platforms  = ["linux/amd64"]
  args = {
    WASM_BUILD_MODE = WASM_BUILD_MODE
  }
  cache-from = rust_wasm_source_cache_from
  // Remote task builds must publish the source-sealed graph as well as the manifest-only
  // dependency graph. Without this export, an identical clean worker restores cargo-chef but
  // recompiles every source-sensitive WASM, clippy, and test layer.
  cache-to   = rust_wasm_source_cache_to
}

// Manual browser-wasm test image; Playwright is deliberately absent from the common Rust branch.
target "_nook-rust-browser-common" {
  inherits   = ["_sccache"]
  context    = "."
  dockerfile = "nook-app/nook-platform/docker/rust/product.Dockerfile"
  target     = "nook-rust-browser"
  platforms  = ["linux/amd64"]
  args = {
    WASM_BUILD_MODE = WASM_BUILD_MODE
  }
  cache-from = rust_wasm_source_cache_from
  cache-to   = rust_wasm_source_cache_to
}

// Explicit Rust/WASM commands load this source-sealed image on demand.
target "nook-rust" {
  inherits = ["_nook-rust-common"]
  tags     = [DOCKER_RUST_IMAGE]
  output   = ["type=docker"]
}

target "nook-rust-fast" {
  inherits = ["_nook-rust-fast-common"]
  tags     = [DOCKER_RUST_FAST_IMAGE]
  output   = ["type=docker"]
}

target "nook-rust-browser" {
  inherits = ["_nook-rust-browser-common"]
  tags     = [DOCKER_RUST_BROWSER_IMAGE]
  output   = ["type=docker"]
}
