// Web/e2e bases and final-image Zot cache scopes. Independent of the Rust toolchain lineage.
// Shared GHA_CACHE_* / NOOK_REGISTRY_CACHE_HOST / write_cache_repository live in
// nook-app/docker-bake.hcl and are merged via NOOK_BAKE_FILES.
// web-deps owns its own scope in toolchain.docker-bake.hcl.

web_cache_from = GHA_CACHE_ENABLED == "" ? [] : GHA_CACHE_EXACT_WEB_AVAILABLE != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-web-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
] : GHA_CACHE_FALLBACK_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-web-v1:buildcache,ignore-error=true",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-web-deps-v1:buildcache,ignore-error=true",
] : [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-web-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-web-deps-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
]

web_cache_to = GHA_CACHE_WRITE_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-web-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache,mode=max,ignore-error=true,timeout=10m",
] : []

web_e2e_cache_from = GHA_CACHE_ENABLED == "" ? [] : GHA_CACHE_EXACT_WEB_E2E_AVAILABLE != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-web-e2e-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
] : GHA_CACHE_FALLBACK_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-web-e2e-v1:buildcache,ignore-error=true",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-web-deps-v1:buildcache,ignore-error=true",
] : [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-web-e2e-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-web-deps-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
]

web_e2e_cache_to = GHA_CACHE_WRITE_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-web-e2e-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache,mode=max,ignore-error=true,timeout=10m",
] : []

target "web-base" {
  context    = "."
  dockerfile = "nook-app/nook-web/docker/web.Dockerfile"
  target     = "web-base"
  platforms  = ["linux/amd64"]
}

target "web-e2e-base" {
  context    = "."
  dockerfile = "nook-app/nook-web/docker/web.Dockerfile"
  target     = "web-e2e-base"
  platforms  = ["linux/amd64"]
}
