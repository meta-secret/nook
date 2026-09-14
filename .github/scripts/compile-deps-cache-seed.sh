#!/usr/bin/env bash
# Hosted-only maintenance publisher for the immutable dependency and compiler
# generation baselines. Product build:compile remains the only exact-head
# source publisher; ordinary new heads never require maintenance seeding.
set -euo pipefail

if [ "${GITHUB_ACTIONS:-}" != "true" ] \
  || [ "${REQUESTED_REMOTE_TASKS:-}" != "build:compile-cache-seed" ]; then
  echo "compile cache seeding requires the dedicated hosted selector" >&2
  exit 2
fi

requested_source_sha="${REQUESTED_SOURCE_SHA:-}"
if [[ ! "$requested_source_sha" =~ ^[0-9a-f]{40}$ ]] \
  || [ "$(git rev-parse HEAD)" != "$requested_source_sha" ]; then
  echo "compile cache seeding requires the exact requested checkout" >&2
  exit 2
fi

compile_deps_scope="${GHA_RUST_COMPILE_DEPS_SCOPE:-}"
if [[ ! "$compile_deps_scope" =~ ^nook-rust-compile-deps-v3-[0-9a-f]{40}$ ]]; then
  echo "compile dependency seeding requires the recipe-aware immutable scope" >&2
  exit 2
fi
compile_deps_available="${GHA_CACHE_EXACT_RUST_COMPILE_DEPS_AVAILABLE:-}"
compile_generation_scope="${GHA_RUST_COMPILE_GENERATION_SCOPE:-}"
compile_generation_available="${GHA_CACHE_COMPILE_GENERATION_AVAILABLE:-}"
if [[ ! "$compile_generation_scope" =~ ^nook-build-compile-generation-v1-[0-9a-f]{40}$ ]]; then
  echo "compile cache seeding requires the recipe-aware immutable generation scope" >&2
  exit 2
fi
if [ -n "$compile_deps_available" ] && [ -n "$compile_generation_available" ]; then
  echo "Compile dependency and generation baselines already exist; skipping solve and export"
  exit 0
