// App bake: shared variables, parallel groups, and loadable runtime variants.
// Every target's build definition (dockerfile/target/contexts) lives next to its Dockerfile and
// is merged in via multiple -f flags (bake has no `include`):
//   nook-app/docker/base.docker-bake.hcl        -> rust-base, web-base
//   nook-app/nook-core/docker-bake.hcl          -> builder-deps, builder-debug
//   nook-app/nook-wasm/docker-bake.hcl          -> builder-wasm, web-artifacts, on-demand Rust images
//   nook-app/docker/toolchain.docker-bake.hcl   -> web-deps
//   nook-app/nook-web/nook-web-app/docker-bake.hcl -> slim web runtime and CI targets
// Callers (Taskfile `setup`, nook-app/docker/Taskfile.yml) pass all files via the NOOK_BAKE_FILES list.
//
// PREPARE PHASE: rust-base -> builder-deps -> (builder-debug || builder-wasm) -> web-artifacts, in
// parallel with web-base -> web-deps. web-artifacts joins only small outputs and is exported to a commit-scoped,
// invocation-isolated host directory.
// WEB PHASE: nook-web consumes web-base + web-deps + only that host artifact directory. The heavy
// Rust snapshot never becomes a context or parent of the final image. Local builds reuse the
// selected builder's content store; GitHub-hosted CI additionally imports/exports distinct GHA
// cache scopes for Rust, web dependencies, and the two final web-image variants.

variable "DOCKER_IMAGE" {
  default = "nook-web:local"
}

variable "DOCKER_RUST_IMAGE" {
  default = "nook-rust:local"
}

variable "DOCKER_RUST_FAST_IMAGE" {
  default = "nook-rust-fast:local"
}

variable "DOCKER_RUST_BROWSER_IMAGE" {
  default = "nook-rust-browser:local"
}

variable "DOCKER_E2E_IMAGE" {
  default = "nook-web-e2e:local"
}

// Passed to every target that reaches the internal builder-wasm Dockerfile stage. Setting only the
// standalone `builder-wasm` bake target is insufficient for scratch exports such as web-artifacts,
// because each final target owns its own Dockerfile solve.
variable "WASM_BUILD_MODE" {
  default = "dev"
}

variable "SCCACHE_REDIS_ENDPOINT" {
  default = "rediss://redis-ovh-borg-1.bynull.link:6380"
}

variable "SCCACHE_REDIS_MODE" {
  default = "external"
}

// Enabled only by the GitHub Actions Docker setup. Keeping the default empty preserves zero-network
// local builds. Separate scopes are mandatory: Docker's GHA backend overwrites a scope when a
// different image exports to it, so sharing the default `buildkit` scope loses sibling lineages.
// Rust exporters omit ignore-error so a failed cook-layer upload fails Main instead of leaving PRs
// with indexes that silently miss and redownload crates. Web exporters keep ignore-error.
variable "GHA_CACHE_ENABLED" {
  default = ""
}

// Some manual workflows build an arbitrary PR head while the Actions run itself belongs to the
// default branch. They may restore shared layers, but must not overwrite main's cache scopes.
variable "GHA_CACHE_WRITE_ENABLED" {
  default = ""
}

// Retained for local/manual compatibility. Hosted delivery keeps this empty: Main owns the shared
// scopes, while every other workflow restores them read-only.
variable "GHA_CACHE_SCOPE_SUFFIX" {
  default = ""
}

// Retained for local/manual compatibility with explicitly suffixed cache experiments.
variable "GHA_CACHE_FALLBACK_ENABLED" {
  default = ""
}

// Retained for local/manual compatibility with explicitly suffixed cache experiments.
variable "GHA_CACHE_SEED_SCOPE_SUFFIX" {
  default = ""
}

// Main and pull requests derive this immutable scope from every file that defines the WASM
// dependency graph and compiler environment. A new graph gets a new location instead of
// overwriting the last complete dependency export with a different lineage.
variable "GHA_RUST_WASM_DEPS_SCOPE" {
  default = "nook-rust-wasm-deps-v4-local"
}

