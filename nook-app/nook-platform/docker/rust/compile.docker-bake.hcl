// Compile-only graph for the hosted `build:compile` task.
//
// This target intentionally uses the clean rust-base/web-base dependency stages
// as named contexts. It does not inherit product builder-core-deps or
// builder-wasm, whose warm-up graphs include validation-only work.

compile_cache_from = GHA_CACHE_ENABLED == "" ? [] : GHA_CACHE_SCOPE_SUFFIX != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/remote-buildcache/nook-build-compile-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
] : [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-build-compile-v1:buildcache,ignore-error=true",
]

compile_cache_to = GHA_CACHE_WRITE_ENABLED != "" ? [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-build-compile-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache,mode=${GHA_CACHE_EXPORT_MODE},compression=zstd,force-compression=true,timeout=10m",
] : []

target "build-compile" {
  context    = "."
  dockerfile = "nook-app/nook-platform/docker/rust/compile.Dockerfile"
  target     = "compile"
  platforms  = ["linux/amd64"]
  contexts = {
    rust-base = "target:rust-base-restore"
    web-base  = "target:web-base"
    web-deps  = "target:web-deps"
  }
  args = {
    WASM_BUILD_MODE         = WASM_BUILD_MODE
    VITE_BASE               = VITE_BASE
    VITE_SITE_URL           = VITE_SITE_URL
    VITE_PUBLIC_APP_URL     = VITE_PUBLIC_APP_URL
    VITE_SIMPLE_APP_URL     = VITE_SIMPLE_APP_URL
    VITE_SENTINEL_APP_URL   = VITE_SENTINEL_APP_URL
    NOOK_SIMPLE_VAULT_URL   = NOOK_SIMPLE_VAULT_URL
    NOOK_EXTENSION_CHANNEL  = NOOK_EXTENSION_CHANNEL
    NOOK_EXTENSION_VERSION  = NOOK_EXTENSION_VERSION
    NOOK_EXTENSION_COMMIT   = NOOK_EXTENSION_COMMIT
    NOOK_EXTENSION_SITE_URL = NOOK_EXTENSION_SITE_URL
  }
  cache-from = compile_cache_from
  cache-to   = compile_cache_to
  output     = ["type=cacheonly"]
}
