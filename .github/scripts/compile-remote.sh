#!/usr/bin/env bash
# Hosted-only entrypoint for the compile-only remote task.
# The remote workflow owns checkout, registry login, Buildx selection, and
# cache/sccache setup. This script must remain a direct buildx boundary: it
# must not call Task setup, preflight, or another remote wrapper.
set -euo pipefail

if [ "${GITHUB_ACTIONS:-}" != "true" ]; then
  echo "build:compile is hosted-only; invoke it through task remote TASK_NAME=build:compile" >&2
  exit 2
fi

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "${script_dir}/../.." && pwd)"
cd "$repo_root"

compile_dockerfile="${repo_root}/nook-app/nook-platform/docker/rust/compile.Dockerfile"
active_compile_dockerfile="$(sed -E '/^[[:space:]]*#/d; s/[[:space:]]+#.*$//' "$compile_dockerfile")"
forbidden_compile_patterns=(
  'cargo[[:space:]]+test'
  'cargo[[:space:]]+clippy'
  '(bun|npm|pnpm|yarn)[[:space:]]+(run[[:space:]]+)?test'
  'coverage'
  '(^|[^[:alnum:]_])e2e([^[:alnum:]_]|$)'
  '(^|[^[:alnum:]_])preflight([^[:alnum:]_]|$)'
)
for forbidden_pattern in "${forbidden_compile_patterns[@]}"; do
  if printf '%s\n' "$active_compile_dockerfile" | grep -Eiq -- "$forbidden_pattern"; then
    echo "compile-only Dockerfile contains forbidden operation: ${forbidden_pattern}" >&2
    exit 2
  fi
done

docker_bin="${DOCKER:-docker}"
registry_host="${NOOK_REGISTRY_CACHE_HOST:-registry.dev.nokey.sh}"
export NOOK_REGISTRY_CACHE_HOST="$registry_host"
wasm_build_mode="${WASM_BUILD_MODE:-dev}"
extension_commit="${NOOK_EXTENSION_COMMIT:-${GIT_COMMIT_ID:-${GITHUB_SHA:-}}}"

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
  --set "build-compile.args.SCCACHE_S3_MODE=${SCCACHE_S3_MODE:-external}"
  --set "build-compile.args.SCCACHE_ENDPOINT=${SCCACHE_ENDPOINT:-https://sccache.dev.nokey.sh}"
  --set "build-compile.args.SCCACHE_BUCKET=${SCCACHE_BUCKET:-nook-sccache}"
  --set "build-compile.args.WASM_BUILD_MODE=${wasm_build_mode}"
  --set "build-compile.args.VITE_BASE=${VITE_BASE:-/}"
  --set "build-compile.args.VITE_SITE_URL=${VITE_SITE_URL:-}"
  --set "build-compile.args.VITE_PUBLIC_APP_URL=${VITE_PUBLIC_APP_URL:-}"
  --set "build-compile.args.VITE_SIMPLE_APP_URL=${VITE_SIMPLE_APP_URL:-}"
  --set "build-compile.args.VITE_SENTINEL_APP_URL=${VITE_SENTINEL_APP_URL:-}"
  --set "build-compile.args.NOOK_SIMPLE_VAULT_URL=${NOOK_SIMPLE_VAULT_URL:-https://simple.nokey.sh/}"
  --set "build-compile.args.NOOK_EXTENSION_CHANNEL=${NOOK_EXTENSION_CHANNEL:-production}"
  --set "build-compile.args.NOOK_EXTENSION_VERSION=${NOOK_EXTENSION_VERSION:-1.0.0}"
  --set "build-compile.args.NOOK_EXTENSION_COMMIT=${extension_commit}"
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
elif [ "${SCCACHE_OPTIONAL:-}" != "1" ]; then
  echo "build:compile requires readable SCCACHE_S3_ACCESS_KEY_FILE and SCCACHE_S3_SECRET_KEY_FILE in hosted CI" >&2
  exit 2
fi

bash "${repo_root}/.github/scripts/bake-with-frontend-flake-retry.sh" \
  "build:compile" \
  "$docker_bin" buildx bake "${bake_args[@]}" build-compile
