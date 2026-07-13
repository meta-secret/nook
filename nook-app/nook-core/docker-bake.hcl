// nook-core build targets: cargo-chef dependency cache + native verify warm-up.
// `builder-deps` is also the shared base for the wasm build (see nook-app/nook-wasm/docker-bake.hcl).
// cache-from/to come from shared_cache_* in nook-app/docker-bake.hcl (platform is always amd64).

// Rust dependency cache (cargo-chef cook + fetch). Base for both native and wasm builders.
target "builder-deps" {
  context    = "."
  dockerfile = "nook-app/nook-core/Dockerfile"
  target     = "builder-deps"
  platforms  = ["linux/amd64"]
  contexts = {
    nook-base = "target:nook-base"
  }
  cache-from = shared_cache_from
  cache-to   = shared_cache_to
}

// Native verify warm-up (nextest --no-run, clippy, llvm-cov). Parallel with builder-wasm.
target "builder-debug" {
  context    = "."
  dockerfile = "nook-app/nook-core/Dockerfile"
  target     = "builder-debug"
  platforms  = ["linux/amd64"]
  contexts = {
    nook-base    = "target:nook-base"
    builder-deps = "target:builder-deps"
  }
  cache-from = shared_cache_from
  cache-to   = shared_cache_to
}

// Small local-output target for the rare case where a commit-keyed main coverage artifact is
// unavailable. It reuses builder-debug's cached Rust layers without exporting the full app image.
target "coverage-export" {
  context    = "."
  dockerfile = "nook-app/nook-core/Dockerfile"
  target     = "coverage-export"
  platforms  = ["linux/amd64"]
  contexts = {
    nook-base    = "target:nook-base"
    builder-deps = "target:builder-deps"
  }
  cache-from = shared_cache_from
  cache-to   = shared_cache_to
}
