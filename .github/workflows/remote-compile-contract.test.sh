#!/usr/bin/env bash
# Static contract for the isolated build:compile workflow boundary.
set -euo pipefail

workflows_dir="$(cd "$(dirname "$0")" && pwd)"
remote="$workflows_dir/remote.yml"
setup="$workflows_dir/../actions/nook-docker-setup/action.yml"
compile_script="$workflows_dir/../scripts/compile-remote.sh"
seed_script="$workflows_dir/../scripts/compile-deps-cache-seed.sh"
compile_fingerprint="$workflows_dir/../scripts/compile-deps-cache-fingerprint.sh"
compile_bake="$workflows_dir/../../nook-app/nook-platform/docker/rust/compile.docker-bake.hcl"
batch_job="$(sed -n '/^  batch:$/,/^  web-verify:$/p' "$remote")"
compile_timeout="    timeout-minutes: \${{ (inputs.tasks || inputs.task) == 'build:compile' && 3 || 360 }}"

grep -Fq -- "'remote-build-compile-generation-seed'" "$remote" \
  || { echo 'remote compile contract: generation seed writes must be globally serialized' >&2; exit 1; }

printf '%s\n' "$batch_job" | grep -Fqx -- "$compile_timeout" \
  || { echo 'remote compile contract: build:compile must use three minutes and other batch tasks must retain 360 minutes' >&2; exit 1; }

[[ "$(printf '%s\n' "$batch_job" | grep -Fxc -- "$compile_timeout")" -eq 1 ]] \
  || { echo 'remote compile contract: the conditional compile timeout must appear exactly once' >&2; exit 1; }

printf '%s\n' "$batch_job" | grep -Fq -- "== 'build:compile' && 3 || 360" \
  || { echo 'remote compile contract: non-compile batch tasks must preserve their 360-minute timeout' >&2; exit 1; }

for required in \
  "if [ \"\$REQUESTED_REMOTE_TASKS\" != \"build:compile\" ]; then" \
  'build:compile must be dispatched as the only remote task.' \
  "(inputs.tasks || inputs.task) != 'web:verify'" \
  "(inputs.tasks || inputs.task) != 'ci:pr'" \
  "(inputs.tasks || inputs.task) != 'ci:pr:e2e'"; do
  printf '%s\n' "$batch_job" | grep -Fq -- "$required" \
    || { echo "remote compile contract: missing selector isolation: $required" >&2; exit 1; }
done

printf '%s\n' "$batch_job" | grep -Fq -- "(inputs.tasks || inputs.task) != 'build:compile-cache-seed'" \
  || { echo 'remote compile contract: dependency seed selector must be excluded from the generic batch' >&2; exit 1; }

for required in \
  'GHA_RUST_COMPILE_GENERATION_SCOPE' \
  'GHA_CACHE_COMPILE_GENERATION_AVAILABLE' \
  'nook-build-compile-generation-v1-$compile_deps_fingerprint'; do
  grep -Fq -- "$required" "$setup" \
    || { echo "remote compile contract: missing immutable generation cache baseline: $required" >&2; exit 1; }
done

grep -Fq -- '^nook-build-compile-generation-v1-[0-9a-f]{40}$' "$compile_script" \
  || { echo 'remote compile contract: generation baseline identity must be revalidated at the build boundary' >&2; exit 1; }
grep -Fq -- 'compile_generation_cache_ref' "$compile_bake" \
  || { echo 'remote compile contract: Bake must import the immutable generation baseline' >&2; exit 1; }

for required in \
  'nook-rust-compile-deps-input-v3' \
  'nook-app/nook-platform/docker/rust/compile.Dockerfile' \
  'nook-app/nook-platform/docker/rust/compile.docker-bake.hcl'; do
  grep -Fq -- "$required" "$compile_fingerprint" \
    || { echo "remote compile contract: compile dependency fingerprint omits recipe input: $required" >&2; exit 1; }
done

