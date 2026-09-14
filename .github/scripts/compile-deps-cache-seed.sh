#!/usr/bin/env bash
# Hosted-only maintenance publisher for missing compile dependency and
# compatible exact-source graphs. Product build:compile remains a three-minute
# consumer/current-source publisher; cold bootstrap belongs here.
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
compile_source_available="${GHA_CACHE_EXACT_BUILD_COMPILE_AVAILABLE:-}"
compile_scope_suffix="${GHA_CACHE_SCOPE_SUFFIX:-}"
if [[ ! "$compile_scope_suffix" =~ ^-git-[0-9a-f]{40}$ ]]; then
  echo "compile cache seeding requires the exact source scope" >&2
  exit 2
fi
if [ -n "$compile_deps_available" ] && [ -n "$compile_source_available" ]; then
  echo "Compatible compile dependency and exact-source caches already exist; skipping solve and export"
  exit 0
fi

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "${script_dir}/../.." && pwd)"
cd "$repo_root"
docker_bin="${DOCKER:-docker}"
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
  --set "rust-base.args.SCCACHE_S3_RW_MODE=${SCCACHE_S3_RW_MODE:-READ_ONLY}"
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
)

access_key_file="${SCCACHE_S3_ACCESS_KEY_FILE:-}"
secret_key_file="${SCCACHE_S3_SECRET_KEY_FILE:-}"
if [ -n "$access_key_file" ] && [ -r "$access_key_file" ] \
  && [ -n "$secret_key_file" ] && [ -r "$secret_key_file" ]; then
  bake_args+=(
    "--allow=fs.read=${access_key_file}"
    "--allow=fs.read=${secret_key_file}"
    "--set=*.secrets=id=sccache_s3_access_key,src=${access_key_file}"
    "--set=*.secrets+=id=sccache_s3_secret_key,src=${secret_key_file}"
  )
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

if [ -z "$compile_source_available" ]; then
  # The dependency ref either pre-existed or was published immediately above.
  # Import it while exporting only the current compatible exact-source v3 ref.
  GHA_CACHE_WRITE_ENABLED= \
  GHA_COMPILE_DEPS_CACHE_WRITE_ENABLED= \
  GHA_COMPILE_SOURCE_CACHE_WRITE_ENABLED=1 \
  GHA_CACHE_EXACT_RUST_COMPILE_DEPS_AVAILABLE=1 \
    bash "${repo_root}/.github/scripts/bake-with-frontend-flake-retry.sh" \
      "build:compile-cache-seed source" \
      "$docker_bin" buildx bake "${bake_args[@]}" build-compile
else
  echo "Compatible exact-source cache already exists; skipping source solve and export: nook-build-compile-v3${compile_scope_suffix}"
fi
