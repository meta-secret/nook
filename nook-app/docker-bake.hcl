// App bake: shared variables, parallel groups, and loadable runtime variants.
// Every target's build definition (dockerfile/target/contexts) lives next to its Dockerfile and
// is merged in via multiple -f flags (bake has no `include`):
//   nook-app/docker/rust.docker-bake.hcl        -> rust-base + ecosystem gates
//   nook-app/docker/web.docker-bake.hcl         -> web-base, web-e2e-base
//   nook-app/nook-platform/nook-core/docker-bake.hcl          -> builder-core-deps, builder-debug
//   nook-app/nook-platform/nook-wasm/docker-bake.hcl          -> builder-wasm, web-artifacts, on-demand Rust images
//   nook-app/docker/toolchain.docker-bake.hcl   -> web-deps
//   nook-app/nook-web/nook-web-app/docker-bake.hcl -> slim web runtime and CI targets
// Callers (Taskfile `setup`, nook-app/docker/Taskfile.yml) pass all files via the NOOK_BAKE_FILES list.
//
// PREPARE PHASE: rust-base -> builder-core-deps -> (builder-debug || builder-wasm) -> web-artifacts, in
// parallel with web-base -> web-deps. web-artifacts joins only small outputs and is exported to a commit-scoped,
// invocation-isolated host directory.
// WEB PHASE: nook-web consumes web-base + web-deps + only that host artifact directory. The heavy
// Rust snapshot never becomes a context or parent of the final image. Local builds reuse the
// selected builder's content store; GitHub-hosted CI additionally imports/exports distinct
// registry.dev.nokey.sh BuildKit cache refs for Rust, web dependencies, and the two final web-image
// variants.

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

variable "SCCACHE_ENDPOINT" {
  default = "https://sccache.dev.nokey.sh"
}

variable "SCCACHE_BUCKET" {
  default = "nook-sccache"
}

variable "SCCACHE_S3_MODE" {
  default = "external"
}

variable "FUZZ_SECONDS" {
  default = "20"
}

// Enabled only by the GitHub Actions Docker setup after registry login.
// Keeping the default empty preserves zero-network local builds. Separate refs
// are mandatory so sibling BuildKit lineages do not overwrite each other.
// Rust exporters omit ignore-error so a failed cook-layer upload fails Main.
// Web exporters keep ignore-error.
variable "GHA_CACHE_ENABLED" {
  default = ""
}

// Some manual workflows build an arbitrary PR head while the Actions run itself belongs to the
// default branch. They may restore shared layers, but must not overwrite main's cache refs.
variable "GHA_CACHE_WRITE_ENABLED" {
  default = ""
}

// Main keeps this empty. Explicit Remote tasks use a deterministic branch hash so repeated runs
// update only the Remote repository and cannot replace the trusted Main cache.
variable "GHA_CACHE_SCOPE_SUFFIX" {
  default = ""
}

// Isolated PR/Remote writes restore their scoped ref first (ignore-error when cold) and then
// fall back to Main. Ordinary Main validation keeps this empty and consumes only trusted refs.
variable "GHA_CACHE_FALLBACK_ENABLED" {
  default = ""
}

// Retained for local/manual compatibility with explicitly suffixed cache experiments.
variable "GHA_CACHE_SEED_SCOPE_SUFFIX" {
  default = ""
}

// Main and pull requests derive this immutable scope from every file that defines the WASM
// dependency graph and compiler environment. A new graph gets a new registry ref instead of
// overwriting the last complete dependency export with a different lineage.
variable "GHA_RUST_WASM_DEPS_SCOPE" {
  default = "nook-rust-wasm-deps-v4-local"
}

variable "NOOK_REGISTRY_CACHE_HOST" {
  default = "registry.dev.nokey.sh"
}

