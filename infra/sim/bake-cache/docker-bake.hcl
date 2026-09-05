// Runtime Bake+Zot cache simulation mirroring Nook parent/leaf scopes.
// base ≈ rust-base (context parent; no cache-from by default).
// base-publish ≈ rust-base-publish (mode=max writer for short base index).
// parent ≈ rust-ecosystem-nightly (cache-from only; standalone Dockerfile).
// parent-publish ≈ rust-ecosystem-nightly-publish (mode=max writer).
// parent-nested ≈ bare nightly context target (no cache importer).
// parent-nested-restore ≈ read-only nightly cache warmer.
// platform-nested-broken ≈ removed rust-platform-nightly source overlay.
// leaf-via-platform-broken ≈ old 3-linked-target dylint/fuzz topology.
// combined-leaf ≈ fixed one-Dockerfile stages with one full leaf scope.
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

variable "RUST_DEPS_INPUT_FINGERPRINT" {
  default = ""
}

variable "INPUT_CACHE_WRITE_ENABLED" {
  default = ""
}

variable "INPUT_CACHE_CANDIDATE" {
  default = ""
}

variable "LEAF_EXACT_AVAILABLE" {
  default = ""
}

variable "NESTED_LEAF_EXACT_AVAILABLE" {
  default = ""
}

variable "CONSUMER_EXACT_AVAILABLE" {
  default = ""
}

variable "HIVE_EXACT_AVAILABLE" {
  default = ""
}

variable "HIVE_CONSOLE_EXACT_AVAILABLE" {
  default = ""
}

variable "NOOK_REGISTRY_CACHE_HOST" {
  default = "registry.dev.nokey.sh:5000"
}

write_cache_repository = GHA_CACHE_SCOPE_SUFFIX != "" ? "nook/remote-buildcache" : "nook/buildcache"

base_cache_from = GHA_CACHE_ENABLED == "" || BASE_OWN_CACHE_ENABLED == "" ? [] : GHA_CACHE_FALLBACK_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-bake-sim-base-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-bake-sim-base-v1:buildcache,ignore-error=true",
] : [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-bake-sim-base-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
]

base_cache_to = GHA_CACHE_WRITE_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-bake-sim-base-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache,mode=max,timeout=5m",
] : []

// FALLBACK: exact git scope first, then content fingerprint, then trusted Main.
parent_cache_from = GHA_CACHE_ENABLED == "" || PARENT_OWN_CACHE_ENABLED == "" ? [] : GHA_CACHE_FALLBACK_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-bake-sim-parent-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/remote-buildcache/nook-bake-sim-parent-input-v2:fingerprint-${RUST_DEPS_INPUT_FINGERPRINT},ignore-error=true",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-bake-sim-parent-v1:buildcache,ignore-error=true",
] : [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-bake-sim-parent-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/remote-buildcache/nook-bake-sim-parent-input-v2:fingerprint-${RUST_DEPS_INPUT_FINGERPRINT},ignore-error=true",
]

parent_cache_to = GHA_CACHE_WRITE_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-bake-sim-parent-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache,mode=max,timeout=5m",
] : []

parent_input_cache_to = INPUT_CACHE_WRITE_ENABLED != "" && INPUT_CACHE_CANDIDATE != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/remote-buildcache/nook-bake-sim-parent-input-v2:candidate-${RUST_DEPS_INPUT_FINGERPRINT}-${INPUT_CACHE_CANDIDATE},mode=max,timeout=5m",
] : []

parent_input_candidate_cache_from = INPUT_CACHE_CANDIDATE != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/remote-buildcache/nook-bake-sim-parent-input-v2:candidate-${RUST_DEPS_INPUT_FINGERPRINT}-${INPUT_CACHE_CANDIDATE}",
] : []

// Nested parent (Bake-context base) uses its own Zot scope.
parent_nested_cache_from = GHA_CACHE_ENABLED == "" || PARENT_OWN_CACHE_ENABLED == "" ? [] : GHA_CACHE_FALLBACK_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-bake-sim-parent-nested-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-bake-sim-parent-nested-v1:buildcache,ignore-error=true",
] : [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-bake-sim-parent-nested-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
]

parent_nested_cache_to = GHA_CACHE_WRITE_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-bake-sim-parent-nested-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache,mode=max,timeout=5m",
] : []

nested_leaf_cache_from = GHA_CACHE_ENABLED == "" ? [] : NESTED_LEAF_EXACT_AVAILABLE != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-bake-sim-nested-leaf-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache",
] : GHA_CACHE_FALLBACK_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-bake-sim-nested-leaf-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-bake-sim-nested-leaf-v1:buildcache,ignore-error=true",
] : [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-bake-sim-nested-leaf-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
]

nested_leaf_cache_to = GHA_CACHE_WRITE_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-bake-sim-nested-leaf-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache,mode=max,timeout=5m",
] : []

