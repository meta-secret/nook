// Compile-shaped BuildKit cache proof. Publication is explicit so a warm
// verification can import the stable graph without widening it with export.

variable "NOOK_REGISTRY_CACHE_HOST" {
  default = "registry.dev.nokey.sh:5000"
}

variable "COMPILE_CACHE_WRITE_ENABLED" {
  default = "1"
}

compile_cache_ref = "${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-bake-sim-compile-v1:buildcache"

compile_cache_to = COMPILE_CACHE_WRITE_ENABLED != "" ? [
  "type=registry,ref=${compile_cache_ref},mode=max,compression=zstd,force-compression=true,timeout=5m",
] : []

target "compile-warm" {
  context = "."
  dockerfile = "compile-warm.Dockerfile"
  target = "compile"
  cache-from = [
    "type=registry,ref=${compile_cache_ref},ignore-error=true",
  ]
  cache-to = compile_cache_to
  output = ["type=cacheonly"]
}
