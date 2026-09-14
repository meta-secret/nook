// Exact-source/fingerprinted-dependency cache transport proof. These fixture
// values intentionally make both immutable registry identities visible.

variable "NOOK_REGISTRY_CACHE_HOST" {
  default = "registry.dev.nokey.sh:5000"
}

variable "COMPILE_CACHE_WRITE_ENABLED" {
  default = "1"
}

variable "GHA_RUST_COMPILE_DEPS_SCOPE" {
  default = "nook-rust-compile-deps-v2-1111111111111111111111111111111111111111"
}

variable "GHA_CACHE_SCOPE_SUFFIX" {
  default = "-git-2222222222222222222222222222222222222222"
}

variable "GHA_CACHE_EXACT_RUST_COMPILE_DEPS_AVAILABLE" {
  default = "1"
}

variable "GHA_CACHE_EXACT_BUILD_COMPILE_AVAILABLE" {
  default = "1"
}

compile_deps_cache_ref = "${NOOK_REGISTRY_CACHE_HOST}/nook/remote-buildcache/${GHA_RUST_COMPILE_DEPS_SCOPE}:buildcache"
compile_source_cache_ref = "${NOOK_REGISTRY_CACHE_HOST}/nook/remote-buildcache/nook-build-compile-v2${GHA_CACHE_SCOPE_SUFFIX}:buildcache"

target "compile-exact-source" {
  context = "."
  dockerfile = "compile-warm.Dockerfile"
  target = "compile"
  cache-from = GHA_CACHE_EXACT_BUILD_COMPILE_AVAILABLE != "" ? [
    "type=registry,ref=${compile_source_cache_ref}",
  ] : GHA_CACHE_EXACT_RUST_COMPILE_DEPS_AVAILABLE != "" ? [
    "type=registry,ref=${compile_deps_cache_ref}",
  ] : []
  cache-to = COMPILE_CACHE_WRITE_ENABLED != "" ? [
    "type=registry,ref=${compile_source_cache_ref},mode=max,compression=zstd,force-compression=true,timeout=5m",
  ] : []
  output = ["type=cacheonly"]
}

target "compile-exact-dependencies" {
  context = "."
  dockerfile = "compile-warm.Dockerfile"
  target = "compile-dependencies"
  cache-from = GHA_CACHE_EXACT_RUST_COMPILE_DEPS_AVAILABLE != "" ? [
    "type=registry,ref=${compile_deps_cache_ref}",
  ] : []
  cache-to = COMPILE_CACHE_WRITE_ENABLED != "" ? [
    "type=registry,ref=${compile_deps_cache_ref},mode=max,compression=zstd,force-compression=true,timeout=5m",
  ] : []
  output = ["type=cacheonly"]
}
