#!/usr/bin/env bash
set -euo pipefail

task_timeout_minutes() {
  case "$1" in
    arc:runtime) echo 15 ;;
    preflight) echo 15 ;;
    loom:verify) echo 15 ;;
    rust:ci|hive:verify) echo 20 ;;
    web:build) echo 25 ;;
    web:e2e|web:e2e:debug|extension:e2e) echo 30 ;;
    check|ci:pr) echo 35 ;;
    ci:pr:e2e) echo 45 ;;
    *) echo 30 ;;
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

cleanup_timed_out_buildkit_work() {
  local builder="${NOOK_PR_BUILDX_BUILDER:-}"
  local cleanup_status=0

  if [[ -n "$builder" ]]; then
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
    arc:runtime) run_with_timeout "$timeout_minutes" bash .github/scripts/arc-runtime-smoke.sh ;;
    rust:ci) run_with_timeout "$timeout_minutes" env CI_ARTIFACT_DIR="$artifact_root/rust-ci" task ci:pr:rust ;;
    loom:verify) run_with_timeout "$timeout_minutes" task loom:verify ;;
    web:build) run_with_timeout "$timeout_minutes" task web:build ;;
    web:e2e) run_with_timeout "$timeout_minutes" env E2E_ARTIFACT_DIR="$artifact_root/web-e2e" task web:test:e2e ;;
    web:e2e:debug) run_with_timeout "$timeout_minutes" env E2E_ARTIFACT_DIR="$artifact_root/web-e2e-debug" NOOK_REMOTE_E2E_DEBUG=1 task _web:test:e2e:debug ;;
    extension:e2e) run_with_timeout "$timeout_minutes" env E2E_ARTIFACT_DIR="$artifact_root/extension-e2e" task extension:test:e2e ;;
    hive:verify) run_with_timeout "$timeout_minutes" env HIVE_CACHE_TO= task hive:verify ;;
    check) run_with_timeout "$timeout_minutes" task check ;;
    ci:pr) run_with_timeout "$timeout_minutes" task ci:pr ;;
    ci:pr:e2e) run_with_timeout "$timeout_minutes" env E2E_ARTIFACT_DIR="$artifact_root/ci-pr-e2e" task ci:pr:e2e ;;
    *) run_with_timeout "$timeout_minutes" task "$1" ;;
  esac
}

run_batch() {
  local raw_tasks="$1"
  local task
  local status
  local failures=0
  local timeout_cleanup_status
  local -a tasks

  IFS=',' read -r -a tasks <<< "$raw_tasks"
  if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
    printf '## Remote task batch\n\n| Task | Result |\n|---|---|\n' >> "$GITHUB_STEP_SUMMARY"
  fi

  for task in "${tasks[@]}"; do
    echo "::group::Remote task: $task"
    set +e
    run_task "$task"
    status=$?
    if (( status == 124 || status == 137 )); then
      timeout_cleanup_status=0
      cleanup_timed_out_buildkit_work || timeout_cleanup_status=1
      restore_exact_worktree || timeout_cleanup_status=1
      if (( timeout_cleanup_status != 0 )); then
        echo "::error::Failed to restore exact runner state after timeout: $task"
        status=1
      fi
    fi
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
  echo "Usage: $0 --timeout <task> | --run <task[,task...]>" >&2
}

case "${1:-}" in
  --timeout)
    [[ $# -eq 2 ]] || { usage; exit 2; }
    task_timeout_minutes "$2"
    ;;
  --run)
    [[ $# -eq 2 ]] || { usage; exit 2; }
    run_batch "$2"
    ;;
  *)
    usage
    exit 2
    ;;
esac
