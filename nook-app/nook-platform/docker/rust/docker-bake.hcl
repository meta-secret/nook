// Rust toolchain base + ecosystem gates + platform Zot cache scopes.
// Hosted CI seeds rust_base_cache_* before dependency scopes consume it.
// Ecosystem Bake targets seed their own scopes so policy-tools, nightly/fuzz/dylint,
// and deterministic compiles are reused without folding that tooling into product rust-base.
// Main seeds those scopes with the trusted registry writer; PRs only write
// isolated remote-buildcache refs.
// Nightly: rust-ecosystem-nightly-publish is the sole writer for the shared nightly
// ref. Dylint/fuzz write leaf scopes only (no nightly/rust-base in cache-from).
// Parents restore via Bake contexts (same pattern as preflight).
// Context parents keep cache-from and never declare cache-to.
// Dedicated *-publish targets write mode=max refs under write_cache_repository
// plus GHA_CACHE_SCOPE_SUFFIX (Main: nook/buildcache; isolated: …-git-<sha>).
// Empty cache-from= and cache-to= overrides are prohibited.
// Shared GHA_CACHE_* / NOOK_REGISTRY_CACHE_HOST / write_cache_repository live in
// nook-app/docker-bake.hcl and are merged via NOOK_BAKE_FILES.

variable "FUZZ_SECONDS" {
  default = "20"
}

variable "DOCKER_POLICY_TOOLS_IMAGE" {
  default = "nook-rust-policy-tools:local"
}

// Main and pull requests derive this immutable scope from every file that defines the WASM
// dependency graph and compiler environment. A new graph gets a new registry ref instead of
// overwriting the last complete dependency export with a different lineage.
variable "GHA_RUST_WASM_DEPS_SCOPE" {
  default = "nook-rust-wasm-deps-v5-local"
}

rust_base_cache_from = GHA_CACHE_ENABLED == "" ? [] : GHA_CACHE_FALLBACK_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-rust-base-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-rust-base-v1:buildcache",
] : [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-rust-base-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache",
]

rust_base_cache_to = GHA_CACHE_WRITE_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-rust-base-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache,mode=max,timeout=10m",
] : []

// Nightly + cargo-fuzz + cargo-dylint. Kept out of rust-base so product builds do
// not inherit a second toolchain, while fuzz/dylint jobs can still reuse it.
// Do not cache-from rust-base here: a shorter parent importer wins and orphans the
// nightly RUN even when this scope's mode=max export already embeds rust-base.
// v4 rotates past thin indexes. PR FALLBACK is PR-scope only: a thin trusted Main
// importer steals fat PR mode=max layers the same way rust-base did.
rust_ecosystem_nightly_cache_from = GHA_CACHE_ENABLED == "" ? [] : GHA_CACHE_FALLBACK_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-rust-ecosystem-nightly-v4${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
] : [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-rust-ecosystem-nightly-v4${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
]

rust_ecosystem_nightly_cache_to = GHA_CACHE_WRITE_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-rust-ecosystem-nightly-v4${GHA_CACHE_SCOPE_SUFFIX}:buildcache,mode=max,timeout=10m",
] : []

// Source-sensitive cargo-dylint leaf. Own scope only.
// Do not cache-from nightly: that shorter parent orphans the dylint RUN (Clippy
// driver fetch) even when the leaf scope imports. mode=max embeds nightly.
// v2 rotates past thin PR indexes written while nightly was still listed.
rust_ecosystem_dylint_cache_from = GHA_CACHE_ENABLED == "" ? [] : GHA_CACHE_FALLBACK_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-rust-ecosystem-dylint-v2${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-rust-ecosystem-dylint-v2:buildcache,ignore-error=true",
] : [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-rust-ecosystem-dylint-v2${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
]

rust_ecosystem_dylint_cache_to = GHA_CACHE_WRITE_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-rust-ecosystem-dylint-v2${GHA_CACHE_SCOPE_SUFFIX}:buildcache,mode=max,timeout=10m",
] : []

// Source-sensitive cargo-fuzz smoke leaf. Own scope only; same short-chain rule
// as dylint. Dylint's job remains the sole shared nightly writer.
rust_ecosystem_fuzz_cache_from = GHA_CACHE_ENABLED == "" ? [] : GHA_CACHE_FALLBACK_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-rust-ecosystem-fuzz-v2${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-rust-ecosystem-fuzz-v2:buildcache,ignore-error=true",
] : [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-rust-ecosystem-fuzz-v2${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
]

rust_ecosystem_fuzz_cache_to = GHA_CACHE_WRITE_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-rust-ecosystem-fuzz-v2${GHA_CACHE_SCOPE_SUFFIX}:buildcache,mode=max,timeout=10m",
] : []

