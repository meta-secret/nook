#!/usr/bin/env bash
set -euo pipefail

repo_root="${REPO_ROOT:-$(git rev-parse --show-toplevel)}"
docker_bin="${DOCKER:-docker}"
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

require_cached_step() {
  local log_file="$1"
  local marker="$2"
  local step
  step="$(awk -v marker="$marker" 'index($0, marker) { print $1; exit }' "$log_file")"
  test -n "$step" && grep -Fxq "$step CACHED" "$log_file"
}

run_fresh_builder() {
  local purpose="$1"
  local attempt="$2"
  local log_file="$3"
  local cache_to="${4:-}"
  local proof_builder
  proof_builder="nook-wasm-cache-${purpose}-${GITHUB_RUN_ID:-local}-${attempt}-${RANDOM}"
  "$docker_bin" buildx create \
    --name "$proof_builder" \
    --driver docker-container \
    --use \
    --bootstrap >/dev/null
  local command=(
    "$docker_bin" buildx bake
    --progress=plain
    "${bake_args[@]}"
    --set "builder-wasm-deps-cache-proof.output=type=cacheonly"
  )
  if [ -n "$cache_to" ]; then
    command+=(--set "builder-wasm-deps-cache-proof.cache-to=$cache_to")
  fi
  if [ "$purpose" = "promote" ]; then
    # A repair solve must never import the ref it is replacing. Otherwise a
    # parseable but incomplete destination can be faithfully republished and
    # leave Main unable to heal without manual tag deletion. These independent
    # refs are optional acceleration only; a miss rebuilds from source.
    command+=(
      --set "builder-wasm-deps-cache-proof.cache-from=type=registry,ref=${registry_host}/nook/remote-buildcache/nook-rust-wasm-deps-input-v2:fingerprint-${deps_fingerprint},ignore-error=true"
      --set "builder-wasm-deps-cache-proof.cache-from+=type=registry,ref=${registry_host}/nook/buildcache/nook-rust-wasm-source-v2:buildcache,ignore-error=true"
    )
  else
    command+=(
      --set "builder-wasm-deps-cache-proof.cache-from=type=registry,ref=${cache_ref}"
    )
  fi
  command+=(builder-wasm-deps-cache-proof)
  set +e
  "${command[@]}" 2>&1 | tee "$log_file"
  local status="${PIPESTATUS[0]}"
  set -e
  "$docker_bin" buildx rm "$proof_builder" >/dev/null 2>&1 || true
  return "$status"
}

if [ "${NOOK_WASM_CACHE_PROMOTION_ENABLED:-}" = "1" ]; then
  if [ "${GITHUB_ACTIONS:-}" != "true" ] \
    || [ "${GITHUB_EVENT_NAME:-}" != "push" ] \
    || [ "${GITHUB_REF:-}" != "refs/heads/main" ]; then
    echo "portable WASM cache promotion is restricted to trusted Main pushes" >&2
    exit 2
  fi
  promotion_log="$(mktemp)"
  trap 'rm -f "$promotion_log"' EXIT
  run_fresh_builder \
    promote \
    1 \
    "$promotion_log" \
    "type=registry,ref=${cache_ref},mode=max,timeout=10m"
  rm -f "$promotion_log"
  trap - EXIT
  bun "$repo_root/.github/scripts/verify-registry-cache-blobs.ts" "$cache_ref"
fi

for attempt in 1 2 3; do
  proof_log="$(mktemp)"
  cleanup() {
    rm -f "$proof_log"
  }
  trap cleanup EXIT

  if run_fresh_builder verify "$attempt" "$proof_log" \
    && require_cached_step "$proof_log" "nook-sccache-report chef-wasm-release" \
    && require_cached_step "$proof_log" "nook-sccache-report chef-wasm-clippy" \
    && require_cached_step "$proof_log" "nook-sccache-report wasm-release-test-dependencies"; then
    echo "verified fresh-builder WASM dependency cache metadata from $cache_scope"
    cleanup
    trap - EXIT
    exit 0
  fi

  echo "WASM dependency cache verification attempt $attempt missed required layers" >&2
  cleanup
  trap - EXIT
  if [ "$attempt" -lt 3 ]; then
    sleep 5
  fi
done

echo "published WASM dependency cache is incomplete for fresh hosted builders" >&2
exit 1
