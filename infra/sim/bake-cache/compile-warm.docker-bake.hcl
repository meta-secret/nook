// Production-shaped BuildKit cache proof. Ordinary publish builds populate
// both the dependency graph and an optional exact-head accelerator. Cross-head
// compiler reuse is owned by sccache rather than a maintenance seed.

variable "NOOK_REGISTRY_CACHE_HOST" {
  default = "registry.dev.nokey.sh:5000"
}

variable "COMPILE_SOURCE_SCOPE" {
  default = "git-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
}

variable "COMPILE_SOURCE_CACHE_AVAILABLE" {
  default = ""
}

variable "COMPILE_SOURCE_CACHE_WRITE_ENABLED" {
  default = ""
}

variable "COMPILE_SOURCE_CACHE_VERSION" {
  default = "v3"
}

variable "SIMULATED_BUILD_PROFILE" {
  default = "production"
}

variable "SIMULATED_EXTENSION_COMMIT" {
  default = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
}

variable "SIMULATED_SCCACHE_CLIENT_SIDE" {
  default = "1"
}

variable "SIMULATED_SCCACHE_ERROR_LOG" {
  default = ""
}

variable "SIMULATED_SCCACHE_SANITIZES_ERROR_LOG" {
  default = "1"
}

variable "SIMULATED_SCCACHE_NEXT_HEAD_HITS" {
  default = "1"
}

compile_deps_cache_ref = "${NOOK_REGISTRY_CACHE_HOST}/nook/remote-buildcache/nook-bake-sim-compile-deps-v3:fingerprint-lock-and-recipe-inputs"
// v3 models the production compatibility boundary: legacy v2 mode=min
// manifests do not prove that the final compiler lineage was retained.
compile_source_cache_ref = "${NOOK_REGISTRY_CACHE_HOST}/nook/remote-buildcache/nook-bake-sim-compile-${COMPILE_SOURCE_CACHE_VERSION}-${COMPILE_SOURCE_SCOPE}:buildcache"
compile_cache_from = COMPILE_SOURCE_CACHE_AVAILABLE != "" ? [
  "type=registry,ref=${compile_source_cache_ref}",
] : [
  "type=registry,ref=${compile_deps_cache_ref}",
]

compile_deps_cache_to = COMPILE_SOURCE_CACHE_WRITE_ENABLED != "" ? [
  "type=registry,ref=${compile_deps_cache_ref},mode=max,compression=zstd,force-compression=true,timeout=5m",
] : []

compile_source_cache_to = COMPILE_SOURCE_CACHE_WRITE_ENABLED != "" ? [
  "type=registry,ref=${compile_source_cache_ref},mode=min,compression=zstd,force-compression=true,timeout=2m",
] : []

compile_solve_args = {
  SIMULATED_BUILD_PROFILE    = SIMULATED_BUILD_PROFILE
  SIMULATED_EXTENSION_COMMIT = SIMULATED_EXTENSION_COMMIT
  SIMULATED_SCCACHE_CLIENT_SIDE = SIMULATED_SCCACHE_CLIENT_SIDE
  SIMULATED_SCCACHE_ERROR_LOG = SIMULATED_SCCACHE_ERROR_LOG
  SIMULATED_SCCACHE_SANITIZES_ERROR_LOG = SIMULATED_SCCACHE_SANITIZES_ERROR_LOG
  SIMULATED_SCCACHE_NEXT_HEAD_HITS = SIMULATED_SCCACHE_NEXT_HEAD_HITS
}

target "compile-warm" {
  context = "."
  dockerfile = "compile-warm.Dockerfile"
  target = "compile"
  platforms = ["linux/amd64"]
  contexts = {
    toolchain-base = "target:compile-toolchain-context"
  }
  args = compile_solve_args
  cache-from = compile_cache_from
  cache-to = compile_source_cache_to
  output = ["type=cacheonly"]
}

target "compile-dependency-cache" {
  context = "."
  dockerfile = "compile-warm.Dockerfile"
  target = "compile-dependency-cache"
  platforms = ["linux/amd64"]
  contexts = {
    toolchain-base = "target:compile-toolchain-context"
  }
  args = compile_solve_args
  cache-from = []
  cache-to = compile_deps_cache_to
  output = ["type=cacheonly"]
}

target "compile-toolchain-context" {
  context = "."
  dockerfile = "compile-warm.Dockerfile"
  target = "compile-toolchain-image"
  platforms = ["linux/amd64"]
  output = ["type=cacheonly"]
}
