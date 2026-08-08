// Runtime Bake+Zot cache simulation mirroring Nook parent/leaf scopes.
// base ≈ rust-base (context parent; no cache-from by default).
// base-publish ≈ rust-base-publish (mode=max writer for short base index).
// parent ≈ rust-ecosystem-nightly (cache-from only; standalone Dockerfile).
// parent-publish ≈ rust-ecosystem-nightly-publish (mode=max writer).
// parent-nested ≈ nightly with Bake-context base (Scenario L orphan proof).
// leaf ≈ rust-dylint (own-scope leaf; mode=max embeds parent).
// leaf-short-chain ≈ short-parent import bug (parent scope in cache-from).
// parent-pr-cold ≈ broken nightly FALLBACK (git-scope only, no Main).
//
// PARENT_OWN_CACHE_ENABLED: when empty, context parent has no cache-from so a
// leaf own-scope mode=max restore is not orphaned by a shorter parent importer.
// BASE_OWN_CACHE_ENABLED: when empty, nested base has no cache-from (real
// rust-base). When set, short base import orphans nested parent RUNs.

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

variable "BASE_OWN_CACHE_ENABLED" {
  default = ""
}

variable "NOOK_REGISTRY_CACHE_HOST" {
  default = "registry.dev.nokey.sh:5000"
}

write_cache_repository = GHA_CACHE_SCOPE_SUFFIX != "" ? "nook/remote-buildcache" : "nook/buildcache"

base_cache_from = GHA_CACHE_ENABLED == "" || BASE_OWN_CACHE_ENABLED == "" ? [] : GHA_CACHE_FALLBACK_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-bake-sim-base-v1:buildcache,ignore-error=true",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-bake-sim-base-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
] : [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-bake-sim-base-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
]

base_cache_to = GHA_CACHE_WRITE_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-bake-sim-base-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache,mode=max,timeout=5m",
] : []

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

// Nested parent (Bake-context base) uses its own Zot scope.
parent_nested_cache_from = GHA_CACHE_ENABLED == "" || PARENT_OWN_CACHE_ENABLED == "" ? [] : GHA_CACHE_FALLBACK_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-bake-sim-parent-nested-v1:buildcache,ignore-error=true",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-bake-sim-parent-nested-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
] : [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-bake-sim-parent-nested-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
]

parent_nested_cache_to = GHA_CACHE_WRITE_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-bake-sim-parent-nested-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache,mode=max,timeout=5m",
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

// Context base: no cache-from when BASE_OWN_CACHE_ENABLED is empty (real rust-base).
target "base" {
  context = "."
  dockerfile = "base.Dockerfile"
  cache-from = base_cache_from
  output = ["type=cacheonly"]
}

target "base-publish" {
  context = "."
  dockerfile = "base.Dockerfile"
  cache-from = base_cache_from
  cache-to = base_cache_to
  output = ["type=cacheonly"]
}

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

target "parent-nested" {
  context = "."
  dockerfile = "parent-nested.Dockerfile"
  contexts = {
    base = "target:base"
  }
  cache-from = parent_nested_cache_from
  output = ["type=cacheonly"]
}

target "parent-nested-publish" {
  context = "."
  dockerfile = "parent-nested.Dockerfile"
  contexts = {
    base = "target:base"
  }
  cache-from = parent_nested_cache_from
  cache-to = parent_nested_cache_to
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

// Leaf over nested parent+base. Observes parent RUN after same-builder verify.
// No own-scope export (three-level mode=max export can skip as empty).
target "leaf-nested" {
  context = "."
  dockerfile = "leaf.Dockerfile"
  contexts = {
    parent = "target:parent-nested"
  }
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
