// Rust toolchain base + ecosystem gates + platform Zot cache scopes.
// Hosted CI seeds rust_base_cache_* before dependency scopes consume it.
// Ecosystem Bake targets seed their own scopes so policy-tools, fuzz/dylint,
// and deterministic compiles are reused without folding that tooling into product rust-base.
// Main seeds those scopes with the trusted registry writer; PRs only write
// isolated remote-buildcache refs.
// Nightly, dylint, and fuzz are stages of one Dockerfile. This keeps the exact
// toolchain lineage inside each mode=max leaf scope and removes the linked
// nightly context whose nested identity rebuilt cargo-dylint. Source COPY steps
// stay after the shared tool stage. rust-base remains the only linked context.
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

// Cross-machine, source-free dependency identity. Local sealed formatting and
// hosted PR jobs derive this value with the same repository script.
variable "NOOK_RUST_DEPS_INPUT_FINGERPRINT" {
  default = "local"
}

variable "NOOK_RUST_DEPS_INPUT_WRITE_ENABLED" {
  default = ""
}

// Unique quarantine tag written by one local formatter invocation. Pull
// requests never import this tag. A GitHub-hosted promoter must download every
// blob twice before atomically assigning the fingerprint tag.
variable "NOOK_RUST_DEPS_INPUT_CANDIDATE" {
  default = ""
}

rust_base_cache_from = GHA_CACHE_ENABLED == "" ? [] : GHA_CACHE_EXACT_RUST_BASE_AVAILABLE != "" && GHA_CACHE_SCOPE_SUFFIX == "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-rust-base-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
] : GHA_CACHE_FALLBACK_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-rust-base-v1:buildcache,ignore-error=true",
] : [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-rust-base-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
]

rust_base_cache_to = GHA_CACHE_WRITE_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-rust-base-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache,mode=max,timeout=10m",
] : []

// Source-sensitive cargo-dylint leaf. Own scope only.
// Do not cache-from nightly: that shorter parent orphans the dylint RUN (Clippy
// driver fetch) even when the leaf scope imports. mode=max embeds nightly.
// v3 rotates past thin Main dylint-v2 indexes that orphaned nested nightly
// `cargo install` after Main nightly FALLBACK already restored it.
rust_ecosystem_dylint_cache_from = GHA_CACHE_ENABLED == "" ? [] : GHA_CACHE_EXACT_RUST_DYLINT_AVAILABLE != "" && GHA_CACHE_SCOPE_SUFFIX == "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-rust-ecosystem-dylint-v3${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
] : GHA_CACHE_FALLBACK_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-rust-ecosystem-dylint-v3:buildcache,ignore-error=true",
] : [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-rust-ecosystem-dylint-v3${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
]

rust_ecosystem_dylint_cache_to = GHA_CACHE_WRITE_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-rust-ecosystem-dylint-v3${GHA_CACHE_SCOPE_SUFFIX}:buildcache,mode=max,timeout=10m",
] : []

// Source-sensitive cargo-fuzz smoke leaf. Own scope only; same short-chain rule
// as dylint. Dylint's job remains the sole shared nightly writer.
// v3 matches dylint: leave thin fuzz-v2 indexes that orphaned nested nightly.
rust_ecosystem_fuzz_cache_from = GHA_CACHE_ENABLED == "" ? [] : GHA_CACHE_EXACT_RUST_FUZZ_AVAILABLE != "" && GHA_CACHE_SCOPE_SUFFIX == "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-rust-ecosystem-fuzz-v3${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
] : GHA_CACHE_FALLBACK_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-rust-ecosystem-fuzz-v3:buildcache,ignore-error=true",
] : [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-rust-ecosystem-fuzz-v3${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
]

rust_ecosystem_fuzz_cache_to = GHA_CACHE_WRITE_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-rust-ecosystem-fuzz-v3${GHA_CACHE_SCOPE_SUFFIX}:buildcache,mode=max,timeout=10m",
] : []