rust_base_cache_from = GHA_CACHE_ENABLED == "" ? [] : GHA_CACHE_SCOPE_SUFFIX == "" ? [
  "type=gha,scope=nook-rust-base-v1,version=2",
] : GHA_CACHE_FALLBACK_ENABLED != "" ? concat([
  "type=gha,scope=nook-rust-base-v1${GHA_CACHE_SCOPE_SUFFIX},version=2",
], GHA_CACHE_SEED_SCOPE_SUFFIX != "" ? [
  "type=gha,scope=nook-rust-base-v1${GHA_CACHE_SEED_SCOPE_SUFFIX},version=2",
  "type=gha,scope=nook-rust-base-v1,version=2",
] : [
  "type=gha,scope=nook-rust-base-v1,version=2",
]) : [
  "type=gha,scope=nook-rust-base-v1${GHA_CACHE_SCOPE_SUFFIX},version=2",
]

rust_base_cache_to = GHA_CACHE_WRITE_ENABLED != "" ? [
  "type=gha,scope=nook-rust-base-v1${GHA_CACHE_SCOPE_SUFFIX},mode=max,version=2,timeout=10m",
] : []

rust_deps_cache_from = GHA_CACHE_ENABLED == "" ? [] : GHA_CACHE_SCOPE_SUFFIX == "" ? [
  "type=gha,scope=nook-rust-deps-v2,version=2",
  "type=gha,scope=nook-rust-base-v1,version=2",
  "type=gha,scope=nook-rust-v1,version=2",
] : GHA_CACHE_FALLBACK_ENABLED != "" ? concat([
  "type=gha,scope=nook-rust-deps-v2${GHA_CACHE_SCOPE_SUFFIX},version=2",
], GHA_CACHE_SEED_SCOPE_SUFFIX != "" ? [
  "type=gha,scope=nook-rust-deps-v2${GHA_CACHE_SEED_SCOPE_SUFFIX},version=2",
  "type=gha,scope=nook-rust-deps-v2,version=2",
  "type=gha,scope=nook-rust-base-v1,version=2",
  "type=gha,scope=nook-rust-v1,version=2",
] : [
  "type=gha,scope=nook-rust-deps-v2,version=2",
  "type=gha,scope=nook-rust-base-v1,version=2",
  "type=gha,scope=nook-rust-v1,version=2",
]) : [
  "type=gha,scope=nook-rust-deps-v2${GHA_CACHE_SCOPE_SUFFIX},version=2",
]

rust_deps_cache_to = GHA_CACHE_WRITE_ENABLED != "" ? [
  "type=gha,scope=nook-rust-deps-v2${GHA_CACHE_SCOPE_SUFFIX},mode=max,version=2,timeout=10m",
] : []

// The fingerprinted v4 scope is the self-contained WASM dependency lineage. Keep reading the
// mutable v3/v2/v1 scopes during migration so already-warmed runners can still restore until Main
// publishes the exact immutable graph.
rust_wasm_deps_cache_from = GHA_CACHE_ENABLED == "" ? [] : GHA_CACHE_SCOPE_SUFFIX == "" ? [
  "type=gha,scope=${GHA_RUST_WASM_DEPS_SCOPE},version=2",
  "type=gha,scope=nook-rust-wasm-deps-v3,version=2",
  "type=gha,scope=nook-rust-wasm-deps-v2,version=2",
  "type=gha,scope=nook-rust-wasm-deps-v1,version=2",
  "type=gha,scope=nook-rust-deps-v2,version=2",
  "type=gha,scope=nook-rust-base-v1,version=2",
  "type=gha,scope=nook-rust-v1,version=2",
] : GHA_CACHE_FALLBACK_ENABLED != "" ? concat([
  "type=gha,scope=${GHA_RUST_WASM_DEPS_SCOPE},version=2",
], GHA_CACHE_SEED_SCOPE_SUFFIX != "" ? [
  "type=gha,scope=nook-rust-wasm-deps-v3${GHA_CACHE_SEED_SCOPE_SUFFIX},version=2",
  "type=gha,scope=nook-rust-wasm-deps-v3,version=2",
  "type=gha,scope=nook-rust-wasm-deps-v2,version=2",
  "type=gha,scope=nook-rust-wasm-deps-v1,version=2",
  "type=gha,scope=nook-rust-deps-v2,version=2",
  "type=gha,scope=nook-rust-base-v1,version=2",
  "type=gha,scope=nook-rust-v1,version=2",
] : [
  "type=gha,scope=${GHA_RUST_WASM_DEPS_SCOPE},version=2",
  "type=gha,scope=nook-rust-wasm-deps-v3,version=2",
  "type=gha,scope=nook-rust-wasm-deps-v2,version=2",
  "type=gha,scope=nook-rust-wasm-deps-v1,version=2",
  "type=gha,scope=nook-rust-deps-v2,version=2",
  "type=gha,scope=nook-rust-base-v1,version=2",
  "type=gha,scope=nook-rust-v1,version=2",
]) : [
  "type=gha,scope=${GHA_RUST_WASM_DEPS_SCOPE},version=2",
]

