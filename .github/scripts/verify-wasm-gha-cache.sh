#!/usr/bin/env bash
set -euo pipefail

repo_root="${REPO_ROOT:-$(git rev-parse --show-toplevel)}"
if [ -x /usr/local/bin/docker ]; then docker_cli=/usr/local/bin/docker
elif [ -x /usr/bin/docker ]; then docker_cli=/usr/bin/docker
elif [ -x /opt/homebrew/bin/docker ]; then docker_cli=/opt/homebrew/bin/docker
else
  echo "trusted Docker CLI is unavailable" >&2
  exit 127
fi
cache_scope="${GHA_RUST_WASM_DEPS_SCOPE:?missing GHA_RUST_WASM_DEPS_SCOPE}"
deps_fingerprint="${NOOK_RUST_DEPS_INPUT_FINGERPRINT:?missing NOOK_RUST_DEPS_INPUT_FINGERPRINT}"
sccache_mode="${SCCACHE_S3_MODE:-external}"
sccache_endpoint="${SCCACHE_ENDPOINT:-https://sccache.dev.nokey.sh}"
sccache_bucket="${SCCACHE_BUCKET:-nook-sccache}"
registry_host="${NOOK_REGISTRY_CACHE_HOST:-registry.dev.nokey.sh}"
cache_ref="${registry_host}/nook/buildcache/${cache_scope}:buildcache"

bake_args=(
  --allow="fs.read=$repo_root"
  -f "$repo_root/nook-app/docker-bake.hcl"
  -f "$repo_root/nook-app/nook-platform/docker/rust/docker-bake.hcl"
  -f "$repo_root/nook-app/nook-web/docker/web.docker-bake.hcl"
  -f "$repo_root/nook-app/nook-platform/nook-core/docker-bake.hcl"
  -f "$repo_root/nook-app/nook-platform/nook-wasm/docker-bake.hcl"
  -f "$repo_root/nook-app/nook-web/docker/toolchain.docker-bake.hcl"
  -f "$repo_root/nook-app/nook-web/nook-web-app/docker-bake.hcl"
  --set "*.context=$repo_root"
  --set "*.args.SCCACHE_S3_MODE=$sccache_mode"
  --set "*.args.SCCACHE_ENDPOINT=$sccache_endpoint"
  --set "*.args.SCCACHE_BUCKET=$sccache_bucket"
)

if [ -r "${SCCACHE_S3_ACCESS_KEY_FILE:-}" ] \
  && [ -r "${SCCACHE_S3_SECRET_KEY_FILE:-}" ]; then
  bake_args+=(
    --allow="fs.read=${SCCACHE_S3_ACCESS_KEY_FILE}"
    --allow="fs.read=${SCCACHE_S3_SECRET_KEY_FILE}"
    --set "*.secrets=id=sccache_s3_access_key,src=${SCCACHE_S3_ACCESS_KEY_FILE}"
    --set "*.secrets+=id=sccache_s3_secret_key,src=${SCCACHE_S3_SECRET_KEY_FILE}"
  )
fi

if [ "${NOOK_WASM_CACHE_PROMOTION_ENABLED:-}" = "1" ]; then
  if [ "${GITHUB_ACTIONS:-}" != "true" ] \
    || [ "${GITHUB_EVENT_NAME:-}" != "push" ] \
    || [ "${GITHUB_REF:-}" != "refs/heads/main" ]; then
    echo "portable WASM cache promotion is restricted to trusted Main pushes" >&2
    exit 2
  fi
  # Publish from the already-selected node-local rootless BuildKit shard. A
  # repair solve never imports the ref it is replacing: independent input and
  # source refs may accelerate it, while a miss rebuilds from source.
  "$docker_cli" buildx bake \
    --progress=plain \
    "${bake_args[@]}" \
    --set "builder-wasm-deps-cache-proof.output=type=cacheonly" \
    --set "builder-wasm-deps-cache-proof.cache-to=type=registry,ref=${cache_ref},mode=max,compression=zstd,force-compression=true,timeout=10m" \
    --set "builder-wasm-deps-cache-proof.cache-from=type=registry,ref=${registry_host}/nook/remote-buildcache/nook-rust-wasm-deps-input-v3:fingerprint-${deps_fingerprint},ignore-error=true" \
    --set "builder-wasm-deps-cache-proof.cache-from+=type=registry,ref=${registry_host}/nook/buildcache/nook-rust-wasm-source-v3:buildcache,ignore-error=true" \
    builder-wasm-deps-cache-proof
fi

bun "$repo_root/.github/scripts/verify-registry-cache-blobs.ts" "$cache_ref"
echo "verified ARC-published WASM dependency cache blob integrity for $cache_scope"
