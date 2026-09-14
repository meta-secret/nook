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
compile_dockerfile="$workflows_dir/../../nook-app/nook-platform/docker/rust/compile.Dockerfile"
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

# A repository-wide COPY makes Cortex, workflow, and catalog edits invalidate
# every web compiler vertex. Keep the product source boundary at nook-web, and
# introduce the per-head extension identity only at its packaging command so a
# new commit cannot poison preceding type-check and web-build cache keys.
if grep -Eq -- '^[[:space:]]*COPY[[:space:]]+\.[[:space:]]+\.' "$compile_dockerfile"; then
  echo 'remote compile contract: product compiler must not copy the repository root' >&2
  exit 1
fi
grep -Fq -- 'COPY nook-app/nook-web nook-app/nook-web' "$compile_dockerfile" \
  || { echo 'remote compile contract: web compiler must copy only its product domain' >&2; exit 1; }
for legal_document in docs/privacy-policy.md docs/terms-of-service.md; do
  grep -Fq -- "COPY ${legal_document} ${legal_document}" "$compile_dockerfile" \
    || { echo "remote compile contract: web compiler omits semantic input: ${legal_document}" >&2; exit 1; }
  if grep -Fq -- "$legal_document" "$compile_fingerprint"; then
    echo "remote compile contract: per-source legal input must not rotate the dependency generation: ${legal_document}" >&2
    exit 1
  fi
done
web_typecheck_line="$(grep -nF 'node_modules/.bin/svelte-check --tsconfig tsconfig.compile.json' "$compile_dockerfile" | sed -n '2s/:.*//p')"
test -n "$web_typecheck_line" \
  || { echo 'remote compile contract: web type-check boundary is missing' >&2; exit 1; }
for legal_document in docs/privacy-policy.md docs/terms-of-service.md; do
  legal_copy_line="$(grep -nF "COPY ${legal_document} ${legal_document}" "$compile_dockerfile" | cut -d: -f1)"
  test "$legal_copy_line" -lt "$web_typecheck_line" \
    || { echo "remote compile contract: legal input must enter before web compilation: ${legal_document}" >&2; exit 1; }
done
for extension_locale in en ru; do
  locale_path="nook-app/nook-platform/nook-app-common/locales/${extension_locale}.json"
  grep -Fq -- "COPY ${locale_path} ${locale_path}" "$compile_dockerfile" \
    || { echo "remote compile contract: extension packaging omits semantic input: ${locale_path}" >&2; exit 1; }
  if grep -Fq -- "$locale_path" "$compile_fingerprint"; then
    echo "remote compile contract: per-source locale input must not rotate the dependency generation: ${locale_path}" >&2
    exit 1
  fi
done
extension_arg_line="$(grep -nFx 'ARG NOOK_EXTENSION_COMMIT=' "$compile_dockerfile" | cut -d: -f1)"
extension_build_line="$(grep -nF 'NOOK_EXTENSION_COMMIT="${NOOK_EXTENSION_COMMIT}"' "$compile_dockerfile" | cut -d: -f1)"
last_web_build_line="$(grep -nF 'nook-web-research && node_modules/.bin/vite build' "$compile_dockerfile" | cut -d: -f1)"
test -n "$extension_arg_line" && test -n "$extension_build_line" \
  && test "$extension_arg_line" -lt "$extension_build_line" \
  && test $((extension_build_line - extension_arg_line)) -le 8 \
  || { echo 'remote compile contract: per-head extension commit must be declared only at the extension packaging boundary' >&2; exit 1; }
for extension_locale in en ru; do
  locale_path="nook-app/nook-platform/nook-app-common/locales/${extension_locale}.json"
  locale_copy_line="$(grep -nF "COPY ${locale_path} ${locale_path}" "$compile_dockerfile" | cut -d: -f1)"
  test -n "$last_web_build_line" && test "$locale_copy_line" -gt "$last_web_build_line" \
    && test "$locale_copy_line" -lt "$extension_arg_line" \
    || { echo "remote compile contract: extension locale must enter only at packaging: ${locale_path}" >&2; exit 1; }
done

for required in \
  'nook-rust-compile-deps-input-v3' \
  '.github/scripts/compile-deps-cache-seed.sh' \
  '.github/scripts/compile-remote.sh' \
  'nook-app/nook-platform/docker/rust/compile.Dockerfile' \
  'nook-app/nook-platform/docker/rust/compile.docker-bake.hcl'; do
  grep -Fq -- "$required" "$compile_fingerprint" \
    || { echo "remote compile contract: compile dependency fingerprint omits recipe input: $required" >&2; exit 1; }
done

# Bake inheritance is resolved before command-line target overrides. The
# maintenance target therefore needs the same explicit build arguments as the
# ordinary consumer; setting only build-compile.args.* creates different LLB
# vertex keys even though build-compile-generation inherits the HCL target.
for argument in \
  SCCACHE_S3_MODE \
  SCCACHE_ENDPOINT \
  SCCACHE_BUCKET \
  WASM_BUILD_MODE \
  VITE_BASE \
  VITE_SITE_URL \
  VITE_PUBLIC_APP_URL \
  VITE_SIMPLE_APP_URL \
  VITE_SENTINEL_APP_URL \
  NOOK_SIMPLE_VAULT_URL \
  NOOK_EXTENSION_CHANNEL \
  NOOK_EXTENSION_VERSION \
  NOOK_EXTENSION_COMMIT \
  NOOK_EXTENSION_SITE_URL; do
  grep -Fq -- "build-compile-generation.args.${argument}=" "$seed_script" \
    || { echo "remote compile contract: generation seed omits consumer argument: $argument" >&2; exit 1; }
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
