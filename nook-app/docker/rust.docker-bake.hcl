// Rust toolchain base + ecosystem gates. Hosted CI seeds rust_base_cache_* before
// dependency scopes consume it. Ecosystem Bake targets seed their own scopes so
// deny/audit, nightly/fuzz/dylint, and deterministic compiles are reused without
// folding that tooling into product rust-base.
// Main seeds those scopes with the trusted registry writer; PRs only write
// isolated remote-buildcache refs.
// Only one CI job may cache-to the shared nightly scope (dylint). Fuzz reads the
// same cache-from list but does not race the registry index.
// Policy-tools has its own scope; dependency-policy writes only the leaf policy
// scope after restoring tools.

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
  cache-from = rust_ecosystem_policy_tools_cache_from
  cache-to   = rust_ecosystem_policy_tools_cache_to
  output     = ["type=cacheonly"]
}

target "rust-dependency-policy" {
  context    = "."
  dockerfile = "nook-app/docker/rust.Dockerfile"
  target     = "rust-dependency-policy"
  platforms  = ["linux/amd64"]
  cache-from = rust_ecosystem_policy_cache_from
  cache-to   = rust_ecosystem_policy_cache_to
  output     = ["type=cacheonly"]
}

target "rust-ecosystem-nightly" {
  context    = "."
  dockerfile = "nook-app/docker/rust.Dockerfile"
  target     = "rust-ecosystem-nightly"
  platforms  = ["linux/amd64"]
  cache-from = rust_ecosystem_nightly_cache_from
  cache-to   = rust_ecosystem_nightly_cache_to
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
  cache-from = rust_ecosystem_nightly_cache_from
  // Read-only for the shared nightly scope; dylint is the sole CI writer.
  cache-to   = []
  output     = ["type=cacheonly"]
}

target "rust-dylint" {
  inherits   = ["_sccache"]
  context    = "."
  dockerfile = "nook-app/docker/rust.Dockerfile"
  target     = "rust-dylint"
  platforms  = ["linux/amd64"]
  cache-from = rust_ecosystem_nightly_cache_from
  cache-to   = rust_ecosystem_nightly_cache_to
  output     = ["type=cacheonly"]
}

target "rust-ecosystem-deterministic" {
  inherits   = ["_sccache"]
  context    = "."
  dockerfile = "nook-app/docker/rust.Dockerfile"
  target     = "rust-ecosystem-deterministic"
  platforms  = ["linux/amd64"]
  cache-from = rust_ecosystem_deterministic_cache_from
  cache-to   = rust_ecosystem_deterministic_cache_to
  output     = ["type=cacheonly"]
}
