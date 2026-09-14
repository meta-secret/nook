// Plain BuildKit cache proof for the Rust dependency lineage.
// The ref is intentionally stable: BuildKit's Dockerfile instruction and
// COPY-input digests decide which vertices replay.

variable "NOOK_REGISTRY_CACHE_HOST" {
  default = "registry.dev.nokey.sh:5000"
}

rust_deps_cache_ref = "${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-bake-sim-rust-deps-v1:buildcache"

target "rust-deps-replay" {
  context = "."
  dockerfile = "hive.Dockerfile"
  target = "verify"
  cache-from = [
    "type=registry,ref=${rust_deps_cache_ref},ignore-error=true",
  ]
  cache-to = [
    "type=registry,ref=${rust_deps_cache_ref},mode=max,timeout=5m",
  ]
  output = ["type=cacheonly"]
}