rust_wasm_deps_cache_to = GHA_CACHE_WRITE_ENABLED != "" ? [
  "type=gha,scope=${GHA_RUST_WASM_DEPS_SCOPE},mode=max,version=2,timeout=10m",
] : []

rust_native_source_cache_from = GHA_CACHE_ENABLED == "" ? [] : GHA_CACHE_SCOPE_SUFFIX == "" ? [
  "type=gha,scope=nook-rust-native-source-v2,version=2",
  "type=gha,scope=nook-rust-deps-v2,version=2",
  "type=gha,scope=nook-rust-base-v1,version=2",
  "type=gha,scope=nook-rust-v1,version=2",
] : GHA_CACHE_FALLBACK_ENABLED != "" ? concat([
  "type=gha,scope=nook-rust-native-source-v2${GHA_CACHE_SCOPE_SUFFIX},version=2",
], GHA_CACHE_SEED_SCOPE_SUFFIX != "" ? [
  "type=gha,scope=nook-rust-native-source-v2${GHA_CACHE_SEED_SCOPE_SUFFIX},version=2",
  "type=gha,scope=nook-rust-native-source-v2,version=2",
  "type=gha,scope=nook-rust-deps-v2,version=2",
  "type=gha,scope=nook-rust-base-v1,version=2",
  "type=gha,scope=nook-rust-v1,version=2",
] : [
  "type=gha,scope=nook-rust-native-source-v2,version=2",
  "type=gha,scope=nook-rust-deps-v2,version=2",
  "type=gha,scope=nook-rust-base-v1,version=2",
  "type=gha,scope=nook-rust-v1,version=2",
]) : [
  "type=gha,scope=nook-rust-native-source-v2${GHA_CACHE_SCOPE_SUFFIX},version=2",
]

rust_native_source_cache_to = GHA_CACHE_WRITE_ENABLED != "" ? [
  "type=gha,scope=nook-rust-native-source-v2${GHA_CACHE_SCOPE_SUFFIX},mode=max,version=2,timeout=10m",
] : []

rust_wasm_source_cache_from = GHA_CACHE_ENABLED == "" ? [] : GHA_CACHE_SCOPE_SUFFIX == "" ? [
  "type=gha,scope=nook-rust-wasm-source-v2,version=2",
  "type=gha,scope=nook-rust-wasm-deps-v3,version=2",
  "type=gha,scope=nook-rust-wasm-deps-v2,version=2",
  "type=gha,scope=nook-rust-wasm-deps-v1,version=2",
  "type=gha,scope=nook-rust-deps-v2,version=2",
  "type=gha,scope=nook-rust-base-v1,version=2",
  "type=gha,scope=nook-rust-v1,version=2",
] : GHA_CACHE_FALLBACK_ENABLED != "" ? concat([
  "type=gha,scope=nook-rust-wasm-source-v2${GHA_CACHE_SCOPE_SUFFIX},version=2",
], GHA_CACHE_SEED_SCOPE_SUFFIX != "" ? [
  "type=gha,scope=nook-rust-wasm-source-v2${GHA_CACHE_SEED_SCOPE_SUFFIX},version=2",
  "type=gha,scope=nook-rust-wasm-source-v2,version=2",
  "type=gha,scope=nook-rust-wasm-deps-v3,version=2",
  "type=gha,scope=nook-rust-wasm-deps-v2,version=2",
  "type=gha,scope=nook-rust-wasm-deps-v1,version=2",
  "type=gha,scope=nook-rust-deps-v2,version=2",
  "type=gha,scope=nook-rust-base-v1,version=2",
  "type=gha,scope=nook-rust-v1,version=2",
] : [
  "type=gha,scope=nook-rust-wasm-source-v2,version=2",
  "type=gha,scope=nook-rust-wasm-deps-v3,version=2",
  "type=gha,scope=nook-rust-wasm-deps-v2,version=2",
  "type=gha,scope=nook-rust-wasm-deps-v1,version=2",
  "type=gha,scope=nook-rust-deps-v2,version=2",
  "type=gha,scope=nook-rust-base-v1,version=2",
  "type=gha,scope=nook-rust-v1,version=2",
]) : [
  "type=gha,scope=nook-rust-wasm-source-v2${GHA_CACHE_SCOPE_SUFFIX},version=2",
]

