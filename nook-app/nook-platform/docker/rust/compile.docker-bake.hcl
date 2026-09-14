// Compile-only graph for the hosted `build:compile` task.
//
// This target intentionally uses the clean rust-base/web-base dependency stages
// as named contexts. It does not inherit product builder-core-deps or
// builder-wasm, whose warm-up graphs include validation-only work.

variable "NOOK_COMPILE_HIVE" {
  default = "0"
}

variable "GHA_RUST_COMPILE_DEPS_SCOPE" {
  default = ""
}

variable "GHA_CACHE_EXACT_RUST_COMPILE_DEPS_AVAILABLE" {
  default = ""
}

variable "GHA_CACHE_EXACT_BUILD_COMPILE_AVAILABLE" {
  default = ""
}

variable "GHA_COMPILE_DEPS_CACHE_WRITE_ENABLED" {
  default = ""
}

// The source-free dependency graph is fingerprinted independently. A feature
// source graph is exact-commit-only and embeds Hive when the request includes
// it. There is deliberately no trusted Main source fallback.
compile_deps_cache_ref = "${NOOK_REGISTRY_CACHE_HOST}/nook/remote-buildcache/${GHA_RUST_COMPILE_DEPS_SCOPE}:buildcache"
compile_source_cache_ref = "${NOOK_REGISTRY_CACHE_HOST}/nook/remote-buildcache/nook-build-compile-v2${GHA_CACHE_SCOPE_SUFFIX}:buildcache"

compile_cache_from = GHA_CACHE_ENABLED == "" ? [] : GHA_CACHE_EXACT_BUILD_COMPILE_AVAILABLE != "" && GHA_CACHE_SCOPE_SUFFIX != "" ? [
  "type=registry,ref=${compile_source_cache_ref}",
] : GHA_CACHE_EXACT_RUST_COMPILE_DEPS_AVAILABLE != "" && GHA_RUST_COMPILE_DEPS_SCOPE != "" ? [
  "type=registry,ref=${compile_deps_cache_ref}",
] : []

compile_cache_to = GHA_CACHE_WRITE_ENABLED != "" && NOOK_COMPILE_CACHE_MODE == "publish" && GHA_CACHE_SCOPE_SUFFIX != "" && GHA_CACHE_EXACT_BUILD_COMPILE_AVAILABLE == "" ? [
  // The fingerprint ref owns the maximal dependency closure. Keep the exact
  // source handoff minimal so publication does not serialize that graph twice.
  "type=registry,ref=${compile_source_cache_ref},mode=min,compression=zstd,force-compression=true,timeout=10m",
] : []

compile_deps_cache_from = GHA_CACHE_ENABLED != "" && GHA_CACHE_EXACT_RUST_COMPILE_DEPS_AVAILABLE != "" && GHA_RUST_COMPILE_DEPS_SCOPE != "" ? [
  "type=registry,ref=${compile_deps_cache_ref}",
] : []

compile_deps_cache_to = GHA_COMPILE_DEPS_CACHE_WRITE_ENABLED != "" && GHA_RUST_COMPILE_DEPS_SCOPE != "" ? [
  "type=registry,ref=${compile_deps_cache_ref},mode=max,compression=zstd,force-compression=true,timeout=10m",
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

// Provisioning invokes this target only after computing the exact dependency
// fingerprint and setting GHA_RUST_COMPILE_DEPS_SCOPE. Its final stage has no
// authored product source, so publishing it cannot contaminate the dependency
// ref with a feature checkout.
target "build-compile-dependencies" {
  context    = "."
  dockerfile = "nook-app/nook-platform/docker/rust/compile.Dockerfile"
  target     = "compile-dependencies"
  platforms  = ["linux/amd64"]
  contexts = {
    rust-base = "target:rust-base"
    web-base  = "target:web-base"
    web-deps  = "target:web-deps-compile"
  }
  args = {
    NOOK_COMPILE_HIVE = NOOK_COMPILE_HIVE
  }
  cache-from = compile_deps_cache_from
  cache-to   = compile_deps_cache_to
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
