// App bake: shared variables, parallel groups, and loadable runtime variants.
// Every target's build definition (dockerfile/target/contexts) lives next to its Dockerfile and
// is merged in via multiple -f flags (bake has no `include`):
//   nook-app/docker/base.docker-bake.hcl        -> rust-base, web-base
//   nook-app/nook-core/docker-bake.hcl          -> builder-deps, builder-debug
//   nook-app/nook-wasm/docker-bake.hcl          -> builder-wasm, web-artifacts, on-demand Rust images
//   nook-app/docker/toolchain.docker-bake.hcl   -> web-deps
//   nook-app/nook-web/nook-web-app/docker-bake.hcl -> _nook-web-common (slim web image)
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

variable "SCCACHE_REDIS_PORT" {
  default = "6380"
}

variable "SCCACHE_REDIS_HOST_IP" {
  default = ""
}

// Enabled only by the GitHub Actions Docker setup. Keeping the default empty preserves zero-network
// local builds. Separate scopes are mandatory: Docker's GHA backend overwrites a scope when a
// different image exports to it, so sharing the default `buildkit` scope loses sibling lineages.
variable "GHA_CACHE_ENABLED" {
  default = ""
}

rust_deps_cache_from = GHA_CACHE_ENABLED != "" ? [
  "type=gha,scope=nook-rust-deps-v2,version=2",
  "type=gha,scope=nook-rust-v1,version=2",
] : []

rust_deps_cache_to = GHA_CACHE_ENABLED != "" ? [
  "type=gha,scope=nook-rust-deps-v2,mode=max,version=2,ignore-error=true,timeout=10m",
] : []

rust_wasm_deps_cache_from = GHA_CACHE_ENABLED != "" ? [
  "type=gha,scope=nook-rust-wasm-deps-v1,version=2",
  "type=gha,scope=nook-rust-deps-v2,version=2",
  "type=gha,scope=nook-rust-v1,version=2",
] : []

rust_wasm_deps_cache_to = GHA_CACHE_ENABLED != "" ? [
  "type=gha,scope=nook-rust-wasm-deps-v1,mode=max,version=2,ignore-error=true,timeout=10m",
] : []

rust_source_cache_from = GHA_CACHE_ENABLED != "" ? [
  "type=gha,scope=nook-rust-deps-v2,version=2",
  "type=gha,scope=nook-rust-v1,version=2",
] : []

web_deps_cache_from = GHA_CACHE_ENABLED != "" ? [
  "type=gha,scope=nook-web-deps-v1,version=2",
] : []

web_deps_cache_to = GHA_CACHE_ENABLED != "" ? [
  "type=gha,scope=nook-web-deps-v1,mode=max,version=2,ignore-error=true,timeout=10m",
] : []

web_cache_from = GHA_CACHE_ENABLED != "" ? [
  "type=gha,scope=nook-web-v1,version=2",
  "type=gha,scope=nook-web-deps-v1,version=2",
] : []

web_cache_to = GHA_CACHE_ENABLED != "" ? [
  "type=gha,scope=nook-web-v1,mode=max,version=2,ignore-error=true,timeout=10m",
] : []

web_e2e_cache_from = GHA_CACHE_ENABLED != "" ? [
  "type=gha,scope=nook-web-e2e-v1,version=2",
  "type=gha,scope=nook-web-deps-v1,version=2",
] : []

web_e2e_cache_to = GHA_CACHE_ENABLED != "" ? [
  "type=gha,scope=nook-web-e2e-v1,mode=max,version=2,ignore-error=true,timeout=10m",
] : []

target "_sccache-network" {
  args = {
    SCCACHE_REDIS_PORT = SCCACHE_REDIS_PORT
  }
  extra-hosts = {
    "host.docker.internal" = SCCACHE_REDIS_HOST_IP
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

# Main/nightly-only image. It has the same sealed app as nook-web, but swaps in the Chromium base.
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

// Manual browser-wasm tests install Chromium only in this on-demand image.
target "nook-rust-browser" {
  inherits = ["_nook-rust-browser-common"]
  tags     = [DOCKER_RUST_BROWSER_IMAGE]
  output   = ["type=docker"]
}