// Pinned cargo-deny/cargo-audit install image. Own scope so other ecosystem
// exports cannot replace the tools index. mode=max embeds rust-base; do not also
// import rust-base or the short chain steals the parent and tools RUNs miss.
// v4 + PR-only FALLBACK: thin Main v3 kept stealing fat PR tools layers.
// Workspace deny/audit runs via Task against the loaded image, not a Bake leaf.
rust_ecosystem_policy_tools_cache_from = GHA_CACHE_ENABLED == "" ? [] : GHA_CACHE_FALLBACK_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-rust-ecosystem-policy-tools-v4${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
] : [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-rust-ecosystem-policy-tools-v4${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
]

rust_ecosystem_policy_tools_cache_to = GHA_CACHE_WRITE_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-rust-ecosystem-policy-tools-v4${GHA_CACHE_SCOPE_SUFFIX}:buildcache,mode=max,timeout=10m",
] : []

// Proptest/Insta/Loom compile layers on top of rust-platform (source over cooked deps).
// Falls back through trusted rust-deps so PR-isolated deps/base cannot orphan
// the deterministic toolchain graph. Omit rust-base: rust-deps mode=max embeds it.
rust_ecosystem_deterministic_cache_from = GHA_CACHE_ENABLED == "" ? [] : GHA_CACHE_FALLBACK_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-rust-ecosystem-deterministic-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-rust-ecosystem-deterministic-v1:buildcache,ignore-error=true",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-rust-deps-v2:buildcache",
] : [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-rust-ecosystem-deterministic-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-rust-deps-v2:buildcache",
]

rust_ecosystem_deterministic_cache_to = GHA_CACHE_WRITE_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-rust-ecosystem-deterministic-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache,mode=max,timeout=10m",
] : []

// Product deps must not import PR rust-base: parallel Native/WASM writers orphan
// trusted deps layers the same way ecosystem nightly/policy were orphaned.
rust_deps_cache_from = GHA_CACHE_ENABLED == "" ? [] : GHA_CACHE_FALLBACK_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-rust-deps-v2${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-rust-deps-v2:buildcache",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-rust-base-v1:buildcache",
] : [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-rust-deps-v2${GHA_CACHE_SCOPE_SUFFIX}:buildcache",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-rust-base-v1:buildcache",
]

rust_deps_cache_to = GHA_CACHE_WRITE_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-rust-deps-v2${GHA_CACHE_SCOPE_SUFFIX}:buildcache,mode=max,timeout=10m",
] : []

// WASM chef cooks. Own scope only: importing rust-base or native rust-deps
// short-chains orphan the wasm cook RUNs the same way nightly/policy were orphaned.
// mode=max already embeds those parents. v5 rotates past thin PR indexes written
// while those short importers were still listed.
rust_wasm_deps_write_scope = GHA_CACHE_SCOPE_SUFFIX != "" ? "nook-rust-wasm-deps-v5${GHA_CACHE_SCOPE_SUFFIX}" : GHA_RUST_WASM_DEPS_SCOPE

rust_wasm_deps_cache_from = GHA_CACHE_ENABLED == "" ? [] : GHA_CACHE_FALLBACK_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-rust-wasm-deps-v5${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/${GHA_RUST_WASM_DEPS_SCOPE}:buildcache,ignore-error=true",
] : [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/${GHA_RUST_WASM_DEPS_SCOPE}:buildcache,ignore-error=true",
]

rust_wasm_deps_cache_to = GHA_CACHE_WRITE_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/${rust_wasm_deps_write_scope}:buildcache,mode=max,timeout=10m",
] : []

rust_native_source_cache_from = GHA_CACHE_ENABLED == "" ? [] : GHA_CACHE_FALLBACK_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-rust-native-source-v2${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-rust-native-source-v2:buildcache",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-rust-deps-v2${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-rust-deps-v2:buildcache",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-rust-base-v1:buildcache",
] : [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-rust-native-source-v2${GHA_CACHE_SCOPE_SUFFIX}:buildcache",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-rust-deps-v2${GHA_CACHE_SCOPE_SUFFIX}:buildcache",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-rust-base-v1:buildcache",
]

rust_native_source_cache_to = GHA_CACHE_WRITE_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-rust-native-source-v2${GHA_CACHE_SCOPE_SUFFIX}:buildcache,mode=max,timeout=10m",
] : []

