// Thin shared Bake fragment: GHA/registry/sccache variables, _sccache inherit target,
// and cross-lineage prepare groups that span Rust + web solves.
// Package-owned targets and Zot scopes live next to their Dockerfiles:
//   nook-app/nook-platform/docker/rust/docker-bake.hcl -> rust cache scopes + rust-base/ecosystem
//   nook-app/nook-web/docker/web.docker-bake.hcl       -> web/e2e bases + final-image cache scopes
//   nook-app/nook-platform/nook-core/docker-bake.hcl   -> builder-core-deps, focused rust leaves
//   nook-app/nook-platform/nook-wasm/docker-bake.hcl   -> builder-wasm, web-artifacts, nook-rust*
//   nook-app/nook-web/docker/toolchain.docker-bake.hcl -> web-deps + independent Bun dependency scopes
//   nook-app/nook-web/nook-web-app/docker-bake.hcl     -> loadable nook-web* images
//   preflight/docker-bake.hcl                         -> preflight targets + cache scopes
// Callers pass all files via NOOK_BAKE_FILES / PREFLIGHT_BAKE_FILES (bake has no `include`).

variable "SCCACHE_ENDPOINT" {
  default = "https://sccache.dev.nokey.sh"
}

variable "SCCACHE_BUCKET" {
  default = "nook-sccache"
}

variable "SCCACHE_S3_MODE" {
  default = "external"
}

variable "SCCACHE_S3_RW_MODE" {
  default = "READ_WRITE"
}

// Empty by default in HCL. Local Task Bake sets this from root Taskfile env when
// remote registry credentials exist. CI sets it from nook-docker-setup after
// registry login. Separate refs keep sibling BuildKit lineages from overwriting
// each other. Rust exporters omit ignore-error so a failed cook-layer upload
// fails Main. Web exporters keep ignore-error.
variable "GHA_CACHE_ENABLED" {
  default = ""
}

// Some manual workflows build an arbitrary PR head while the Actions run itself belongs to the
// default branch. They may restore shared layers, but must not overwrite main's cache refs.
variable "GHA_CACHE_WRITE_ENABLED" {
  default = ""
}

// The remote build:compile handoff defaults to publication so ordinary feature
// invocations retain their existing semantics. Delivery may explicitly select
// read-only for a warm verification; that mode must not create any registry
// exporter, regardless of the generic cache-write flag.
variable "NOOK_COMPILE_CACHE_MODE" {
  default = "publish"
}

// Main, hosted, and ARC publishers retain complete mode=max graphs. Complete
// roots are required because a thin PR-lane export can orphan dependency and
// compiler ancestry on a fresh shard.
variable "GHA_CACHE_EXPORT_MODE" {
  default = "max"
}

// Main keeps this empty. Ordinary PR jobs use a stable -pr-<number> lane so
// successive heads and fresh ARC shards reuse the previous verified graph.
// Remote build:compile and local publications retain immutable -git-<sha>
// identities. Every nonempty suffix writes only remote-buildcache and cannot
// replace trusted Main refs.
variable "GHA_CACHE_SCOPE_SUFFIX" {
  default = ""
}

// Isolated PR-number and exact-git writes use this to enable Main fallback.
// Per-scope exact probes suppress that fallback when an exact ref is present.
variable "GHA_CACHE_FALLBACK_ENABLED" {
  default = ""
}

// BuildKit merges cache importers; their list order is not fallback precedence.
// Hosted setup probes each exact ref and trusted Main native/WASM source refs.
// A present exact or Main source ref must be imported alone. A missing source
// ref may fall back to dependency fingerprints.
variable "GHA_CACHE_EXACT_RUST_BASE_AVAILABLE" {
  default = ""
}

variable "GHA_CACHE_EXACT_RUST_DYLINT_AVAILABLE" {
  default = ""
}

variable "GHA_CACHE_EXACT_RUST_FUZZ_AVAILABLE" {
  default = ""
}

variable "GHA_CACHE_EXACT_RUST_POLICY_TOOLS_AVAILABLE" {
  default = ""
}

