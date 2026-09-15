#!/usr/bin/env bash
set -euo pipefail

pr_number="${NOOK_CACHE_PR_NUMBER:-}"
event_name="${NOOK_CACHE_EVENT_NAME:-}"
git_ref="${NOOK_CACHE_GIT_REF:-}"
cache_selection="${NOOK_CACHE_SELECTION:-}"
case "$cache_selection" in
  general|native|wasm|wasm-proof|compile|preflight|web-e2e|web-research-deps|web-research-image|connection-only|ecosystem-dylint|ecosystem-fuzz|ecosystem-policy-tools|ecosystem-deterministic|ecosystem-kani|ecosystem-smoke) ;;
  *)
    echo "cache-selection is outside the closed consumer profile set (got: ${cache_selection:-empty})" >&2
    exit 1
    ;;
esac
test -n "$NOOK_SELECTED_BUILDER"
echo "NOOK_PR_BUILDX_BUILDER=$NOOK_SELECTED_BUILDER" >> "$GITHUB_ENV"
registry_username="$NOOK_REGISTRY_USERNAME"
registry_password="$NOOK_REGISTRY_PASSWORD"
if { [ -n "$registry_username" ] && [ -z "$registry_password" ]; } \
  || { [ -z "$registry_username" ] && [ -n "$registry_password" ]; }; then
  echo "Registry username and password must either both be present or both be absent" >&2
  exit 1
fi
if [ -z "$registry_username" ]; then
  echo "Private registry credentials are unavailable; using local cold BuildKit without Zot login, pull, probe, import, or export"
  echo "GHA_CACHE_ENABLED=" >> "$GITHUB_ENV"
  echo "GHA_CACHE_WRITE_ENABLED=" >> "$GITHUB_ENV"
  echo "GHA_CACHE_SCOPE_SUFFIX=" >> "$GITHUB_ENV"
  echo "GHA_CACHE_RESTORE_SCOPE_SUFFIX=" >> "$GITHUB_ENV"
  echo "GHA_CACHE_FALLBACK_ENABLED=" >> "$GITHUB_ENV"
  echo "GHA_CACHE_EXACT_PROBES_COMPLETE=" >> "$GITHUB_ENV"
  echo "NOOK_REGISTRY_CACHE_HOST=" >> "$GITHUB_ENV"
  exit 0
fi
echo "GHA_CACHE_ENABLED=1" >> "$GITHUB_ENV"
echo "NOOK_REGISTRY_CACHE_HOST=${NOOK_CACHE_REGISTRY_HOST:-}" >> "$GITHUB_ENV"

read_only=""
if [ "$event_name" != "push" ] || [ "$git_ref" != "refs/heads/main" ]; then
  read_only=1
  if [[ "$pr_number" =~ ^[0-9]+$ ]] && [ "${NOOK_CACHE_WRITE_REQUESTED:-}" != "false" ]; then
    echo "::warning::Pull-request jobs are forced to restore Main's cache read-only"
  fi
fi
isolated_cache_write="${NOOK_CACHE_ISOLATED_WRITE:-}"
isolated_scope_requested="$isolated_cache_write"
publish_compile_cache="${NOOK_CACHE_PUBLISH_COMPILE:-}"
case "$publish_compile_cache" in
  true|false) ;;
  *)
    echo "publish-compile-cache must be true or false (got: ${publish_compile_cache:-empty})" >&2
    exit 1
    ;;
esac
remote_compile_cache_write=""
remote_compile_scope=""
if [ "$event_name" = "workflow_dispatch" ] \
  && [ "$NOOK_REMOTE_TASK_SELECTION" = "build:compile" ]; then
  remote_compile_scope=1
  # Feature source output is exact-head scoped. Dependencies use their
  # content fingerprint below.
  if [ "$NOOK_REMOTE_TASK_SELECTION" = "build:compile" ] \
    && [ "$publish_compile_cache" = "true" ]; then
    remote_compile_cache_write=1
    echo "build:compile publication mode enables exact-head cache export"
  else
    echo "build:compile read-only verification imports caches without registry export"
  fi
elif [ "$publish_compile_cache" != "true" ]; then
  echo "publish-compile-cache=false requires the remote build:compile task" >&2
  exit 1
fi
if [ "$publish_compile_cache" = "true" ]; then
  echo "NOOK_COMPILE_CACHE_MODE=publish" >> "$GITHUB_ENV"
else
  echo "NOOK_COMPILE_CACHE_MODE=read-only" >> "$GITHUB_ENV"
