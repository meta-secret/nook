#!/usr/bin/env bash
set -euo pipefail

repo_root="${REPO_ROOT:-$(git rev-parse --show-toplevel)}"
docker_bin="${DOCKER:-docker}"
cache_scope="${GHA_RUST_WASM_DEPS_SCOPE:?missing GHA_RUST_WASM_DEPS_SCOPE}"
sccache_mode="${SCCACHE_S3_MODE:-external}"
sccache_endpoint="${SCCACHE_ENDPOINT:-https://sccache.dev.nokey.sh}"
sccache_bucket="${SCCACHE_BUCKET:-nook-sccache}"
registry_host="${NOOK_REGISTRY_CACHE_HOST:-registry.dev.nokey.sh}"
arc_builder="${NOOK_PR_BUILDX_BUILDER:-}"
use_arc_sidecar=""

if [ "${NOOK_BUILDKIT_REMOTE:-}" = "1" ]; then
  use_arc_sidecar=1
  : "${arc_builder:?missing NOOK_PR_BUILDX_BUILDER for ARC cache proof}"
  expected_arc_builder="nook-arc-${GITHUB_RUN_ID:?missing GITHUB_RUN_ID}-${GITHUB_JOB:?missing GITHUB_JOB}-${GITHUB_RUN_ATTEMPT:?missing GITHUB_RUN_ATTEMPT}"
  expected_arc_builder="$(printf '%s' "$expected_arc_builder" | tr -c 'a-zA-Z0-9_.-' '-')"
  if [ "$arc_builder" != "$expected_arc_builder" ]; then
    echo "refusing to prune non-job ARC BuildKit builder: $arc_builder" >&2
    exit 2
  fi
fi

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
  --set "*.output=type=cacheonly"
  --set "builder-wasm-deps-restore.cache-from=type=registry,ref=${registry_host}/nook/buildcache/$cache_scope:buildcache"
)

require_cached_step() {
  local log_file="$1"
  local marker="$2"
  local step
  step="$(awk -v marker="$marker" 'index($0, marker) { print $1; exit }' "$log_file")"
  test -n "$step" && grep -Fxq "$step CACHED" "$log_file"
}

for attempt in 1 2 3; do
  proof_builder="$arc_builder"
  remove_proof_builder=""
  proof_log="$(mktemp)"
  cleanup() {
    if [ -n "$remove_proof_builder" ]; then
      "$docker_bin" buildx rm "$proof_builder" >/dev/null 2>&1 || true
    fi
    rm -f "$proof_log"
  }
  trap cleanup EXIT

  if [ -n "$use_arc_sidecar" ]; then
    # ARC exposes one private, job-scoped BuildKit sidecar and intentionally has
    # no nested container runtime. Empty that sidecar before every attempt so
    # the proof can only restore the layers published to the registry.
    "$docker_bin" buildx use "$proof_builder"
    "$docker_bin" buildx prune \
      --all \
      --force >/dev/null
  else
    proof_builder="nook-wasm-cache-proof-${GITHUB_RUN_ID:-local}-${attempt}-${RANDOM}"
    remove_proof_builder=1
    "$docker_bin" buildx create \
      --name "$proof_builder" \
      --driver docker-container \
      --use \
      --bootstrap >/dev/null
  fi

  if "$docker_bin" buildx bake \
    --progress=plain \
    "${bake_args[@]}" \
    builder-wasm-deps-restore 2>&1 | tee "$proof_log" \
    && require_cached_step "$proof_log" "nook-sccache-report chef-wasm-release" \
    && require_cached_step "$proof_log" "nook-sccache-report chef-wasm-clippy" \
    && require_cached_step "$proof_log" "nook-sccache-report wasm-release-test-dependencies"; then
    echo "verified empty-builder WASM dependency cache reuse from $cache_scope"
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

echo "published WASM dependency cache is incomplete for an empty verification builder" >&2
exit 1
