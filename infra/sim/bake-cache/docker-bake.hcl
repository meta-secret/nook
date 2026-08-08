// Runtime Bake+Zot cache simulation mirroring Nook parent/leaf scopes.
// parent ≈ rust-ecosystem-nightly (cache-from only).
// parent-publish ≈ rust-ecosystem-nightly-publish (mode=max writer).
// leaf ≈ rust-dylint (own-scope leaf; mode=max embeds parent).
// leaf-short-chain ≈ short-parent import bug (parent scope in cache-from).
// parent-pr-cold ≈ broken nightly FALLBACK (git-scope only, no Main).
//
// PARENT_OWN_CACHE_ENABLED: when empty, context parent has no cache-from so a
// leaf own-scope mode=max restore is not orphaned by a shorter parent importer.

variable "GHA_CACHE_ENABLED" {
  default = "1"
}

variable "GHA_CACHE_WRITE_ENABLED" {
  default = ""
}

variable "GHA_CACHE_FALLBACK_ENABLED" {
  default = ""
}

variable "GHA_CACHE_SCOPE_SUFFIX" {
  default = ""
}

variable "PARENT_OWN_CACHE_ENABLED" {
  default = "1"
}

variable "NOOK_REGISTRY_CACHE_HOST" {
  default = "registry.dev.nokey.sh:5000"
}

write_cache_repository = GHA_CACHE_SCOPE_SUFFIX != "" ? "nook/remote-buildcache" : "nook/buildcache"

// FALLBACK: fat Main first, then git-scope (mirrors real nightly/policy-tools).
parent_cache_from = GHA_CACHE_ENABLED == "" || PARENT_OWN_CACHE_ENABLED == "" ? [] : GHA_CACHE_FALLBACK_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-bake-sim-parent-v1:buildcache,ignore-error=true",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-bake-sim-parent-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
] : [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-bake-sim-parent-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
]

parent_cache_to = GHA_CACHE_WRITE_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-bake-sim-parent-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache,mode=max,timeout=5m",
] : []

// Broken PR FALLBACK: git-scope only (documents cold install without Main).
parent_pr_cold_cache_from = GHA_CACHE_ENABLED == "" ? [] : [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-bake-sim-parent-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
]

leaf_cache_from = GHA_CACHE_ENABLED == "" ? [] : GHA_CACHE_FALLBACK_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-bake-sim-leaf-v1:buildcache,ignore-error=true",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-bake-sim-leaf-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
] : [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-bake-sim-leaf-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
]

leaf_cache_to = GHA_CACHE_WRITE_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-bake-sim-leaf-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache,mode=max,timeout=5m",
] : []

// Short-chain: parent scope only (no leaf own-scope) — leaf RUN cannot restore.
leaf_short_chain_cache_from = GHA_CACHE_ENABLED == "" ? [] : [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-bake-sim-parent-v1:buildcache,ignore-error=true",
]

target "parent" {
  context = "."
  dockerfile = "parent.Dockerfile"
  cache-from = parent_cache_from
  output = ["type=cacheonly"]
}

target "parent-publish" {
  context = "."
  dockerfile = "parent.Dockerfile"
  cache-from = parent_cache_from
  cache-to = parent_cache_to
  output = ["type=cacheonly"]
}

target "parent-pr-cold" {
  context = "."
  dockerfile = "parent.Dockerfile"
  cache-from = parent_pr_cold_cache_from
  output = ["type=cacheonly"]
}

target "leaf" {
  context = "."
  dockerfile = "leaf.Dockerfile"
  contexts = {
    parent = "target:parent"
  }
  cache-from = leaf_cache_from
  cache-to = leaf_cache_to
  output = ["type=cacheonly"]
}

target "leaf-short-chain" {
  context = "."
  dockerfile = "leaf.Dockerfile"
  contexts = {
    parent = "target:parent"
  }
  cache-from = leaf_short_chain_cache_from
  output = ["type=cacheonly"]
}
