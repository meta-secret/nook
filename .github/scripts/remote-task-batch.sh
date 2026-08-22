#!/usr/bin/env bash
set -euo pipefail

readonly MAX_REMOTE_TASKS=8

catalog() {
  cat <<'EOF'
preflight
rust:ci
bake-cache:prove
rust:test
rust:lint
rust:coverage
wasm:build
wasm:test
wasm:test:browser
web:check
web:test
web:build
web:e2e
extension:check
extension:e2e
hive:verify
check
ci:pr
ci:pr:e2e
EOF
}

is_catalog_task() {
  catalog | grep -Fxq "$1"
}

normalize_tasks() {
  local raw_tasks="$1"
  local task
  local seen=","
  local normalized=""
  local count=0
  local -a requested_tasks

  if [[ -z "$raw_tasks" || "$raw_tasks" == ,* || "$raw_tasks" == *, || "$raw_tasks" == *,,* ]]; then
    echo "Remote task selection must be a non-empty comma-separated list." >&2
    return 2
  fi
  if [[ "$raw_tasks" =~ [[:space:]] ]]; then
    echo "Remote task selection must not contain whitespace." >&2
    return 2
  fi

  IFS=',' read -r -a requested_tasks <<< "$raw_tasks"
  for task in "${requested_tasks[@]}"; do
    if ! is_catalog_task "$task"; then
      echo "Unknown remote task: $task" >&2
      echo "Run 'task remote:list' to see the allowlisted catalog." >&2
      return 2
    fi
    if [[ "$seen" == *",$task,"* ]]; then
      echo "Duplicate remote task: $task" >&2
      return 2
    fi
    seen+="$task,"
    normalized+="${normalized:+,}$task"
    count=$((count + 1))
  done

  if (( count > MAX_REMOTE_TASKS )); then
    echo "A remote batch may contain at most $MAX_REMOTE_TASKS tasks." >&2
    return 2
  fi

  printf '%s\n' "$normalized"
}

task_command() {
  case "$1" in
    preflight) echo "task preflight" ;;
    rust:ci) echo "task ci:pr:rust" ;;
    bake-cache:prove) echo "task infra:bake-cache:prove" ;;
    rust:test) echo "task remote:rust:test" ;;
    rust:lint) echo "task remote:rust:lint" ;;
    rust:coverage) echo "task remote:rust:coverage" ;;
    wasm:build) echo "task wasm:build" ;;
    wasm:test) echo "task wasm:test" ;;
    wasm:test:browser) echo "task wasm:test:browser" ;;
    web:check) echo "task remote:web:check" ;;
    web:test) echo "task remote:web:test" ;;
    web:build) echo "task web:build" ;;
    web:e2e) echo "task web:test:e2e" ;;
    extension:check) echo "task remote:extension:check" ;;
    extension:e2e) echo "task extension:test:e2e" ;;
    hive:verify) echo "task hive:verify" ;;
    check) echo "task check" ;;
    ci:pr) echo "task ci:pr" ;;
    ci:pr:e2e) echo "task ci:pr:e2e" ;;
    *) return 2 ;;
  esac
}

task_timeout_minutes() {
  case "$1" in
    preflight) echo 15 ;;
    bake-cache:prove|rust:ci|rust:test|rust:lint|wasm:build|wasm:test|web:check|web:test|extension:check|hive:verify) echo 20 ;;
    wasm:test:browser|web:build) echo 25 ;;
    rust:coverage|web:e2e|extension:e2e) echo 30 ;;
    check|ci:pr) echo 35 ;;
    ci:pr:e2e) echo 45 ;;
    *) return 2 ;;
  esac
}

run_with_timeout() {
  local timeout_minutes="$1"
  shift
  timeout --kill-after=1m "${timeout_minutes}m" "$@"
}

restore_hosted_builder() {
  local builder="${NOOK_PR_BUILDX_BUILDER:-}"
  if [[ -n "$builder" ]]; then
    docker buildx use "$builder"
  fi
}

snapshot_daemon_containers() {
  if [[ "${NOOK_BUILDKIT_REMOTE:-}" == "1" ]]; then
    return 0
  fi
  docker ps -aq | sort
}

cleanup_timed_out_daemon_work() {
  local container
  local snapshot="$1"
  local builder="${NOOK_PR_BUILDX_BUILDER:-}"
  local cleanup_status=0

  if [[ "${NOOK_BUILDKIT_REMOTE:-}" == "1" ]]; then
    if [[ -n "$builder" ]]; then
      docker buildx inspect --bootstrap "$builder" >/dev/null || cleanup_status=1
    fi
    return "$cleanup_status"
  fi

  while IFS= read -r container; do
    if [[ -n "$container" ]] && ! grep -Fxq "$container" "$snapshot"; then
      docker rm -f "$container" || cleanup_status=1
    fi
  done < <(docker ps -aq)

  if [[ -n "$builder" ]]; then
    while IFS= read -r container; do
      if [[ -n "$container" ]]; then
        docker restart "$container" || cleanup_status=1
      fi
    done < <(docker ps -q --filter "name=buildx_buildkit_${builder}")
    docker buildx inspect --bootstrap "$builder" >/dev/null || cleanup_status=1
  fi

  return "$cleanup_status"
}

restore_exact_worktree() {
  git restore --source=HEAD --staged --worktree -- .
  git clean -fd
}

