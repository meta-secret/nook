// nook-core build targets: cargo-chef dependency cache + native verify warm-up.
// `builder-deps` is also the shared base for the wasm build (see nook-app/nook-wasm/docker-bake.hcl).
// The selected builder's local content store caches this linux/amd64 lineage.

// Rust dependency cache (cargo-chef cook + fetch). Base for both native and wasm builders.
target "builder-deps" {
  inherits   = ["_sccache-network"]
  context    = "."
  dockerfile = "nook-app/nook-core/Dockerfile"
  target     = "builder-deps"
  platforms  = ["linux/amd64"]
  contexts = {
    rust-base = "target:rust-base"
  }
}

// Native verify warm-up (nextest --no-run, clippy, llvm-cov). Parallel with builder-wasm.
target "builder-debug" {
  inherits   = ["_sccache-network"]
  context    = "."
  dockerfile = "nook-app/nook-core/Dockerfile"
  target     = "builder-debug"
  platforms  = ["linux/amd64"]
  contexts = {
    rust-base    = "target:rust-base"
    builder-deps = "target:builder-deps"
  }
}

// Small local-output target for the rare case where a commit-keyed main coverage artifact is
// unavailable. It reuses builder-debug's cached Rust layers without exporting the full app image.
target "coverage-export" {
  inherits   = ["_sccache-network"]
  context    = "."
  dockerfile = "nook-app/nook-core/Dockerfile"
  target     = "coverage-export"
  platforms  = ["linux/amd64"]
  contexts = {
    rust-base    = "target:rust-base"
    builder-deps = "target:builder-deps"
  }
}