// Pinned cargo-deny/cargo-audit install image. Own scope so other ecosystem
// exports cannot replace the tools index. mode=max embeds rust-base; do not also
// import rust-base or the short chain steals the parent and tools RUNs miss.
// v4 rotates past thin indexes. A present exact ref is imported alone. A cold
// isolated scope uses the fat Main policy-tools index as its trusted seed.
// Workspace deny/audit runs via Task against the loaded image, not a Bake leaf.
rust_ecosystem_policy_tools_cache_from = GHA_CACHE_ENABLED == "" ? [] : GHA_CACHE_EXACT_RUST_POLICY_TOOLS_AVAILABLE != "" && GHA_CACHE_SCOPE_SUFFIX == "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-rust-ecosystem-policy-tools-v4${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
] : GHA_CACHE_FALLBACK_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-rust-ecosystem-policy-tools-v4:buildcache,ignore-error=true",
] : [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-rust-ecosystem-policy-tools-v4${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
]

rust_ecosystem_policy_tools_cache_to = GHA_CACHE_WRITE_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-rust-ecosystem-policy-tools-v4${GHA_CACHE_SCOPE_SUFFIX}:buildcache,mode=max,timeout=10m",
] : []

// Proptest/Insta/Loom compile layers on top of rust-platform (source over cooked deps).
// Falls back through trusted rust-deps so PR-isolated deps/base cannot orphan
// the deterministic toolchain graph. Omit rust-base: rust-deps mode=max embeds it.
rust_ecosystem_deterministic_cache_from = GHA_CACHE_ENABLED == "" ? [] : GHA_CACHE_EXACT_RUST_DETERMINISTIC_AVAILABLE != "" && GHA_CACHE_SCOPE_SUFFIX == "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-rust-ecosystem-deterministic-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
] : GHA_CACHE_FALLBACK_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-rust-ecosystem-deterministic-v1:buildcache,ignore-error=true",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-rust-deps-v3:buildcache,ignore-error=true",
] : [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-rust-ecosystem-deterministic-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-rust-deps-v3:buildcache,ignore-error=true",
]

rust_ecosystem_deterministic_cache_to = GHA_CACHE_WRITE_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-rust-ecosystem-deterministic-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache,mode=max,timeout=10m",
] : []

// Kani uses its own compiler, so sccache cannot safely wrap the proof build.
// Cache the complete toolchain + source proof graph as one mode=max scope.
rust_ecosystem_kani_cache_from = GHA_CACHE_ENABLED == "" ? [] : GHA_CACHE_EXACT_RUST_KANI_AVAILABLE != "" && GHA_CACHE_SCOPE_SUFFIX == "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-rust-ecosystem-kani-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
] : GHA_CACHE_FALLBACK_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-rust-ecosystem-kani-v1:buildcache,ignore-error=true",
] : [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-rust-ecosystem-kani-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
]

rust_ecosystem_kani_cache_to = GHA_CACHE_WRITE_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-rust-ecosystem-kani-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache,mode=max,timeout=10m",
] : []

// Product native deps. Own scope only: product.Dockerfile extends rust-base
// internally. A shorter rust-base importer orphans chef cooks the same way
// nightly/policy/wasm were orphaned. mode=max embeds rust-base.
// v3 rotates past thin indexes written while trusted rust-base was still listed.
rust_deps_cache_from = GHA_CACHE_ENABLED == "" ? [] : GHA_CACHE_EXACT_RUST_DEPS_AVAILABLE != "" && GHA_CACHE_SCOPE_SUFFIX == "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-rust-deps-v3${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
] : GHA_CACHE_FALLBACK_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/remote-buildcache/nook-rust-native-deps-input-v2:fingerprint-${NOOK_RUST_DEPS_INPUT_FINGERPRINT},ignore-error=true",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-rust-deps-v3:buildcache,ignore-error=true",
] : [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-rust-deps-v3${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
]

rust_deps_cache_to = GHA_CACHE_WRITE_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-rust-deps-v3${GHA_CACHE_SCOPE_SUFFIX}:buildcache,mode=max,timeout=10m",
] : []

rust_native_deps_input_cache_to = NOOK_RUST_DEPS_INPUT_WRITE_ENABLED != "" && NOOK_RUST_DEPS_INPUT_CANDIDATE != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/remote-buildcache/nook-rust-native-deps-input-v2:candidate-${NOOK_RUST_DEPS_INPUT_FINGERPRINT}-${NOOK_RUST_DEPS_INPUT_CANDIDATE},mode=max,timeout=10m",
] : []

