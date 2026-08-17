// Thin shared Bake fragment: GHA/registry/sccache variables, _sccache inherit target,
// and cross-lineage prepare groups that span Rust + web solves.
// Package-owned targets and Zot scopes live next to their Dockerfiles:
//   nook-app/nook-platform/docker/rust/docker-bake.hcl -> rust cache scopes + rust-base/ecosystem
//   nook-app/nook-web/docker/web.docker-bake.hcl       -> web/e2e bases + final-image cache scopes
//   nook-app/nook-platform/nook-core/docker-bake.hcl   -> builder-core-deps, focused rust leaves
//   nook-app/nook-platform/nook-wasm/docker-bake.hcl   -> builder-wasm, web-artifacts, nook-rust*
//   nook-app/nook-web/docker/toolchain.docker-bake.hcl -> web-deps + web-deps cache scope
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

// Main keeps this empty. Isolated PR/Remote/local writes use -git-<40-char-sha> so each
// commit owns a distinct remote-buildcache index and cannot replace trusted Main refs.
variable "GHA_CACHE_SCOPE_SUFFIX" {
  default = ""
}

// Isolated git-scoped writes use this to enable cold-scope Main fallback.
// Per-scope exact probes suppress that fallback when an exact ref is present.
variable "GHA_CACHE_FALLBACK_ENABLED" {
  default = ""
}

// BuildKit merges cache importers; their list order is not fallback precedence.
// Hosted setup probes each exact ref. A present exact ref must be imported alone,
// while a missing exact ref may fall back to dependency fingerprints and Main.
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

variable "GHA_CACHE_EXACT_RUST_WASM_SOURCE_AVAILABLE" {
  default = ""
}

variable "GHA_CACHE_EXACT_RUST_WASM_NODE_AVAILABLE" {
  default = ""
}

variable "GHA_CACHE_EXACT_PREFLIGHT_AVAILABLE" {
  default = ""
}

variable "GHA_CACHE_EXACT_WEB_E2E_AVAILABLE" {
  default = ""
}

variable "GHA_CACHE_EXACT_WEB_AVAILABLE" {
  default = ""
}

variable "GHA_CACHE_EXACT_WEB_DEPS_AVAILABLE" {
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

target "_sccache" {
  args = {
    SCCACHE_S3_MODE  = SCCACHE_S3_MODE
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
