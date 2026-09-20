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

group "pr-verification" {
  targets = ["pr-rust-verify", "pr-web-verification", "pr-web-build", "rust-dylint"]
}

// This group is invoked only after the entire verification solve succeeds.
group "pr-tests" {
  targets = ["coverage-export", "builder-wasm", "pr-web-tests", "rust-ecosystem-deterministic"]
}

group "pr-heavy" {
  targets = ["rust-fuzz-smoke", "rust-kani"]
}