// Main and remote builds intentionally write different Zot repositories. Zot authorizes
// repositories, not tag prefixes: the remote identity can update nook/remote-buildcache/**
// while it can only read the trusted nook/buildcache/** lineage published by Main.
write_cache_repository = GHA_CACHE_SCOPE_SUFFIX != "" ? "nook/remote-buildcache" : "nook/buildcache"

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
// Nightly refs use ignore-error while the scope is new/cold; rust-base stays strict.
rust_ecosystem_nightly_cache_from = GHA_CACHE_ENABLED == "" ? [] : GHA_CACHE_FALLBACK_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-rust-ecosystem-nightly-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-rust-ecosystem-nightly-v1:buildcache,ignore-error=true",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-rust-base-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-rust-base-v1:buildcache",
] : [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-rust-ecosystem-nightly-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-rust-base-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache",
]

rust_ecosystem_nightly_cache_to = GHA_CACHE_WRITE_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-rust-ecosystem-nightly-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache,mode=max,timeout=10m",
] : []

rust_deps_cache_from = GHA_CACHE_ENABLED == "" ? [] : GHA_CACHE_FALLBACK_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-rust-deps-v2${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-rust-deps-v2:buildcache",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-rust-base-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-rust-base-v1:buildcache",
] : [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-rust-deps-v2${GHA_CACHE_SCOPE_SUFFIX}:buildcache",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-rust-base-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache",
]

rust_deps_cache_to = GHA_CACHE_WRITE_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-rust-deps-v2${GHA_CACHE_SCOPE_SUFFIX}:buildcache,mode=max,timeout=10m",
] : []

rust_wasm_deps_write_scope = GHA_CACHE_SCOPE_SUFFIX != "" ? "nook-rust-wasm-deps-v4${GHA_CACHE_SCOPE_SUFFIX}" : GHA_RUST_WASM_DEPS_SCOPE

rust_wasm_deps_cache_from = GHA_CACHE_ENABLED == "" ? [] : GHA_CACHE_FALLBACK_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-rust-wasm-deps-v4${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/${GHA_RUST_WASM_DEPS_SCOPE}:buildcache",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-rust-deps-v2${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-rust-deps-v2:buildcache",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-rust-base-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-rust-base-v1:buildcache",
] : [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/${GHA_RUST_WASM_DEPS_SCOPE}:buildcache",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-rust-deps-v2${GHA_CACHE_SCOPE_SUFFIX}:buildcache",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-rust-base-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache",
]

rust_wasm_deps_cache_to = GHA_CACHE_WRITE_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/${rust_wasm_deps_write_scope}:buildcache,mode=max,timeout=10m",
] : []

rust_native_source_cache_from = GHA_CACHE_ENABLED == "" ? [] : GHA_CACHE_FALLBACK_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-rust-native-source-v2${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-rust-native-source-v2:buildcache",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-rust-deps-v2${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-rust-deps-v2:buildcache",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-rust-base-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-rust-base-v1:buildcache",
] : [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-rust-native-source-v2${GHA_CACHE_SCOPE_SUFFIX}:buildcache",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-rust-deps-v2${GHA_CACHE_SCOPE_SUFFIX}:buildcache",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-rust-base-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache",
]

rust_native_source_cache_to = GHA_CACHE_WRITE_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-rust-native-source-v2${GHA_CACHE_SCOPE_SUFFIX}:buildcache,mode=max,timeout=10m",
] : []

rust_wasm_source_cache_from = GHA_CACHE_ENABLED == "" ? [] : GHA_CACHE_FALLBACK_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-rust-wasm-source-v2${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-rust-wasm-source-v2:buildcache",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-rust-wasm-deps-v4${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/${GHA_RUST_WASM_DEPS_SCOPE}:buildcache",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-rust-deps-v2${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-rust-deps-v2:buildcache",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-rust-base-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-rust-base-v1:buildcache",
] : [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-rust-wasm-source-v2${GHA_CACHE_SCOPE_SUFFIX}:buildcache",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/${GHA_RUST_WASM_DEPS_SCOPE}:buildcache",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-rust-deps-v2${GHA_CACHE_SCOPE_SUFFIX}:buildcache",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-rust-base-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache",
]

rust_wasm_source_cache_to = GHA_CACHE_WRITE_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-rust-wasm-source-v2${GHA_CACHE_SCOPE_SUFFIX}:buildcache,mode=max,timeout=10m",
] : []

