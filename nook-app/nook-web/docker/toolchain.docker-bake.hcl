// Web deps branch: `bun install` -> node_modules. Own bake target (like builder-core-deps),
// cached in the selected builder locally and in its own private Zot ref on hosted CI.
// No Rust target is merged here.
// Shared GHA_CACHE_* / NOOK_REGISTRY_CACHE_HOST / write_cache_repository live in
// nook-app/docker-bake.hcl and are merged via NOOK_BAKE_FILES.

web_deps_cache_from = GHA_CACHE_ENABLED == "" ? [] : GHA_CACHE_FALLBACK_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-web-deps-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-web-deps-v1:buildcache,ignore-error=true",
] : [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-web-deps-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache",
]

web_deps_cache_to = GHA_CACHE_WRITE_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-web-deps-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache,mode=max,ignore-error=true,timeout=10m",
] : []

target "web-deps" {
  context    = "."
  dockerfile = "nook-app/nook-web/docker/toolchain.Dockerfile"
  target     = "web-deps"
  platforms  = ["linux/amd64"]
  contexts = {
    web-base = "target:web-base"
  }
  cache-from = web_deps_cache_from
}

// Explicit writer for the web-deps Zot scope. Image leaves use web-deps as a
// named context without cache-to so they cannot thin-export this parent.
target "web-deps-publish" {
  inherits = ["web-deps"]
  cache-to   = web_deps_cache_to
}