run_task() {
  local artifact_root="${E2E_ARTIFACT_DIR:-${TMPDIR:-/tmp}/nook-e2e-artifacts}"
  local timeout_minutes
  timeout_minutes="$(task_timeout_minutes "$1")"

  case "$1" in
    preflight) run_with_timeout "$timeout_minutes" task preflight ;;
    rust:ci) run_with_timeout "$timeout_minutes" env CI_ARTIFACT_DIR="$artifact_root/rust-ci" task ci:pr:rust ;;
    bake-cache:prove) run_with_timeout "$timeout_minutes" task infra:bake-cache:prove ;;
    rust:test) run_with_timeout "$timeout_minutes" task remote:rust:test ;;
    rust:lint) run_with_timeout "$timeout_minutes" task remote:rust:lint ;;
    rust:coverage) run_with_timeout "$timeout_minutes" task remote:rust:coverage ;;
    wasm:build) run_with_timeout "$timeout_minutes" task wasm:build ;;
    wasm:test) run_with_timeout "$timeout_minutes" task wasm:test ;;
    wasm:test:browser) run_with_timeout "$timeout_minutes" task wasm:test:browser ;;
    web:check) run_with_timeout "$timeout_minutes" task remote:web:check ;;
    web:test) run_with_timeout "$timeout_minutes" task remote:web:test ;;
    web:build) run_with_timeout "$timeout_minutes" task web:build ;;
    web:e2e) run_with_timeout "$timeout_minutes" env E2E_ARTIFACT_DIR="$artifact_root/web-e2e" task web:test:e2e ;;
    extension:check) run_with_timeout "$timeout_minutes" task remote:extension:check ;;
    extension:e2e) run_with_timeout "$timeout_minutes" env E2E_ARTIFACT_DIR="$artifact_root/extension-e2e" task extension:test:e2e ;;
    hive:verify) run_with_timeout "$timeout_minutes" env HIVE_CACHE_TO= task hive:verify ;;
    check) run_with_timeout "$timeout_minutes" task check ;;
    ci:pr) run_with_timeout "$timeout_minutes" task ci:pr ;;
    ci:pr:e2e) run_with_timeout "$timeout_minutes" env E2E_ARTIFACT_DIR="$artifact_root/ci-pr-e2e" task ci:pr:e2e ;;
    *) return 2 ;;
  esac
}

requires_current_base() {
  local normalized_tasks="$1"
  local task
  local -a tasks

  IFS=',' read -r -a tasks <<< "$normalized_tasks"
  for task in "${tasks[@]}"; do
    case "$task" in
      web:e2e|extension:e2e|check|ci:pr|ci:pr:e2e) return 0 ;;
    esac
  done
  return 1
}

print_commands() {
  local normalized_tasks="$1"
  local task
  local -a tasks

  IFS=',' read -r -a tasks <<< "$normalized_tasks"
  for task in "${tasks[@]}"; do
    task_command "$task"
  done
}

run_batch() {
  local normalized_tasks="$1"
  local task
  local status
  local failures=0
  local daemon_snapshot
  local timeout_cleanup_status
  local -a tasks

  IFS=',' read -r -a tasks <<< "$normalized_tasks"
  if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
    printf '## Remote task batch\n\n| Task | Result |\n|---|---|\n' >> "$GITHUB_STEP_SUMMARY"
  fi

  for task in "${tasks[@]}"; do
    echo "::group::Remote task: $task"
    daemon_snapshot="$(mktemp)"
    snapshot_daemon_containers > "$daemon_snapshot"
    set +e
    run_task "$task"
    status=$?
    if (( status == 124 || status == 137 )); then
      timeout_cleanup_status=0
      cleanup_timed_out_daemon_work "$daemon_snapshot" || timeout_cleanup_status=1
      restore_exact_worktree || timeout_cleanup_status=1
      if (( timeout_cleanup_status != 0 )); then
        echo "::error::Failed to restore exact runner state after timeout: $task"
        status=1
      fi
    fi
    rm -f "$daemon_snapshot"
    if ! restore_hosted_builder; then
      echo "::error::Failed to restore the hosted Buildx builder after: $task"
      status=1
    fi
    set -e
    echo "::endgroup::"

    if (( status == 0 )); then
      echo "Remote task passed: $task"
      if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
        printf '| `%s` | passed |\n' "$task" >> "$GITHUB_STEP_SUMMARY"
      fi
    else
      echo "::error::Remote task failed: $task (exit $status)"
      if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
        printf '| `%s` | failed (exit %s) |\n' "$task" "$status" >> "$GITHUB_STEP_SUMMARY"
      fi
      failures=$((failures + 1))
    fi
  done

  if (( failures > 0 )); then
    echo "$failures remote task(s) failed." >&2
    return 1
  fi
}

usage() {
  echo "Usage: $0 --list | --validate <tasks> | --commands <tasks> | --timeout <task> | --requires-current-base <tasks> | --run <tasks>" >&2
}

case "${1:-}" in
  --list)
    [[ $# -eq 1 ]] || { usage; exit 2; }
    catalog
    ;;
  --validate)
    [[ $# -eq 2 ]] || { usage; exit 2; }
    normalize_tasks "$2"
    ;;
  --commands)
    [[ $# -eq 2 ]] || { usage; exit 2; }
    normalized_tasks="$(normalize_tasks "$2")"
    print_commands "$normalized_tasks"
    ;;
  --timeout)
    [[ $# -eq 2 ]] || { usage; exit 2; }
    normalized_tasks="$(normalize_tasks "$2")"
    [[ "$normalized_tasks" != *,* ]] || { echo "--timeout accepts one task." >&2; exit 2; }
    task_timeout_minutes "$normalized_tasks"
    ;;
  --requires-current-base)
    [[ $# -eq 2 ]] || { usage; exit 2; }
    normalized_tasks="$(normalize_tasks "$2")"
    requires_current_base "$normalized_tasks"
    ;;
  --run)
    [[ $# -eq 2 ]] || { usage; exit 2; }
    normalized_tasks="$(normalize_tasks "$2")"
    run_batch "$normalized_tasks"
    ;;
  *)
    usage
    exit 2
    ;;
esac
