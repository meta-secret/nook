#!/usr/bin/env bash
set -euo pipefail

repo_root="${REPO_ROOT:-$(git rev-parse --show-toplevel)}"
docker_bin="${DOCKER:-docker}"
cache_scope="${GHA_RUST_WASM_DEPS_SCOPE:?missing GHA_RUST_WASM_DEPS_SCOPE}"
sccache_mode="${SCCACHE_REDIS_MODE:-external}"
sccache_endpoint="${SCCACHE_REDIS_ENDPOINT:-rediss://redis-ovh-borg-1.bynull.link:6380}"

bake_args=(
  --allow="fs.read=$repo_root"
  -f "$repo_root/nook-app/docker-bake.hcl"
  -f "$repo_root/nook-app/docker/base.docker-bake.hcl"
  -f "$repo_root/nook-app/nook-core/docker-bake.hcl"
  -f "$repo_root/nook-app/nook-wasm/docker-bake.hcl"
  -f "$repo_root/nook-app/docker/toolchain.docker-bake.hcl"
  -f "$repo_root/nook-app/nook-web/nook-web-app/docker-bake.hcl"
  --set "*.context=$repo_root"
  --set "*.args.SCCACHE_REDIS_MODE=$sccache_mode"
  --set "*.args.SCCACHE_REDIS_ENDPOINT=$sccache_endpoint"
  --set "*.output=type=cacheonly"
  --set "builder-wasm-deps.cache-from=type=gha,scope=$cache_scope,version=2"
  --set "builder-wasm-deps.cache-to="
)

require_cached_step() {
  local log_file="$1"
  local marker="$2"
  local step
  step="$(awk -v marker="$marker" 'index($0, marker) { print $1; exit }' "$log_file")"
  test -n "$step" && grep -Fxq "$step CACHED" "$log_file"
}

for attempt in 1 2 3; do
  proof_builder="nook-wasm-cache-proof-${GITHUB_RUN_ID:-local}-${attempt}-${RANDOM}"
  proof_log="$(mktemp)"
  cleanup() {
    "$docker_bin" buildx rm "$proof_builder" >/dev/null 2>&1 || true
    rm -f "$proof_log"
  }
  trap cleanup EXIT

  "$docker_bin" buildx create \
    --name "$proof_builder" \
    --driver docker-container \
    --bootstrap >/dev/null

  if "$docker_bin" buildx --builder "$proof_builder" bake \
    --progress=plain \
    "${bake_args[@]}" \
    builder-wasm-deps 2>&1 | tee "$proof_log" \
    && require_cached_step "$proof_log" "nook-sccache-report chef-wasm-release" \
    && require_cached_step "$proof_log" "nook-sccache-report chef-wasm-clippy" \
    && require_cached_step "$proof_log" "nook-sccache-report wasm-release-test-dependencies"; then
    echo "verified fresh-builder WASM dependency cache reuse from $cache_scope"
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
