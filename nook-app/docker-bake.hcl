// App bake: shared variables, parallel groups, and the publish variants.
// Every target's build definition (dockerfile/target/contexts) lives next to its Dockerfile and
// is merged in via multiple -f flags (bake has no `include`):
//   nook-app/docker/base.docker-bake.hcl        -> rust-base, web-base
//   nook-app/nook-core/docker-bake.hcl          -> builder-deps, builder-debug
//   nook-app/nook-wasm/docker-bake.hcl          -> builder-wasm, web-artifacts, on-demand Rust images
//   nook-app/docker/toolchain.docker-bake.hcl   -> web-deps
//   nook-app/nook-web/nook-web-app/docker-bake.hcl -> _nook-web-common (slim web image)
// Callers (Taskfile `setup`, nook-app/docker/Taskfile.yml) pass all files via the NOOK_BAKE_FILES list.
//
// PREPARE PHASE: rust-base -> builder-deps -> builder-debug -> builder-wasm -> web-artifacts, in
// parallel with web-base -> web-deps. web-artifacts is exported to a commit-scoped,
// invocation-isolated host directory.
// WEB PHASE: nook-web consumes web-base + web-deps + only that host artifact directory. The heavy
// Rust snapshot never becomes a context or parent of the final image. Main publishes the two cache
// lineages independently; no combined Rust + web image exists.

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

// ghcr.io/<owner>/<repo>/toolchain — shared remote cache. Defaults to the canonical repo path so
// that EVERYONE (local dev included) pulls the warm dep/target layers CI already published. This is
// the whole point: a fresh local build reuses CI's cache instead of a catastrophic cold recompile.
variable "TOOLCHAIN_REGISTRY" {
  default = "ghcr.io/meta-secret/nook/toolchain"
}

// Push the cache to GHCR? Only CI has write creds and should publish the shared base. Local dev
// leaves this empty, so it PULLS the cache but never pushes (avoids a 403 without registry auth).
variable "TOOLCHAIN_PUSH" {
  default = ""
}

// Current git commit — immutable toolchain image tag (set by Taskfile `GIT_COMMIT_ID` var).
variable "GIT_COMMIT_ID" {
  default = ""
}

// Passed to every target that reaches the internal builder-wasm Dockerfile stage. Setting only the
// standalone `builder-wasm` bake target is insufficient for scratch exports such as web-artifacts,
// because each final target owns its own Dockerfile solve.
variable "WASM_BUILD_MODE" {
  default = "dev"
}

// Rust and web use independent cache refs so publishing one branch never assembles or overwrites
// the other. The legacy combined refs remain read-only fallbacks during the migration.
rust_cache_from = TOOLCHAIN_REGISTRY != "" ? concat(
  [
    "type=registry,ref=${TOOLCHAIN_REGISTRY}:rust-buildcache",
    "type=registry,ref=${TOOLCHAIN_REGISTRY}:buildcache",
  ],
  GIT_COMMIT_ID != "" ? [
    "type=registry,ref=${TOOLCHAIN_REGISTRY}:rust-${GIT_COMMIT_ID}",
    "type=registry,ref=${TOOLCHAIN_REGISTRY}:${GIT_COMMIT_ID}",
  ] : [],
) : []

web_cache_from = TOOLCHAIN_REGISTRY != "" ? concat(
  [
    "type=registry,ref=${TOOLCHAIN_REGISTRY}:web-buildcache",
    "type=registry,ref=${TOOLCHAIN_REGISTRY}:buildcache",
  ],
  GIT_COMMIT_ID != "" ? [
    "type=registry,ref=${TOOLCHAIN_REGISTRY}:web-${GIT_COMMIT_ID}",
    "type=registry,ref=${TOOLCHAIN_REGISTRY}:${GIT_COMMIT_ID}",
  ] : [],
) : []

rust_cache_to = (TOOLCHAIN_REGISTRY != "" && TOOLCHAIN_PUSH != "") ? [
  "type=registry,ref=${TOOLCHAIN_REGISTRY}:rust-buildcache,mode=max",
] : []

web_cache_to = (TOOLCHAIN_REGISTRY != "" && TOOLCHAIN_PUSH != "") ? [
  "type=registry,ref=${TOOLCHAIN_REGISTRY}:web-buildcache,mode=max",
] : []

web_e2e_cache_from = TOOLCHAIN_REGISTRY != "" ? [
  "type=registry,ref=${TOOLCHAIN_REGISTRY}:web-e2e-buildcache",
] : []

web_e2e_cache_to = (TOOLCHAIN_REGISTRY != "" && TOOLCHAIN_PUSH != "") ? [
  "type=registry,ref=${TOOLCHAIN_REGISTRY}:web-e2e-buildcache,mode=max",
] : []

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

// Pre-build both independent cache lineages in parallel.
group "builders" {
  targets = ["builder-wasm", "web-deps"]
}

// Main publishes the independent Rust and web cache images in parallel. Keeping this legacy group
// name preserves the existing Task/workflow interface without constructing a merged image.
group "toolchain-push" {
  targets = ["rust-toolchain-push", "web-toolchain-push", "web-e2e-toolchain-push"]
}

// --- nook-web image (source-in-image; loaded as nook-web:local, what `task` runs) ---
// _nook-web-common lives in nook-app/nook-web/nook-web-app/docker-bake.hcl.
target "nook-web" {
  inherits = ["_nook-web-common"]
  tags     = [DOCKER_IMAGE]
  output   = ["type=docker"]
}

# Main/nightly-only image. It has the same sealed app as nook-web, but swaps in the Chromium base.
# Tag it as DOCKER_IMAGE too so the existing deploy/extract tasks consume the already-tested image.
target "nook-web-e2e" {
  inherits = ["_nook-web-common"]
  contexts = {
    web-base = "target:web-e2e-base"
  }
  tags   = [DOCKER_IMAGE, DOCKER_E2E_IMAGE]
  output = ["type=docker"]
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

// After green main CI, publish the verified Rust/WASM lineage and its max-mode cache.
target "rust-toolchain-push" {
  inherits = ["builder-wasm"]
  tags = (TOOLCHAIN_PUSH != "" && GIT_COMMIT_ID != "") ? [
    "${TOOLCHAIN_REGISTRY}:rust-${GIT_COMMIT_ID}",
  ] : []
  output   = ["type=registry"]
  cache-to = rust_cache_to
}

// Publish web dependencies separately. This image has no Cargo registry, Rust toolchain, or target/.
target "web-toolchain-push" {
  inherits = ["web-deps"]
  tags = (TOOLCHAIN_PUSH != "" && GIT_COMMIT_ID != "") ? [
    "${TOOLCHAIN_REGISTRY}:web-${GIT_COMMIT_ID}",
  ] : []
  output   = ["type=registry"]
  cache-to = web_cache_to
}

# Browser cache is separate so PR cache imports never fetch Chromium layers.
target "web-e2e-toolchain-push" {
  inherits = ["web-e2e-base"]
  tags = (TOOLCHAIN_PUSH != "" && GIT_COMMIT_ID != "") ? [
    "${TOOLCHAIN_REGISTRY}:web-e2e-${GIT_COMMIT_ID}",
  ] : []
  output   = ["type=registry"]
  cache-to = web_e2e_cache_to
}