web_deps_cache_from = GHA_CACHE_ENABLED == "" ? [] : GHA_CACHE_FALLBACK_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-web-deps-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-web-deps-v1:buildcache",
] : [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-web-deps-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache",
]

web_deps_cache_to = GHA_CACHE_WRITE_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-web-deps-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache,mode=max,ignore-error=true,timeout=10m",
] : []

web_cache_from = GHA_CACHE_ENABLED == "" ? [] : GHA_CACHE_FALLBACK_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-web-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-web-v1:buildcache",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-web-deps-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-web-deps-v1:buildcache",
] : [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-web-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-web-deps-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache",
]

web_cache_to = GHA_CACHE_WRITE_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-web-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache,mode=max,ignore-error=true,timeout=10m",
] : []

web_e2e_cache_from = GHA_CACHE_ENABLED == "" ? [] : GHA_CACHE_FALLBACK_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-web-e2e-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-web-e2e-v1:buildcache",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-web-deps-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-web-deps-v1:buildcache",
] : [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-web-e2e-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-web-deps-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache",
]

web_e2e_cache_to = GHA_CACHE_WRITE_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-web-e2e-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache,mode=max,ignore-error=true,timeout=10m",
] : []

target "_sccache" {
  args = {
    SCCACHE_S3_MODE    = SCCACHE_S3_MODE
    SCCACHE_ENDPOINT   = SCCACHE_ENDPOINT
    SCCACHE_BUCKET     = SCCACHE_BUCKET
  }
}

// Default: build the nook-web image (source-in-image) that `task` runs.
group "default" {
  targets = ["nook-web"]
}

// Phase one of `task setup`: Rust/WASM validation + tiny artifact export runs concurrently with
// Bun dependency preparation. The second phase builds nook-web from the host artifact directory.
group "prepare" {
  targets = ["builder-debug", "rust-format-check", "web-artifacts", "web-deps"]
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

// Focused native tests load a sealed dependency-plus-source image without the general Rust/WASM
// join. The regular DOCKER_RUST_IMAGE tag keeps the existing runtime command surface unchanged.
target "nook-rust-test" {
  inherits = ["_nook-rust-test-common"]
  tags     = [DOCKER_RUST_IMAGE]
  output   = ["type=docker"]
}

target "nook-rust-lint" {
  inherits = ["_nook-rust-lint-common"]
  tags     = [DOCKER_RUST_IMAGE]
  output   = ["type=docker"]
}

target "nook-rust-coverage" {
  inherits = ["_nook-rust-coverage-common"]
  tags     = [DOCKER_RUST_IMAGE]
  output   = ["type=docker"]
}

target "nook-rust-fast" {
  inherits = ["_nook-rust-fast-common"]
  tags     = [DOCKER_RUST_FAST_IMAGE]
  output   = ["type=docker"]
}

// Focused web/type-check tasks stop at the sealed source image. They do not build production
// artifacts or re-run the complete in-image verification graph.
target "nook-web-focused" {
  inherits = ["_nook-web-focused-common"]
  tags     = [DOCKER_IMAGE]
  output   = ["type=docker"]
  cache-from = web_cache_from
  cache-to   = web_cache_to
}

// Manual browser-wasm tests install Chromium only in this on-demand image.
target "nook-rust-browser" {
  inherits = ["_nook-rust-browser-common"]
  tags     = [DOCKER_RUST_BROWSER_IMAGE]
  output   = ["type=docker"]
}
