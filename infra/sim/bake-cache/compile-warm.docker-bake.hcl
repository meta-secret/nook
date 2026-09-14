// Production-shaped BuildKit cache proof. A separate seed boundary publishes
// the source-free content-fingerprinted ref before the product build consumes
// it; authored source remains isolated in exact-commit refs.

variable "NOOK_REGISTRY_CACHE_HOST" {
  default = "registry.dev.nokey.sh:5000"
}

variable "COMPILE_SOURCE_SCOPE" {
  default = "git-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
}

variable "COMPILE_SOURCE_CACHE_AVAILABLE" {
  default = ""
}

variable "COMPILE_GENERATION_SCOPE" {
  default = "generation-v1-fingerprint-a"
}

variable "COMPILE_GENERATION_CACHE_AVAILABLE" {
  default = ""
}

variable "COMPILE_DEPS_CACHE_WRITE_ENABLED" {
  default = ""
}

variable "COMPILE_SOURCE_CACHE_WRITE_ENABLED" {
  default = ""
}

variable "COMPILE_GENERATION_CACHE_WRITE_ENABLED" {
  default = ""
}

variable "COMPILE_SOURCE_CACHE_GENERATION" {
  default = "v3"
}

variable "SIMULATED_BUILD_PROFILE" {
  default = "production"
}

variable "SIMULATED_EXTENSION_COMMIT" {
  default = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
}

compile_deps_cache_ref = "${NOOK_REGISTRY_CACHE_HOST}/nook/remote-buildcache/nook-bake-sim-compile-deps-v3:fingerprint-lock-and-recipe-inputs"
// v3 models the production compatibility boundary: legacy v2 mode=min
// manifests do not prove that the final compiler lineage was retained.
compile_source_cache_ref = "${NOOK_REGISTRY_CACHE_HOST}/nook/remote-buildcache/nook-bake-sim-compile-${COMPILE_SOURCE_CACHE_GENERATION}-${COMPILE_SOURCE_SCOPE}:buildcache"
compile_generation_cache_ref = "${NOOK_REGISTRY_CACHE_HOST}/nook/remote-buildcache/nook-bake-sim-compile-${COMPILE_GENERATION_SCOPE}:buildcache"

compile_cache_from = COMPILE_SOURCE_CACHE_AVAILABLE != "" ? [
  "type=registry,ref=${compile_source_cache_ref}",
] : COMPILE_GENERATION_CACHE_AVAILABLE != "" ? [
  "type=registry,ref=${compile_generation_cache_ref}",
  "type=registry,ref=${compile_deps_cache_ref}",
] : [
  "type=registry,ref=${compile_deps_cache_ref}",
]

compile_deps_cache_to = COMPILE_DEPS_CACHE_WRITE_ENABLED != "" ? [
  "type=registry,ref=${compile_deps_cache_ref},mode=max,compression=zstd,force-compression=true,timeout=5m",
] : []

compile_source_cache_to = COMPILE_SOURCE_CACHE_WRITE_ENABLED != "" ? [
  "type=registry,ref=${compile_source_cache_ref},mode=min,compression=zstd,force-compression=true,timeout=2m",
] : []

compile_generation_cache_to = COMPILE_GENERATION_CACHE_WRITE_ENABLED != "" && COMPILE_GENERATION_CACHE_AVAILABLE == "" ? [
  "type=registry,ref=${compile_generation_cache_ref},mode=max,compression=zstd,force-compression=true,timeout=5m",
] : []

target "compile-dependencies" {
  context = "."
  dockerfile = "compile-warm.Dockerfile"
  target = "compile-dependencies"
  platforms = ["linux/amd64"]
  contexts = {
    toolchain-base = "target:compile-toolchain-context"
  }
  cache-from = [
    "type=registry,ref=${compile_deps_cache_ref},ignore-error=true",
  ]
  cache-to = compile_deps_cache_to
  output = ["type=cacheonly"]
}

target "compile-warm" {
  context = "."
  dockerfile = "compile-warm.Dockerfile"
  target = "compile"
  platforms = ["linux/amd64"]
  contexts = {
    toolchain-base = "target:compile-toolchain-context"
  }
  args = {
    SIMULATED_BUILD_PROFILE    = SIMULATED_BUILD_PROFILE
    SIMULATED_EXTENSION_COMMIT = SIMULATED_EXTENSION_COMMIT
  }
  cache-from = compile_cache_from
  cache-to = compile_source_cache_to
  output = ["type=cacheonly"]
}

target "compile-generation" {
  inherits = ["compile-warm"]
  cache-to = compile_generation_cache_to
}


target "compile-toolchain-context" {
  context = "."
  dockerfile = "compile-warm.Dockerfile"
  target = "compile-toolchain-image"
  platforms = ["linux/amd64"]
  output = ["type=cacheonly"]
}