rust_wasm_source_cache_to = GHA_CACHE_WRITE_ENABLED != "" ? [
  "type=gha,scope=nook-rust-wasm-source-v2${GHA_CACHE_SCOPE_SUFFIX},mode=max,version=2,timeout=10m",
] : []

web_deps_cache_from = GHA_CACHE_ENABLED == "" ? [] : GHA_CACHE_SCOPE_SUFFIX == "" ? [
  "type=gha,scope=nook-web-deps-v1,version=2",
] : GHA_CACHE_FALLBACK_ENABLED != "" ? concat([
  "type=gha,scope=nook-web-deps-v1${GHA_CACHE_SCOPE_SUFFIX},version=2",
], GHA_CACHE_SEED_SCOPE_SUFFIX != "" ? [
  "type=gha,scope=nook-web-deps-v1${GHA_CACHE_SEED_SCOPE_SUFFIX},version=2",
  "type=gha,scope=nook-web-deps-v1,version=2",
] : [
  "type=gha,scope=nook-web-deps-v1,version=2",
]) : [
  "type=gha,scope=nook-web-deps-v1${GHA_CACHE_SCOPE_SUFFIX},version=2",
]

web_deps_cache_to = GHA_CACHE_WRITE_ENABLED != "" ? [
  "type=gha,scope=nook-web-deps-v1${GHA_CACHE_SCOPE_SUFFIX},mode=max,version=2,ignore-error=true,timeout=10m",
] : []

web_cache_from = GHA_CACHE_ENABLED == "" ? [] : GHA_CACHE_SCOPE_SUFFIX == "" ? [
  "type=gha,scope=nook-web-v1,version=2",
  "type=gha,scope=nook-web-deps-v1,version=2",
] : GHA_CACHE_FALLBACK_ENABLED != "" ? concat([
  "type=gha,scope=nook-web-v1${GHA_CACHE_SCOPE_SUFFIX},version=2",
], GHA_CACHE_SEED_SCOPE_SUFFIX != "" ? [
  "type=gha,scope=nook-web-v1${GHA_CACHE_SEED_SCOPE_SUFFIX},version=2",
  "type=gha,scope=nook-web-v1,version=2",
  "type=gha,scope=nook-web-deps-v1,version=2",
] : [
  "type=gha,scope=nook-web-v1,version=2",
  "type=gha,scope=nook-web-deps-v1,version=2",
]) : [
  "type=gha,scope=nook-web-v1${GHA_CACHE_SCOPE_SUFFIX},version=2",
]

web_cache_to = GHA_CACHE_WRITE_ENABLED != "" ? [
  "type=gha,scope=nook-web-v1${GHA_CACHE_SCOPE_SUFFIX},mode=max,version=2,ignore-error=true,timeout=10m",
] : []

