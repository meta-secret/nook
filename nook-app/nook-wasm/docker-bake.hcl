// nook-wasm build target: wasm32 clippy + release build + wasm-pack bundle.
// LINEAR CHAIN: FROM builder-debug (native warm-up), so wasm target/ + wasm pkg accumulate in the
// same image lineage (no COPY --from of target/), cached locally and in the hosted Rust GHA scope
// (platform is always amd64).

target "builder-wasm" {
  inherits   = ["_sccache-network"]
  context    = "."
  dockerfile = "nook-app/nook-wasm/Dockerfile"
  target     = "builder-wasm"
  platforms  = ["linux/amd64"]
  contexts = {
    builder-debug = "target:builder-debug"
  }
  args = {
    WASM_BUILD_MODE = WASM_BUILD_MODE
  }
  cache-from = rust_cache_from
}

target "rust-format-check" {
  context    = "."
  dockerfile = "nook-app/nook-wasm/Dockerfile"
  target     = "rust-format-check"
  platforms  = ["linux/amd64"]
  contexts = {
    builder-debug = "target:builder-debug"
  }
  cache-from = rust_cache_from
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
  }
  args = {
    WASM_BUILD_MODE = WASM_BUILD_MODE
  }
  cache-from = rust_cache_from
  cache-to   = rust_cache_to
}

// Source-sealed Rust runtime used only by explicit rust/wasm Task commands.
target "_nook-rust-common" {
  inherits   = ["_sccache-network"]
  context    = "."
  dockerfile = "nook-app/nook-wasm/Dockerfile"
  target     = "nook-rust"
  platforms  = ["linux/amd64"]
  contexts = {
    builder-debug = "target:builder-debug"
  }
  args = {
    WASM_BUILD_MODE = WASM_BUILD_MODE
  }
  cache-from = rust_cache_from
}

// Manual browser-wasm test image; Playwright is deliberately absent from the common Rust branch.
target "_nook-rust-browser-common" {
  inherits   = ["_sccache-network"]
  context    = "."
  dockerfile = "nook-app/nook-wasm/Dockerfile"
  target     = "nook-rust-browser"
  platforms  = ["linux/amd64"]
  contexts = {
    builder-debug = "target:builder-debug"
  }
  args = {
    WASM_BUILD_MODE = WASM_BUILD_MODE
  }
  cache-from = rust_cache_from
}
