#!/usr/bin/env bash
# Export the already-built Main prepare graph into hosted GHA cache scopes.
# Call only after a successful prepare on the same job-scoped Buildx builder so
# cancelled Mid-prepare runs cannot publish incomplete indexes that orphan the
# cargo-chef cook layers PRs need.

set -euo pipefail

if [ -z "${GHA_CACHE_WRITE_ENABLED:-}" ]; then
  echo "publish-buildkit-gha-cache: GHA_CACHE_WRITE_ENABLED must be set" >&2
  exit 2
fi

if [ -z "${GHA_CACHE_ENABLED:-}" ]; then
  echo "publish-buildkit-gha-cache: GHA_CACHE_ENABLED must be set" >&2
  exit 2
fi

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
builder="${BUILDX_BUILDER:-${NOOK_PR_BUILDX_BUILDER:-}}"
if [ -z "$builder" ]; then
  echo "publish-buildkit-gha-cache: BUILDX_BUILDER is required" >&2
  exit 2
fi

cd "$repo_root"

password_allow=()
if [ -n "${SCCACHE_REDIS_PASSWORD_FILE:-}" ] && [ -r "${SCCACHE_REDIS_PASSWORD_FILE}" ]; then
  password_allow=(--allow="fs.read=${SCCACHE_REDIS_PASSWORD_FILE}")
fi

echo "Publishing hosted BuildKit cache from builder ${builder}"
docker buildx --builder "$builder" bake \
  --allow="fs.read=${repo_root}" \
  "${password_allow[@]}" \
  -f "${repo_root}/nook-app/docker-bake.hcl" \
  -f "${repo_root}/nook-app/docker/base.docker-bake.hcl" \
  -f "${repo_root}/nook-app/nook-core/docker-bake.hcl" \
  -f "${repo_root}/nook-app/nook-wasm/docker-bake.hcl" \
  -f "${repo_root}/nook-app/docker/toolchain.docker-bake.hcl" \
  -f "${repo_root}/nook-app/nook-web/nook-web-app/docker-bake.hcl" \
  --set "*.context=${repo_root}" \
  --set "*.args.SCCACHE_REDIS_MODE=${SCCACHE_REDIS_MODE:-external}" \
  --set "*.args.SCCACHE_REDIS_ENDPOINT=${SCCACHE_REDIS_ENDPOINT:-rediss://redis-ovh-borg-1.bynull.link:6380}" \
  --set "builder-wasm.args.WASM_BUILD_MODE=${WASM_BUILD_MODE:-dev}" \
  --set "*.output=type=cacheonly" \
  publish-gha-cache

echo "Hosted BuildKit cache publish complete"
