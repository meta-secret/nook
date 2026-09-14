// Production-shaped BuildKit cache proof. Source-free dependencies use one
// content-fingerprinted ref while authored source uses exact-commit refs.

variable "NOOK_REGISTRY_CACHE_HOST" {
  default = "registry.dev.nokey.sh:5000"
}

variable "COMPILE_SOURCE_SCOPE" {
  default = "git-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
}

variable "COMPILE_SOURCE_CACHE_AVAILABLE" {
  default = ""
}

variable "COMPILE_ANCESTOR_SOURCE_SCOPE" {
  default = ""
}

variable "COMPILE_DEPS_CACHE_WRITE_ENABLED" {
  default = ""
}

variable "COMPILE_SOURCE_CACHE_WRITE_ENABLED" {
  default = ""
}

compile_deps_cache_ref = "${NOOK_REGISTRY_CACHE_HOST}/nook/remote-buildcache/nook-bake-sim-compile-deps-v2:fingerprint-lock-inputs"
compile_source_cache_ref = "${NOOK_REGISTRY_CACHE_HOST}/nook/remote-buildcache/nook-bake-sim-compile-v2-${COMPILE_SOURCE_SCOPE}:buildcache"
compile_ancestor_source_cache_ref = "${NOOK_REGISTRY_CACHE_HOST}/nook/remote-buildcache/nook-bake-sim-compile-v2-${COMPILE_ANCESTOR_SOURCE_SCOPE}:buildcache"

compile_cache_from = COMPILE_SOURCE_CACHE_AVAILABLE != "" ? [
  "type=registry,ref=${compile_source_cache_ref}",
] : COMPILE_ANCESTOR_SOURCE_SCOPE != "" ? [
  "type=registry,ref=${compile_ancestor_source_cache_ref}",
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

target "compile-dependencies" {
  context = "."
  dockerfile = "compile-warm.Dockerfile"
  target = "compile-dependencies"
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
  cache-from = compile_cache_from
  cache-to = compile_source_cache_to
  output = ["type=cacheonly"]
}
