#!/usr/bin/env bash
# Run the task-planning agent in a detached worktree and copy the plan file back.
#
# Required env:
#   WORKBENCH_PLAN_FILE — relative path of the plan artifact inside the checkout
# Optional env:
#   CI_AGENT_PROMPT_FILE, CI_AGENT_TIMEOUT_MS, CURSOR_API_KEY (consumed by ci-agent:run)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

: "${WORKBENCH_PLAN_FILE:?WORKBENCH_PLAN_FILE is required}"

rm -f -- "$WORKBENCH_PLAN_FILE"
planning_parent="$(mktemp -d)"
planning_root="$planning_parent/checkout"
cleanup() {
  git worktree remove --force "$planning_root" 2>/dev/null || true
  rm -rf -- "$planning_parent"
}
trap cleanup EXIT
git worktree add --detach "$planning_root" HEAD
REPO_ROOT="$planning_root" task ci-agent:run
test -s "$planning_root/$WORKBENCH_PLAN_FILE"
cp -- "$planning_root/$WORKBENCH_PLAN_FILE" "$WORKBENCH_PLAN_FILE"
test -s "$WORKBENCH_PLAN_FILE"