grep -Fq -- 'nook-rust-compile-deps-v3-' "$setup" \
  || { echo 'remote compile contract: setup must use the recipe-aware compile dependency scope' >&2; exit 1; }
grep -Fq -- '^nook-rust-compile-deps-v3-' "$compile_script" \
  || { echo 'remote compile contract: compile boundary must require the recipe-aware scope' >&2; exit 1; }

seed_job="$(sed -n '/^  compile-cache-seed:$/,/^  web-verify:$/p' "$remote")"
for required in \
  "inputs.task == 'build:compile-cache-seed'" \
  'timeout-minutes: 25' \
  'ref: ${{ inputs.source_sha }}' \
  'timeout --kill-after=1m 22m bash .github/scripts/compile-deps-cache-seed.sh' \
  'artifact-suffix: compile-cache-seed' \
  'cache-selection: compile-seed' \
  'cache-write: "false"' \
  'main-cache-only: "true"' \
  'isolated-cache-write: "false"'; do
  printf '%s\n' "$seed_job" | grep -Fq -- "$required" \
    || { echo "remote compile contract: missing isolated compile seed boundary: $required" >&2; exit 1; }
done

for forbidden in 'task build:compile' 'cargo test' 'preflight'; do
  grep -Fq -- "$forbidden" "$seed_script" \
    && { echo "remote compile contract: seed boundary contains forbidden product work: $forbidden" >&2; exit 1; }
done
grep -Fq -- 'build-compile-dependencies' "$seed_script" \
  || { echo 'remote compile contract: seed boundary must target only source-free compile dependencies' >&2; exit 1; }
grep -Fq -- 'GHA_CACHE_EXACT_RUST_COMPILE_DEPS_AVAILABLE' "$seed_script" \
  || { echo 'remote compile contract: seed boundary must skip an existing immutable fingerprint' >&2; exit 1; }
grep -Fq -- 'GHA_COMPILE_DEPS_CACHE_WRITE_ENABLED=1' "$seed_script" \
  || { echo 'remote compile contract: seed boundary must narrowly authorize only the dependency export' >&2; exit 1; }
grep -Fq -- 'GHA_COMPILE_GENERATION_CACHE_WRITE_ENABLED=1' "$seed_script" \
  || { echo 'remote compile contract: seed boundary must narrowly authorize the immutable generation export' >&2; exit 1; }
grep -Fq -- 'GHA_CACHE_COMPILE_GENERATION_AVAILABLE' "$seed_script" \
  || { echo 'remote compile contract: seed boundary must independently skip an existing generation baseline' >&2; exit 1; }
if grep -Fq -- 'GHA_COMPILE_SOURCE_CACHE_WRITE_ENABLED=1' "$seed_script"; then
  echo 'remote compile contract: maintenance must not seed a per-head exact source cache' >&2
  exit 1
fi
if grep -Fq -- 'build-compile-dependencies' "$compile_script"; then
  echo 'remote compile contract: ordinary build:compile must consume dependency caches, not seed them' >&2
  exit 1
fi

grep -Fq -- 'GHA_CACHE_WRITE_ENABLED=' "$seed_script" \
  || { echo 'remote compile contract: seed boundary must keep generic cache exports disabled' >&2; exit 1; }
grep -Fq -- 'timeout=8m' "$compile_bake" \
  || { echo 'remote compile contract: dependency cache export must remain bounded inside the seed job' >&2; exit 1; }
grep -Fq -- 'mode=max,compression=zstd,force-compression=true,timeout=12m' "$compile_bake" \
  || { echo 'remote compile contract: generation baseline must retain the complete graph with a bounded export' >&2; exit 1; }

grep -Fq -- '[ "$cache_selection" = "compile-seed" ]' "$setup" \
  || { echo 'remote compile contract: seed must probe the immutable remote-buildcache namespace' >&2; exit 1; }
if grep -Fq -- 'nook-build-compile-v2$ancestor_scope_suffix' "$setup"; then
  echo 'remote compile contract: incompatible legacy source manifests must not be probed' >&2
  exit 1
fi

echo 'remote compile contract test: ok'
