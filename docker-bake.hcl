// Root bake: shared variables, parallel groups, and the publish variants.
// Every target's build definition (dockerfile/target/contexts) lives next to its Dockerfile and
// is merged in via multiple -f flags (bake has no `include`):
//   docker/base.docker-bake.hcl        -> nook-base
//   nook-core/docker-bake.hcl          -> builder-deps, builder-debug
//   nook-wasm/docker-bake.hcl          -> builder-wasm
//   nook-web/docker-bake.hcl           -> toolchain-web
//   docker/toolchain.docker-bake.hcl   -> _toolchain-common (deps + warm target/ base image)
//   docker/nook-web.docker-bake.hcl    -> _nook-web-common (toolchain + workspace source)
// Callers (Taskfile `setup`, .task/docker.yml) pass all files via the NOOK_BAKE_FILES list.
//
// Two tiers: `toolchain` is the deps/warm-target base pushed to GHCR (shared cache); `nook-web`
// layers the workspace source on top and is what `task` runs (no bind mount). Local dev builds it.

variable "DOCKER_IMAGE" {
  default = "nook-web:local"
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

// Shared cache settings referenced by package targets (in their own bake files) and the root.
// cache-from: always on (pull the shared base). cache-to: gated on TOOLCHAIN_PUSH (CI only).
// Platform is always linux/amd64 (hardcoded per target); no cross-platform builds.
shared_cache_from = TOOLCHAIN_REGISTRY != "" ? [
  "type=registry,ref=${TOOLCHAIN_REGISTRY}:buildcache",
  "type=registry,ref=${TOOLCHAIN_REGISTRY}:latest",
] : []

shared_cache_to = (TOOLCHAIN_REGISTRY != "" && TOOLCHAIN_PUSH != "") ? [
  "type=registry,ref=${TOOLCHAIN_REGISTRY}:buildcache,mode=max",
] : []

// Default: build the nook-web image (source-in-image) that `task` runs.
group "default" {
  targets = ["nook-web"]
}

// Pre-build parallel package stages explicitly so cold CI can fan out core + wasm + web tracks.
group "builders" {
  targets = ["builder-debug", "builder-wasm", "toolchain-web"]
}

// --- nook-web image (source-in-image; loaded as nook-web:local, what `task` runs) ---
// _nook-web-common lives in docker/nook-web.docker-bake.hcl.
target "nook-web" {
  inherits = ["_nook-web-common"]
  tags     = [DOCKER_IMAGE]
  output   = ["type=docker"]
}

// --- Toolchain base image (deps + warm target/; the shared GHCR cache) ---
// _toolchain-common lives in docker/toolchain.docker-bake.hcl; variants below set tags/output/cache-to.

// In-graph base for `app` (local + CI). Pulls the shared cache (cache-from) but never tags/pushes
// a registry ref — that is toolchain-push's job. Loadable locally for debugging.
target "toolchain" {
  inherits = ["_toolchain-common"]
  output   = ["type=docker"]
}

// Cache-only publish (any branch / PR): push just the :buildcache layers, no :latest image tag.
// Safe to run from feature branches — it never overwrites the canonical base image, but keeps the
// shared layer cache fresh so LOCAL and CI builds on any branch pull warm layers. Gated on PUSH.
target "toolchain-cache" {
  inherits = ["_toolchain-common"]
  output   = ["type=cacheonly"]
  cache-to = shared_cache_to
}

// After green MAIN CI: publish the verified toolchain base to GHCR (:latest image + :buildcache
// layers) so every later build — CI and LOCAL — pulls it via cache-from. Gated on TOOLCHAIN_PUSH.
// Do not use `docker push` after `--load`; the daemon re-uploads layers buildkit already has in GHCR.
target "toolchain-push" {
  inherits = ["_toolchain-common"]
  tags = TOOLCHAIN_PUSH != "" ? [
    "${TOOLCHAIN_REGISTRY}:latest",
  ] : []
  output   = ["type=registry"]
  cache-to = shared_cache_to
}
