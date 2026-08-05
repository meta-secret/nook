// Rust toolchain base + ecosystem gates. Hosted CI seeds rust_base_cache_* before
// dependency scopes consume it. Ecosystem targets Bake from the same Dockerfile.

target "rust-base" {
  context    = "."
  dockerfile = "nook-app/docker/rust.Dockerfile"
  target     = "rust-base"
  platforms  = ["linux/amd64"]
  args = {
    SCCACHE_ENDPOINT = SCCACHE_ENDPOINT
    SCCACHE_BUCKET   = SCCACHE_BUCKET
    SCCACHE_S3_MODE  = SCCACHE_S3_MODE
  }
  cache-from = rust_base_cache_from
  cache-to   = rust_base_cache_to
}

target "rust-ecosystem-policy-tools" {
  context    = "."
  dockerfile = "nook-app/docker/rust.Dockerfile"
  target     = "rust-ecosystem-policy-tools"
  platforms  = ["linux/amd64"]
  cache-from = rust_base_cache_from
  output     = ["type=cacheonly"]
}

target "rust-dependency-policy" {
  context    = "."
  dockerfile = "nook-app/docker/rust.Dockerfile"
  target     = "rust-dependency-policy"
  platforms  = ["linux/amd64"]
  cache-from = rust_base_cache_from
  output     = ["type=cacheonly"]
}

target "rust-ecosystem-nightly" {
  inherits   = ["_sccache"]
  context    = "."
  dockerfile = "nook-app/docker/rust.Dockerfile"
  target     = "rust-ecosystem-nightly"
  platforms  = ["linux/amd64"]
  cache-from = rust_base_cache_from
  output     = ["type=cacheonly"]
}

target "rust-fuzz-smoke" {
  inherits   = ["_sccache"]
  context    = "."
  dockerfile = "nook-app/docker/rust.Dockerfile"
  target     = "rust-fuzz-smoke"
  platforms  = ["linux/amd64"]
  args = {
    FUZZ_SECONDS = FUZZ_SECONDS
  }
  cache-from = rust_base_cache_from
  output     = ["type=cacheonly"]
}

target "rust-dylint" {
  inherits   = ["_sccache"]
  context    = "."
  dockerfile = "nook-app/docker/rust.Dockerfile"
  target     = "rust-dylint"
  platforms  = ["linux/amd64"]
  cache-from = rust_base_cache_from
  output     = ["type=cacheonly"]
}

target "rust-ecosystem-deterministic" {
  inherits   = ["_sccache"]
  context    = "."
  dockerfile = "nook-app/docker/rust.Dockerfile"
  target     = "rust-ecosystem-deterministic"
  platforms  = ["linux/amd64"]
  cache-from = rust_deps_cache_from
  output     = ["type=cacheonly"]
}