// WASM chef cooks. Prefer own deps scopes. Never import shorter rust-base or
// native rust-deps: those short-chain and orphan cook RUNs. Longer source-v2
// indexes embed the cook layers (mode=max), so they are a soft fallback when
// the fingerprinted deps scope is still empty after a cook-input rotation.
rust_wasm_deps_write_scope = GHA_CACHE_SCOPE_SUFFIX != "" ? "nook-rust-wasm-deps-v5${GHA_CACHE_SCOPE_SUFFIX}" : GHA_RUST_WASM_DEPS_SCOPE

rust_wasm_deps_cache_from = GHA_CACHE_ENABLED == "" ? [] : GHA_CACHE_EXACT_RUST_WASM_DEPS_AVAILABLE != "" && GHA_CACHE_SCOPE_SUFFIX == "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/${rust_wasm_deps_write_scope}:buildcache,ignore-error=true",
] : GHA_CACHE_FALLBACK_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/remote-buildcache/nook-rust-wasm-deps-input-v2:fingerprint-${NOOK_RUST_DEPS_INPUT_FINGERPRINT},ignore-error=true",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/${GHA_RUST_WASM_DEPS_SCOPE}:buildcache,ignore-error=true",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-rust-wasm-source-v2:buildcache,ignore-error=true",
] : [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/${GHA_RUST_WASM_DEPS_SCOPE}:buildcache,ignore-error=true",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-rust-wasm-source-v2:buildcache,ignore-error=true",
]

rust_wasm_deps_cache_to = GHA_CACHE_WRITE_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/${rust_wasm_deps_write_scope}:buildcache,mode=max,timeout=10m",
] : []

rust_wasm_deps_input_cache_to = NOOK_RUST_DEPS_INPUT_WRITE_ENABLED != "" && NOOK_RUST_DEPS_INPUT_CANDIDATE != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/remote-buildcache/nook-rust-wasm-deps-input-v2:candidate-${NOOK_RUST_DEPS_INPUT_FINGERPRINT}-${NOOK_RUST_DEPS_INPUT_CANDIDATE},mode=max,timeout=10m",
] : []

// Native source restores own scope plus cooked deps. Do not import rust-base:
// that shorter parent orphans source RUNs even when mode=max embeds the chain.
// v3 rotates past thin indexes written while rust-base was still listed.
rust_native_source_cache_from = GHA_CACHE_ENABLED == "" ? [] : GHA_CACHE_EXACT_RUST_NATIVE_SOURCE_AVAILABLE != "" && GHA_CACHE_SCOPE_SUFFIX == "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-rust-native-source-v3${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
] : GHA_CACHE_FALLBACK_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-rust-native-source-v3:buildcache,ignore-error=true",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/remote-buildcache/nook-rust-native-deps-input-v2:fingerprint-${NOOK_RUST_DEPS_INPUT_FINGERPRINT},ignore-error=true",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-rust-deps-v3:buildcache,ignore-error=true",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-rust-deps-v3:buildcache,ignore-error=true",
] : [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-rust-native-source-v3${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-rust-deps-v3${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
]

rust_native_source_cache_to = GHA_CACHE_WRITE_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-rust-native-source-v3${GHA_CACHE_SCOPE_SUFFIX}:buildcache,mode=max,timeout=10m",
] : []

// WASM source layers restore their own scope plus wasm-deps. Do not import
// rust-base or native rust-deps here: those shorter parents orphan source RUNs.
rust_wasm_source_cache_from = GHA_CACHE_ENABLED == "" ? [] : GHA_CACHE_EXACT_RUST_WASM_SOURCE_AVAILABLE != "" && GHA_CACHE_SCOPE_SUFFIX == "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-rust-wasm-source-v2${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
] : GHA_CACHE_FALLBACK_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-rust-wasm-source-v2:buildcache,ignore-error=true",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/remote-buildcache/nook-rust-wasm-deps-input-v2:fingerprint-${NOOK_RUST_DEPS_INPUT_FINGERPRINT},ignore-error=true",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/${GHA_RUST_WASM_DEPS_SCOPE}:buildcache,ignore-error=true",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/${GHA_RUST_WASM_DEPS_SCOPE}:buildcache,ignore-error=true",
] : [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-rust-wasm-source-v2${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/${GHA_RUST_WASM_DEPS_SCOPE}:buildcache,ignore-error=true",
]

rust_wasm_source_cache_to = GHA_CACHE_WRITE_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-rust-wasm-source-v2${GHA_CACHE_SCOPE_SUFFIX}:buildcache,mode=max,timeout=10m",
] : []