web_e2e_cache_from = GHA_CACHE_ENABLED == "" ? [] : GHA_CACHE_SCOPE_SUFFIX == "" ? [
  "type=gha,scope=nook-web-e2e-v1,version=2",
  "type=gha,scope=nook-web-deps-v1,version=2",
] : GHA_CACHE_FALLBACK_ENABLED != "" ? concat([
  "type=gha,scope=nook-web-e2e-v1${GHA_CACHE_SCOPE_SUFFIX},version=2",
], GHA_CACHE_SEED_SCOPE_SUFFIX != "" ? [
  "type=gha,scope=nook-web-e2e-v1${GHA_CACHE_SEED_SCOPE_SUFFIX},version=2",
  "type=gha,scope=nook-web-e2e-v1,version=2",
  "type=gha,scope=nook-web-deps-v1,version=2",
] : [
  "type=gha,scope=nook-web-e2e-v1,version=2",
  "type=gha,scope=nook-web-deps-v1,version=2",
]) : [
  "type=gha,scope=nook-web-e2e-v1${GHA_CACHE_SCOPE_SUFFIX},version=2",
]

web_e2e_cache_to = GHA_CACHE_WRITE_ENABLED != "" ? [
  "type=gha,scope=nook-web-e2e-v1${GHA_CACHE_SCOPE_SUFFIX},mode=max,version=2,ignore-error=true,timeout=10m",
] : []

target "_sccache" {
  args = {
    SCCACHE_REDIS_MODE     = SCCACHE_REDIS_MODE
    SCCACHE_REDIS_ENDPOINT = SCCACHE_REDIS_ENDPOINT
  }
}

// Default: build the nook-web image (source-in-image) that `task` runs.
group "default" {
  targets = ["nook-web"]
}

// Phase one of `task setup`: Rust/WASM validation + tiny artifact export runs concurrently with
// Bun dependency preparation. The second phase builds nook-web from the host artifact directory.
group "prepare" {
  targets = ["rust-format-check", "web-artifacts", "web-deps"]
}

// Formatting must be able to build source-sealed images before the host applies the emitted diff.
group "prepare-with-unformatted-rust" {
  targets = ["web-artifacts", "web-deps"]
}

// Pre-build both independent local lineages in parallel.
group "builders" {
  targets = ["builder-wasm", "web-deps"]
}

group "ci-rust" {
  targets = ["coverage-export", "rust-format-check"]
}

// --- nook-web image (source-in-image; loaded as nook-web:local, what `task` runs) ---
// _nook-web-common lives in nook-app/nook-web/nook-web-app/docker-bake.hcl.
target "nook-web" {
  inherits = ["_nook-web-common"]
  tags     = [DOCKER_IMAGE]
  output   = ["type=docker"]
  cache-from = web_cache_from
  cache-to   = web_cache_to
}

// PR CI joins production builds with the sibling lint/check/test stage, allowing BuildKit to run
// both branches in parallel while loading the same sealed image and deployable artifacts.
target "nook-web-ci" {
  inherits = ["_nook-web-ci-common"]
  tags     = [DOCKER_IMAGE]
  output   = ["type=docker"]
  cache-from = web_cache_from
  cache-to   = web_cache_to
}

# Main/manual-e2e image. It has the same sealed app as nook-web, but swaps in the Chromium base.
# Tag it as DOCKER_IMAGE too so the existing deploy/extract tasks consume the already-tested image.
target "nook-web-e2e" {
  inherits = ["_nook-web-common"]
  contexts = {
    web-base = "target:web-e2e-base"
  }
  tags       = [DOCKER_IMAGE, DOCKER_E2E_IMAGE]
  output     = ["type=docker"]
  cache-from = web_e2e_cache_from
  cache-to   = web_e2e_cache_to
}

// Explicit Rust/WASM commands load this source-sealed image on demand. Normal setup/CI does not.
target "nook-rust" {
  inherits = ["_nook-rust-common"]
  tags     = [DOCKER_RUST_IMAGE]
  output   = ["type=docker"]
}

target "nook-rust-fast" {
  inherits = ["_nook-rust-fast-common"]
  tags     = [DOCKER_RUST_FAST_IMAGE]
  output   = ["type=docker"]
}

// Manual browser-wasm tests install Chromium only in this on-demand image.
target "nook-rust-browser" {
  inherits = ["_nook-rust-browser-common"]
  tags     = [DOCKER_RUST_BROWSER_IMAGE]
  output   = ["type=docker"]
}
