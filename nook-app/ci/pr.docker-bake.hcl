// PR targets stay in the selected builder. No image export or registry cache.
target "pr-rust-verify" {
  inherits = ["rust-base"]
  target = "pr-rust-verify"
  output = ["type=cacheonly"]
}

target "pr-wasm-artifacts" {
  inherits = ["builder-wasm"]
  target = "pr-wasm-artifacts"
  output = ["type=cacheonly"]
}

target "_pr-web" {
  inherits = ["_nook-web-base"]
  contexts = {
    web-artifacts = "target:pr-wasm-artifacts"
  }
  output = ["type=cacheonly"]
}

target "pr-web-verification" {
  inherits = ["_pr-web"]
  target = "pr-web-verification"
}

target "pr-web-tests" {
  inherits = ["_pr-web"]
  target = "pr-web-tests"
}

target "pr-web-build" {
  inherits = ["_pr-web"]
  target = "nook-web-build"
}

target "pr-browser-artifacts" {
  inherits = ["_pr-web"]
  target = "pr-browser-artifacts"
}

// Each leaf waits only for its own image/toolchain preparation. The Task join
// also waits for policy checks and the separately exported browser artifacts.
group "pr-checks" {
  targets = ["pr-rust-verify", "pr-web-verification", "rust-dylint", "coverage-export", "builder-wasm", "pr-web-tests", "rust-ecosystem-deterministic", "rust-fuzz-smoke", "rust-kani"]
}