fi

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "${script_dir}/../.." && pwd)"
cd "$repo_root"
docker_bin="${DOCKER:-docker}"
runtime_mode_file="${RUNNER_TEMP:-/tmp}/nook-sccache-runtime-mode-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-0}"
printf '%s\n' READ_WRITE >"$runtime_mode_file"
chmod 600 "$runtime_mode_file"
trap 'rm -f -- "$runtime_mode_file"' EXIT
bake_args=(
  --allow="fs.read=${repo_root}"
  -f "${repo_root}/nook-app/docker-bake.hcl"
  -f "${repo_root}/nook-app/nook-platform/docker/rust/docker-bake.hcl"
  -f "${repo_root}/nook-app/nook-web/docker/web.docker-bake.hcl"
  -f "${repo_root}/nook-app/nook-platform/nook-core/docker-bake.hcl"
  -f "${repo_root}/nook-app/nook-platform/nook-wasm/docker-bake.hcl"
  -f "${repo_root}/nook-app/nook-web/docker/toolchain.docker-bake.hcl"
  -f "${repo_root}/nook-app/nook-web/nook-web-app/docker-bake.hcl"
  -f "${repo_root}/nook-app/nook-platform/docker/rust/compile.docker-bake.hcl"
  --set "*.context=${repo_root}"
  --set "rust-base.args.SCCACHE_S3_RW_MODE=READ_ONLY"
  --set "build-compile.args.SCCACHE_S3_MODE=${SCCACHE_S3_MODE:-external}"
  --set "build-compile.args.SCCACHE_ENDPOINT=${SCCACHE_ENDPOINT:-https://sccache.dev.nokey.sh}"
  --set "build-compile.args.SCCACHE_BUCKET=${SCCACHE_BUCKET:-nook-sccache}"
  --set "build-compile.args.WASM_BUILD_MODE=${WASM_BUILD_MODE:-dev}"
  --set "build-compile.args.VITE_BASE=${VITE_BASE:-/}"
  --set "build-compile.args.VITE_SITE_URL=${VITE_SITE_URL:-}"
  --set "build-compile.args.VITE_PUBLIC_APP_URL=${VITE_PUBLIC_APP_URL:-}"
  --set "build-compile.args.VITE_SIMPLE_APP_URL=${VITE_SIMPLE_APP_URL:-}"
  --set "build-compile.args.VITE_SENTINEL_APP_URL=${VITE_SENTINEL_APP_URL:-}"
  --set "build-compile.args.NOOK_SIMPLE_VAULT_URL=${NOOK_SIMPLE_VAULT_URL:-https://simple.nokey.sh/}"
  --set "build-compile.args.NOOK_EXTENSION_CHANNEL=${NOOK_EXTENSION_CHANNEL:-production}"
  --set "build-compile.args.NOOK_EXTENSION_VERSION=${NOOK_EXTENSION_VERSION:-1.0.0}"
  --set "build-compile.args.NOOK_EXTENSION_COMMIT=${NOOK_EXTENSION_COMMIT:-${GIT_COMMIT_ID:-${GITHUB_SHA:-}}}"
  --set "build-compile.args.NOOK_EXTENSION_SITE_URL=${NOOK_EXTENSION_SITE_URL:-https://nokey.sh/}"
  # The source-free exporter must resolve the same dependency vertex keys as
  # generation and ordinary consumer solves. Target-specific CLI overrides do
  # not propagate through Bake inheritance.
  --set "build-compile-dependencies.args.SCCACHE_S3_MODE=${SCCACHE_S3_MODE:-external}"
  --set "build-compile-dependencies.args.SCCACHE_ENDPOINT=${SCCACHE_ENDPOINT:-https://sccache.dev.nokey.sh}"
  --set "build-compile-dependencies.args.SCCACHE_BUCKET=${SCCACHE_BUCKET:-nook-sccache}"
  --set "build-compile-dependencies.args.WASM_BUILD_MODE=${WASM_BUILD_MODE:-dev}"
  --set "build-compile-dependencies.args.VITE_BASE=${VITE_BASE:-/}"
  --set "build-compile-dependencies.args.VITE_SITE_URL=${VITE_SITE_URL:-}"
  --set "build-compile-dependencies.args.VITE_PUBLIC_APP_URL=${VITE_PUBLIC_APP_URL:-}"
  --set "build-compile-dependencies.args.VITE_SIMPLE_APP_URL=${VITE_SIMPLE_APP_URL:-}"
  --set "build-compile-dependencies.args.VITE_SENTINEL_APP_URL=${VITE_SENTINEL_APP_URL:-}"
  --set "build-compile-dependencies.args.NOOK_SIMPLE_VAULT_URL=${NOOK_SIMPLE_VAULT_URL:-https://simple.nokey.sh/}"
  --set "build-compile-dependencies.args.NOOK_EXTENSION_CHANNEL=${NOOK_EXTENSION_CHANNEL:-production}"
  --set "build-compile-dependencies.args.NOOK_EXTENSION_VERSION=${NOOK_EXTENSION_VERSION:-1.0.0}"
  --set "build-compile-dependencies.args.NOOK_EXTENSION_COMMIT=${NOOK_EXTENSION_COMMIT:-${GIT_COMMIT_ID:-${GITHUB_SHA:-}}}"
  --set "build-compile-dependencies.args.NOOK_EXTENSION_SITE_URL=${NOOK_EXTENSION_SITE_URL:-https://nokey.sh/}"
  # Bake applies CLI overrides after target inheritance. Mirror every
  # invocation-shaping consumer argument on the maintenance target so the
  # exported generation contains the keys build:compile will request.
  --set "build-compile-generation.args.SCCACHE_S3_MODE=${SCCACHE_S3_MODE:-external}"
  --set "build-compile-generation.args.SCCACHE_ENDPOINT=${SCCACHE_ENDPOINT:-https://sccache.dev.nokey.sh}"
  --set "build-compile-generation.args.SCCACHE_BUCKET=${SCCACHE_BUCKET:-nook-sccache}"
  --set "build-compile-generation.args.WASM_BUILD_MODE=${WASM_BUILD_MODE:-dev}"
  --set "build-compile-generation.args.VITE_BASE=${VITE_BASE:-/}"
  --set "build-compile-generation.args.VITE_SITE_URL=${VITE_SITE_URL:-}"
  --set "build-compile-generation.args.VITE_PUBLIC_APP_URL=${VITE_PUBLIC_APP_URL:-}"
  --set "build-compile-generation.args.VITE_SIMPLE_APP_URL=${VITE_SIMPLE_APP_URL:-}"
  --set "build-compile-generation.args.VITE_SENTINEL_APP_URL=${VITE_SENTINEL_APP_URL:-}"
  --set "build-compile-generation.args.NOOK_SIMPLE_VAULT_URL=${NOOK_SIMPLE_VAULT_URL:-https://simple.nokey.sh/}"
  --set "build-compile-generation.args.NOOK_EXTENSION_CHANNEL=${NOOK_EXTENSION_CHANNEL:-production}"
  --set "build-compile-generation.args.NOOK_EXTENSION_VERSION=${NOOK_EXTENSION_VERSION:-1.0.0}"
  --set "build-compile-generation.args.NOOK_EXTENSION_COMMIT=${NOOK_EXTENSION_COMMIT:-${GIT_COMMIT_ID:-${GITHUB_SHA:-}}}"
  --set "build-compile-generation.args.NOOK_EXTENSION_SITE_URL=${NOOK_EXTENSION_SITE_URL:-https://nokey.sh/}"
)