// Node tests are a distinct source-sensitive consumer running on a separate PR
// worker. Its own mode=max scope embeds the complete WASM lineage without
// racing wasm-export's source-v2 writer. A present exact ref is imported alone;
// the first solve for a new head falls back only to trusted Main's full graph.
rust_wasm_node_cache_from = GHA_CACHE_ENABLED == "" ? [] : GHA_CACHE_EXACT_RUST_WASM_NODE_AVAILABLE != "" && GHA_CACHE_SCOPE_SUFFIX == "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-rust-wasm-node-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
] : GHA_CACHE_FALLBACK_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-rust-wasm-node-v1:buildcache,ignore-error=true",
] : [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-rust-wasm-node-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
]

rust_wasm_node_cache_to = GHA_CACHE_WRITE_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-rust-wasm-node-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache,mode=max,timeout=10m",
] : []


// Context parent for ecosystem/product leaves. No cache-from and no cache-to:
// importing the short rust-base index while nesting nightly/policy orphans their
// expensive RUNs even after Main nightly FALLBACK restored them.
target "rust-base" {
  context    = "."
  dockerfile = "nook-app/nook-platform/docker/rust/product.Dockerfile"
  target     = "rust-base"
  platforms  = ["linux/amd64"]
  args = {
    SCCACHE_ENDPOINT = SCCACHE_ENDPOINT
    SCCACHE_BUCKET   = SCCACHE_BUCKET
    SCCACHE_S3_MODE  = SCCACHE_S3_MODE
  }
}

// Read-only warmer for the rust-base Zot scope (docker:rust-base).
target "rust-base-restore" {
  inherits   = ["rust-base"]
  cache-from = rust_base_cache_from
}

// Explicit writer for the rust-base Zot scope. Context consumers use rust-base
// (no cache-from/cache-to) so linked leaf bakes cannot thin-export or orphan.
target "rust-base-publish" {
  inherits = ["rust-base-restore"]
  cache-to   = rust_base_cache_to
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

target "rust-fuzz-smoke" {
  inherits   = ["_sccache"]
  context    = "."
  dockerfile = "nook-app/nook-platform/docker/rust/nightly.Dockerfile"
  target     = "rust-fuzz-smoke"
  platforms  = ["linux/amd64"]
  args = {
    FUZZ_SECONDS = FUZZ_SECONDS
  }
  contexts = {
    rust-base = "target:rust-base"
  }
  cache-from = rust_ecosystem_fuzz_cache_from
  cache-to   = rust_ecosystem_fuzz_cache_to
  output     = ["type=cacheonly"]
}

target "rust-dylint" {
  inherits   = ["_sccache"]
  context    = "."
  dockerfile = "nook-app/nook-platform/docker/rust/nightly.Dockerfile"
  target     = "rust-dylint"
  platforms  = ["linux/amd64"]
  contexts = {
    rust-base = "target:rust-base"
  }
  cache-from = rust_ecosystem_dylint_cache_from
  cache-to   = rust_ecosystem_dylint_cache_to
  output     = ["type=cacheonly"]
}

target "rust-ecosystem-deterministic" {
  inherits   = ["_sccache"]
  context    = "."
  dockerfile = "nook-app/nook-platform/docker/rust/product.Dockerfile"
  target     = "rust-ecosystem-deterministic"
  platforms  = ["linux/amd64"]
  cache-from = rust_ecosystem_deterministic_cache_from
  cache-to   = rust_ecosystem_deterministic_cache_to
  output     = ["type=cacheonly"]
}

target "rust-kani" {
  context    = "."
  dockerfile = "nook-app/nook-platform/docker/rust/product.Dockerfile"
  target     = "rust-kani"
  platforms  = ["linux/amd64"]
  cache-from = rust_ecosystem_kani_cache_from
  cache-to   = rust_ecosystem_kani_cache_to
  output     = ["type=cacheonly"]
}
