// Rust toolchain base + ecosystem gates. Hosted CI seeds rust_base_cache_* before
// dependency scopes consume it. Ecosystem Bake targets seed their own scopes so
// deny/audit, nightly/fuzz/dylint, and deterministic compiles are reused without
// folding that tooling into product rust-base.
// Main seeds those scopes with the trusted registry writer; PRs only write
// isolated remote-buildcache refs.
// Nightly: rust-ecosystem-nightly is the sole writer for the shared nightly ref.
// Dylint/fuzz write leaf scopes only (no nightly/rust-base in cache-from).
// Parents restore via Bake contexts (same pattern as preflight). Tasks must clear
// parent cache-from after warming that parent: target:PARENT still imports the
// parent's Zot scope, and that shorter index orphans leaf RUNs on verify/publish.
// Ecosystem Tasks import with cache-to cleared, then publish with leaf cache-from
// kept so remote hits re-export without cold chef/toolchain rebuilds.

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
  contexts = {
    rust-base = "target:rust-base"
  }
  cache-from = rust_ecosystem_policy_tools_cache_from
  cache-to   = rust_ecosystem_policy_tools_cache_to
  output     = ["type=cacheonly"]
}

target "rust-dependency-policy" {
  context    = "."
  dockerfile = "nook-app/docker/rust.Dockerfile"
  target     = "rust-dependency-policy"
  platforms  = ["linux/amd64"]
  contexts = {
    rust-base = "target:rust-base"
  }
  cache-from = rust_ecosystem_policy_cache_from
  cache-to   = rust_ecosystem_policy_cache_to
  output     = ["type=cacheonly"]
}

target "rust-ecosystem-nightly" {
  context    = "."
  dockerfile = "nook-app/docker/rust.Dockerfile"
  target     = "rust-ecosystem-nightly"
  platforms  = ["linux/amd64"]
  contexts = {
    rust-base = "target:rust-base"
  }
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
  contexts = {
    rust-ecosystem-nightly = "target:rust-ecosystem-nightly"
  }
  cache-from = rust_ecosystem_fuzz_cache_from
  cache-to   = rust_ecosystem_fuzz_cache_to
  output     = ["type=cacheonly"]
}

target "rust-dylint" {
  inherits   = ["_sccache"]
  context    = "."
  dockerfile = "nook-app/docker/rust.Dockerfile"
  target     = "rust-dylint"
  platforms  = ["linux/amd64"]
  contexts = {
    rust-ecosystem-nightly = "target:rust-ecosystem-nightly"
  }
  cache-from = rust_ecosystem_dylint_cache_from
  cache-to   = rust_ecosystem_dylint_cache_to
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