access_key_file="${SCCACHE_S3_ACCESS_KEY_FILE:-}"
secret_key_file="${SCCACHE_S3_SECRET_KEY_FILE:-}"
if [ -n "$access_key_file" ] && [ -r "$access_key_file" ] \
  && [ -n "$secret_key_file" ] && [ -r "$secret_key_file" ]; then
  bake_args+=(
    "--allow=fs.read=${access_key_file}"
    "--allow=fs.read=${secret_key_file}"
    "--allow=fs.read=${runtime_mode_file}"
    "--set=*.secrets=id=sccache_s3_access_key,src=${access_key_file}"
    "--set=*.secrets+=id=sccache_s3_secret_key,src=${secret_key_file}"
    "--set=*.secrets+=id=sccache_runtime_mode,src=${runtime_mode_file}"
  )
else
  echo "compile cache publication requires readable SCCACHE_S3_ACCESS_KEY_FILE and SCCACHE_S3_SECRET_KEY_FILE" >&2
  exit 2
fi

if [ -z "$compile_deps_available" ]; then
  GHA_CACHE_WRITE_ENABLED= \
  GHA_COMPILE_SOURCE_CACHE_WRITE_ENABLED= \
  GHA_COMPILE_DEPS_CACHE_WRITE_ENABLED=1 \
    bash "${repo_root}/.github/scripts/bake-with-frontend-flake-retry.sh" \
      "build:compile-cache-seed dependencies" \
      "$docker_bin" buildx bake "${bake_args[@]}" build-compile-dependencies
else
  echo "Compile dependency cache already exists; skipping dependency solve and export: $compile_deps_scope"
fi

if [ -z "$compile_generation_available" ]; then
  # Probe-before-write makes this fingerprinted ref immutable. The complete
  # mode=max graph becomes the shared starting point for all subsequent heads.
  GHA_CACHE_WRITE_ENABLED= \
  GHA_COMPILE_DEPS_CACHE_WRITE_ENABLED= \
  GHA_COMPILE_SOURCE_CACHE_WRITE_ENABLED= \
  GHA_COMPILE_GENERATION_CACHE_WRITE_ENABLED=1 \
  GHA_CACHE_EXACT_RUST_COMPILE_DEPS_AVAILABLE=1 \
    bash "${repo_root}/.github/scripts/bake-with-frontend-flake-retry.sh" \
      "build:compile-cache-seed generation" \
      "$docker_bin" buildx bake "${bake_args[@]}" build-compile-generation
else
  echo "Compile generation baseline already exists; skipping solve and export: $compile_generation_scope"
fi
