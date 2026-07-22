// nook-wasm build target: wasm32 clippy + release build + wasm-pack bundle.
// The WASM branch and native verification branch are siblings from builder-deps. Hosted BuildKit
// runs them concurrently; only their small generated outputs join at web-artifacts.

target "builder-wasm" {
  inherits   = ["_sccache-network"]
  context    = "."
  dockerfile = "nook-app/nook-wasm/Dockerfile"
  target     = "builder-wasm"
  platforms  = ["linux/amd64"]
  contexts = {
    builder-wasm-deps = "target:builder-wasm-deps"
  }
  args = {
    WASM_BUILD_MODE = WASM_BUILD_MODE
  }
  cache-from = rust_wasm_source_cache_from
}

target "_nook-rust-fast-common" {
  context    = "."
  dockerfile = "nook-app/nook-wasm/Dockerfile"
  target     = "nook-rust-fast"
  platforms  = ["linux/amd64"]
  contexts = {
    builder-wasm-deps = "target:builder-wasm-deps"
  }
  cache-from = rust_wasm_deps_cache_from
}

target "rust-format-check" {
  context    = "."
  dockerfile = "nook-app/nook-wasm/Dockerfile"
  target     = "rust-format-check"
  platforms  = ["linux/amd64"]
  contexts = {
    builder-debug = "target:builder-debug"
  }
  cache-from = rust_native_source_cache_from
}

target "wasm-export" {
  inherits   = ["_sccache-network"]
  context    = "."
  dockerfile = "nook-app/nook-wasm/Dockerfile"
  target     = "wasm-export"
  platforms  = ["linux/amd64"]
  contexts = {
    builder-wasm-deps = "target:builder-wasm-deps"
  }
  args = {
    WASM_BUILD_MODE = WASM_BUILD_MODE
  }
  cache-from = rust_wasm_source_cache_from
  cache-to   = rust_wasm_source_cache_to
}

// Small scratch output exported to the host between the parallel prepare phase and slim web build.
target "web-artifacts" {
  inherits   = ["_sccache-network"]
  context    = "."
  dockerfile = "nook-app/nook-wasm/Dockerfile"
  target     = "web-artifacts"
  platforms  = ["linux/amd64"]
  contexts = {
    builder-debug = "target:builder-debug"
    builder-wasm-deps = "target:builder-wasm-deps"
  }
  args = {
    WASM_BUILD_MODE = WASM_BUILD_MODE
  }
  cache-from = rust_wasm_source_cache_from
  cache-to   = rust_wasm_source_cache_to
}

// Source-sealed Rust runtime used only by explicit rust/wasm Task commands.
target "_nook-rust-common" {
  inherits   = ["_sccache-network"]
  context    = "."
  dockerfile = "nook-app/nook-wasm/Dockerfile"
  target     = "nook-rust"
  platforms  = ["linux/amd64"]
  contexts = {
    builder-wasm-deps = "target:builder-wasm-deps"
  }
  args = {
    WASM_BUILD_MODE = WASM_BUILD_MODE
  }
  cache-from = rust_wasm_source_cache_from
}

// Manual browser-wasm test image; Playwright is deliberately absent from the common Rust branch.
target "_nook-rust-browser-common" {
  inherits   = ["_sccache-network"]
  context    = "."
  dockerfile = "nook-app/nook-wasm/Dockerfile"
  target     = "nook-rust-browser"
  platforms  = ["linux/amd64"]
  contexts = {
    builder-wasm-deps = "target:builder-wasm-deps"
  }
  args = {
    WASM_BUILD_MODE = WASM_BUILD_MODE
  }
  cache-from = rust_wasm_source_cache_from
}
