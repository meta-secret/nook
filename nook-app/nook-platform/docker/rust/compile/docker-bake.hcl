// Compile-only graph for the hosted `build:compile` task.
//
// This target intentionally uses the clean rust-base/web-base toolchain stages
// as named contexts. Its source-free dependency ancestry installs the package
// graphs itself. It does not inherit product builder-core-deps or
// builder-wasm, whose warm-up graphs include validation-only work.

// Immutable exact-head refs form a commit-parent lineage. The current ref
// accelerates same-head retries; the first-parent ref restores reusable layers
// for an ordinary new head. BuildKit validates both against this actual graph.
// The semantic repository name is unversioned so Dockerfile, context, and build
// arguments remain the cache invalidation authority.
variable "GHA_CACHE_PARENT_SCOPE_SUFFIX" {
  default = ""
}

compile_source_cache_ref = "${NOOK_REGISTRY_CACHE_HOST}/nook/remote-buildcache/nook-build-compile${GHA_CACHE_SCOPE_SUFFIX}:buildcache"
compile_parent_cache_ref = "${NOOK_REGISTRY_CACHE_HOST}/nook/remote-buildcache/nook-build-compile${GHA_CACHE_PARENT_SCOPE_SUFFIX}:buildcache"
compile_foundation_cache_from = GHA_CACHE_ENABLED == "" ? [] : concat(
  ["type=registry,ref=${compile_source_cache_ref}"],
  GHA_CACHE_PARENT_SCOPE_SUFFIX != "" && GHA_CACHE_PARENT_SCOPE_SUFFIX != GHA_CACHE_SCOPE_SUFFIX ? [
    "type=registry,ref=${compile_parent_cache_ref}",
  ] : [],
)
compile_source_cache_from = GHA_CACHE_ENABLED == "" ? [] : [
  "type=registry,ref=${compile_source_cache_ref}",
]

// Compile is the one Rust lineage with two foundations. Keep this path and
// the two target contexts together so the directory layout and BuildKit graph
// stay visibly aligned.
compile_dockerfile = "nook-app/nook-platform/docker/rust/compile/Dockerfile"

// Every entry point uses one solve contract. Bake applies CLI overrides after
// inheritance, so callers also mirror overrides on each named target.
compile_solve_args = {
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

compile_foundation_cache_to = GHA_CACHE_WRITE_ENABLED != "" && NOOK_COMPILE_CACHE_MODE == "publish" && GHA_CACHE_SCOPE_SUFFIX != "" ? [
  // Phase A is the sole current-head mode=max exporter. BuildKit retains every
  // source-free dependency vertex rooted by the dependency-only target; Phase
  // B imports this ref and never exports registry cache. The timeout applies
  // per registry operation, while the five-minute GitHub job bounds both phases.
  "type=registry,ref=${compile_source_cache_ref},mode=max,compression=zstd,timeout=20s",
] : []

target "build-compile-foundation" {
  inherits   = ["_sccache"]
  context    = "."
  dockerfile = compile_dockerfile
  target     = "compile-foundation"
  platforms  = ["linux/amd64"]
  contexts = {
    // Context targets must be cache-I/O-free. Their component cache scopes are
    // owned by the normal restore/publish workflows, while Phase A owns the
    // exact-head foundation scope.
    rust-base = "target:rust-base"
    web-base  = "target:web-base"
  }
  args       = compile_solve_args
  cache-from = compile_foundation_cache_from
  cache-to   = compile_foundation_cache_to
  output     = ["type=cacheonly"]
}

target "build-compile" {
  inherits   = ["_sccache"]
  context    = "."
  dockerfile = compile_dockerfile
  target     = "compile"
  platforms  = ["linux/amd64"]
  contexts = {
    rust-base = "target:rust-base"
    web-base  = "target:web-base"
  }
  args       = compile_solve_args
  cache-from = compile_source_cache_from
  output     = ["type=cacheonly"]
}
