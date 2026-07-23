// Independent Rust/WASM and web/e2e bases. BuildKit prepares both branches in parallel, and the
// final web image consumes only web-base plus small artifacts copied from builder-wasm.
// Each branch is cached independently in the selected builder and its hosted GHA lineage scope.

target "rust-base" {
  context    = "."
  dockerfile = "nook-app/docker/base.Dockerfile"
  target     = "rust-base"
  platforms  = ["linux/amd64"]
  args = {
    SCCACHE_REDIS_ENDPOINT = SCCACHE_REDIS_ENDPOINT
  }
  cache-from = rust_base_cache_from
  cache-to   = rust_base_cache_to
}

target "web-base" {
  context    = "."
  dockerfile = "nook-app/docker/base.Dockerfile"
  target     = "web-base"
  platforms  = ["linux/amd64"]
}

target "web-e2e-base" {
  context    = "."
  dockerfile = "nook-app/docker/base.Dockerfile"
  target     = "web-e2e-base"
  platforms  = ["linux/amd64"]
}
