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
probe_classification_contract="$workflows_dir/../../infra/contracts/compile-cache-probe-classification.test.sh"
proof="$workflows_dir/../../infra/tasks/bake-cache.yml"
remote_taskfile="$workflows_dir/../../.task/remote-execution.yml"
batch_job="$(sed -n '/^  batch:$/,/^  web-verify:$/p' "$remote")"
compile_timeout="    timeout-minutes: \${{ (inputs.tasks || inputs.task) == 'build:compile' && 5 || 360 }}"
printf '%s\n' "$batch_job" | grep -Fqx -- "$compile_timeout"
grep -Fq -- 'build:compile) echo 5 ;;' "$workflows_dir/../scripts/remote-task-batch.sh"
grep -Fq -- 'SCCACHE_S3_RW_MODE: READ_WRITE' "$remote"
test "$(grep -Fc -- 'sccache-access-key: ${{ secrets.NOOK_SCCACHE_ACCESS_KEY }}' "$remote")" -eq 3
test "$(grep -Fc -- 'sccache-secret-key: ${{ secrets.NOOK_SCCACHE_SECRET_KEY }}' "$remote")" -eq 3
if rg -n --fixed-strings 'NOOK_SCCACHE_REMOTE_' "$remote" "$workflows_dir/../../infra/tasks/sccache.yml"; then
  echo 'retired secondary sccache identity remains' >&2
  exit 1
fi
for forbidden in build:compile-cache-seed compile-generation COMPILE_GENERATION GHA_RUST_COMPILE_GENERATION; do
  if rg -n --fixed-strings "$forbidden" "$remote" "$setup" "$compile_script" "$compile_bake" "$proof" "$remote_taskfile"; then
    echo "retired seed/generation surface remains: $forbidden" >&2
    exit 1
  fi
done
test ! -e "$workflows_dir/../scripts/compile-deps-cache-seed.sh"
grep -Fq -- 'workflow_args+=(--raw-field "tasks=$requested_tasks")' "$remote_taskfile"
for required in 'trusted build:compile requires the shared READ_WRITE compiler cache mode' 'id=sccache_runtime_mode' 'No remote BuildKit cache is available; performing a cold solve with sccache'; do
  grep -Fq -- "$required" "$compile_script"
done
grep -Fq -- 'SCCACHE_OPTIONAL=1' "$workflows_dir/../actions/nook-cache-connect/main.js"
grep -Fq -- '"reason":"credentials_unavailable"' "$sccache_fallback_contract"
grep -Fq -- 'Sccache no-secret route: compiler ran directly without remote access' "$sccache_fallback_contract"
runtime_secret_line="$(grep -nF -- '--set=build-compile.secrets=id=sccache_runtime_mode,src=${runtime_mode_file}' "$compile_script" | cut -d: -f1)"
credential_branch_line="$(grep -nF -- 'if [ -n "$access_key_file" ]' "$compile_script" | cut -d: -f1)"
test -n "$runtime_secret_line"
test -n "$credential_branch_line"
test "$runtime_secret_line" -lt "$credential_branch_line"
for compile_target in build-compile build-compile-dependency-cache; do
  for secret_binding in \
    "secrets=id=sccache_runtime_mode,src=\${runtime_mode_file}" \
    "secrets+=id=sccache_s3_access_key,src=\${access_key_file}" \
    "secrets+=id=sccache_s3_secret_key,src=\${secret_key_file}"; do
    grep -Fq -- "--set=${compile_target}.${secret_binding}" "$compile_script"
  done
done
for required in '"deps|$compile_deps_scope"' '"exact|nook-build-compile-v3$scope_suffix"' 'Compile cache probes complete: count=2 timeout_seconds=6 parallel=true' 'classify-registry-cache-probe.sh' 'return 2' 'return 3' 'NOOK_CACHE_PROBE_WARNING' '"failure_class":"transient_unavailable"' 'GHA_CACHE_EXACT_PROBE_FAILURE_CLASS'; do
  grep -Fq -- "$required" "$setup"
done
for required in 'transient_unavailable 124' "transient_unavailable 2 'context canceled'" "fatal 1 'unauthorized: authentication required'" "fatal 1 'invalid reference format'" 'echo cold_solve' "simulate_compile_probe 124 ''" "simulate_compile_probe 1 'unauthorized: authentication required'"; do
  grep -Fq -- "$required" "$probe_classification_contract"
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
test "$(grep -Fc -- 'RUSTC_WRAPPER= cargo fetch --locked' "$compile_dockerfile")" -eq 2
if grep -Fq -- 'id=sccache_runtime_mode,required=false' "$compile_dockerfile"; then
  echo 'compile vertex permits missing runtime authority secret' >&2
  exit 1
