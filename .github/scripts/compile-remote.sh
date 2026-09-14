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
  '(bun|npm|pnpm|yarn)[[:space:]]+(run[[:space:]]+)?(test|check|lint|verify|audit|coverage|e2e|preflight)([^[:alnum:]_]|$)'
  '(bun|npm|pnpm|yarn)[[:space:]]+run[[:space:]]+build([^[:alnum:]_]|$)'
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
runtime_mode_file="${RUNNER_TEMP:-/tmp}/nook-sccache-runtime-mode-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-0}"
runtime_mode="${SCCACHE_S3_RW_MODE:-READ_ONLY}"
case "$runtime_mode" in
  READ_ONLY|READ_WRITE) ;;
  *) echo "build:compile received unsupported sccache mode: $runtime_mode" >&2; exit 2 ;;
esac
if [ "${NOOK_COMPILE_CACHE_MODE:-read-only}" = publish ] && [ "$runtime_mode" != READ_WRITE ]; then
  echo "build:compile publication requires READ_WRITE compiler-cache authority" >&2
  exit 2
fi
if [ "${NOOK_COMPILE_CACHE_MODE:-read-only}" = read-only ] && [ "$runtime_mode" != READ_ONLY ]; then
  echo "build:compile verification requires READ_ONLY compiler-cache authority" >&2
  exit 2
fi
printf '%s\n' "$runtime_mode" >"$runtime_mode_file"
chmod 600 "$runtime_mode_file"
trap 'rm -f -- "$runtime_mode_file"' EXIT
registry_host="${NOOK_REGISTRY_CACHE_HOST:-registry.dev.nokey.sh}"
export NOOK_REGISTRY_CACHE_HOST="$registry_host"
wasm_build_mode="${WASM_BUILD_MODE:-dev}"
extension_commit="${NOOK_EXTENSION_COMMIT:-${GIT_COMMIT_ID:-${GITHUB_SHA:-}}}"
compile_scope_suffix="${GHA_CACHE_SCOPE_SUFFIX:-}"
compile_deps_scope="${GHA_RUST_COMPILE_DEPS_SCOPE:-}"
compile_deps_available="${GHA_CACHE_EXACT_RUST_COMPILE_DEPS_AVAILABLE:-}"
compile_exact_available="${GHA_CACHE_EXACT_BUILD_COMPILE_AVAILABLE:-}"
if [[ ! "$compile_scope_suffix" =~ ^-git-[0-9a-f]{40}$ ]]; then
  echo "build:compile requires an exact-commit BuildKit source scope" >&2
  exit 2
fi
if [[ ! "$compile_deps_scope" =~ ^nook-rust-compile-deps-v3-[0-9a-f]{40}$ ]]; then
  echo "build:compile requires the fingerprinted Rust dependency scope" >&2
  exit 2
fi
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
  # Stable neutral value only: compile.Dockerfile requires the runtime secret
  # and the wrapper replaces this before any sccache daemon/client command.
  --set "rust-base.args.SCCACHE_S3_RW_MODE=READ_ONLY"
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

# Bake target overrides do not propagate through shared HCL values. Mirror the
# solve shape on the source-free sibling so both targets share dependency keys
# when the first ordinary publish requests them together.
for compile_argument in \
  "SCCACHE_S3_MODE=${SCCACHE_S3_MODE:-external}" \
  "SCCACHE_ENDPOINT=${SCCACHE_ENDPOINT:-https://sccache.dev.nokey.sh}" \
  "SCCACHE_BUCKET=${SCCACHE_BUCKET:-nook-sccache}" \
  "WASM_BUILD_MODE=${wasm_build_mode}" \
  "VITE_BASE=${VITE_BASE:-/}" \
  "VITE_SITE_URL=${VITE_SITE_URL:-}" \
  "VITE_PUBLIC_APP_URL=${VITE_PUBLIC_APP_URL:-}" \
  "VITE_SIMPLE_APP_URL=${VITE_SIMPLE_APP_URL:-}" \
  "VITE_SENTINEL_APP_URL=${VITE_SENTINEL_APP_URL:-}" \
  "NOOK_SIMPLE_VAULT_URL=${NOOK_SIMPLE_VAULT_URL:-https://simple.nokey.sh/}" \
  "NOOK_EXTENSION_CHANNEL=${NOOK_EXTENSION_CHANNEL:-production}" \
  "NOOK_EXTENSION_VERSION=${NOOK_EXTENSION_VERSION:-1.0.0}" \
  "NOOK_EXTENSION_COMMIT=${extension_commit}" \
  "NOOK_EXTENSION_SITE_URL=${NOOK_EXTENSION_SITE_URL:-https://nokey.sh/}"; do
  bake_args+=(--set "build-compile-dependency-cache.args.${compile_argument}")
done

access_key_file="${SCCACHE_S3_ACCESS_KEY_FILE:-}"
secret_key_file="${SCCACHE_S3_SECRET_KEY_FILE:-}"
bake_args+=(
  "--allow=fs.read=${runtime_mode_file}"
  "--set=build-compile.secrets=id=sccache_runtime_mode,src=${runtime_mode_file}"
  "--set=build-compile-dependency-cache.secrets=id=sccache_runtime_mode,src=${runtime_mode_file}"
)
if [ -n "$access_key_file" ] && [ -r "$access_key_file" ] \
  && [ -n "$secret_key_file" ] && [ -r "$secret_key_file" ]; then
  bake_args+=(
    "--allow=fs.read=${access_key_file}"
    "--allow=fs.read=${secret_key_file}"
    "--set=build-compile.secrets+=id=sccache_s3_access_key,src=${access_key_file}"
    "--set=build-compile.secrets+=id=sccache_s3_secret_key,src=${secret_key_file}"
    "--set=build-compile-dependency-cache.secrets+=id=sccache_s3_access_key,src=${access_key_file}"
    "--set=build-compile-dependency-cache.secrets+=id=sccache_s3_secret_key,src=${secret_key_file}"
  )
elif [ "${SCCACHE_OPTIONAL:-}" != "1" ]; then
  echo "build:compile requires readable SCCACHE_S3_ACCESS_KEY_FILE and SCCACHE_S3_SECRET_KEY_FILE in hosted CI" >&2
  exit 2
fi

compile_targets=(build-compile)
if [ "$runtime_mode" = READ_WRITE ] && [ -z "$compile_deps_available" ]; then
  compile_targets=(build-compile-dependency-cache build-compile)
  echo "Dependency cache is absent; publishing its source-free graph in the ordinary compile session"
fi

if [ -n "$compile_exact_available" ]; then
  echo "Exact BuildKit cache is available; sccache remains the cross-commit compiler cache"
elif [ -n "$compile_deps_available" ]; then
  echo "Dependency BuildKit cache is available; sccache will serve cross-commit compiler objects"
else
  echo "No remote BuildKit cache is available; performing a cold solve with sccache"
fi
bash "${repo_root}/.github/scripts/bake-with-frontend-flake-retry.sh" \
  "build:compile source" \
  "$docker_bin" buildx bake "${bake_args[@]}" "${compile_targets[@]}"