// WASM source layers restore their own scope plus wasm-deps. Do not import
// rust-base or native rust-deps here: those shorter parents orphan source RUNs.
rust_wasm_source_cache_from = GHA_CACHE_ENABLED == "" ? [] : GHA_CACHE_FALLBACK_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-rust-wasm-source-v2${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-rust-wasm-source-v2:buildcache,ignore-error=true",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-rust-wasm-deps-v5${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/${GHA_RUST_WASM_DEPS_SCOPE}:buildcache,ignore-error=true",
] : [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-rust-wasm-source-v2${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/${GHA_RUST_WASM_DEPS_SCOPE}:buildcache,ignore-error=true",
]

rust_wasm_source_cache_to = GHA_CACHE_WRITE_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-rust-wasm-source-v2${GHA_CACHE_SCOPE_SUFFIX}:buildcache,mode=max,timeout=10m",
] : []


target "rust-base" {
  context    = "."
  dockerfile = "nook-app/nook-platform/docker/rust/lineage.Dockerfile"
  target     = "rust-base"
  platforms  = ["linux/amd64"]
  args = {
    SCCACHE_ENDPOINT = SCCACHE_ENDPOINT
    SCCACHE_BUCKET   = SCCACHE_BUCKET
    SCCACHE_S3_MODE  = SCCACHE_S3_MODE
  }
  cache-from = rust_base_cache_from
}

// Explicit writer for the rust-base Zot scope. Context consumers use rust-base
// (no cache-to) so linked leaf bakes cannot thin-export this parent.
target "rust-base-publish" {
  inherits = ["rust-base"]
  cache-to = rust_base_cache_to
}

target "rust-ecosystem-policy-tools" {
  context    = "."
  dockerfile = "nook-app/nook-platform/docker/rust/policy-tools.Dockerfile"
  target     = "rust-ecosystem-policy-tools"
  platforms  = ["linux/amd64"]
  contexts = {
    rust-base = "target:rust-base"
  }
  tags       = [DOCKER_POLICY_TOOLS_IMAGE]
  cache-from = rust_ecosystem_policy_tools_cache_from
  cache-to   = rust_ecosystem_policy_tools_cache_to
  output     = ["type=docker"]
}

target "rust-ecosystem-nightly" {
  context    = "."
  dockerfile = "nook-app/nook-platform/docker/rust/nightly.Dockerfile"
  target     = "rust-ecosystem-nightly"
  platforms  = ["linux/amd64"]
  contexts = {
    rust-base = "target:rust-base"
  }
  cache-from = rust_ecosystem_nightly_cache_from
  output     = ["type=cacheonly"]
}

target "rust-ecosystem-nightly-publish" {
  inherits = ["rust-ecosystem-nightly"]
  cache-to = rust_ecosystem_nightly_cache_to
}

// Platform sources over nightly tools. Dylint/fuzz take this via Bake context so
// source edits do not rewrite the shared nightly toolchain scope.
target "rust-platform-nightly" {
  context    = "."
  dockerfile = "nook-app/nook-platform/docker/rust/nightly.Dockerfile"
  target     = "rust-platform-nightly"
  platforms  = ["linux/amd64"]
  contexts = {
    rust-ecosystem-nightly = "target:rust-ecosystem-nightly"
  }
  output = ["type=cacheonly"]
}

target "rust-fuzz-smoke" {
  inherits   = ["_sccache"]
  context    = "."
  dockerfile = "nook-app/nook-platform/docker/rust/fuzz-smoke.Dockerfile"
  target     = "rust-fuzz-smoke"
  platforms  = ["linux/amd64"]
  args = {
    FUZZ_SECONDS = FUZZ_SECONDS
  }
  contexts = {
    rust-platform-nightly = "target:rust-platform-nightly"
  }
  cache-from = rust_ecosystem_fuzz_cache_from
  cache-to   = rust_ecosystem_fuzz_cache_to
  output     = ["type=cacheonly"]
}

target "rust-dylint" {
  inherits   = ["_sccache"]
  context    = "."
  dockerfile = "nook-app/nook-platform/docker/rust/dylint.Dockerfile"
  target     = "rust-dylint"
  platforms  = ["linux/amd64"]
  contexts = {
    rust-platform-nightly = "target:rust-platform-nightly"
  }
  cache-from = rust_ecosystem_dylint_cache_from
  cache-to   = rust_ecosystem_dylint_cache_to
  output     = ["type=cacheonly"]
}

target "rust-ecosystem-deterministic" {
  inherits   = ["_sccache"]
  context    = "."
  dockerfile = "nook-app/nook-platform/docker/rust/deterministic.Dockerfile"
  target     = "rust-ecosystem-deterministic"
  platforms  = ["linux/amd64"]
  contexts = {
    rust-platform = "target:rust-platform"
  }
  cache-from = rust_ecosystem_deterministic_cache_from
  cache-to   = rust_ecosystem_deterministic_cache_to
  output     = ["type=cacheonly"]
}
