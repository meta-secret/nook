// Standalone preflight Bake targets and Zot cache scopes. Callers merge shared vars
// and rust-base via:
//   -f nook-app/docker-bake.hcl
//   -f nook-app/nook-platform/docker/rust/docker-bake.hcl
//   -f preflight/docker-bake.hcl
// Shared GHA_CACHE_* / NOOK_REGISTRY_CACHE_HOST / write_cache_repository live in
// nook-app/docker-bake.hcl.
//
// Own scope so Native product exports do not need to rebuild preflight cooks on
// every PR head. Do not cache-from rust-base here: Bake restores it via contexts
// rust-base = target:rust-base. A shorter rust-base importer orphans chef cooks
// the same way nightly/policy were orphaned.

preflight_cache_from = GHA_CACHE_ENABLED == "" ? [] : GHA_CACHE_EXACT_PREFLIGHT_AVAILABLE != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-preflight-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
] : GHA_CACHE_FALLBACK_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-preflight-v1:buildcache,ignore-error=true",
] : [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-preflight-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
]

preflight_cache_to = GHA_CACHE_WRITE_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-preflight-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache,mode=max,timeout=10m",
] : []

target "_preflight-common" {
  inherits   = ["_sccache"]
  context    = "."
  dockerfile = "preflight/Dockerfile"
  platforms  = ["linux/amd64"]
  contexts = {
    rust-base = "target:rust-base"
  }
  cache-from = preflight_cache_from
  cache-to   = preflight_cache_to
}

target "preflight-test" {
  inherits = ["_preflight-common"]
  target   = "test"
  output   = ["type=cacheonly"]
}

target "preflight-cli-export" {
  inherits = ["_preflight-common"]
  target   = "cli-export"
}
