// Root bake: shared variables, parallel groups, and the publish variants.
// Every target's build definition (dockerfile/target/contexts) lives next to its Dockerfile and
// is merged in via multiple -f flags (bake has no `include`):
//   docker/base.docker-bake.hcl        -> nook-base
//   nook-core/docker-bake.hcl          -> builder-deps, builder-debug
//   nook-wasm/docker-bake.hcl          -> builder-wasm      (FROM builder-debug)
//   docker/toolchain.docker-bake.hcl   -> web-deps, _toolchain-common (parallel web + rust merge)
//   nook-web/docker-bake.hcl           -> _nook-web-common  (FROM toolchain + workspace source)
// Callers (Taskfile `setup`, .task/docker.yml) pass all files via the NOOK_BAKE_FILES list.
//
// LINEAR CHAIN (rust): nook-base -> builder-deps -> builder-debug -> builder-wasm -> toolchain ->
// nook-web. The web branch (web-deps) is a PARALLEL bake target off nook-base; toolchain merges
// node_modules via COPY --from=web-deps. Each named stage (nook-base, builder-*, web-deps) has its
// own cache-to so GHCR :buildcache captures every layer. Two tiers for publishing: `toolchain` is
// the shared base pushed to GHCR (cache); `nook-web` layers the workspace source on top.

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

// Pre-build the linear chain top explicitly so cold CI warms the whole toolchain in one target.
group "builders" {
  targets = ["toolchain"]
}

// --- nook-web image (source-in-image; loaded as nook-web:local, what `task` runs) ---
// _nook-web-common lives in nook-web/docker-bake.hcl.
target "nook-web" {
  inherits = ["_nook-web-common"]
  tags     = [DOCKER_IMAGE]
  output   = ["type=docker"]
}

// --- Toolchain base image (linear top: deps + warm native/wasm target/ + node_modules + wasm pkg;
// the shared GHCR cache). _toolchain-common lives in docker/toolchain.docker-bake.hcl; the variants
// below inherit it and set output/tags/cache-to. ---

// In-graph base for nook-web (local + CI). Pulls the shared cache (cache-from) but never tags/pushes
// a registry ref — that is toolchain-push's job. Loadable locally for debugging.
target "toolchain" {
  inherits = ["_toolchain-common"]
  output   = ["type=docker"]
}

// Cache-only publish (manual / legacy): push just the :buildcache layers, no :latest image tag.
// CI uses toolchain-push on main only; this target is not invoked by Taskfile workflows.
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
