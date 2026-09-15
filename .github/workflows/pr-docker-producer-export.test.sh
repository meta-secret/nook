#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
platform_tasks="$repo_root/nook-app/nook-platform/docker/Taskfile.yml"
web_tasks="$repo_root/nook-app/nook-web/docker/Taskfile.yml"
rust_bake="$repo_root/nook-app/nook-platform/docker/rust/docker-bake.hcl"
pr_workflow="$repo_root/.github/workflows/pr.yml"

task_block() {
  local file="$1" task="$2"
  sed -n "/^  ${task}:/,/^  [[:alnum:]_:.-]*:$/p" "$file" | sed '$d'
}

native_publish="$(task_block "$platform_tasks" docker:ci:cache:publish:native)"
wasm_publish="$(task_block "$platform_tasks" docker:ci:cache:publish:wasm)"
smoke="$(task_block "$platform_tasks" docker:ecosystem:smoke)"
web_publish="$(task_block "$web_tasks" docker:ci:cache:publish:web)"

test "$(grep -Fc 'buildx bake' <<<"$native_publish")" -eq 1
test "$(grep -Fc 'buildx bake' <<<"$wasm_publish")" -eq 1
! grep -Fq 'publish:rust-base' <<<"$wasm_publish"
grep -Fq 'builder-wasm-build-publish' <<<"$wasm_publish"
! grep -Fq 'wasm-export' <<<"$wasm_publish"
test "$(grep -Fc 'rust-ecosystem-smoke-publish' <<<"$smoke")" -eq 2
grep -Fq 'GHA_CACHE_WRITE_ENABLED= task docker:ecosystem:deterministic' <<<"$smoke"
grep -Fq 'GHA_CACHE_WRITE_ENABLED= task docker:ecosystem:fuzz' <<<"$smoke"
grep -Fq 'GHA_CACHE_WRITE_ENABLED= task docker:ecosystem:kani' <<<"$smoke"
test "$(grep -Fc 'buildx bake' <<<"$web_publish")" -eq 1
grep -Fq 'web-deps-publish' <<<"$web_publish"
! grep -Fq 'web-app-deps-publish web-research-deps-publish' <<<"$web_publish"
grep -Fq 'mode=max' "$rust_bake"
grep -Fq 'rust-ecosystem-smoke-v1${GHA_CACHE_SCOPE_SUFFIX}' "$rust_bake"
grep -Fq 'needs.rust-ecosystem.outputs.dependency-policy-result' "$pr_workflow"
grep -Fq 'needs.rust-ecosystem.outputs.deterministic-tests-result' "$pr_workflow"
grep -Fq 'needs.rust-ecosystem.outputs.dylint-result' "$pr_workflow"
grep -Fq 'needs.verify.outputs.cache-result || needs.verify.result' "$pr_workflow"
grep -Fq 'probe_request_timeout_seconds=12' "$repo_root/.github/scripts/select-hosted-buildkit-cache.sh"
grep -Fq 'probe_lineage_timeout_seconds=45' "$repo_root/.github/scripts/select-hosted-buildkit-cache.sh"
grep -Fq 'GHA_CACHE_RESTORE_RUST_ECOSYSTEM_SMOKE_SCOPE_SUFFIX|nook-rust-ecosystem-smoke-v1' "$repo_root/.github/scripts/select-hosted-buildkit-cache.sh"
grep -Fq 'target "rust-ecosystem-deterministic-smoke-member"' "$rust_bake"
grep -Fq 'target "rust-fuzz-smoke-member"' "$rust_bake"
grep -Fq 'target "rust-kani-smoke-member"' "$rust_bake"
grep -A4 -F 'target "rust-fuzz-smoke-member"' "$rust_bake" | grep -Fq 'target   = "rust-ecosystem-nightly"'
grep -A4 -F 'target "rust-kani-smoke-member"' "$rust_bake" | grep -Fq 'target   = "rust-kani-toolchain"'
grep -A4 -F 'target "rust-dylint-build-publish"' "$rust_bake" | grep -Fq 'cache-to = rust_ecosystem_dylint_cache_to'
grep -A12 -F 'target "wasm-export"' "$repo_root/nook-app/nook-platform/nook-wasm/docker-bake.hcl" | grep -Fq 'cache-to   = []'
test "$(grep -Fc 'cache-to = []' "$rust_bake")" -ge 8
nightly="$repo_root/nook-app/nook-platform/docker/rust/nightly.Dockerfile"
install_block="$(sed -n '/RUN --mount=type=secret,id=sccache_s3_access_key/,/cargo dylint --version/p' "$nightly")"
grep -Fq 'id=sccache_s3_secret_key' <<<"$install_block"
grep -Fq 'cargo install cargo-dylint dylint-link' <<<"$install_block"

# Inspect the resolved Bake plans, not just HCL text. Each PR publication command
# must expose exactly one physical exporter, and PRs deliberately use mode=min.
bake_files=(
  -f "$repo_root/nook-app/docker-bake.hcl"
  -f "$repo_root/nook-app/nook-platform/docker/rust/docker-bake.hcl"
  -f "$repo_root/nook-app/nook-platform/nook-core/docker-bake.hcl"
  -f "$repo_root/nook-app/nook-platform/nook-wasm/docker-bake.hcl"
)
for target in rust-native-source-publish builder-wasm-build-publish rust-dylint-build-publish rust-ecosystem-smoke-publish; do
  plan="$(env \
    GHA_CACHE_ENABLED=1 \
    GHA_CACHE_WRITE_ENABLED=1 \
    GHA_CACHE_EXPORT_MODE=min \
    GHA_CACHE_SCOPE_SUFFIX=-git-contract \
    NOOK_REGISTRY_CACHE_HOST=registry.invalid \
    NOOK_REGISTRY_CACHE_REPOSITORY=nook/remote-buildcache \
    docker buildx bake "${bake_files[@]}" --print "$target" 2>/dev/null)"
  test "$(jq '[.target[] | select(((.["cache-to"] // []) | length) > 0)] | length' <<<"$plan")" -eq 1
  test "$(jq -r '[.target[] | .["cache-to"][]? | .mode] | unique | join(",")' <<<"$plan")" = min
done

echo 'PR Docker producer single-export contract passed'
