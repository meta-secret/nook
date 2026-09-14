#!/usr/bin/env bash
set -euo pipefail
workflows_dir="$(cd "$(dirname "$0")" && pwd)"
remote="$workflows_dir/remote.yml"
setup="$workflows_dir/../actions/nook-docker-setup/action.yml"
compile_script="$workflows_dir/../scripts/compile-remote.sh"
compile_bake="$workflows_dir/../../nook-app/nook-platform/docker/rust/compile.docker-bake.hcl"
compile_dockerfile="$workflows_dir/../../nook-app/nook-platform/docker/rust/compile.Dockerfile"
sccache_report="$workflows_dir/../../nook-app/nook-platform/docker/sccache-report.sh"
sccache_wrapper="$workflows_dir/../../nook-app/nook-platform/docker/sccache-wrapper.sh"
sccache_fallback_contract="$workflows_dir/../../infra/contracts/sccache-wrapper-fallback.test.sh"
sccache_publication_contract="$workflows_dir/../../infra/contracts/sccache-publication.test.sh"
proof="$workflows_dir/../../infra/tasks/bake-cache.yml"
remote_taskfile="$workflows_dir/../../.task/remote-execution.yml"
batch_job="$(sed -n '/^  batch:$/,/^  web-verify:$/p' "$remote")"
compile_timeout="    timeout-minutes: \${{ (inputs.tasks || inputs.task) == 'build:compile' && 5 || 360 }}"
printf '%s\n' "$batch_job" | grep -Fqx -- "$compile_timeout"
grep -Fq -- 'build:compile) echo 5 ;;' "$workflows_dir/../scripts/remote-task-batch.sh"
grep -Fq -- "SCCACHE_S3_RW_MODE: \${{ (inputs.tasks || inputs.task) == 'build:compile' && inputs.publish_compile_cache && 'READ_WRITE' || 'READ_ONLY' }}" "$remote"
for forbidden in build:compile-cache-seed compile-generation COMPILE_GENERATION GHA_RUST_COMPILE_GENERATION; do
  if rg -n --fixed-strings "$forbidden" "$remote" "$setup" "$compile_script" "$compile_bake" "$proof" "$remote_taskfile"; then
    echo "retired seed/generation surface remains: $forbidden" >&2
    exit 1
  fi
done
test ! -e "$workflows_dir/../scripts/compile-deps-cache-seed.sh"
grep -Fq -- 'workflow_args+=(--raw-field "tasks=$requested_tasks")' "$remote_taskfile"
for required in 'publication requires READ_WRITE compiler-cache authority' 'verification requires READ_ONLY compiler-cache authority' 'id=sccache_runtime_mode' 'No remote BuildKit cache is available; performing a cold solve with sccache'; do
  grep -Fq -- "$required" "$compile_script"
done
runtime_secret_line="$(grep -nF -- '--set=*.secrets=id=sccache_runtime_mode,src=${runtime_mode_file}' "$compile_script" | cut -d: -f1)"
credential_branch_line="$(grep -nF -- 'if [ -n "$access_key_file" ]' "$compile_script" | cut -d: -f1)"
test -n "$runtime_secret_line"
test -n "$credential_branch_line"
test "$runtime_secret_line" -lt "$credential_branch_line"
grep -Fq -- '--set=*.secrets+=id=sccache_s3_access_key,src=${access_key_file}' "$compile_script"
for required in '"deps|$compile_deps_scope"' '"exact|nook-build-compile-v3$scope_suffix"' 'Compile cache probes complete: count=2 timeout_seconds=6 parallel=true'; do
  grep -Fq -- "$required" "$setup"
done
for required in 'mode=min,compression=zstd,force-compression=true,timeout=2m' 'mode=max,compression=zstd,force-compression=true,timeout=2m' 'target "build-compile-dependency-cache"' 'target     = "compile-dependency-cache"' 'cache-to   = compile_deps_cache_to' 'NOOK_COMPILE_CACHE_MODE == "publish"'; do
  grep -Fq -- "$required" "$compile_bake"
