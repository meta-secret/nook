#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
docker_setup="$repo_root/.github/actions/nook-docker-setup/action.yml"
remote="$repo_root/.github/workflows/remote.yml"
main="$repo_root/.github/workflows/main.yml"
hive="$repo_root/.github/workflows/hive.yml"
release="$repo_root/.github/workflows/release.yml"
compile_remote="$repo_root/.github/scripts/compile-remote.sh"

require_text() {
  local file="$1"
  local text="$2"
  grep -Fq -- "$text" "$file" || {
    echo "missing cache workflow contract in ${file#$repo_root/}: $text" >&2
    exit 1
  }
}

reject_text() {
  local file="$1"
  local text="$2"
  if grep -Fq -- "$text" "$file"; then
    echo "obsolete cache workflow contract in ${file#$repo_root/}: $text" >&2
    exit 1
  fi
}

# Remote compilation keeps dependencies content-addressed and source output
# exact-head scoped. It must never revive the old shared compile ref.
require_text "$docker_setup" 'GHA_RUST_COMPILE_DEPS_SCOPE'
require_text "$docker_setup" 'GHA_CACHE_EXACT_RUST_COMPILE_DEPS_AVAILABLE'
require_text "$docker_setup" 'GHA_CACHE_EXACT_BUILD_COMPILE_AVAILABLE'
require_text "$docker_setup" 'nook-build-compile-v2$scope_suffix'
reject_text "$docker_setup" 'nook/buildcache/nook-build-compile'
require_text "$remote" 'isolated-cache-write: "true"'
require_text "$docker_setup" '"$NOOK_REMOTE_TASK_SELECTION" != "hive:verify"'
require_text "$compile_remote" 'nook-rust-compile-deps-v2-'
require_text "$compile_remote" 'GHA_CACHE_SCOPE_SUFFIX'
require_text "$compile_remote" 'build-compile-dependencies'
require_text "$compile_remote" '"build:compile dependencies"'
require_text "$docker_setup" 'GHA_CACHE_EXACT_WEB_DEPS_AVAILABLE'
require_text "$docker_setup" 'GHA_CACHE_MAIN_WEB_DEPS_AVAILABLE'
require_text "$docker_setup" 'GHA_CACHE_EXACT_WEB_E2E_AVAILABLE'

# Cache publication remains independently visible without delaying the
# verification/product chain. Node-local BuildKit provides in-run seeding;
# registry exports seed later runs asynchronously.
require_text "$main" 'needs: [preflight]'
require_text "$main" 'needs: [wasm]'
reject_text "$main" 'needs: [rust, preflight]'
reject_text "$main" 'needs: [preflight-cache-publish]'
reject_text "$main" 'needs: [rust, native-cache-publish]'
reject_text "$main" 'needs: [wasm, wasm-cache-publish]'
require_text "$main" 'needs: [web, web-e2e]'
reject_text "$main" 'needs: [web, web-e2e, wasm-cache-proof]'
require_text "$main" 'name: Publish verified native BuildKit cache'
require_text "$main" 'name: Publish verified WASM BuildKit cache'
require_text "$main" 'name: Publish verified web BuildKit cache'
reject_text "$main" 'cache_publication_outcome:'
reject_text "$main" 'id: publish_native_cache'
reject_text "$main" 'id: publish_wasm_cache'

# Every trusted cache-bearing workflow preserves telemetry, including the
# failure path where the build step itself did not complete.
require_text "$hive" 'uses: ./.github/actions/nook-cache-telemetry'
require_text "$release" 'uses: ./.nook/release-workflow/.github/actions/nook-cache-telemetry'