variable "GHA_CACHE_EXACT_RUST_DETERMINISTIC_AVAILABLE" {
  default = ""
}

variable "GHA_CACHE_EXACT_RUST_KANI_AVAILABLE" {
  default = ""
}

variable "GHA_CACHE_EXACT_RUST_DEPS_AVAILABLE" {
  default = ""
}

variable "GHA_CACHE_EXACT_RUST_WASM_DEPS_AVAILABLE" {
  default = ""
}

variable "GHA_CACHE_EXACT_RUST_NATIVE_SOURCE_AVAILABLE" {
  default = ""
}

variable "GHA_CACHE_MAIN_RUST_NATIVE_SOURCE_AVAILABLE" {
  default = ""
}

variable "GHA_CACHE_EXACT_RUST_WASM_SOURCE_AVAILABLE" {
  default = ""
}

variable "GHA_CACHE_MAIN_RUST_WASM_SOURCE_AVAILABLE" {
  default = ""
}

variable "GHA_CACHE_EXACT_PREFLIGHT_AVAILABLE" {
  default = ""
}

// Hosted setup sets this after it probes every exact ref. Local Task runs do
// not probe, so an empty availability value there means unknown, not absent.
variable "GHA_CACHE_EXACT_PROBES_COMPLETE" {
  default = ""
}

variable "GHA_CACHE_EXACT_WEB_E2E_AVAILABLE" {
  default = ""
}

// Hosted setup probes the two independent Bun dependency scopes used by the web-deps aggregate.
// A present exact scope is imported alone; Main is considered only after an exact miss.
variable "GHA_CACHE_EXACT_WEB_APP_DEPS_AVAILABLE" {
  default = ""
}

variable "GHA_CACHE_MAIN_WEB_APP_DEPS_AVAILABLE" {
  default = ""
}

variable "GHA_CACHE_EXACT_WEB_RESEARCH_DEPS_AVAILABLE" {
  default = ""
}

variable "GHA_CACHE_MAIN_WEB_RESEARCH_DEPS_AVAILABLE" {
  default = ""
}

// Retained for local/manual compatibility with explicitly suffixed cache experiments.
variable "GHA_CACHE_SEED_SCOPE_SUFFIX" {
  default = ""
}

variable "NOOK_REGISTRY_CACHE_HOST" {
  default = "registry.dev.nokey.sh"
}

// Main and remote builds intentionally write different Zot repositories. Zot authorizes
// repositories, not tag prefixes: the remote identity can update nook/remote-buildcache/**
// while it can only read the trusted nook/buildcache/** lineage published by Main.
write_cache_repository = GHA_CACHE_SCOPE_SUFFIX != "" ? "nook/remote-buildcache" : "nook/buildcache"

// A PR cache is optional acceleration and must not consume the validation
// deadline during a degraded registry event. Main publication owns the longer
// strict window used to refresh the shared fallback.
cache_export_timeout = GHA_CACHE_SCOPE_SUFFIX != "" ? "60s" : "10m"

target "_sccache" {
  args = {
    SCCACHE_S3_MODE  = SCCACHE_S3_MODE
    SCCACHE_S3_RW_MODE = SCCACHE_S3_RW_MODE
    SCCACHE_ENDPOINT = SCCACHE_ENDPOINT
    SCCACHE_BUCKET   = SCCACHE_BUCKET
  }
}

// Phase one of `task setup`: Rust/WASM validation + tiny artifact export runs concurrently with
// Bun dependency preparation. The second phase builds nook-web from the host artifact directory.
group "prepare" {
  targets = ["builder-debug", "rust-format-check", "web-artifacts", "web-deps"]
}

// Formatting must be able to build source-sealed images before the host applies the emitted diff.
group "prepare-with-unformatted-rust" {
  targets = ["web-artifacts", "web-deps"]
}

// Pre-build both independent local lineages in parallel.
group "builders" {
  targets = ["builder-wasm", "web-deps"]
}
