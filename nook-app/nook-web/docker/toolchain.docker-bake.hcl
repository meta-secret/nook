// Web deps branch: each `bun install` has an independent cache owner. The aggregate web-deps
// target only assembles those outputs, so a research lockfile change cannot invalidate the app
// install (or vice versa). The child scopes are also imported by the aggregate target because
// BuildKit target dependencies do not inherit cache-from declarations.
// Shared GHA_CACHE_* / NOOK_REGISTRY_CACHE_HOST / write_cache_repository live in
// nook-app/docker-bake.hcl and are merged via NOOK_BAKE_FILES.

web_app_deps_cache_from = GHA_CACHE_ENABLED == "" ? [] : GHA_CACHE_EXACT_WEB_APP_DEPS_AVAILABLE != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-web-app-deps-v1${GHA_CACHE_RESTORE_WEB_APP_DEPS_SCOPE_SUFFIX}:buildcache",
] : GHA_CACHE_EXACT_PROBES_COMPLETE != "" ? (
  GHA_CACHE_FALLBACK_ENABLED != "" && GHA_CACHE_MAIN_WEB_APP_DEPS_AVAILABLE != "" ? [
    "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-web-app-deps-v1:buildcache",
  ] : []
) : GHA_CACHE_FALLBACK_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-web-app-deps-v1${GHA_CACHE_RESTORE_WEB_APP_DEPS_SCOPE_SUFFIX}:buildcache,ignore-error=true",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-web-app-deps-v1:buildcache,ignore-error=true",
] : [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-web-app-deps-v1${GHA_CACHE_RESTORE_WEB_APP_DEPS_SCOPE_SUFFIX}:buildcache",
]

web_research_deps_cache_from = GHA_CACHE_ENABLED == "" ? [] : GHA_CACHE_EXACT_WEB_RESEARCH_DEPS_AVAILABLE != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-web-research-deps-v1${GHA_CACHE_RESTORE_WEB_RESEARCH_DEPS_SCOPE_SUFFIX}:buildcache",
] : GHA_CACHE_EXACT_PROBES_COMPLETE != "" ? (
  GHA_CACHE_FALLBACK_ENABLED != "" && GHA_CACHE_MAIN_WEB_RESEARCH_DEPS_AVAILABLE != "" ? [
    "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-web-research-deps-v1:buildcache",
  ] : []
) : GHA_CACHE_FALLBACK_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-web-research-deps-v1${GHA_CACHE_RESTORE_WEB_RESEARCH_DEPS_SCOPE_SUFFIX}:buildcache,ignore-error=true",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-web-research-deps-v1:buildcache,ignore-error=true",
] : [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-web-research-deps-v1${GHA_CACHE_RESTORE_WEB_RESEARCH_DEPS_SCOPE_SUFFIX}:buildcache",
]

web_deps_cache_from = GHA_CACHE_ENABLED == "" ? [] : GHA_CACHE_FALLBACK_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-web-deps-v1${GHA_CACHE_RESTORE_WEB_DEPS_SCOPE_SUFFIX}:buildcache,ignore-error=true",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-web-deps-v1:buildcache",
  # Child refs are optional adjuncts here. The standalone child targets select exact-or-Main
  # after probing; aggregate imports tolerate a first publication where one child is absent.
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-web-app-deps-v1${GHA_CACHE_RESTORE_WEB_APP_DEPS_SCOPE_SUFFIX}:buildcache,ignore-error=true",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-web-app-deps-v1:buildcache,ignore-error=true",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-web-research-deps-v1${GHA_CACHE_RESTORE_WEB_RESEARCH_DEPS_SCOPE_SUFFIX}:buildcache,ignore-error=true",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-web-research-deps-v1:buildcache,ignore-error=true",
] : [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-web-deps-v1${GHA_CACHE_RESTORE_WEB_DEPS_SCOPE_SUFFIX}:buildcache",
  # Child refs are independently published and may not exist during the first rollout.
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-web-app-deps-v1${GHA_CACHE_RESTORE_WEB_APP_DEPS_SCOPE_SUFFIX}:buildcache,ignore-error=true",
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-web-research-deps-v1${GHA_CACHE_RESTORE_WEB_RESEARCH_DEPS_SCOPE_SUFFIX}:buildcache,ignore-error=true",
]

web_app_deps_cache_to = GHA_CACHE_ENABLED != "" && GHA_CACHE_WRITE_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-web-app-deps-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache,mode=max,ignore-error=true,timeout=${cache_export_timeout}",
] : []

web_research_deps_cache_to = GHA_CACHE_ENABLED != "" && GHA_CACHE_WRITE_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-web-research-deps-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache,mode=max,ignore-error=true,timeout=${cache_export_timeout}",
] : []

web_deps_cache_to = GHA_CACHE_ENABLED != "" && GHA_CACHE_WRITE_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-web-deps-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache,mode=max,ignore-error=true,timeout=${cache_export_timeout}",
] : []

target "web-app-deps" {
  context    = "."
  dockerfile = "nook-app/nook-web/docker/toolchain.Dockerfile"
  target     = "web-app-deps"
  platforms  = ["linux/amd64"]
  contexts = {
    web-base = "target:web-base"
  }
  cache-from = web_app_deps_cache_from
}

target "web-research-deps" {
  context    = "."
  dockerfile = "nook-app/nook-web/docker/toolchain.Dockerfile"
  target     = "web-research-deps"
  platforms  = ["linux/amd64"]
  contexts = {
    web-base = "target:web-base"
  }
  cache-from = web_research_deps_cache_from
}

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

// Explicit writers for the independent lockfile scopes. Keep these separate from the aggregate
// writer so each dependency graph can be restored without importing a shorter parent graph.
target "web-app-deps-publish" {
  inherits = ["web-app-deps"]
  cache-to = web_app_deps_cache_to
}

target "web-research-deps-publish" {
  inherits = ["web-research-deps"]
  cache-to = web_research_deps_cache_to
}