fi
if [ "$isolated_cache_write" = "true" ] \
  || { [ "$isolated_scope_requested" = "true" ] \
    && { [ "$cache_selection" = "web-research-deps" ] \
      || [ "$cache_selection" = "web-research-image" ]; }; } \
  || [ -n "$remote_compile_scope" ]; then
  if [ "${NOOK_CACHE_MAIN_ONLY:-}" != "true" ] \
    || [ "${NOOK_CACHE_WRITE_REQUESTED:-}" != "false" ]; then
    echo "isolated-cache-write requires main-cache-only=true and cache-write=false" >&2
    exit 1
  fi
  case "$event_name" in
    workflow_dispatch)
      case "$git_ref" in
        refs/heads/*) ;;
        *)
          echo "isolated-cache-write requires a repository branch ref" >&2
          exit 1
          ;;
      esac
      ;;
    pull_request)
      if [[ ! "$pr_number" =~ ^[0-9]+$ ]]; then
        echo "isolated-cache-write on pull_request requires a PR number" >&2
        exit 1
      fi
      ;;
    *)
      echo "isolated-cache-write requires workflow_dispatch or pull_request" >&2
      exit 1
      ;;
  esac
elif [ "${NOOK_CACHE_MAIN_ONLY:-}" = "true" ]; then
  if [ "${NOOK_CACHE_WRITE_REQUESTED:-}" != "false" ]; then
    echo "main-cache-only requires cache-write=false" >&2
    exit 1
  fi
  read_only=1
fi

scope_suffix=""
fallback_enabled=""
# Every feature publication is immutable. A bounded first-parent search
# chooses a prior cache for restore without allowing concurrent heads
# to replace each other's tags.
if [ "$isolated_scope_requested" = "true" ] || [ -n "$remote_compile_scope" ]; then
  fallback_enabled=1
  scope_sha="$(git rev-parse HEAD)"
  if [[ ! "$scope_sha" =~ ^[0-9a-f]{40}$ ]]; then
    echo "isolated-cache-write requires a 40-char lowercase git SHA (got: ${scope_sha:-empty})" >&2
    exit 1
  fi
  scope_suffix="-git-$scope_sha"
  if [ "$isolated_cache_write" = "true" ]; then
    echo "Isolated cache writes use $scope_suffix with trusted Main fallback"
  else
    echo "Exact source cache restore uses $scope_suffix without registry export"
  fi
fi
echo "GHA_CACHE_SCOPE_SUFFIX=$scope_suffix" >> "$GITHUB_ENV"
echo "GHA_CACHE_RESTORE_SCOPE_SUFFIX=$scope_suffix" >> "$GITHUB_ENV"
echo "GHA_CACHE_FALLBACK_ENABLED=$fallback_enabled" >> "$GITHUB_ENV"

# cache-from entries are merged, not ordered. Importing exact and Main
# together can select Main's parent and orphan an exact source leaf.
# Probe each full-graph ref and use Main only while that exact ref is absent.
registry_host="${NOOK_CACHE_REGISTRY_HOST:-}"
exact_repository="nook/buildcache"
if [ -n "$scope_suffix" ]; then
  exact_repository="nook/remote-buildcache"
fi
cache_probe_failure_class=none
registry_cache_disabled=""
disable_registry_cache() {
  registry_cache_disabled=1
  cache_probe_failure_class=transient_unavailable
  echo "GHA_CACHE_ENABLED=" >> "$GITHUB_ENV"
  echo "GHA_CACHE_WRITE_ENABLED=" >> "$GITHUB_ENV"
  echo "GHA_CACHE_FALLBACK_ENABLED=" >> "$GITHUB_ENV"
  echo "NOOK_REGISTRY_CACHE_HOST=" >> "$GITHUB_ENV"
}
cache_ref_status() {
  local ref="$1"
  local request_timeout_seconds="${2:-4}"
  local probe_output
  local probe_status=0
  local failure_class
  probe_output="$(mktemp)"
  # Cache discovery is optional acceleration and must never consume an
  # unbounded share of a validation job.
  timeout --kill-after=1s "${request_timeout_seconds}s" docker buildx imagetools inspect "$ref" >/dev/null 2>"$probe_output" || probe_status=$?
  failure_class="$(bash "${NOOK_CACHE_ACTION_PATH:?NOOK_CACHE_ACTION_PATH is required}/../../scripts/classify-registry-cache-probe.sh" "$probe_status" "$probe_output")"
  case "$failure_class" in
  available)
    rm -f "$probe_output"
    return 0
    ;;
  absent)
    rm -f "$probe_output"
    return 1
    ;;
  transient_unavailable)
    echo "Registry cache probe was transiently unavailable: $ref" >&2
    cat "$probe_output" >&2
    rm -f "$probe_output"
    return 2
    ;;
  fatal)
    echo "Registry cache probe failed with a fatal authentication, permission, reference, or unclassified error: $ref" >&2
    cat "$probe_output" >&2
    rm -f "$probe_output"
    return 3
    ;;
  *)
    echo "Registry cache probe classifier returned an invalid class: $failure_class" >&2
    rm -f "$probe_output"
    return 3
    ;;
  esac
}
publish_exact_availability() {
  local env_name="$1"
  local scope="$2"
  local ref="$registry_host/$exact_repository/$scope:buildcache"
  local available=""
  local probe_status=0
  if [ -n "$registry_cache_disabled" ]; then
    echo "$env_name=" >> "$GITHUB_ENV"
    return 0
  fi
  if [ -n "${cache_probe_status_by_ref[$ref]+set}" ]; then
    probe_status="${cache_probe_status_by_ref[$ref]}"
  else
    cache_ref_status "$ref" || probe_status=$?
  fi
  case "$probe_status" in
    0)
      available=1
      echo "Exact cache available: $scope"
      ;;
    1)
      echo "Exact cache absent; Main/fingerprint fallback enabled: $scope"
      ;;
    2)
      cache_probe_failure_class=transient_unavailable
      echo "::warning title=Optional cache probe unavailable::NOOK_CACHE_PROBE_WARNING {\"cache\":\"$scope\",\"failure_class\":\"transient_unavailable\",\"action\":\"continue_cold\"}"
      ;;
    *) return "$probe_status" ;;
  esac
  echo "$env_name=$available" >> "$GITHUB_ENV"
  last_exact_available="$available"
}
publish_main_availability() {
  local env_name="$1"
  local scope="$2"
  local ref="$registry_host/nook/buildcache/$scope:buildcache"
  local available=""
  local probe_status=0
  if [ -n "$registry_cache_disabled" ]; then
    echo "$env_name=" >> "$GITHUB_ENV"
    return 0
  fi
  cache_ref_status "$ref" || probe_status=$?
  case "$probe_status" in
    0)
      available=1
      echo "Main cache available: $scope"
      ;;
    1)
      echo "Main cache absent; source-free dependency fallback enabled: $scope"
      ;;
    2)
      cache_probe_failure_class=transient_unavailable
      echo "::warning title=Optional cache probe unavailable::NOOK_CACHE_PROBE_WARNING {\"cache\":\"$scope\",\"failure_class\":\"transient_unavailable\",\"action\":\"continue_cold\"}"
      ;;
    *) return "$probe_status" ;;
  esac
  echo "$env_name=$available" >> "$GITHUB_ENV"
}

restore_scope_suffix="$scope_suffix"
restore_ancestor_sha=""
GHA_CACHE_RESTORE_RUST_BASE_SCOPE_SUFFIX="$scope_suffix"
GHA_CACHE_RESTORE_RUST_DEPS_SCOPE_SUFFIX="$scope_suffix"
GHA_CACHE_RESTORE_RUST_NATIVE_SCOPE_SUFFIX="$scope_suffix"
GHA_CACHE_RESTORE_RUST_WASM_DEPS_SCOPE_SUFFIX="$scope_suffix"
GHA_CACHE_RESTORE_RUST_WASM_SCOPE_SUFFIX="$scope_suffix"
GHA_CACHE_RESTORE_RUST_DYLINT_SCOPE_SUFFIX="$scope_suffix"
GHA_CACHE_RESTORE_RUST_FUZZ_SCOPE_SUFFIX="$scope_suffix"
GHA_CACHE_RESTORE_RUST_POLICY_TOOLS_SCOPE_SUFFIX="$scope_suffix"
GHA_CACHE_RESTORE_RUST_DETERMINISTIC_SCOPE_SUFFIX="$scope_suffix"
GHA_CACHE_RESTORE_RUST_KANI_SCOPE_SUFFIX="$scope_suffix"
GHA_CACHE_RESTORE_PREFLIGHT_SCOPE_SUFFIX="$scope_suffix"
GHA_CACHE_RESTORE_WEB_E2E_SCOPE_SUFFIX="$scope_suffix"
GHA_CACHE_RESTORE_WEB_SCOPE_SUFFIX="$scope_suffix"
GHA_CACHE_RESTORE_WEB_DEPS_SCOPE_SUFFIX="$scope_suffix"
GHA_CACHE_RESTORE_WEB_APP_DEPS_SCOPE_SUFFIX="$scope_suffix"
GHA_CACHE_RESTORE_WEB_RESEARCH_DEPS_SCOPE_SUFFIX="$scope_suffix"
declare -A restore_suffix_by_env=()
declare -A restore_sha_by_env=()
declare -A transient_restore_probe_by_env=()
declare -A cache_probe_status_by_ref=()
if [ -n "$scope_suffix" ] \
  && [ "$cache_selection" != "compile" ] \
  && [ "$cache_selection" != "connection-only" ] \
  && [ "$cache_selection" != "wasm-proof" ]; then
  restore_lineages=()
  case "$cache_selection" in
    # Each producer guarantees only its own immutable lineage. Select
    # the nearest available suffix independently so an arbitrary task
    # head cannot make unrelated caches unreachable.
    general) restore_lineages=(
      "GHA_CACHE_RESTORE_RUST_BASE_SCOPE_SUFFIX|nook-rust-base-v2"
      "GHA_CACHE_RESTORE_RUST_DEPS_SCOPE_SUFFIX|nook-rust-deps-v4"
      "GHA_CACHE_RESTORE_RUST_NATIVE_SCOPE_SUFFIX|nook-rust-native-source-v4"
      "GHA_CACHE_RESTORE_RUST_WASM_DEPS_SCOPE_SUFFIX|nook-rust-wasm-deps-v6"
      "GHA_CACHE_RESTORE_RUST_WASM_SCOPE_SUFFIX|nook-rust-wasm-source-v3"
      "GHA_CACHE_RESTORE_RUST_DYLINT_SCOPE_SUFFIX|nook-rust-ecosystem-dylint-v4"
      "GHA_CACHE_RESTORE_RUST_FUZZ_SCOPE_SUFFIX|nook-rust-ecosystem-fuzz-v4"
      "GHA_CACHE_RESTORE_RUST_POLICY_TOOLS_SCOPE_SUFFIX|nook-rust-ecosystem-policy-tools-v5"
      "GHA_CACHE_RESTORE_RUST_DETERMINISTIC_SCOPE_SUFFIX|nook-rust-ecosystem-deterministic-v2"
      "GHA_CACHE_RESTORE_RUST_KANI_SCOPE_SUFFIX|nook-rust-ecosystem-kani-v2"
      "GHA_CACHE_RESTORE_PREFLIGHT_SCOPE_SUFFIX|nook-preflight-v1"
      "GHA_CACHE_RESTORE_WEB_E2E_SCOPE_SUFFIX|nook-web-e2e-v1"
      "GHA_CACHE_RESTORE_WEB_SCOPE_SUFFIX|nook-web-v1"
      "GHA_CACHE_RESTORE_WEB_DEPS_SCOPE_SUFFIX|nook-web-deps-v1"
      "GHA_CACHE_RESTORE_WEB_APP_DEPS_SCOPE_SUFFIX|nook-web-app-deps-v1"
      "GHA_CACHE_RESTORE_WEB_RESEARCH_DEPS_SCOPE_SUFFIX|nook-web-research-deps-v1"
    ) ;;
    native) restore_lineages=(
      "GHA_CACHE_RESTORE_RUST_BASE_SCOPE_SUFFIX|nook-rust-base-v2"
      "GHA_CACHE_RESTORE_RUST_DEPS_SCOPE_SUFFIX|nook-rust-deps-v4"
      "GHA_CACHE_RESTORE_RUST_NATIVE_SCOPE_SUFFIX|nook-rust-native-source-v4"
    ) ;;
    wasm) restore_lineages=(
      "GHA_CACHE_RESTORE_RUST_BASE_SCOPE_SUFFIX|nook-rust-base-v2"
      "GHA_CACHE_RESTORE_RUST_WASM_DEPS_SCOPE_SUFFIX|nook-rust-wasm-deps-v6"
      "GHA_CACHE_RESTORE_RUST_WASM_SCOPE_SUFFIX|nook-rust-wasm-source-v3"
    ) ;;
    preflight) restore_lineages=("GHA_CACHE_RESTORE_PREFLIGHT_SCOPE_SUFFIX|nook-preflight-v1") ;;
    web-e2e|web-research-image) restore_lineages=(
      "GHA_CACHE_RESTORE_WEB_E2E_SCOPE_SUFFIX|nook-web-e2e-v1"
      "GHA_CACHE_RESTORE_WEB_SCOPE_SUFFIX|nook-web-v1"
      "GHA_CACHE_RESTORE_WEB_DEPS_SCOPE_SUFFIX|nook-web-deps-v1"
      "GHA_CACHE_RESTORE_WEB_APP_DEPS_SCOPE_SUFFIX|nook-web-app-deps-v1"
      "GHA_CACHE_RESTORE_WEB_RESEARCH_DEPS_SCOPE_SUFFIX|nook-web-research-deps-v1"
    ) ;;
    web-research-deps) restore_lineages=("GHA_CACHE_RESTORE_WEB_RESEARCH_DEPS_SCOPE_SUFFIX|nook-web-research-deps-v1") ;;
    ecosystem-dylint) restore_lineages=("GHA_CACHE_RESTORE_RUST_DYLINT_SCOPE_SUFFIX|nook-rust-ecosystem-dylint-v4") ;;
    ecosystem-fuzz) restore_lineages=("GHA_CACHE_RESTORE_RUST_FUZZ_SCOPE_SUFFIX|nook-rust-ecosystem-fuzz-v4") ;;
    ecosystem-policy-tools) restore_lineages=("GHA_CACHE_RESTORE_RUST_POLICY_TOOLS_SCOPE_SUFFIX|nook-rust-ecosystem-policy-tools-v5") ;;
    ecosystem-deterministic) restore_lineages=("GHA_CACHE_RESTORE_RUST_DETERMINISTIC_SCOPE_SUFFIX|nook-rust-ecosystem-deterministic-v2") ;;
    ecosystem-kani) restore_lineages=("GHA_CACHE_RESTORE_RUST_KANI_SCOPE_SUFFIX|nook-rust-ecosystem-kani-v2") ;;
    ecosystem-smoke) restore_lineages=(
      "GHA_CACHE_RESTORE_RUST_ECOSYSTEM_SMOKE_SCOPE_SUFFIX|nook-rust-ecosystem-smoke-v1"
    ) ;;
  esac

  ancestor_probe_limit=8
  restore_probe_dir="$(mktemp -d)"
  mapfile -t restore_ancestors < <(git rev-list --first-parent --max-count="$ancestor_probe_limit" HEAD^)
  restore_candidate_suffixes=("$scope_suffix")
  restore_candidate_shas=("$(git rev-parse HEAD)")
  for ancestor_sha in "${restore_ancestors[@]}"; do
    restore_candidate_suffixes+=("-git-$ancestor_sha")
    restore_candidate_shas+=("$ancestor_sha")
  done
  probe_index=0
  probe_request_timeout_seconds=12
  probe_lineage_timeout_seconds=45
  for lineage_spec in "${restore_lineages[@]}"; do
    IFS='|' read -r restore_env restore_anchor <<< "$lineage_spec"
    probe_file="$restore_probe_dir/$probe_index"
    (
      lineage_deadline=$((SECONDS + probe_lineage_timeout_seconds))
      : > "$probe_file"
      for candidate_index in "${!restore_candidate_suffixes[@]}"; do
        remaining_seconds=$((lineage_deadline - SECONDS))
        if (( remaining_seconds <= 0 )); then
          printf '%s|%s|%s\n' '-1' '2' 'lineage_deadline' >> "$probe_file"
          break
        fi
        request_timeout_seconds="$probe_request_timeout_seconds"
        if (( remaining_seconds < request_timeout_seconds )); then
          request_timeout_seconds="$remaining_seconds"
        fi
        candidate_suffix="${restore_candidate_suffixes[$candidate_index]}"
        cache_ref="$registry_host/$exact_repository/$restore_anchor$candidate_suffix:buildcache"
        candidate_status=0
        cache_ref_status "$cache_ref" "$request_timeout_seconds" || candidate_status=$?
        printf '%s|%s|%s\n' "$candidate_index" "$candidate_status" "$cache_ref" >> "$probe_file"
        case "$candidate_status" in
          # A transient result leaves every farther candidate uncertain. Stop
          # this lineage and use its safe Main fallback rather than claiming a
          # farther hit is the nearest immutable cache.
          0|2|3) break ;;
        esac
      done
    ) &
    printf '%s|%s|%s\n' "$probe_index" "$restore_env" "$restore_anchor" >> "$restore_probe_dir/index"
    probe_index=$((probe_index + 1))
  done
  wait || true

  while IFS='|' read -r index restore_env restore_anchor; do
    while IFS='|' read -r candidate_index candidate_status cache_ref; do
      if [ "$candidate_index" != "-1" ]; then
        cache_probe_status_by_ref["$cache_ref"]="$candidate_status"
      fi
      case "$candidate_status" in
        0)
          restore_suffix_by_env["$restore_env"]="${restore_candidate_suffixes[$candidate_index]}"
          restore_sha_by_env["$restore_env"]="${restore_candidate_shas[$candidate_index]}"
          echo "Nearest immutable $restore_anchor cache: ${restore_candidate_shas[$candidate_index]}"
          ;;
        1) ;;
        2) transient_restore_probe_by_env["$restore_env"]=1 ;;
        *) rm -rf "$restore_probe_dir"; exit "$candidate_status" ;;
      esac
    done < "$restore_probe_dir/$index"
  done < "$restore_probe_dir/index"
  rm -rf "$restore_probe_dir"

  for lineage_spec in "${restore_lineages[@]}"; do
    IFS='|' read -r restore_env restore_anchor <<< "$lineage_spec"
    if [ -n "${restore_suffix_by_env[$restore_env]+set}" ]; then
      selected_suffix="${restore_suffix_by_env[$restore_env]:-$scope_suffix}"
    elif [ -n "${transient_restore_probe_by_env[$restore_env]+set}" ]; then
      selected_suffix=""
      cache_probe_failure_class=transient_unavailable
      echo "::warning title=Optional lineage probe unavailable::NOOK_CACHE_PROBE_WARNING {\"cache\":\"$restore_anchor\",\"failure_class\":\"transient_unavailable\",\"action\":\"lineage_main_fallback\"}"
    else
      selected_suffix="$scope_suffix"
    fi
    printf -v "$restore_env" '%s' "$selected_suffix"
    echo "$restore_env=$selected_suffix" >> "$GITHUB_ENV"
  done
  echo "Immutable lineage probes complete: lineages=${#restore_lineages[@]} candidates=${#restore_candidate_suffixes[@]} request_timeout_seconds=$probe_request_timeout_seconds lineage_timeout_seconds=$probe_lineage_timeout_seconds concurrent_lineages=true"

  source_restore_env=""
  case "$cache_selection" in
    native) source_restore_env=GHA_CACHE_RESTORE_RUST_NATIVE_SCOPE_SUFFIX ;;
    wasm) source_restore_env=GHA_CACHE_RESTORE_RUST_WASM_SCOPE_SUFFIX ;;
  esac
  if [ -n "$source_restore_env" ] && [ -n "${restore_sha_by_env[$source_restore_env]:-}" ]; then
      restore_ancestor_sha="${restore_sha_by_env[$source_restore_env]}"
      if [ "$restore_ancestor_sha" != "$(git rev-parse HEAD)" ]; then
      current_compiler_input="$(git rev-parse HEAD:nook-app/nook-platform)"
      restore_compiler_input="$(git rev-parse "$restore_ancestor_sha:nook-app/nook-platform")"
      echo "NOOK_COMPILER_INPUT_FINGERPRINT=$current_compiler_input" >> "$GITHUB_ENV"
      echo "NOOK_RESTORE_COMPILER_INPUT_FINGERPRINT=$restore_compiler_input" >> "$GITHUB_ENV"
      fi
  fi
fi

case "$cache_selection" in
  general|native|wasm|wasm-proof|compile)
  # Preserve the shared Rust dependency identity for its existing
  # consumers. build:compile uses immutable exact-head and ancestor
  # source scopes below; sccache owns cross-head compiler objects.
  rust_deps_fingerprint="$(
    NOOK_RUST_DEPS_FINGERPRINT_ROOT="$GITHUB_WORKSPACE" \
      bash "${NOOK_CACHE_ACTION_PATH:?NOOK_CACHE_ACTION_PATH is required}/../../scripts/rust-deps-cache-fingerprint.sh"
  )"
  if [[ ! "$rust_deps_fingerprint" =~ ^[0-9a-f]{40}$ ]]; then
    echo "Could not fingerprint the hosted Rust dependency graph" >&2
    exit 1
  fi
  echo "NOOK_RUST_DEPS_INPUT_FINGERPRINT=$rust_deps_fingerprint" >> "$GITHUB_ENV"
  echo "GHA_RUST_WASM_DEPS_SCOPE=nook-rust-wasm-deps-v6-$rust_deps_fingerprint" >> "$GITHUB_ENV"
  ;;
esac

if [ "$cache_selection" = "compile" ]; then
  if [ "$NOOK_REMOTE_TASK_SELECTION" != "build:compile" ]; then
    echo "compile cache selection requires the build:compile selector" >&2
    exit 1
  fi
  compile_probe_failure_class=none
  compile_exact_available=""
  compile_probe_status=0
  cache_ref_status "$registry_host/$exact_repository/nook-build-compile-v4$scope_suffix:buildcache" || compile_probe_status=$?
  case "$compile_probe_status" in
    0)
      compile_exact_available=1
      echo "GHA_CACHE_EXACT_BUILD_COMPILE_AVAILABLE=1" >> "$GITHUB_ENV"
      ;;
    1) echo "GHA_CACHE_EXACT_BUILD_COMPILE_AVAILABLE=" >> "$GITHUB_ENV" ;;
    2)
      echo "GHA_CACHE_EXACT_BUILD_COMPILE_AVAILABLE=" >> "$GITHUB_ENV"
      compile_probe_failure_class=transient_unavailable
      disable_registry_cache
      echo '::warning title=Optional compile cache probe unavailable::NOOK_CACHE_PROBE_WARNING {"cache":"exact_source","failure_class":"transient_unavailable","action":"continue_cold"}'
      ;;
    *) exit "$compile_probe_status" ;;
  esac
  compile_restore_scope_suffix=""
  if [ -n "$compile_exact_available" ]; then
    compile_restore_scope_suffix="$scope_suffix"
  elif [ "$compile_probe_failure_class" = "none" ]; then
    # Exact refs are immutable proof artifacts. Probe a small first-
    # parent window in parallel and import only the nearest successful
    # full graph, so a new commit can reuse unchanged source vertices
    # without a mutable shared tag or preparatory seed job.
    ancestor_probe_limit=8
    ancestor_probe_dir="$(mktemp -d)"
    mapfile -t compile_ancestors < <(git rev-list --first-parent --max-count="$ancestor_probe_limit" HEAD^)
    for ancestor_sha in "${compile_ancestors[@]}"; do
      (
        ancestor_status=0
        cache_ref_status "$registry_host/$exact_repository/nook-build-compile-v4-git-$ancestor_sha:buildcache" || ancestor_status=$?
        printf '%s\n' "$ancestor_status" > "$ancestor_probe_dir/$ancestor_sha"
      ) &
    done
    wait || true
    for ancestor_sha in "${compile_ancestors[@]}"; do
      ancestor_status="$(cat "$ancestor_probe_dir/$ancestor_sha")"
      if [ "$ancestor_status" -eq 3 ]; then
        rm -rf "$ancestor_probe_dir"
        exit 3
      fi
      if [ "$ancestor_status" -eq 2 ]; then
        compile_probe_failure_class=transient_unavailable
        disable_registry_cache
      fi
    done
    for ancestor_sha in "${compile_ancestors[@]}"; do
      ancestor_status="$(cat "$ancestor_probe_dir/$ancestor_sha")"
      case "$ancestor_status" in
        0)
          compile_restore_scope_suffix="-git-$ancestor_sha"
          echo "Nearest ancestor compile cache available: $ancestor_sha"
          break
          ;;
        1|2) ;;
        *) rm -rf "$ancestor_probe_dir"; exit "$ancestor_status" ;;
      esac
    done
    rm -rf "$ancestor_probe_dir"
  fi
  echo "GHA_BUILD_COMPILE_RESTORE_SCOPE_SUFFIX=$compile_restore_scope_suffix" >> "$GITHUB_ENV"
  echo "GHA_CACHE_RESTORE_SCOPE_SUFFIX=$compile_restore_scope_suffix" >> "$GITHUB_ENV"
  echo "GHA_CACHE_EXACT_PROBE_FAILURE_CLASS=$compile_probe_failure_class" >> "$GITHUB_ENV"
  echo "Compile cache probes complete: exact=1 ancestor_limit=8 timeout_seconds=6"
fi

if [ "$cache_selection" = "general" ] || [ "$cache_selection" = "native" ]; then
  # Native consumes exact dependency scopes and the complete native source graph.
  # Main source also owns fresh dependency-only restores after publication.
  publish_exact_availability GHA_CACHE_EXACT_RUST_BASE_AVAILABLE "nook-rust-base-v2$GHA_CACHE_RESTORE_RUST_BASE_SCOPE_SUFFIX"
  if [ -n "$scope_suffix" ]; then
    publish_exact_availability GHA_CACHE_EXACT_RUST_DEPS_AVAILABLE "nook-rust-deps-v4$GHA_CACHE_RESTORE_RUST_DEPS_SCOPE_SUFFIX"
    publish_exact_availability GHA_CACHE_EXACT_RUST_NATIVE_SOURCE_AVAILABLE "nook-rust-native-source-v4$GHA_CACHE_RESTORE_RUST_NATIVE_SCOPE_SUFFIX"
  fi
  publish_main_availability GHA_CACHE_MAIN_RUST_NATIVE_SOURCE_AVAILABLE "nook-rust-native-source-v4"
fi

if [ "$cache_selection" = "general" ] || [ "$cache_selection" = "wasm" ]; then
  # WASM consumes the base, fingerprinted dependency, and complete WASM source scopes.
  wasm_deps_exact_scope="nook-rust-wasm-deps-v6-$rust_deps_fingerprint"
  if [ -n "$scope_suffix" ]; then
    wasm_deps_exact_scope="nook-rust-wasm-deps-v6$GHA_CACHE_RESTORE_RUST_WASM_DEPS_SCOPE_SUFFIX"
  fi
  if [ "$cache_selection" != "general" ]; then
    publish_exact_availability GHA_CACHE_EXACT_RUST_BASE_AVAILABLE "nook-rust-base-v2$GHA_CACHE_RESTORE_RUST_BASE_SCOPE_SUFFIX"
  fi
  publish_exact_availability GHA_CACHE_EXACT_RUST_WASM_DEPS_AVAILABLE "$wasm_deps_exact_scope"
  publish_exact_availability GHA_CACHE_EXACT_RUST_WASM_SOURCE_AVAILABLE "nook-rust-wasm-source-v3$GHA_CACHE_RESTORE_RUST_WASM_SCOPE_SUFFIX"
  if [ -n "$scope_suffix" ]; then
    publish_main_availability GHA_CACHE_MAIN_RUST_WASM_SOURCE_AVAILABLE "nook-rust-wasm-source-v3"
  fi
fi

if [ "$cache_selection" = "general" ] || [ "$cache_selection" = "ecosystem-dylint" ]; then
  publish_exact_availability GHA_CACHE_EXACT_RUST_DYLINT_AVAILABLE "nook-rust-ecosystem-dylint-v4$GHA_CACHE_RESTORE_RUST_DYLINT_SCOPE_SUFFIX"
fi
if [ "$cache_selection" = "general" ] || [ "$cache_selection" = "ecosystem-fuzz" ]; then
  publish_exact_availability GHA_CACHE_EXACT_RUST_FUZZ_AVAILABLE "nook-rust-ecosystem-fuzz-v4$GHA_CACHE_RESTORE_RUST_FUZZ_SCOPE_SUFFIX"
fi
if [ "$cache_selection" = "general" ] || [ "$cache_selection" = "ecosystem-policy-tools" ]; then
  publish_exact_availability GHA_CACHE_EXACT_RUST_POLICY_TOOLS_AVAILABLE "nook-rust-ecosystem-policy-tools-v5$GHA_CACHE_RESTORE_RUST_POLICY_TOOLS_SCOPE_SUFFIX"
fi
if [ "$cache_selection" = "general" ] || [ "$cache_selection" = "ecosystem-deterministic" ]; then
  publish_exact_availability GHA_CACHE_EXACT_RUST_DETERMINISTIC_AVAILABLE "nook-rust-ecosystem-deterministic-v2$GHA_CACHE_RESTORE_RUST_DETERMINISTIC_SCOPE_SUFFIX"
fi
if [ "$cache_selection" = "general" ] || [ "$cache_selection" = "ecosystem-kani" ]; then
  publish_exact_availability GHA_CACHE_EXACT_RUST_KANI_AVAILABLE "nook-rust-ecosystem-kani-v2$GHA_CACHE_RESTORE_RUST_KANI_SCOPE_SUFFIX"
fi
if [ "$cache_selection" = "general" ] || [ "$cache_selection" = "preflight" ]; then
  publish_exact_availability GHA_CACHE_EXACT_PREFLIGHT_AVAILABLE "nook-preflight-v1$GHA_CACHE_RESTORE_PREFLIGHT_SCOPE_SUFFIX"
fi
if [ "$cache_selection" = "general" ] || [ "$cache_selection" = "web-e2e" ] \
  || [ "$cache_selection" = "web-research-image" ]; then
  publish_exact_availability GHA_CACHE_EXACT_WEB_E2E_AVAILABLE "nook-web-e2e-v1$GHA_CACHE_RESTORE_WEB_E2E_SCOPE_SUFFIX"
  # Keep the aggregate dependency graph and its independent lockfile
  # children distinct from the source-bearing browser image. Each
  # importer selects exact-or-Main rather than merging cache versions.
  publish_exact_availability GHA_CACHE_EXACT_WEB_DEPS_AVAILABLE "nook-web-deps-v1$GHA_CACHE_RESTORE_WEB_DEPS_SCOPE_SUFFIX"
  publish_exact_availability GHA_CACHE_EXACT_WEB_APP_DEPS_AVAILABLE "nook-web-app-deps-v1$GHA_CACHE_RESTORE_WEB_APP_DEPS_SCOPE_SUFFIX"
  publish_exact_availability GHA_CACHE_EXACT_WEB_RESEARCH_DEPS_AVAILABLE "nook-web-research-deps-v1$GHA_CACHE_RESTORE_WEB_RESEARCH_DEPS_SCOPE_SUFFIX"
  if [ -n "$scope_suffix" ]; then
    publish_main_availability GHA_CACHE_MAIN_WEB_DEPS_AVAILABLE "nook-web-deps-v1"
    publish_main_availability GHA_CACHE_MAIN_WEB_APP_DEPS_AVAILABLE "nook-web-app-deps-v1"
    publish_main_availability GHA_CACHE_MAIN_WEB_RESEARCH_DEPS_AVAILABLE "nook-web-research-deps-v1"
  fi
fi
if [ "$cache_selection" = "web-research-deps" ]; then
  publish_exact_availability GHA_CACHE_EXACT_WEB_RESEARCH_DEPS_AVAILABLE "nook-web-research-deps-v1$GHA_CACHE_RESTORE_WEB_RESEARCH_DEPS_SCOPE_SUFFIX"
  if [ -n "$scope_suffix" ]; then
    publish_main_availability GHA_CACHE_MAIN_WEB_RESEARCH_DEPS_AVAILABLE "nook-web-research-deps-v1"
  fi
fi
case "$cache_selection" in
  general|native|wasm|compile|preflight|web-e2e|web-research-deps|web-research-image|ecosystem-dylint|ecosystem-fuzz|ecosystem-policy-tools|ecosystem-deterministic|ecosystem-kani|ecosystem-smoke)
  echo "GHA_CACHE_EXACT_PROBES_COMPLETE=1" >> "$GITHUB_ENV"
  if [ "$cache_selection" != "compile" ]; then
    echo "GHA_CACHE_EXACT_PROBE_FAILURE_CLASS=$cache_probe_failure_class" >> "$GITHUB_ENV"
  fi
  ;;
esac

cache_write_enabled=""
if [ -n "$registry_cache_disabled" ]; then
  cache_write_enabled=""
elif [ -n "$remote_compile_cache_write" ]; then
  cache_write_enabled=1
elif [ "$isolated_cache_write" = "true" ]; then
  cache_write_enabled=1
elif [ -z "$read_only" ] && [ "${NOOK_CACHE_WRITE_REQUESTED:-}" = "true" ]; then
  cache_write_enabled=1
fi
# The Delivery-owned read-only compile handoff is an explicit no-op for
# registry publication. Keep this guard next to the generic cache flag
# so a future cache-write path cannot accidentally re-enable export.
if [ "$NOOK_REMOTE_TASK_SELECTION" = "build:compile" ] \
  && [ "$publish_compile_cache" = "false" ]; then
  cache_write_enabled=""
fi
echo "GHA_CACHE_WRITE_ENABLED=$cache_write_enabled" >> "$GITHUB_ENV"
