// Compile-only graph for the hosted `build:compile` task.
//
// This target intentionally uses the clean rust-base/web-base dependency stages
// as named contexts. It does not inherit product builder-core-deps or
// builder-wasm, whose warm-up graphs include validation-only work.

variable "NOOK_COMPILE_HIVE" {
  default = "0"
}

// The compile graph keeps manifest-only dependency RUNs before authored source
// COPY/RUN steps. A single stable registry ref with mode=max retains those
// native BuildKit vertices even when compiler sccache is unavailable.
compile_cache_ref = "${NOOK_REGISTRY_CACHE_HOST}/nook/remote-buildcache/nook-build-compile-v1:buildcache"

compile_cache_from = GHA_CACHE_ENABLED == "" ? [] : [
  "type=registry,ref=${compile_cache_ref},ignore-error=true",
]

compile_cache_to = GHA_CACHE_WRITE_ENABLED != "" && NOOK_COMPILE_CACHE_MODE == "publish" ? [
  "type=registry,ref=${compile_cache_ref},mode=max,compression=zstd,force-compression=true,timeout=10m",
] : []

target "build-compile" {
  context    = "."
  dockerfile = "nook-app/nook-platform/docker/rust/compile.Dockerfile"
  target     = "compile"
  platforms  = ["linux/amd64"]
  contexts = {
    // Context targets must be cache-I/O-free. Their component cache scopes are
    // owned by the normal restore/publish workflows, while this graph owns one
    // complete compile scope below.
    rust-base = "target:rust-base"
    web-base  = "target:web-base"
    web-deps  = "target:web-deps-compile"
  }
  args = {
    NOOK_COMPILE_HIVE        = NOOK_COMPILE_HIVE
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

// The normal web-deps target restores and publishes the independent Bun
// component scopes. Keep this compile context bare so those refs cannot leak
// into the build:compile solve; its complete graph is imported/exported through
// compile_cache_ref instead.
target "web-deps-compile" {
  context    = "."
  dockerfile = "nook-app/nook-web/docker/toolchain.Dockerfile"
  target     = "web-deps"
  platforms  = ["linux/amd64"]
  contexts = {
    web-base = "target:web-base"
  }
  output = ["type=cacheonly"]
}