fi
for required in 'unset SCCACHE_ERROR_LOG' 'NOOK_SCCACHE_CONFIGURATION_FAILURE {"reason":"error_log_conflicts_with_client_side"}' 'AWS_MAX_ATTEMPTS:=1' 'NOOK_SCCACHE_START_TIMEOUT:-2s' 'SCCACHE_CLIENT_SIDE:=1' '"remote_writes":0' 'cache_transport_unavailable' 'cache_circuit_open'; do
  grep -Fq -- "$required" "$sccache_wrapper"
done
for required in 'compile_requests":339' 'cache_misses":{"counts":{"Rust":275' '"cache_errors":0' '"cache_write_errors":0' '"cache_write_errors":1' '"cache_writes":0' '"cache_writes":275' '"baked_runtime_mode":"READ_WRITE"' '"runtime_mode":"READ_WRITE"' '"runtime_mode_source":"runtime_secret"' '"counter_reliability":"backend_incomplete"' 'NOOK_SCCACHE_PUBLICATION_PENDING_VERIFICATION' 'NOOK_SCCACHE_HEALTH_WARNING'; do
  grep -Fq -- "$required" "$sccache_publication_contract"
done
grep -Fq -- 'SCCACHE_S3_RW_MODE=READ_WRITE FAKE_SCCACHE_RESULT=success' "$sccache_fallback_contract"
grep -Fq -- 'effective sccache mode: READ_WRITE' "$sccache_fallback_contract"
for required in cache_hits cache_misses cache_write_errors cache_writes counter_reliability publication_status NOOK_SCCACHE_PUBLICATION_PENDING_VERIFICATION NOOK_SCCACHE_HEALTH_WARNING; do grep -Fq -- "$required" "$sccache_report"; done
for required in 'SCCACHE_ERROR_LOG=/tmp/inherited-sccache-error.log' 'test -z "${SCCACHE_ERROR_LOG:-}"' 'SCCACHE_S3_RW_MODE=READ_WRITE FAKE_SCCACHE_RESULT=transport' 'product compilation remained available' 'test "$compiler_status" -eq 7' 'two compiler invocations performed one startup probe'; do
  grep -Fq -- "$required" "$sccache_fallback_contract"
done
for required in 'Client-side cold publication: zero errors plus zero writes is pending verification' 'status=publication_pending_verification' 'inherited SCCACHE_ERROR_LOG disables unsanitized client-side completion' 'compile publication error-log conflict: cache_errors=0 cache_misses=1 cache_writes=0 status=failed' 'bake-sim-sccache-error-log-sanitized' 'NOOK_SCCACHE_AUTHORITY baked_runtime_mode=READ_WRITE runtime_mode=READ_WRITE runtime_mode_source=runtime_secret' 'Target-specific authority: a sibling without its secret fails distinctly' 'dependency-cache sibling status=failed reason=missing-runtime-authority' 'Cold normal publish: no seed prerequisite, sccache READ_WRITE' 'compile_targets=(compile-dependency-cache compile-warm)' 'Next unseeded head: dependency reuse plus cross-commit sccache hits' 'Repeated next-head zero hits: publication verification fails' 'next_head_zero_hits' 'bake-sim-sccache-hit' 'No-BuildKit-export replay: exact reuse with trusted sccache access' 'sccache_mode=READ_WRITE registry_exports=0' 'elapsed=${compile_elapsed}s limit=300s'; do
  grep -Fq -- "$required" "$proof"
done
cache_telemetry="$workflows_dir/lib/cache-telemetry.mjs"
pr_cache_health="$workflows_dir/lib/pr-cache-health.mjs"
if grep -Fq -- 'unexpected_read_only_sccache_writes' "$pr_cache_health"; then
  echo 'BuildKit no-export state incorrectly disables trusted sccache writes' >&2
  exit 1
fi
for required in 'baked_runtime_mode' 'runtime_mode_source' 'counter_reliability' 'publication_status' 'cache_write_errors' 'inconsistent sccache ${field}' 'sccache authority: baked=' 'sccache counters:' 'sccache publication:' 'GHA_CACHE_EXACT_PROBE_FAILURE_CLASS' 'failure_class'; do
  grep -Fq -- "$required" "$cache_telemetry"
done
echo 'remote build:compile cache contract passed'
