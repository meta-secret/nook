// nook-core build targets: cargo-chef dependency cache + native verify warm-up.
// `builder-deps` is also the shared base for the wasm build (see nook-wasm/docker-bake.hcl).
// cache-from/to come from shared_cache_* in the root docker-bake.hcl (platform is always amd64).

// Rust dependency cache (cargo-chef cook + fetch). Base for both native and wasm builders.
target "builder-deps" {
  context    = "."
  dockerfile = "nook-core/Dockerfile"
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
  dockerfile = "nook-core/Dockerfile"
  target     = "builder-debug"
  platforms  = ["linux/amd64"]
  contexts = {
    nook-base    = "target:nook-base"
    builder-deps = "target:builder-deps"
  }
  cache-from = shared_cache_from
  cache-to   = shared_cache_to
}
