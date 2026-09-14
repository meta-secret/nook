#!/usr/bin/env bash
# Hosted-only publisher for the source-free build:compile dependency graph.
set -euo pipefail

if [ "${GITHUB_ACTIONS:-}" != "true" ] \
  || [ "${REQUESTED_REMOTE_TASKS:-}" != "build:compile-cache-seed" ]; then
  echo "compile dependency seeding requires the dedicated hosted selector" >&2
  exit 2
fi

requested_source_sha="${REQUESTED_SOURCE_SHA:-}"
if [[ ! "$requested_source_sha" =~ ^[0-9a-f]{40}$ ]] \
  || [ "$(git rev-parse HEAD)" != "$requested_source_sha" ]; then
  echo "compile dependency seeding requires the exact requested checkout" >&2
  exit 2
fi

compile_deps_scope="${GHA_RUST_COMPILE_DEPS_SCOPE:-}"
if [[ ! "$compile_deps_scope" =~ ^nook-rust-compile-deps-v3-[0-9a-f]{40}$ ]]; then
  echo "compile dependency seeding requires the recipe-aware immutable scope" >&2
  exit 2
fi
if [ -n "${GHA_CACHE_EXACT_RUST_COMPILE_DEPS_AVAILABLE:-}" ]; then
  echo "Compile dependency cache already exists; skipping solve and export: $compile_deps_scope"
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

GHA_CACHE_WRITE_ENABLED= \
GHA_COMPILE_DEPS_CACHE_WRITE_ENABLED=1 \
  bash "${repo_root}/.github/scripts/bake-with-frontend-flake-retry.sh" \
    "build:compile-cache-seed dependencies" \
    "$docker_bin" buildx bake "${bake_args[@]}" build-compile-dependencies
