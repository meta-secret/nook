#!/usr/bin/env bash
# Warm the Main publish-cache builder with only the dependency / native-source Bake
# targets that hosted GHA scopes export. Do not run preflight, web-artifacts, or the
# final nook-web-e2e image: producers already verified those graphs, and rebuilding
# them here added ~15 minutes of duplicate work on Main.
#
# Restores GHA cache-from (GHA_CACHE_WRITE_ENABLED must stay empty). Export happens in
# publish-buildkit-gha-cache.sh on the same builder after this warm succeeds.

set -euo pipefail

if [ -n "${GHA_CACHE_WRITE_ENABLED:-}" ]; then
  echo "warm-buildkit-gha-cache: GHA_CACHE_WRITE_ENABLED must be empty during warm" >&2
  exit 2
fi

if [ -z "${GHA_CACHE_ENABLED:-}" ]; then
  echo "warm-buildkit-gha-cache: GHA_CACHE_ENABLED must be set" >&2
  exit 2
fi

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
builder="${BUILDX_BUILDER:-${NOOK_PR_BUILDX_BUILDER:-}}"
if [ -z "$builder" ]; then
  echo "warm-buildkit-gha-cache: BUILDX_BUILDER is required" >&2
  exit 2
fi

cd "$repo_root"

password_allow=()
if [ -n "${SCCACHE_REDIS_PASSWORD_FILE:-}" ] && [ -r "${SCCACHE_REDIS_PASSWORD_FILE}" ]; then
  password_allow=(--allow="fs.read=${SCCACHE_REDIS_PASSWORD_FILE}")
fi

echo "Warming hosted BuildKit cache graph on builder ${builder} (deps/native-source only)"
BUILDKIT_PROGRESS=plain docker buildx --builder "$builder" bake \
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
  prepare-and-publish-cache

echo "Hosted BuildKit cache warm complete"