done
grep -Fq -- 'compile_targets=(build-compile-dependency-cache build-compile)' "$compile_script"
dependency_target="$(sed -n '/^FROM compile-web-dependencies AS compile-dependency-cache$/,/^FROM compile-wasm-source AS compile$/p' "$compile_dockerfile")"
for forbidden_source in 'compile-native-source' 'compile-wasm-source AS' 'compile-minds-source' 'compile-hive-console ' 'compile-web '; do
  if printf '%s\n' "$dependency_target" | sed '$d' | grep -Fq -- "$forbidden_source"; then
    echo "dependency cache target reaches source stage: $forbidden_source" >&2
    exit 1
  fi
done
if grep -Eq -- '^[[:space:]]*COPY[[:space:]]+\.[[:space:]]+\.' "$compile_dockerfile"; then
  echo 'product compiler must not copy the repository root' >&2
  exit 1
fi
for semantic_input in docs/privacy-policy.md docs/terms-of-service.md nook-app/nook-platform/nook-app-common/locales/en.json nook-app/nook-platform/nook-app-common/locales/ru.json; do
  grep -Fq -- "COPY ${semantic_input} ${semantic_input}" "$compile_dockerfile"
done
grep -Fq -- 'ENV NOOK_SCCACHE_RUNTIME_AUTHORITY=secret' "$compile_dockerfile"
test "$(grep -Fc -- 'id=sccache_runtime_mode,required=true' "$compile_dockerfile")" -eq 18
if grep -Fq -- 'id=sccache_runtime_mode,required=false' "$compile_dockerfile"; then
  echo 'compile vertex permits missing runtime authority secret' >&2
  exit 1
fi
for required in 'AWS_MAX_ATTEMPTS:=1' 'NOOK_SCCACHE_START_TIMEOUT:-2s' 'SCCACHE_CLIENT_SIDE:=1' '[ "${SCCACHE_S3_RW_MODE:-READ_WRITE}" = READ_ONLY ]' '"remote_writes":0' 'cache_transport_unavailable' 'cache_circuit_open'; do
  grep -Fq -- "$required" "$sccache_wrapper"
done
for required in 'compile_requests":339' 'cache_misses":{"counts":{"Rust":275' '"cache_errors":0' '"cache_writes":0' '"cache_writes":275' '"baked_runtime_mode":"READ_ONLY"' '"runtime_mode":"READ_WRITE"' '"runtime_mode":"READ_ONLY"' '"runtime_mode_source":"runtime_secret"' 'NOOK_SCCACHE_PUBLICATION_FAILURE'; do
  grep -Fq -- "$required" "$sccache_publication_contract"
done
grep -Fq -- 'SCCACHE_S3_RW_MODE=READ_ONLY FAKE_SCCACHE_RESULT=success' "$sccache_fallback_contract"
grep -Fq -- 'effective sccache mode: READ_WRITE' "$sccache_fallback_contract"
for required in cache_hits cache_misses cache_writes NOOK_SCCACHE_PUBLICATION_FAILURE NOOK_SCCACHE_READ_ONLY_WRITE_FAILURE; do grep -Fq -- "$required" "$sccache_report"; done
for required in 'SCCACHE_S3_RW_MODE=READ_WRITE FAKE_SCCACHE_RESULT=transport' 'READ_WRITE failure silently lost publication authority' 'test "$compiler_status" -eq 7' 'two compiler invocations performed one startup probe'; do
  grep -Fq -- "$required" "$sccache_fallback_contract"
done
for required in 'Publication guard: zero errors plus zero writes remains terminal' 'cache_errors=0 cache_misses=1 cache_writes=0 status=failed' 'NOOK_SCCACHE_AUTHORITY baked_runtime_mode=READ_ONLY runtime_mode=READ_WRITE runtime_mode_source=runtime_secret' 'Cold normal publish: no seed prerequisite, sccache READ_WRITE' 'compile_targets=(compile-dependency-cache compile-warm)' 'Next unseeded head: dependency reuse plus cross-commit sccache hits' 'bake-sim-sccache-hit' 'Read-only replay: exact BuildKit reuse and zero writes' 'cache_writes=0 registry_exports=0' 'elapsed=${compile_elapsed}s limit=300s'; do
  grep -Fq -- "$required" "$proof"
done
cache_telemetry="$workflows_dir/lib/cache-telemetry.mjs"
for required in 'baked_runtime_mode' 'runtime_mode_source' 'inconsistent sccache ${field}' 'sccache authority: baked='; do
  grep -Fq -- "$required" "$cache_telemetry"
done
echo 'remote build:compile cache contract passed'