consumer_cache_from = GHA_CACHE_ENABLED == "" ? [] : CONSUMER_EXACT_AVAILABLE != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-bake-sim-consumer-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache",
] : GHA_CACHE_FALLBACK_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-bake-sim-consumer-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-bake-sim-consumer-v1:buildcache,ignore-error=true",
] : [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-bake-sim-consumer-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
]

consumer_cache_to = GHA_CACHE_WRITE_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-bake-sim-consumer-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache,mode=max,timeout=5m",
] : []

hive_cache_from = GHA_CACHE_ENABLED == "" ? [] : HIVE_EXACT_AVAILABLE != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-bake-sim-hive-v2${GHA_CACHE_SCOPE_SUFFIX}:buildcache",
] : GHA_CACHE_FALLBACK_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-bake-sim-hive-v2${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-bake-sim-hive-v2:buildcache,ignore-error=true",
] : [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-bake-sim-hive-v2${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
]

hive_cache_to = GHA_CACHE_WRITE_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-bake-sim-hive-v2${GHA_CACHE_SCOPE_SUFFIX}:buildcache,mode=max,timeout=5m",
] : []

hive_console_cache_from = GHA_CACHE_ENABLED == "" ? [] : HIVE_CONSOLE_EXACT_AVAILABLE != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-bake-sim-hive-console-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache",
] : GHA_CACHE_FALLBACK_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-bake-sim-hive-console-v1:buildcache",
] : [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-bake-sim-hive-console-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
]

hive_console_cache_to = GHA_CACHE_WRITE_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-bake-sim-hive-console-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache,mode=max,timeout=5m",
] : []

// Broken PR FALLBACK: git-scope only (documents cold install without Main).
parent_pr_cold_cache_from = GHA_CACHE_ENABLED == "" ? [] : [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-bake-sim-parent-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
]

leaf_cache_from = GHA_CACHE_ENABLED == "" ? [] : LEAF_EXACT_AVAILABLE != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-bake-sim-leaf-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache",
] : GHA_CACHE_FALLBACK_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-bake-sim-leaf-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-bake-sim-leaf-v1:buildcache,ignore-error=true",
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

target "parent-input-publish" {
  context = "."
  dockerfile = "parent.Dockerfile"
  cache-from = parent_cache_from
  cache-to = parent_input_cache_to
  output = ["type=cacheonly"]
}

target "parent-input-verify" {
  context = "."
  dockerfile = "parent.Dockerfile"
  cache-from = parent_input_candidate_cache_from
  output = ["type=cacheonly"]
}

target "parent-nested" {
  context = "."
  dockerfile = "parent-nested.Dockerfile"
  contexts = {
    base = "target:base"
  }
  output = ["type=cacheonly"]
}

target "parent-nested-restore" {
  inherits = ["parent-nested"]
  cache-from = parent_nested_cache_from
}

target "parent-nested-importing" {
  inherits = ["parent-nested-restore"]
}

target "parent-nested-publish" {
  inherits = ["parent-nested-restore"]
  cache-to = parent_nested_cache_to
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

target "platform-nested-broken" {
  context = "."
  dockerfile = "platform-nested.Dockerfile"
  contexts = {
    parent = "target:parent-nested-importing"
  }
  output = ["type=cacheonly"]
}

target "leaf-via-platform-broken" {
  context = "."
  dockerfile = "leaf-platform.Dockerfile"
  contexts = {
    platform = "target:platform-nested-broken"
  }
  output = ["type=cacheonly"]
}

target "combined-leaf" {
  context = "."
  dockerfile = "combined-nightly.Dockerfile"
  target = "leaf"
  cache-from = nested_leaf_cache_from
  cache-to = nested_leaf_cache_to
  output = ["type=cacheonly"]
}

target "combined-consumer" {
  context = "."
  dockerfile = "combined-nightly.Dockerfile"
  target = "consumer"
  cache-from = consumer_cache_from
  cache-to = consumer_cache_to
  output = ["type=cacheonly"]
}

target "dylint-split" {
  context    = "."
  dockerfile = "combined-nightly.Dockerfile"
  target     = "dylint-split"
  args = {
    PRODUCT_SOURCE = "default-product-source"
  }
  output = ["type=cacheonly"]
}

target "wasm-node-source" {
  context    = "."
  dockerfile = "combined-nightly.Dockerfile"
  target     = "wasm-node-source"
  args = {
    PRODUCT_SOURCE = "default-product-source"
  }
  output = ["type=cacheonly"]
}

target "hive" {
  context = "."
  dockerfile = "hive.Dockerfile"
  target = "verify"
  cache-from = hive_cache_from
  cache-to = hive_cache_to
  output = ["type=cacheonly"]
}

target "hive-console" {
  context = "."
  dockerfile = "hive.Dockerfile"
  target = "console-verify"
  cache-from = hive_console_cache_from
  cache-to = hive_console_cache_to
  output = ["type=cacheonly"]
}
