// Rust toolchain base. Hosted CI seeds rust_base_cache_* before dependency scopes consume it.
// Intended to move next to the Rust workspace when that directory layout lands.

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
