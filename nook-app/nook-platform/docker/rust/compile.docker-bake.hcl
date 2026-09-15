// Compile-only graph for the hosted `build:compile` task.
//
// This target intentionally uses the clean rust-base/web-base toolchain stages
// as named contexts. Its source-free dependency ancestry installs the package
// graphs itself. It does not inherit product builder-core-deps or
// builder-wasm, whose warm-up graphs include validation-only work.

variable "GHA_RUST_COMPILE_DEPS_SCOPE" {
  default = ""
}

variable "GHA_CACHE_EXACT_RUST_COMPILE_DEPS_AVAILABLE" {
  default = ""
}

variable "GHA_CACHE_EXACT_BUILD_COMPILE_AVAILABLE" {
  default = ""
}

// The current exact ref remains the immutable export destination. When it is
// absent, hosted setup may select the nearest successfully published first-
// parent ref as the single full-graph restore source.
variable "GHA_BUILD_COMPILE_RESTORE_SCOPE_SUFFIX" {
  default = ""
}

// The source-free dependency graph is fingerprinted independently. A feature
// source graph is exact-commit-only and includes the required Hive compile
// graph. There is deliberately no trusted Main source fallback.
compile_deps_cache_ref = "${NOOK_REGISTRY_CACHE_HOST}/nook/remote-buildcache/${GHA_RUST_COMPILE_DEPS_SCOPE}:buildcache"
// v3 is the first exact-source schema whose mode=min export is rooted at
// the final compile target and therefore retains the expensive WASM compiler
// lineage. Legacy v2 manifests are intentionally incompatible and untrusted
// as warm-build evidence.
compile_source_cache_ref = "${NOOK_REGISTRY_CACHE_HOST}/nook/remote-buildcache/nook-build-compile-v3${GHA_CACHE_SCOPE_SUFFIX}:buildcache"
compile_restore_source_cache_ref = "${NOOK_REGISTRY_CACHE_HOST}/nook/remote-buildcache/nook-build-compile-v3${GHA_BUILD_COMPILE_RESTORE_SCOPE_SUFFIX}:buildcache"

compile_cache_from = GHA_CACHE_ENABLED == "" ? [] : GHA_BUILD_COMPILE_RESTORE_SCOPE_SUFFIX != "" ? [
  "type=registry,ref=${compile_restore_source_cache_ref}",
] : []

compile_fingerprint_cache_from = GHA_CACHE_ENABLED != "" && GHA_BUILD_COMPILE_RESTORE_SCOPE_SUFFIX == "" && GHA_CACHE_EXACT_RUST_COMPILE_DEPS_AVAILABLE != "" && GHA_RUST_COMPILE_DEPS_SCOPE != "" ? [
  "type=registry,ref=${compile_deps_cache_ref}",
] : []

compile_effective_cache_from = concat(compile_cache_from, compile_fingerprint_cache_from)

// Every entry point uses one solve contract. Bake applies CLI overrides after
// inheritance, so callers also mirror overrides on each named target.
compile_solve_args = {
  SCCACHE_S3_MODE         = SCCACHE_S3_MODE
  SCCACHE_ENDPOINT        = SCCACHE_ENDPOINT
  SCCACHE_BUCKET          = SCCACHE_BUCKET
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

compile_cache_to = GHA_CACHE_WRITE_ENABLED != "" && NOOK_COMPILE_CACHE_MODE == "publish" && GHA_CACHE_SCOPE_SUFFIX != "" && GHA_CACHE_EXACT_BUILD_COMPILE_AVAILABLE == "" ? [
  // The fingerprint ref owns the maximal dependency closure. Keep the exact
  // source handoff minimal so publication does not serialize that graph twice.
  // Keep the exact-source handoff bounded. A stalled handoff must fail
  // instead of turning a fast build into an unbounded cache publication job.
  "type=registry,ref=${compile_source_cache_ref},mode=min,compression=zstd,force-compression=true,timeout=2m",
] : []

compile_deps_cache_to = GHA_CACHE_WRITE_ENABLED != "" && NOOK_COMPILE_CACHE_MODE == "publish" && GHA_RUST_COMPILE_DEPS_SCOPE != "" && GHA_CACHE_EXACT_RUST_COMPILE_DEPS_AVAILABLE == "" ? [
  "type=registry,ref=${compile_deps_cache_ref},mode=max,compression=zstd,force-compression=true,timeout=2m",
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
  }
  args       = compile_solve_args
  cache-from = compile_effective_cache_from
  cache-to   = compile_cache_to
  output     = ["type=cacheonly"]
}

// The first ordinary publish includes this source-free target in the same
// Bake invocation as build-compile. BuildKit deduplicates their shared
// dependency work, while only this root can publish the fingerprinted mode=max
// dependency ref.
target "build-compile-dependency-cache" {
  context    = "."
  dockerfile = "nook-app/nook-platform/docker/rust/compile.Dockerfile"
  target     = "compile-dependency-cache"
  platforms  = ["linux/amd64"]
  contexts = {
    rust-base = "target:rust-base"
    web-base  = "target:web-base"
  }
  args       = compile_solve_args
  cache-from = compile_fingerprint_cache_from
  cache-to   = compile_deps_cache_to
  output     = ["type=cacheonly"]
}
