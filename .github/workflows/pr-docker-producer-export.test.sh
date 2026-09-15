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
test "$(grep -Fc 'rust-ecosystem-smoke-publish' <<<"$smoke")" -eq 2
grep -Fq 'GHA_CACHE_WRITE_ENABLED= task docker:ecosystem:deterministic' <<<"$smoke"
grep -Fq 'GHA_CACHE_WRITE_ENABLED= task docker:ecosystem:fuzz' <<<"$smoke"
grep -Fq 'GHA_CACHE_WRITE_ENABLED= task docker:ecosystem:kani' <<<"$smoke"
test "$(grep -Fc 'buildx bake' <<<"$web_publish")" -eq 1
grep -Fq 'web-deps-publish' <<<"$web_publish"
! grep -Fq 'web-app-deps-publish web-research-deps-publish' <<<"$web_publish"
grep -Fq 'mode=max' "$rust_bake"
grep -Fq 'rust-ecosystem-smoke-v1${GHA_CACHE_SCOPE_SUFFIX}' "$rust_bake"
grep -Fq '"id":"dependency-policy","result":"success"' "$pr_workflow"
grep -Fq 'probe_request_timeout_seconds=12' "$repo_root/.github/scripts/select-hosted-buildkit-cache.sh"
grep -Fq 'probe_lineage_timeout_seconds=45' "$repo_root/.github/scripts/select-hosted-buildkit-cache.sh"
grep -Fq 'GHA_CACHE_RESTORE_RUST_ECOSYSTEM_SMOKE_SCOPE_SUFFIX|nook-rust-ecosystem-smoke-v1' "$repo_root/.github/scripts/select-hosted-buildkit-cache.sh"

echo 'PR Docker producer single-export contract passed'
